// ============================================================================
// check-follow-ups  (cron target, 15min)
// ----------------------------------------------------------------------------
// Scans active follow_up_rules and enqueues the next message for every
// recipient that:
//   · received an earlier message of the same chain,
//   · has not replied,
//   · is past the rule's delay_hours window.
//
// We enqueue by inserting a new campaign_contacts row with status='pending'
// pointing to the follow-up template via the campaign's `template_id`. The
// dispatch-campaign cron picks them up next tick.
//
// Chain de-duplication: skip contacts that already have a campaign_contacts
// row pointing at the follow-up template (template_id_override = rule.template_id),
// so each rule fires at most once per contact.
// ============================================================================

import { getAdminClient } from '../_shared/supabase-admin.ts';
import { jsonResponse, preflight } from '../_shared/cors.ts';
import { requireServiceRole } from '../_shared/auth.ts';

interface FollowUpRule {
  id: string;
  campaign_id: string | null;
  trigger_condition: 'no_reply';
  delay_hours: number;
  template_id: string;
  sequence_order: number;
  is_active: boolean;
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

  const { data: rules, error: rulesErr } = await admin
    .from('follow_up_rules')
    .select('id, campaign_id, trigger_condition, delay_hours, template_id, sequence_order, is_active')
    .eq('is_active', true);
  if (rulesErr) return jsonResponse({ ok: false, error: rulesErr.message }, { status: 500 });

  const active = (rules ?? []) as FollowUpRule[];
  if (active.length === 0) return jsonResponse({ ok: true, enqueued: 0, rules: 0 });

  let totalEnqueued = 0;
  const errors: string[] = [];

  for (const rule of active) {
    // Time-window: messages sent BEFORE this cutoff are due for the follow-up.
    const cutoff = new Date(Date.now() - rule.delay_hours * 3600 * 1000).toISOString();

    // Find recipients that are eligible.
    //  - status in (sent, delivered, read) means the message landed.
    //  - replied_at IS NULL means they never came back to us.
    //  - sent_at <= cutoff enforces the delay.
    //  - scope: if rule.campaign_id is set, only that campaign; otherwise
    //    every campaign in the instance.
    // Apenas a mensagem ORIGINAL da campanha (template_id_override IS NULL)
    // dispara um follow-up. Sem isso, a própria linha do follow-up (que ganha
    // sent_at ao ser enviada) voltaria a casar a elegibilidade e re-disparar.
    let query = admin
      .from('campaign_contacts')
      .select('id, campaign_id, contact_id, sent_at')
      .in('status', ['sent', 'delivered', 'read'])
      .is('replied_at', null)
      .is('template_id_override', null)
      .lte('sent_at', cutoff)
      .limit(500);
    if (rule.campaign_id) {
      query = query.eq('campaign_id', rule.campaign_id);
    }
    const { data: eligible, error: eligErr } = await query;
    if (eligErr) {
      errors.push(`rule ${rule.id}: ${eligErr.message}`);
      continue;
    }

    const batch = (eligible ?? []) as Array<{
      id: string;
      campaign_id: string;
      contact_id: string;
    }>;
    if (batch.length === 0) continue;

    // Dedupe DURÁVEL: pula contatos que já têm QUALQUER linha apontando para o
    // template deste follow-up (template_id_override = rule.template_id),
    // independentemente do status. Diferente do marcador antigo em
    // error_message (que o dispatch zerava ao enviar, causando re-enfileiramento
    // infinito), o template_id_override persiste na linha após o envio — então
    // cada regra dispara no máximo uma vez por contato.
    const contactIds = batch.map((b) => b.contact_id);
    const { data: alreadyEnq } = await admin
      .from('campaign_contacts')
      .select('contact_id')
      .in('contact_id', contactIds)
      .eq('template_id_override', rule.template_id);
    const alreadyEnqueuedSet = new Set(
      ((alreadyEnq ?? []) as Array<{ contact_id: string }>).map((r) => r.contact_id),
    );

    const toInsert = batch
      .filter((b) => !alreadyEnqueuedSet.has(b.contact_id))
      .map((b) => ({
        campaign_id: b.campaign_id,
        contact_id: b.contact_id,
        status: 'pending' as const,
        // Points dispatch-campaign at the follow-up template instead of the
        // parent campaign's default template (see migration 19).
        template_id_override: rule.template_id,
        // Breadcrumb legível na UI (não é mais usado como fingerprint).
        error_message: `Follow-up (ordem ${rule.sequence_order})`,
      }));

    if (toInsert.length === 0) continue;

    const { error: insErr } = await admin.from('campaign_contacts').insert(toInsert);
    if (insErr) {
      errors.push(`rule ${rule.id}: insert: ${insErr.message}`);
      continue;
    }

    // Reabre campanhas já concluídas para que o dispatch-campaign (que só varre
    // status='sending') volte a processar a fila de follow-up recém-criada.
    const reopenIds = Array.from(new Set(toInsert.map((r) => r.campaign_id)));
    await admin
      .from('campaigns')
      .update({ status: 'sending', completed_at: null })
      .in('id', reopenIds)
      .eq('status', 'completed');

    totalEnqueued += toInsert.length;
  }

  return jsonResponse({
    ok: true,
    rules: active.length,
    enqueued: totalEnqueued,
    errors,
  });
});
