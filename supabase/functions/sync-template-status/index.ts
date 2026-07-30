// ============================================================================
// sync-template-status
// ----------------------------------------------------------------------------
// Sincroniza o status dos templates direto da Meta (via Zernio
// GET /whatsapp/templates), como fallback ao webhook
// whatsapp.template.status_updated. Útil quando o webhook atrasa ou falha.
// Admin-only, acionado por um botão na tela de Templates.
// ============================================================================

import { requireAdmin, AuthError } from '../_shared/auth.ts';
import { getAdminClient } from '../_shared/supabase-admin.ts';
import { jsonResponse, preflight } from '../_shared/cors.ts';
import { ZernioError, listTemplates, loadZernioContext } from '../_shared/zernio.ts';

function mapStatus(meta: string | null): 'approved' | 'rejected' | 'pending' {
  const s = (meta ?? '').toUpperCase();
  if (s === 'APPROVED') return 'approved';
  if (['REJECTED', 'DISABLED', 'PAUSED'].includes(s)) return 'rejected';
  return 'pending';
}

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;

  try {
    await requireAdmin(req);
    const admin = getAdminClient();
    const ctx = await loadZernioContext();

    const remote = await listTemplates(ctx.apiKey, ctx.accountId);
    const byName = new Map(remote.filter((t) => t.name).map((t) => [t.name as string, t]));

    // Só os templates que já foram submetidos (têm submitted_at) e ainda não
    // estão num estado terminal definitivo precisam de sync; mas sincronizamos
    // todos que casam por nome para refletir mudanças (ex.: pausados).
    const { data: locals, error } = await admin
      .from('templates')
      .select('id, name, status');
    if (error) return jsonResponse({ ok: false, error: error.message }, { status: 500 });

    let updated = 0;
    let approved = 0;
    let rejected = 0;
    for (const local of (locals ?? []) as Array<{ id: string; name: string; status: string }>) {
      const r = byName.get(local.name);
      if (!r) continue;
      const mapped = mapStatus(r.status);
      const patch: Record<string, unknown> = {
        status: mapped,
        meta_template_status: r.status ?? null,
      };
      if (r.id) patch.meta_template_id = r.id;
      if (mapped === 'approved') {
        patch.approved_at = new Date().toISOString();
        approved++;
      } else if (mapped === 'rejected') {
        rejected++;
      }
      // Evita escrita redundante quando nada mudou.
      if (local.status !== mapped || r.id) {
        await admin.from('templates').update(patch).eq('id', local.id);
        updated++;
      }
    }

    return jsonResponse({ ok: true, checked: remote.length, updated, approved, rejected });
  } catch (err) {
    if (err instanceof AuthError) {
      return jsonResponse({ ok: false, error: err.message }, { status: err.status });
    }
    if (err instanceof ZernioError) {
      return jsonResponse({ ok: false, error: err.message }, { status: err.status === 401 ? 401 : 502 });
    }
    console.error('sync-template-status error', err);
    return jsonResponse({ ok: false, error: err instanceof Error ? err.message : 'Erro interno' }, { status: 500 });
  }
});
