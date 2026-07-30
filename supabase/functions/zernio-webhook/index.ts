// ============================================================================
// zernio-webhook  (public, HMAC-verified)
// ----------------------------------------------------------------------------
// Receiver unico dos eventos do Zernio (substitui o antigo meta-webhook). Nao
// ha mais handshake/verify-token da Meta — o Zernio assina cada POST com
// HMAC-SHA256 no header X-Zernio-Signature (segredo: zernio_webhook_secret).
//
// Fluxo:
//   1. Valida X-Zernio-Signature (constant-time) contra o segredo do cofre.
//   2. Idempotencia: deduplica pelo event id estavel via whatsapp_hub.webhook_events.
//   3. Trata os eventos:
//        message.received                  → upsert conversa + mensagem (dispara IA via trigger)
//        message.sent/delivered/read/failed → status de campanha (broadcast) ou de mensagem 1:1
//        whatsapp.template.status_updated  → status do template (substitui o polling)
//        whatsapp.number.*                 → atualiza cache de saude do numero
//        account.disconnected              → log/alerta
//
// Deploy com --no-verify-jwt: o Zernio chama anonimamente; o HMAC e o unico gate.
//
// Os shapes seguem o OpenAPI do Zernio (WebhookPayloadMessage /
// WebhookPayloadMessageDeliveryStatus / WebhookPayloadWhatsAppTemplateStatusUpdated).
// A normalizacao abaixo continua tolerante a variacoes menores de campo.
// ============================================================================

import { getAdminClient } from '../_shared/supabase-admin.ts';
import { getCredential, setCredential } from '../_shared/credentials.ts';
import { jsonResponse, preflight } from '../_shared/cors.ts';
import { getNumberInfo, loadZernioContext } from '../_shared/zernio.ts';

type DeliveryStatus = 'sent' | 'delivered' | 'read' | 'failed';

// --- HMAC ------------------------------------------------------------------

function timingSafeEqualStr(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function hmacSha256Raw(secret: string, payload: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload));
  return new Uint8Array(mac);
}

function hmacToHex(bytes: Uint8Array): string {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

// O formato do X-Zernio-Signature (hex vs base64) não está explícito na doc;
// aceitamos ambos, com prefixo opcional "sha256=", comparação constant-time.
function signatureMatches(header: string, mac: Uint8Array): boolean {
  const got = (header.startsWith('sha256=') ? header.slice(7) : header).trim();
  return timingSafeEqualStr(got, hmacToHex(mac)) || timingSafeEqualStr(got, bytesToBase64(mac));
}

// --- normalizacao do payload (conforme OpenAPI do Zernio) ------------------

interface ZernioEvent {
  id: string | null;
  type: string;
  data: Record<string, unknown>;
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function str(obj: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const v = obj[key];
    if (typeof v === 'string' && v.trim() !== '') return v;
  }
  return null;
}

function normalizeEvent(payload: unknown): ZernioEvent {
  const root = asObject(payload);
  const type = str(root, ['type', 'event', 'eventType']) ?? '';
  const id = str(root, ['id', 'eventId', '_id']);
  const data = root.data ? asObject(root.data) : root;
  return { id: id ?? null, type, data };
}

function normalizePhone(raw: string | null): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  return trimmed.startsWith('+') ? trimmed : `+${trimmed}`;
}

// --- helpers de dominio -----------------------------------------------------

async function findOrCreateContact(
  admin: ReturnType<typeof getAdminClient>,
  phone: string,
  name: string | null,
): Promise<string | null> {
  const { data: existing } = await admin
    .from('contacts')
    .select('id')
    .eq('phone', phone)
    .maybeSingle();
  if (existing) return (existing as { id: string }).id;
  const { data: created, error } = await admin
    .from('contacts')
    .insert({ phone, name, source: 'whatsapp' })
    .select('id')
    .single();
  if (error) return null;
  return (created as { id: string }).id;
}

// Instagram: o contato é identificado pelo IG-scoped id (não tem telefone).
// Dedup por instagram_id; se não existir, cria com source='instagram'.
async function findOrCreateInstagramContact(
  admin: ReturnType<typeof getAdminClient>,
  igId: string,
  name: string | null,
): Promise<string | null> {
  const { data: existing } = await admin
    .from('contacts')
    .select('id')
    .eq('instagram_id', igId)
    .maybeSingle();
  if (existing) return (existing as { id: string }).id;
  const { data: created, error } = await admin
    .from('contacts')
    .insert({ instagram_id: igId, name, source: 'instagram' })
    .select('id')
    .single();
  if (error) return null;
  return (created as { id: string }).id;
}

