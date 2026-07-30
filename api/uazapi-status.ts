import { getCredential } from '../src/lib/credentials.js';
import { requireAdmin } from '../src/lib/admin-auth.js';

// Status e webhook da instância Uazapi (server-side; o token nunca vai ao browser).
// Doc oficial (docs.uazapi.com):
//   GET  /instance/status  — header `token` (da instância; admintoken NÃO é necessário)
//                            → { instance, status: { connected, loggedIn, jid } }
//   POST /webhook          — header `token` → { enabled, url, events[...] }
// GET  aqui → status da conexão + URL do webhook a cadastrar.
// POST aqui → registra o webhook na Uazapi automaticamente.

type ApiRequest = {
  method?: string;
  headers?: Record<string, string | string[] | undefined>;
};

type ApiResponse = {
  status: (code: number) => ApiResponse;
  json: (body: unknown) => void;
  end: () => void;
};

function webhookUrl(): string | null {
  const base = (process.env.SUPABASE_URL ?? '').replace(/\/$/, '');
  return base ? `${base}/functions/v1/whatsapp-inbound?provider=uazapi` : null;
}

export default async function handler(req: ApiRequest, res: ApiResponse) {
  try {
    if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).end();

    const auth = await requireAdmin(req.headers?.authorization ?? req.headers?.Authorization);
    if (!auth.ok) {
      return res.status(auth.status).json({ success: false, message: auth.message });
    }

    const serverUrl = ((await getCredential('uazapi_server_url')) ?? '').replace(/\/$/, '');
    const token = (await getCredential('uazapi_instance_token')) ?? '';
    const hook = webhookUrl();

    if (!serverUrl || !token) {
      return res.status(200).json({ success: true, configured: false, webhook_url: hook });
    }

    if (req.method === 'GET') {
      // Saúde da conexão: GET /instance/status com o token da instância.
      const r = await fetch(`${serverUrl}/instance/status`, {
        headers: { token },
        signal: AbortSignal.timeout(10000),
      });
      const body = (await r.json().catch(() => ({}))) as {
        status?: { connected?: boolean; loggedIn?: boolean };
        instance?: { name?: string; profileName?: string; owner?: string };
      };
      if (!r.ok) {
        return res.status(200).json({
          success: true,
          configured: true,
          connected: false,
          error: `Uazapi respondeu ${r.status}`,
          webhook_url: hook,
        });
      }
      return res.status(200).json({
        success: true,
        configured: true,
        connected: Boolean(body.status?.connected),
        logged_in: Boolean(body.status?.loggedIn),
        instance_name: body.instance?.profileName ?? body.instance?.name ?? null,
        webhook_url: hook,
      });
    }

    // POST → registra o webhook na instância (POST /webhook, token da instância).
    if (!hook) {
      return res.status(500).json({ success: false, message: 'SUPABASE_URL ausente no runtime.' });
    }
    const r = await fetch(`${serverUrl}/webhook`, {
      method: 'POST',
      headers: { token, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        enabled: true,
        url: hook,
        events: ['messages', 'connection'],
        // Recomendação da própria Uazapi: wasSentByApi evita loop com a nossa
        // automação; isGroupYes ignora mensagens de grupos.
        excludeMessages: ['wasSentByApi', 'isGroupYes'],
      }),
      signal: AbortSignal.timeout(10000),
    });
    const body = await r.text();
    if (!r.ok) {
      return res.status(200).json({
        success: false,
        message: `Uazapi rejeitou o webhook (${r.status}): ${body.slice(0, 200)}`,
        webhook_url: hook,
      });
    }
    return res.status(200).json({ success: true, webhook_url: hook });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: err instanceof Error ? err.message : 'Erro interno',
    });
  }
}
