// ============================================================================
// whatsapp-inbound  (público, HMAC-verified para Zernio)  · Fase 4
// ----------------------------------------------------------------------------
// Fecha o loop de atribuição: mensagem inbound → origem no lead.
//   1. Roteia pelo provedor (?provider= ou detecção por X-Zernio-Signature).
//   2. Zernio: valida HMAC (X-Zernio-Signature) contra zernio_webhook_secret.
//   3. parseInboundWebhook do adapter (Fase 3). Ignora echo (isFromMe) e não-msg.
//   4. Idempotência por messageId em whatsapp_hub.webhook_events.
//   5. Resolve/cria o contato (por telefone).
//   6. extractReferral → chama a RPC attribute_inbound_lead, que aplica a
//      hierarquia CTWA > código de rastreio > whatsapp_direto.
//
// Deploy com --no-verify-jwt: provedores chamam anonimamente; o HMAC (Zernio) e
// a resolução de credenciais são os gates. Uazapi/Baileys não assinam (ASSUMIDO).
// ============================================================================

import { getAdminClient } from '../_shared/supabase-admin.ts';
import { getCredential } from '../_shared/credentials.ts';
import { jsonResponse, preflight } from '../_shared/cors.ts';
import {
  resolveInboundProvider,
  type ProviderName,
} from '../_shared/whatsapp/index.ts';

// --- HMAC (mesmo esquema do zernio-webhook) --------------------------------
function timingSafeEqualStr(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
async function hmacSha256(secret: string, payload: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload)));
}
function toHex(b: Uint8Array): string {
  return Array.from(b).map((x) => x.toString(16).padStart(2, '0')).join('');
}
function toB64(b: Uint8Array): string {
  let s = ''; for (const x of b) s += String.fromCharCode(x); return btoa(s);
}
function signatureMatches(header: string, mac: Uint8Array): boolean {
  const got = (header.startsWith('sha256=') ? header.slice(7) : header).trim();
  return timingSafeEqualStr(got, toHex(mac)) || timingSafeEqualStr(got, toB64(mac));
}

