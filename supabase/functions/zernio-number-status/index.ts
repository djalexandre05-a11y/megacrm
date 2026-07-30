// ============================================================================
// zernio-number-status
// ----------------------------------------------------------------------------
// Status do número WhatsApp conectado (tier / quality / health / display), para
// o widget do dashboard. Qualquer usuário autenticado (admin ou operador) pode
// ler. Serve o cache em `zernio_number_info` (atualizado no /setup e pelos
// eventos whatsapp.number.* do webhook); se o cache estiver vazio, busca ao
// vivo no Zernio uma vez e cacheia.
// ============================================================================

import { requireCaller, AuthError } from '../_shared/auth.ts';
import { getCredential, setCredential } from '../_shared/credentials.ts';
import { jsonResponse, preflight } from '../_shared/cors.ts';
import { ZernioError, getNumberInfo, loadZernioContext } from '../_shared/zernio.ts';

interface NumberInfo {
  messaging_limit_tier: string | null;
  quality_rating: string | null;
  health_status: string | null;
  display_phone_number: string | null;
  verified_name: string | null;
}

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;

  try {
    await requireCaller(req);

    let info: NumberInfo | null = null;
    const cached = await getCredential('zernio_number_info');
    if (cached) {
      try {
        info = JSON.parse(cached) as NumberInfo;
      } catch {
        info = null;
      }
    }

    if (!info) {
      // Cache vazio: resolve ao vivo (uma vez) e cacheia.
      const ctx = await loadZernioContext();
      info = await getNumberInfo(ctx.apiKey, ctx.accountId);
      await setCredential('zernio_number_info', JSON.stringify(info));
    }

    return jsonResponse({ ok: true, connected: Boolean(info?.display_phone_number), number: info }, { status: 200 });
  } catch (err) {
    if (err instanceof AuthError) {
      return jsonResponse({ ok: false, error: err.message }, { status: err.status });
    }
    if (err instanceof ZernioError) {
      // Sem configuração / chave inválida: o widget só mostra "não conectado".
      return jsonResponse({ ok: true, connected: false, number: null }, { status: 200 });
    }
    console.error('zernio-number-status error', err);
    return jsonResponse({ ok: false, error: err instanceof Error ? err.message : 'Erro interno' }, { status: 500 });
  }
});
