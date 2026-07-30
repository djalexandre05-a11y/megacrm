// ============================================================================
// dispatch-campaign  (cron target, 30s)
// ----------------------------------------------------------------------------
// Disparo em massa via Zernio Broadcasts (substitui o loop por-contato na Meta).
// O Zernio cuida de batching, retry e rate-limit — aqui NAO ha mais loop de
// backoff/tier proprio. Por tick, por campanha em `sending`:
//
//   1. Reserva um lote de campaign_contacts pendentes (FOR UPDATE SKIP LOCKED).
//   2. Agrupa por template efetivo (template_id_override ?? template da campanha)
//      — follow-ups usam template diferente do template-pai.
//   3. Para cada grupo: cria um broadcast, adiciona destinatarios (telefones em
//      lotes de 100), e dispara (`send`). Marca as linhas como 'sent' e grava
//      zernio_broadcast_id por linha (correlacao exata no webhook de status).
//
// Os status sent/delivered/read/failed por destinatario sao reconciliados depois
// pelo job sync-broadcast-status (polling de GET /broadcasts/{id}/recipients) —
// o evento de status do webhook do Zernio nao carrega o broadcastId.
//
// NOTA: broadcast NAO personaliza por destinatario. So variaveis 'literal' (mesmo
// valor para todos) sao preenchidas; qualquer variavel sem literal faz a linha
// FALHAR antes do envio (a Meta rejeitaria o template). Personalizacao real por
// contato depende da API de recipients do Zernio aceitar params por linha.
// ============================================================================

import { getAdminClient } from '../_shared/supabase-admin.ts';
import { jsonResponse, preflight } from '../_shared/cors.ts';
import { requireServiceRole } from '../_shared/auth.ts';
import {
  ZernioError,
  addBroadcastRecipients,
  createBroadcast,
  loadZernioContext,
  sendBroadcast,
} from '../_shared/zernio.ts';

// Teto de destinatarios processados por campanha por tick. O Zernio faz o
// batching real; isto so limita o trabalho de um unico tick de 30s.
const PER_TICK_LIMIT = 500;
const RECIPIENTS_CHUNK = 100;

interface CampaignRow {
  id: string;
  name: string;
  template_id: string;
  status: 'scheduled' | 'sending' | 'paused' | 'completed';
  variable_mapping: Record<string, VariableSource>;
}

interface TemplateRow {
  id: string;
  name: string;
  language: string;
  body: string;
}

interface CampaignContactRow {
  id: string;
  campaign_id: string;
  contact_id: string;
  template_id_override: string | null;
}

type VariableSource =
  | { source: 'literal'; value: string }
  | { source: 'contact_field'; field: 'name' | 'email' | 'phone' }
  | { source: 'custom_field'; field: string };

function countVariables(body: string): number {
  const matches = body.match(/\{\{\s*\d+\s*\}\}/g) ?? [];
  return new Set(matches).size;
}