// Nome distinto do normalizePhone de _shared/whatsapp/types.ts — o bundler do
// bootstrap inlina os _shared no mesmo escopo do módulo.
function toE164(raw: string): string {
  const t = raw.trim();
  return t.startsWith('+') ? t : `+${t}`;
}

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  if (req.method !== 'POST') {
    return jsonResponse({ ok: false, error: 'Method not allowed' }, { status: 405 });
  }

  const url = new URL(req.url);
  const hasZernioSig = req.headers.get('X-Zernio-Signature') !== null;
  const hint = (url.searchParams.get('provider') as ProviderName | null)
    ?? (hasZernioSig ? 'zernio' : undefined);

  const rawBody = await req.text();

  // Zernio: HMAC obrigatório.
  if (hint === 'zernio' || hasZernioSig) {
    const secret = await getCredential('zernio_webhook_secret');
    const sig = req.headers.get('X-Zernio-Signature') ?? '';
    if (!secret) return jsonResponse({ ok: false, error: 'webhook secret ausente' }, { status: 500 });
    if (!sig) return jsonResponse({ ok: false, error: 'assinatura ausente' }, { status: 401 });
    const mac = await hmacSha256(secret, rawBody);
    if (!signatureMatches(sig, mac)) {
      return jsonResponse({ ok: false, error: 'assinatura inválida' }, { status: 401 });
    }
  }

  let payload: unknown;
  try { payload = JSON.parse(rawBody); }
  catch { return jsonResponse({ ok: false, error: 'JSON inválido' }, { status: 400 }); }

  const creds = {
    zernio_api_key: await getCredential('zernio_api_key'),
    uazapi_server_url: await getCredential('uazapi_server_url'),
    uazapi_instance_token: await getCredential('uazapi_instance_token'),
  };
  const provider = resolveInboundProvider(hint, creds);
  if (!provider) {
    return jsonResponse({ ok: false, error: 'nenhum provedor configurado' }, { status: 500 });
  }

  const inbound = provider.parseInboundWebhook(payload);
  // Não é mensagem inbound processável, ou é echo da própria conta → aceita e ignora.
  if (!inbound || inbound.isFromMe) {
    return jsonResponse({ ok: true, skipped: 'não-inbound ou echo' });
  }

  const admin = getAdminClient();

  // Idempotência por messageId (reusa webhook_events; chave prefixada por provider).
  const dedupKey = `${provider.name}:msg:${inbound.messageId}`;
  const { error: dupErr } = await admin
    .from('webhook_events')
    .insert({ zernio_event_id: dedupKey, event_type: 'message.received' });
  if (dupErr) {
    if ((dupErr as { code?: string }).code === '23505') {
      return jsonResponse({ ok: true, deduped: true });
    }
    console.log(JSON.stringify({ event: 'webhook_event_insert_failed', message: dupErr.message }));
  }

  // Resolve/cria contato por telefone.
  const phone = toE164(inbound.from);
  let contactId: string | null = null;
  {
    const { data: existing } = await admin
      .from('contacts').select('id').eq('phone', phone).maybeSingle();
    if (existing) contactId = (existing as { id: string }).id;
    else {
      const { data: created, error } = await admin
        .from('contacts')
        .insert({ phone, name: inbound.senderName ?? null, source: 'whatsapp' })
        .select('id').single();
      if (error) {
        return jsonResponse({ ok: false, error: `contato: ${error.message}` }, { status: 500 });
      }
      contactId = (created as { id: string }).id;
    }
  }

  // Inbox: mensagens Uazapi viram conversa (channel 'uazapi') + mensagem, para
  // aparecerem no inbox unificado. O caminho Zernio NÃO passa por aqui — o
  // zernio-webhook já cuida do inbox dele; duplicar criaria mensagens em dobro.
  if (provider.name === 'uazapi') {
    let conversationId: string | null = null;
    const { data: existingConv } = await admin
      .from('conversations').select('id').eq('contact_id', contactId).maybeSingle();
    if (existingConv) conversationId = (existingConv as { id: string }).id;
    else {
      const { data: createdConv } = await admin
        .from('conversations')
        .insert({
          contact_id: contactId,
          status: 'ai_active',
          channel: 'uazapi',
          last_message_at: new Date().toISOString(),
        })
        .select('id').single();
      conversationId = (createdConv as { id: string } | null)?.id ?? null;
    }
    if (conversationId) {
      const { error: msgErr } = await admin.from('messages').insert({
        conversation_id: conversationId,
        direction: 'inbound',
        sender_type: 'contact',
        content_type: inbound.contentType ?? 'text',
        content: inbound.text,
        media_url: inbound.mediaUrl ?? null,
        zernio_message_id: `uazapi:${inbound.messageId}`,
        is_private_note: false,
      });
      if (!msgErr) {
        await admin
          .from('conversations')
          .update({ last_message_at: new Date().toISOString() })
          .eq('id', conversationId);
        await admin.rpc('increment_unread_count', { p_conversation_id: conversationId });
      } else if ((msgErr as { code?: string }).code !== '23505') {
        console.log(JSON.stringify({ event: 'uazapi_message_insert_failed', message: msgErr.message }));
      }
    }
  }

  // Reconciliação de atribuição via RPC (CTWA > código > whatsapp_direto).
  const referral = provider.extractReferral(payload);
  const { data: result, error: rpcErr } = await admin.rpc('attribute_inbound_lead', {
    p_contact_id: contactId,
    p_text: inbound.text ?? '',
    p_referral: referral ?? null,
    p_provider: provider.name,
  });
  if (rpcErr) {
    return jsonResponse({ ok: false, error: `atribuição: ${rpcErr.message}` }, { status: 500 });
  }

  console.log(JSON.stringify({ event: 'lead_attributed', provider: provider.name, result }));
  return jsonResponse({ ok: true, provider: provider.name, attribution: result });
});