async function findOrCreateConversation(
  admin: ReturnType<typeof getAdminClient>,
  contactId: string,
  zernioConversationId: string | null,
  channel: 'whatsapp' | 'instagram' = 'whatsapp',
): Promise<string | null> {
  const { data: existing } = await admin
    .from('conversations')
    .select('id, zernio_conversation_id')
    .eq('contact_id', contactId)
    .maybeSingle();
  if (existing) {
    const row = existing as { id: string; zernio_conversation_id: string | null };
    // Preenche o zernio_conversation_id assim que o Zernio o revela (necessario
    // para o operador/IA responderem 1:1 via /inbox/conversations/{id}).
    if (zernioConversationId && !row.zernio_conversation_id) {
      await admin
        .from('conversations')
        .update({ zernio_conversation_id: zernioConversationId })
        .eq('id', row.id);
    }
    return row.id;
  }
  const { data: created, error } = await admin
    .from('conversations')
    .insert({
      contact_id: contactId,
      status: 'ai_active',
      channel,
      zernio_conversation_id: zernioConversationId,
      last_message_at: new Date().toISOString(),
    })
    .select('id')
    .single();
  if (error) return null;
  return (created as { id: string }).id;
}

// InboxWebhookMessage: { text, attachments:[{type: image|video|audio|file|
// sticker|share, url}] }. O tipo vem do attachment; sem attachment é texto.
function decodeInbound(message: Record<string, unknown>): {
  contentType: 'text' | 'image' | 'audio' | 'video' | 'document';
  content: string | null;
  mediaUrl: string | null;
} {
  const text = str(message, ['text', 'body', 'caption']);
  const attachments = Array.isArray(message.attachments) ? message.attachments : [];
  const firstAttachment = asObject(attachments[0]);
  const mediaUrl = str(firstAttachment, ['url', 'link', 'href']);
  const attType = (str(firstAttachment, ['type']) ?? '').toLowerCase();

  if (!mediaUrl) return { contentType: 'text', content: text ?? '', mediaUrl: null };
  switch (attType) {
    case 'image':
    case 'sticker':
      return { contentType: 'image', content: text, mediaUrl };
    case 'audio':
    case 'voice':
      return { contentType: 'audio', content: null, mediaUrl };
    case 'video':
      return { contentType: 'video', content: text, mediaUrl };
    default: // file, share, document
      return { contentType: 'document', content: text, mediaUrl };
  }
}

// --- handlers de evento -----------------------------------------------------

const RANK: Record<string, number> = { sent: 1, delivered: 2, read: 3 };