// Componentes do broadcast a partir do template + mapeamento de variaveis.
// Broadcast NAO personaliza por destinatario: so variaveis 'literal' com valor
// nao-vazio podem ser preenchidas. Qualquer outra (campo do contato/custom, ou
// literal vazio) eh reportada em `missing` — o chamador FALHA a linha em vez de
// enviar parametro vazio, que a Meta rejeitaria com "Required template parameter
// is missing" (a mensagem nunca chegaria, sem aviso).
function buildBroadcastComponents(
  template: TemplateRow,
  mapping: Record<string, VariableSource> | null,
): { components: unknown[]; missing: number[] } {
  const varCount = countVariables(template.body);
  if (varCount === 0) return { components: [], missing: [] };
  const parameters: Array<{ type: 'text'; text: string }> = [];
  const missing: number[] = [];
  for (let i = 1; i <= varCount; i++) {
    const src = mapping?.[String(i)];
    if (src?.source === 'literal' && src.value.trim() !== '') {
      parameters.push({ type: 'text', text: src.value });
    } else {
      missing.push(i);
      parameters.push({ type: 'text', text: '' });
    }
  }
  return { components: [{ type: 'body', parameters }], missing };
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// Renderiza o corpo do template substituindo as variaveis pelos valores literais
// do mapeamento da campanha (broadcast so usa literais — mesmo texto p/ todos).
function renderTemplatePreview(body: string, mapping: Record<string, VariableSource> | null): string {
  return body.replace(/\{\{\s*(\d+)\s*\}\}/g, (_w, n: string) => {
    const src = mapping?.[n];
    return src?.source === 'literal' ? src.value : `{{${n}}}`;
  });
}

// Espelha cada destinatario do broadcast na inbox: garante uma conversa por
// contato e grava a mensagem outbound do template (mesmo preview para todos).
// Sem isso o disparo em massa nunca aparece na inbox (so atualizava
// campaign_contacts). Nao pausa a IA nem mexe no status da conversa — apenas
// registra a mensagem e sobe `last_message_at` para reordenar a lista.
async function recordCampaignInbox(
  admin: ReturnType<typeof getAdminClient>,
  contactIds: string[],
  preview: string,
  sentAt: string,
): Promise<void> {
  if (contactIds.length === 0) return;

  // Conversas existentes desses contatos.
  const { data: existing } = await admin
    .from('conversations')
    .select('id, contact_id')
    .in('contact_id', contactIds);
  const convByContact = new Map<string, string>();
  for (const row of (existing ?? []) as Array<{ id: string; contact_id: string }>) {
    convByContact.set(row.contact_id, row.id);
  }

  // Cria conversas para contatos ainda sem uma (default 'ai_active').
  const missingContacts = contactIds.filter((id) => !convByContact.has(id));
  if (missingContacts.length > 0) {
    const { data: created } = await admin
      .from('conversations')
      .insert(missingContacts.map((id) => ({ contact_id: id, status: 'ai_active', last_message_at: sentAt })))
      .select('id, contact_id');
    for (const row of (created ?? []) as Array<{ id: string; contact_id: string }>) {
      convByContact.set(row.contact_id, row.id);
    }
  }

  // Mensagem outbound (template) por conversa.
  const messages = contactIds
    .map((cid) => convByContact.get(cid))
    .filter((id): id is string => Boolean(id))
    .map((conversationId) => ({
      conversation_id: conversationId,
      direction: 'outbound',
      sender_type: 'system',
      content_type: 'template',
      content: preview,
      meta_status: 'sent',
      is_private_note: false,
    }));
  if (messages.length > 0) {
    await admin.from('messages').insert(messages);
    await admin
      .from('conversations')
      .update({ last_message_at: sentAt })
      .in('id', [...convByContact.values()]);
  }
}

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;

  try {
    await requireServiceRole(req);
  } catch {
    return jsonResponse({ ok: false, error: 'Forbidden' }, { status: 403 });
  }

  const admin = getAdminClient();

  // 1. Promove scheduled → sending para campanhas cujo horario chegou.
  const nowIso = new Date().toISOString();
  await admin
    .from('campaigns')
    .update({ status: 'sending', started_at: nowIso })
    .eq('status', 'scheduled')
    .lte('scheduled_at', nowIso);

  // 2. Campanhas em envio.
  const { data: campaigns, error: campErr } = await admin
    .from('campaigns')
    .select('id, name, template_id, status, variable_mapping')
    .eq('status', 'sending');
  if (campErr) return jsonResponse({ ok: false, error: campErr.message }, { status: 500 });

  const rows = (campaigns ?? []) as CampaignRow[];
  if (rows.length === 0) return jsonResponse({ ok: true, processed: 0 });

  // Credenciais Zernio (uma vez por tick).
  let ctx: Awaited<ReturnType<typeof loadZernioContext>>;
  try {
    ctx = await loadZernioContext();
  } catch (err) {
    const status = err instanceof ZernioError ? err.status : 500;
    return jsonResponse({ ok: false, error: err instanceof Error ? err.message : 'Erro' }, { status });
  }
  if (!ctx.profileId) {
    return jsonResponse(
      { ok: false, error: 'profileId do Zernio ausente (necessario para broadcasts). Reabra /settings/credentials.' },
      { status: 500 },
    );
  }

  let totalSent = 0;
  let totalFailed = 0;
  const errors: string[] = [];
  const templateCache = new Map<string, TemplateRow | null>();

  async function getTemplate(id: string): Promise<TemplateRow | null> {
    if (templateCache.has(id)) return templateCache.get(id) ?? null;
    const { data: tpl } = await admin
      .from('templates')
      .select('id, name, language, body')
      .eq('id', id)
      .maybeSingle();
    const row = tpl ? (tpl as TemplateRow) : null;
    templateCache.set(id, row);
    return row;
  }

  for (const c of rows) {
    // Reserva atomica do lote pendente.
    const { data: pending, error: pErr } = await admin.rpc('claim_campaign_contacts', {
      p_campaign_id: c.id,
      p_limit: PER_TICK_LIMIT,
    });
    if (pErr) {
      errors.push(`campaign ${c.id}: ${pErr.message}`);
      continue;
    }
    const queue = (pending ?? []) as CampaignContactRow[];
    if (queue.length === 0) {
      // Nada reservavel: conclui a campanha se nao ha mais nada pendente.
      const { count: pendingLeft } = await admin
        .from('campaign_contacts')
        .select('id', { count: 'exact', head: true })
        .eq('campaign_id', c.id)
        .eq('status', 'pending');
      if ((pendingLeft ?? 0) === 0) {
        await admin
          .from('campaigns')
          .update({ status: 'completed', completed_at: new Date().toISOString() })
          .eq('id', c.id);
      }
      continue;
    }

    // Telefones dos contatos do lote.
    const contactIds = queue.map((q) => q.contact_id);
    const { data: contacts } = await admin
      .from('contacts')
      .select('id, phone')
      .in('id', contactIds);
    const phoneById = new Map<string, string>();
    for (const row of (contacts ?? []) as Array<{ id: string; phone: string }>) {
      phoneById.set(row.id, row.phone);
    }

    // Agrupa por template efetivo.
    const groups = new Map<string, CampaignContactRow[]>();
    for (const q of queue) {
      const tid = q.template_id_override ?? c.template_id;
      const list = groups.get(tid) ?? [];
      list.push(q);
      groups.set(tid, list);
    }

    let campaignSent = 0;
    let campaignFailed = 0;
    let lastBroadcastId: string | null = null;

    for (const [templateId, groupRows] of groups) {
      const template = await getTemplate(templateId);
      const releaseOrFail = async (failMessage: string | null, retryable: boolean) => {
        // retryable → volta a pending (libera reserva); senao marca failed.
        const ids = groupRows.map((r) => r.id);
        if (retryable) {
          await admin
            .from('campaign_contacts')
            .update({ status: 'pending', claimed_at: null, error_message: failMessage })
            .in('id', ids);
        } else {
          await admin
            .from('campaign_contacts')
            .update({ status: 'failed', claimed_at: null, error_message: failMessage })
            .in('id', ids);
          campaignFailed += ids.length;
        }
      };

      if (!template) {
        await releaseOrFail('Template nao encontrado', false);
        errors.push(`campaign ${c.id}: template ${templateId} nao encontrado`);
        continue;
      }

      const phones = groupRows
        .map((r) => phoneById.get(r.contact_id))
        .filter((p): p is string => Boolean(p));
      if (phones.length === 0) {
        await releaseOrFail('Contatos sem telefone', false);
        continue;
      }

      const { components, missing } = buildBroadcastComponents(template, c.variable_mapping);
      if (missing.length > 0) {
        // Guarda defensiva: nunca disparar com variavel em branco. Marca a linha
        // failed com motivo legivel em vez de virar "sent" e a mensagem sumir.
        const msg = `Variaveis sem texto literal: ${missing.map((i) => `{{${i}}}`).join(', ')}. Broadcast nao personaliza por contato.`;
        await releaseOrFail(msg, false);
        errors.push(`campaign ${c.id}: ${msg}`);
        continue;
      }

      try {
        const broadcastId = await createBroadcast({
          apiKey: ctx.apiKey,
          profileId: ctx.profileId,
          accountId: ctx.accountId,
          name: `${c.name} · ${template.name}`,
          template: { name: template.name, language: template.language, components },
        });
        for (const part of chunk(phones, RECIPIENTS_CHUNK)) {
          await addBroadcastRecipients({ apiKey: ctx.apiKey, broadcastId, phones: part });
        }
        await sendBroadcast({ apiKey: ctx.apiKey, broadcastId });

        const sentAt = new Date().toISOString();
        await admin
          .from('campaign_contacts')
          .update({ status: 'sent', sent_at: sentAt, zernio_broadcast_id: broadcastId, error_message: null, claimed_at: null })
          .in('id', groupRows.map((r) => r.id));
        campaignSent += groupRows.length;
        lastBroadcastId = broadcastId;

        // Espelha o disparo na inbox (apenas contatos efetivamente no broadcast,
        // i.e. com telefone resolvido). Falha aqui nao deve reverter o envio.
        try {
          const preview = renderTemplatePreview(template.body, c.variable_mapping);
          const sentContactIds = groupRows
            .map((r) => r.contact_id)
            .filter((cid) => phoneById.has(cid));
          await recordCampaignInbox(admin, sentContactIds, preview, sentAt);
        } catch (inboxErr) {
          errors.push(`campaign ${c.id}: inbox mirror: ${inboxErr instanceof Error ? inboxErr.message : 'erro'}`);
        }
      } catch (err) {
        const retryable = err instanceof ZernioError && (err.status === 429 || err.status >= 500);
        const msg = err instanceof Error ? err.message : 'Erro no broadcast';
        await releaseOrFail(retryable ? `Tentando novamente: ${msg}` : msg, retryable);
        errors.push(`campaign ${c.id}: broadcast: ${msg}`);
      }
    }

    if (campaignSent > 0) {
      await admin.rpc('bump_campaign_counter', { p_campaign_id: c.id, p_column: 'sent', p_delta: campaignSent });
    }
    if (campaignFailed > 0) {
      await admin.rpc('bump_campaign_counter', { p_campaign_id: c.id, p_column: 'failed', p_delta: campaignFailed });
    }
    if (lastBroadcastId) {
      await admin.from('campaigns').update({ zernio_broadcast_id: lastBroadcastId }).eq('id', c.id);
    }

    totalSent += campaignSent;
    totalFailed += campaignFailed;
  }

  return jsonResponse({ ok: true, campaigns: rows.length, sent: totalSent, failed: totalFailed, errors });
});
