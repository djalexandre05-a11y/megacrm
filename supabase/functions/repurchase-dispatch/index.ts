// ============================================================================
// repurchase-dispatch  (cron target, diário)
// ----------------------------------------------------------------------------
// Consome a fila de predições de recompra (repurchase_predictions) e dispara
// o template de recompra via Zernio para cada par cliente+produto vencido.
//
// GUARDRAILS (ordem de curto-circuito):
//   1. Kill-switch: repurchase_config.auto_send = false → NADA é enviado.
//   2. Template não configurado → nada é enviado.
//   3. Horário comercial (app_settings.business_hours, America/Sao_Paulo):
//      fora da janela do dia → o run inteiro é adiado para o próximo tick.
//   4. Cooldown por par (last_sent_at + cooldown_days) → não reenvia.
//   5. Telefone validado em E.164 antes de qualquer chamada externa.
//   6. Auditoria: cada envio (e cada skip por telefone inválido) vira uma
//      linha em crm_ai_actions com template, variáveis e message id.
//
// Template esperado (Meta, aprovado): "Olá {{1}}, vi no nosso sistema que o
// seu estoque de {{2}} está acabando. Deseja repor o seu estoque?"
//   {{1}} = customer_name · {{2}} = product_name
// ============================================================================

import { getAdminClient } from '../_shared/supabase-admin.ts';
import { jsonResponse, preflight } from '../_shared/cors.ts';
import { requireAdmin, requireServiceRole } from '../_shared/auth.ts';
import {
  ZernioError,
  createInboxConversation,
  loadZernioContext,
  sendInboxTemplate,
} from '../_shared/zernio.ts';

const BATCH_LIMIT = 50;
const E164 = /^\+\d{10,15}$/;
const TZ = 'America/Sao_Paulo';

interface RepurchaseConfig {
  auto_send: boolean;
  lead_days: number;
  cooldown_days: number;
  template_name: string | null;
  template_language: string;
}

interface Prediction {
  id: string;
  customer_doc: string;
  customer_phone: string;
  customer_name: string | null;
  product_name: string;
  predicted_next: string;
  last_sent_at: string | null;
}

type Admin = ReturnType<typeof getAdminClient>;

// business_hours: { mon: {start:'08:00', end:'18:00'}, ... }. Ausente ou
// malformado → permite (o kill-switch é a proteção mestre; isto é refinamento).
function withinBusinessHours(businessHours: unknown): boolean {
  if (!businessHours || typeof businessHours !== 'object') return true;
  const now = new Date();
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ, weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false,
  });
  const parts = Object.fromEntries(fmt.formatToParts(now).map((p) => [p.type, p.value]));
  const dayKey = String(parts.weekday ?? '').toLowerCase().slice(0, 3); // mon, tue…
  const window = (businessHours as Record<string, unknown>)[dayKey];
  if (!window || typeof window !== 'object') return false; // dia sem janela = não envia
  const { start, end } = window as { start?: string; end?: string };
  if (!start || !end) return false;
  const hhmm = `${parts.hour}:${parts.minute}`;
  return hhmm >= start && hhmm <= end;
}

async function findOrCreateContact(admin: Admin, phone: string, name: string | null): Promise<string | null> {
  const { data: existing } = await admin.from('contacts').select('id').eq('phone', phone).maybeSingle();
  if (existing) return (existing as { id: string }).id;
  const { data: created, error } = await admin
    .from('contacts')
    .insert({ phone, name, source: 'import' })
    .select('id')
    .single();
  if (error) return null;
  return (created as { id: string }).id;
}