async function handleMessageReceived(
  admin: ReturnType<typeof getAdminClient>,
  data: Record<string, unknown>,
  errors: string[],
  platform: 'whatsapp' | 'instagram' = 'whatsapp',
): Promise<void> {
  const message = asObject(data.message ?? data);
  const conversation = asObject(data.conversation);
  const sender = asObject(message.sender);
  const zernioConversationId = str(conversation, ['id']) ?? str(message, ['conversationId']);
  const zernioMessageId = str(message, ['id', '_id']);
  const contactName = str(sender, ['name']) ?? str(conversation, ['participantName']);

  // Resolução de identidade depende do canal. WhatsApp usa telefone (E.164);
  // Instagram usa o IG-scoped id/username (sem telefone).
  // ASSUMIDO: shape do payload Instagram do Zernio (sender.id/username,
  // conversation.participantId) — confirmar no 1º teste com conta real.
  let contactId: string | null;
  if (platform === 'instagram') {
    const igId =
      str(sender, ['id', 'username', 'igsid', 'instagramId']) ??
      str(conversation, ['participantId']);
    if (!igId) {
      errors.push('message.received (instagram) sem identidade');
      return;
    }
    contactId = await findOrCreateInstagramContact(admin, igId, contactName ?? igId);
    if (!contactId) {
      errors.push(`contato instagram falhou: ${igId}`);
      return;
    }
  } else {
    // WhatsApp: sender.phoneNumber é E.164 (+...). Fallbacks: sender.id (telefone
    // sem +) e conversation.participantId (wa_id).
    const phone =
      str(sender, ['phoneNumber']) ??
      normalizePhone(str(sender, ['id'])) ??
      normalizePhone(str(conversation, ['participantId']));
    if (!phone) {
      errors.push('message.received sem telefone');
      return;
    }
    contactId = await findOrCreateContact(admin, phone, contactName);
    if (!contactId) {
      errors.push(`contato falhou: ${phone}`);
      return;
    }
  }

  const conversationId = await findOrCreateConversation(
    admin,
    contactId,
    zernioConversationId,
    platform,
  );
  if (!conversationId) {
    errors.push('conversa falhou');
    return;
  }

  // Dedup de mensagem (at-least-once). O indice unico parcial cobre a corrida.
  if (zernioMessageId) {
    const { data: dup } = await admin
      .from('messages')
      .select('id')
      .eq('zernio_message_id', zernioMessageId)
      .maybeSingle();
    if (dup) return;
  }

  const { contentType, content, mediaUrl } = decodeInbound(message);
  const { error: insErr } = await admin.from('messages').insert({
    conversation_id: conversationId,
    direction: 'inbound',
    sender_type: 'contact',
    content_type: contentType,
    content,
    media_url: mediaUrl,
    zernio_message_id: zernioMessageId,
    is_private_note: false,
  });
  if (insErr) {
    if ((insErr as { code?: string }).code === '23505') return; // corrida de dedup
    errors.push(`message insert: ${insErr.message}`);
    return;
  }

  await admin.rpc('increment_unread_count', { p_conversation_id: conversationId });

  // Atribuição de origem: toda 1ª mensagem inbound vira lead (deal) no Funil.
  // Hierarquia CTWA (referral.ctwa_clid) > código [XXXX] no texto > direto.
  // Find-or-create no RPC: mensagens seguintes reusam o deal aberto do contato.
  try {
    const referralObj =
      (message.referral ? asObject(message.referral) : null) ??
      (asObject(message.context).referral ? asObject(asObject(message.context).referral) : null);
    const ctwa = referralObj ? str(referralObj, ['ctwa_clid', 'ctwaClid', 'click_id']) : null;
    const referral = ctwa && referralObj
      ? {
          ctwa_clid: ctwa,
          source_id: str(referralObj, ['source_id', 'sourceId', 'ad_id', 'adId']),
          headline: str(referralObj, ['headline', 'title']),
        }
      : null;
    const { error: attrErr } = await admin.rpc('attribute_inbound_lead', {
      p_contact_id: contactId,
      p_text: content ?? '',
      p_referral: referral,
      p_provider: platform === 'instagram' ? 'instagram' : 'zernio',
    });
    if (attrErr) {
      console.log(JSON.stringify({ event: 'lead_attribution_failed', message: attrErr.message }));
    }
  } catch (err) {
    console.log(JSON.stringify({ event: 'lead_attribution_failed', message: err instanceof Error ? err.message : String(err) }));
  }

  // Resposta do contato cancela follow-ups: marca o ultimo campaign_contact ativo.
  const { data: ccHit } = await admin
    .from('campaign_contacts')
    .select('id, campaign_id')
    .eq('contact_id', contactId)
    .is('replied_at', null)
    .in('status', ['sent', 'delivered', 'read'])
    .order('sent_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (ccHit) {
    await admin
      .from('campaign_contacts')
      .update({ status: 'replied', replied_at: new Date().toISOString() })
      .eq('id', (ccHit as { id: string }).id);
    await admin.rpc('bump_campaign_counter', {
      p_campaign_id: (ccHit as { campaign_id: string }).campaign_id,
      p_column: 'replied',
      p_delta: 1,
    });
  }
}

// WebhookPayloadMessageDeliveryStatus: { event, message: InboxWebhookMessage,
// statusAt, error?, conversation, account }. Refere-se a uma mensagem OUTGOING
// pelo message.id interno. O payload NÃO carrega broadcastId — a correlação por
// destinatário de broadcast usa GET /broadcasts/{id}/recipients (fora deste
// handler). Aqui atualizamos a mensagem 1:1 (IA/operador) na tabela messages.
async function handleStatus(
  admin: ReturnType<typeof getAdminClient>,
  status: DeliveryStatus,
  data: Record<string, unknown>,
): Promise<void> {
  const message = asObject(data.message);
  const zernioMessageId = str(message, ['id', '_id']) ?? str(message, ['platformMessageId']);
  if (!zernioMessageId) return;

  const { data: msg } = await admin
    .from('messages')
    .select('id, meta_status')
    .eq('zernio_message_id', zernioMessageId)
    .maybeSingle();
  if (!msg) return;
  const m = msg as { id: string; meta_status: string | null };
  if (status === 'failed') {
    await admin.from('messages').update({ meta_status: 'failed' }).eq('id', m.id);
    return;
  }
  const newRank = RANK[status] ?? 0;
  const prevRank = RANK[m.meta_status ?? ''] ?? 0;
  if (newRank <= prevRank) return;
  await admin.from('messages').update({ meta_status: status }).eq('id', m.id);
}

async function handleTemplateStatus(
  admin: ReturnType<typeof getAdminClient>,
  data: Record<string, unknown>,
): Promise<void> {
  const template = asObject(data.template ?? data);
  const name = str(template, ['name', 'templateName']);
  const metaTemplateId = str(template, ['id', 'templateId', 'meta_template_id']);
  const rawStatus = (str(template, ['status', 'meta_status']) ?? '').toUpperCase();
  if (!name && !metaTemplateId) return;

  const mapped: 'approved' | 'rejected' | 'pending' =
    rawStatus === 'APPROVED'
      ? 'approved'
      : ['REJECTED', 'DISABLED', 'PAUSED'].includes(rawStatus)
        ? 'rejected'
        : 'pending';

  const update: Record<string, unknown> = { meta_template_status: rawStatus || null, status: mapped };
  if (mapped === 'approved') update.approved_at = new Date().toISOString();

  let query = admin.from('templates').update(update);
  query = metaTemplateId ? query.eq('meta_template_id', metaTemplateId) : query.eq('name', name as string);
  await query;
}

// whatsapp.number.* → re-resolve e cacheia o status do numero (tier/qualidade/
// saude). Best-effort: se a chamada falhar, apenas loga.
async function handleNumberEvent(eventType: string): Promise<void> {
  try {
    const ctx = await loadZernioContext();
    const info = await getNumberInfo(ctx.apiKey, ctx.accountId);
    await setCredential('zernio_number_info', JSON.stringify(info));
  } catch (err) {
    console.error(JSON.stringify({ event: 'zernio_number_refresh_failed', type: eventType, message: err instanceof Error ? err.message : String(err) }));
  }
}

// --- entrypoint -------------------------------------------------------------

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;

  if (req.method !== 'POST') {
    return jsonResponse({ ok: false, error: 'Method not allowed' }, { status: 405 });
  }

  const secret = await getCredential('zernio_webhook_secret');
  const rawBody = await req.text();
  if (!secret) {
    console.error('zernio_webhook_secret not configured');
    return jsonResponse({ ok: false, error: 'Server misconfigured' }, { status: 500 });
  }

  const signatureHeader = req.headers.get('X-Zernio-Signature') ?? '';
  if (!signatureHeader) {
    return jsonResponse({ ok: false, error: 'Missing signature' }, { status: 401 });
  }
  const mac = await hmacSha256Raw(secret, rawBody);
  if (!signatureMatches(signatureHeader, mac)) {
    return jsonResponse({ ok: false, error: 'Invalid signature' }, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return jsonResponse({ ok: false, error: 'Invalid JSON' }, { status: 400 });
  }

  const event = normalizeEvent(payload);
  const admin = getAdminClient();

  // Idempotencia: registra o event id. Se ja existe (23505), ja foi processado.
  if (event.id) {
    const { error: dupErr } = await admin
      .from('webhook_events')
      .insert({ zernio_event_id: event.id, event_type: event.type });
    if (dupErr) {
      if ((dupErr as { code?: string }).code === '23505') {
        return jsonResponse({ ok: true, deduped: true });
      }
      // Falha inesperada no registro: nao bloqueia o processamento.
      console.error(JSON.stringify({ event: 'webhook_event_insert_failed', message: dupErr.message }));
    }
  }

  // Canais suportados no inbox unificado. A plataforma vem em message.platform
  // e/ou account.platform. Outras plataformas (futuras) são ignoradas.
  const SUPPORTED_PLATFORMS = new Set(['whatsapp', 'instagram']);
  const msgPlatform = (
    str(asObject(event.data.message), ['platform']) ??
    str(asObject(event.data.account), ['platform']) ??
    ''
  ).toLowerCase();
  const isMessageEvent = event.type.startsWith('message.');
  if (isMessageEvent && msgPlatform && !SUPPORTED_PLATFORMS.has(msgPlatform)) {
    return jsonResponse({ ok: true, skipped: `platform:${msgPlatform}` });
  }
  const channel: 'whatsapp' | 'instagram' = msgPlatform === 'instagram' ? 'instagram' : 'whatsapp';

  const errors: string[] = [];
  try {
    switch (event.type) {
      case 'message.received':
        await handleMessageReceived(admin, event.data, errors, channel);
        break;
      case 'message.sent':
        await handleStatus(admin, 'sent', event.data);
        break;
      case 'message.delivered':
        await handleStatus(admin, 'delivered', event.data);
        break;
      case 'message.read':
        await handleStatus(admin, 'read', event.data);
        break;
      case 'message.failed':
        await handleStatus(admin, 'failed', event.data);
        break;
      case 'whatsapp.template.status_updated':
        await handleTemplateStatus(admin, event.data);
        break;
      case 'account.disconnected':
        console.error(JSON.stringify({ event: 'zernio_account_disconnected', data: event.data }));
        break;
      default:
        if (event.type.startsWith('whatsapp.number.')) {
          await handleNumberEvent(event.type);
        }
        // Eventos desconhecidos: aceitar (200) para o Zernio nao re-tentar.
        break;
    }
  } catch (err) {
    console.error(JSON.stringify({ event: 'zernio_webhook_handler_error', type: event.type, message: err instanceof Error ? err.message : String(err) }));
    return jsonResponse({ ok: false, error: 'handler error' }, { status: 500 });
  }

  return jsonResponse({ ok: true, type: event.type, errors });
});