async function findOrCreateConversation(admin: Admin, contactId: string): Promise<{ id: string; zernio: string | null } | null> {
  const { data: existing } = await admin
    .from('conversations')
    .select('id, zernio_conversation_id')
    .eq('contact_id', contactId)
    .maybeSingle();
  if (existing) {
    const row = existing as { id: string; zernio_conversation_id: string | null };
    return { id: row.id, zernio: row.zernio_conversation_id };
  }
  const { data: created, error } = await admin
    .from('conversations')
    .insert({ contact_id: contactId, status: 'ai_active', last_message_at: new Date().toISOString() })
    .select('id')
    .single();
  if (error) return null;
  return { id: (created as { id: string }).id, zernio: null };
}

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;

  // Dois modos: cron (service role, batch de vencidos) e MANUAL (admin da UI
  // com { prediction_id } — "Disparar mensagem agora"). O manual é intenção
  // humana explícita: pula kill-switch, horário comercial, cooldown e due-date;
  // mantém template obrigatório e validação E.164.
  let manualId: string | null = null;
  try {
    await requireServiceRole(req);
  } catch {
    try {
      await requireAdmin(req);
      const body = (await req.json().catch(() => ({}))) as { prediction_id?: string };
      manualId = (body.prediction_id ?? '').trim() || null;
      if (!manualId) {
        return jsonResponse({ ok: false, error: 'prediction_id ausente.' }, { status: 400 });
      }
    } catch {
      return jsonResponse({ ok: false, error: 'Forbidden' }, { status: 403 });
    }
  }

  const admin = getAdminClient();

  // -- Guardrail 1: kill-switch (só no modo cron) -----------------------------
  const { data: cfgRow, error: cfgErr } = await admin
    .from('repurchase_config')
    .select('auto_send, lead_days, cooldown_days, template_name, template_language')
    .eq('id', 1)
    .maybeSingle();
  if (cfgErr) return jsonResponse({ ok: false, error: cfgErr.message }, { status: 500 });
  const cfg = (cfgRow ?? null) as RepurchaseConfig | null;
  if (!cfg || (!manualId && !cfg.auto_send)) {
    if (!cfg) return jsonResponse({ ok: false, error: 'repurchase_config ausente.' }, { status: 500 });
    return jsonResponse({ ok: true, skipped: 'kill_switch_off', sent: 0 });
  }

  // -- Guardrail 2: template configurado -------------------------------------
  const templateName = cfg.template_name?.trim();
  if (!templateName) {
    return jsonResponse({ ok: true, skipped: 'template_not_configured', sent: 0 });
  }

  // -- Guardrail 3: horário comercial (só no modo cron) -----------------------
  if (!manualId) {
    const { data: settings } = await admin
      .from('app_settings')
      .select('business_hours')
      .eq('id', 1)
      .maybeSingle();
    if (!withinBusinessHours((settings as { business_hours?: unknown } | null)?.business_hours)) {
      return jsonResponse({ ok: true, skipped: 'outside_business_hours', sent: 0 });
    }
  }

  // -- Fila: vencidos (predicted_next <= hoje + lead_days), fora do cooldown --
  const today = new Date();
  const leadCutoff = new Date(today.getTime() + cfg.lead_days * 86400 * 1000)
    .toISOString()
    .slice(0, 10);
  const cooldownCutoff = new Date(today.getTime() - cfg.cooldown_days * 86400 * 1000).toISOString();

  // Modo manual: só a predição pedida, sem filtro de status/vencimento/cooldown.
  const dueQuery = manualId
    ? admin
        .from('repurchase_predictions')
        .select('id, customer_doc, customer_phone, customer_name, product_name, predicted_next, last_sent_at')
        .eq('id', manualId)
        .limit(1)
    : admin
        .from('repurchase_predictions')
        .select('id, customer_doc, customer_phone, customer_name, product_name, predicted_next, last_sent_at')
        .eq('status', 'pending')
        .lte('predicted_next', leadCutoff)
        .or(`last_sent_at.is.null,last_sent_at.lt.${cooldownCutoff}`)
        .order('predicted_next')
        .limit(BATCH_LIMIT);
  const { data: due, error: dueErr } = await dueQuery;
  if (dueErr) return jsonResponse({ ok: false, error: dueErr.message }, { status: 500 });

  const queue = (due ?? []) as Prediction[];
  if (queue.length === 0) return jsonResponse({ ok: true, sent: 0, queue: 0 });

  const ctx = await loadZernioContext();
  let sent = 0;
  let skippedPhone = 0;
  const errors: string[] = [];

  for (const p of queue) {
    // -- Guardrail 5: E.164 ---------------------------------------------------
    const phone = p.customer_phone?.trim() ?? '';
    if (!E164.test(phone)) {
      skippedPhone++;
      await admin.from('crm_ai_actions').insert({
        action_type: 'repurchase_skip',
        description: `Recompra NÃO disparada: telefone inválido (${phone || 'vazio'})`,
        payload: { prediction_id: p.id, customer_doc: p.customer_doc, product: p.product_name },
      });
      // snoozed evita re-tentar o mesmo telefone inválido todo dia
      await admin.from('repurchase_predictions').update({ status: 'snoozed', updated_at: new Date().toISOString() }).eq('id', p.id);
      continue;
    }

    try {
      const customerName = p.customer_name?.trim() || 'cliente';
      const components = [{
        type: 'body',
        parameters: [
          { type: 'text', text: customerName },
          { type: 'text', text: p.product_name },
        ],
      }];

      const contactId = await findOrCreateContact(admin, phone, p.customer_name);
      if (!contactId) {
        errors.push(`${p.id}: contato falhou`);
        continue;
      }
      const conv = await findOrCreateConversation(admin, contactId);
      if (!conv) {
        errors.push(`${p.id}: conversa falhou`);
        continue;
      }

      let zConvId = conv.zernio;
      if (!zConvId) {
        const created = await createInboxConversation({
          apiKey: ctx.apiKey, accountId: ctx.accountId, participantId: phone,
        });
        zConvId = created.conversationId;
        if (zConvId) {
          await admin.from('conversations').update({ zernio_conversation_id: zConvId }).eq('id', conv.id);
        }
      }
      if (!zConvId) {
        errors.push(`${p.id}: Zernio não retornou conversationId`);
        continue;
      }

      const result = await sendInboxTemplate({
        apiKey: ctx.apiKey, accountId: ctx.accountId, conversationId: zConvId,
        name: templateName, language: cfg.template_language || 'pt_BR', components,
      });

      const preview =
        `Olá ${customerName}, vi no nosso sistema que o seu estoque de ${p.product_name} ` +
        'está acabando. Deseja repor o seu estoque?';
      await admin.from('messages').insert({
        conversation_id: conv.id, direction: 'outbound', sender_type: 'system',
        content_type: 'template', content: preview,
        zernio_message_id: result.messageId, meta_status: 'sent', is_private_note: false,
      });
      await admin.from('conversations').update({ last_message_at: new Date().toISOString() }).eq('id', conv.id);

      await admin.from('repurchase_predictions').update({
        status: 'sent', last_sent_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      }).eq('id', p.id);

      // -- Guardrail 6: auditoria --------------------------------------------
      await admin.from('crm_ai_actions').insert({
        contact_id: contactId,
        action_type: 'repurchase_sent',
        description: `Template de recompra "${templateName}" enviado (${p.product_name})`,
        payload: {
          prediction_id: p.id, customer_doc: p.customer_doc, product: p.product_name,
          template: templateName, variables: [customerName, p.product_name],
          zernio_message_id: result.messageId, predicted_next: p.predicted_next,
        },
      });
      sent++;
    } catch (err) {
      const msg = err instanceof ZernioError ? err.message : err instanceof Error ? err.message : String(err);
      errors.push(`${p.id}: ${msg}`);
    }
  }

  return jsonResponse({ ok: true, queue: queue.length, sent, skipped_phone: skippedPhone, errors });
});
