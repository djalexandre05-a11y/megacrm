// ============================================================================
// _shared/zernio.ts — client Zernio para as Edge Functions (Deno)
// ----------------------------------------------------------------------------
// Toda a comunicacao com o WhatsApp passa pelo Zernio. A ZERNIO_API_KEY e o
// accountId/profileId vivem cifrados em public.app_settings e sao lidos via
// getCredential — nunca de env var de aplicacao. Este modulo centraliza base
// URL, auth (Bearer) e tratamento de erro.
//
// ATENCAO: os formatos de payload de varios endpoints do Zernio (corpo do send
// message, shape de broadcasts/recipients) ainda nao foram validados contra a
// API real — pontos marcados com "ASSUMIDO" precisam de confirmacao no primeiro
// teste de integracao (ver "PONTOS A CONFIRMAR" #2 da refatoracao).
// ============================================================================

import { getCredentials } from './credentials.ts';

export const ZERNIO_API_BASE_URL =
  Deno.env.get('ZERNIO_API_BASE_URL') ?? 'https://zernio.com/api/v1';

export const ZERNIO_WEBHOOK_EVENTS = [
  'message.received',
  'message.sent',
  'message.delivered',
  'message.read',
  'message.failed',
  'whatsapp.template.status_updated',
  'whatsapp.number.activated',
  'whatsapp.number.declined',
  'whatsapp.number.action_required',
  'whatsapp.number.verification_required',
  'whatsapp.number.suspended',
  'whatsapp.number.reactivated',
  'whatsapp.number.released',
  'account.disconnected',
] as const;

export class ZernioError extends Error {
  status: number;
  constructor(message: string, status = 502) {
    super(message);
    this.name = 'ZernioError';
    this.status = status;
  }
}

export interface ZernioContext {
  apiKey: string;
  accountId: string;
  profileId: string | null;
}

// Carrega as credenciais do Zernio do cofre. Lanca se a chave ou a conta nao
// estiverem configuradas (setup incompleto).
export async function loadZernioContext(): Promise<ZernioContext> {
  const creds = await getCredentials([
    'zernio_api_key',
    'zernio_account_id',
    'zernio_profile_id',
  ]);
  const apiKey = creds.zernio_api_key?.trim();
  const accountId = creds.zernio_account_id?.trim();
  if (!apiKey) {
    throw new ZernioError('Zernio API Key nao configurada. Acesse /settings/credentials.', 400);
  }
  if (!accountId) {
    throw new ZernioError('Conta Zernio nao resolvida. Reabra /settings/credentials e salve a chave.', 400);
  }
  return { apiKey, accountId, profileId: creds.zernio_profile_id?.trim() || null };
}

export async function zfetch(
  apiKey: string,
  path: string,
  init: RequestInit = {},
): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(`${ZERNIO_API_BASE_URL}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        ...(init.headers ?? {}),
      },
    });
  } catch (err) {
    throw new ZernioError(
      `Falha de rede ao falar com o Zernio: ${err instanceof Error ? err.message : 'erro'}`,
    );
  }

  const text = await res.text();
  let body: unknown = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }

  if (!res.ok) {
    const msg =
      (body && typeof body === 'object'
        ? ((body as Record<string, unknown>).error ?? (body as Record<string, unknown>).message)
        : typeof body === 'string'
          ? body
          : null);
    // 429 e 5xx sao transitorios — o chamador decide se re-tenta.
    const retryStatus = res.status === 429 || res.status >= 500 ? res.status : 502;
    throw new ZernioError(
      typeof msg === 'string' ? msg : `Zernio respondeu ${res.status} ${res.statusText}`,
      res.status === 401 || res.status === 403 ? 401 : retryStatus,
    );
  }
  return body;
}

function pickString(body: unknown, keys: string[]): string | null {
  if (!body || typeof body !== 'object') return null;
  const obj = body as Record<string, unknown>;
  for (const key of keys) {
    const value = obj[key];
    if (typeof value === 'string' && value.trim() !== '') return value;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Inbox (mensagens 1:1 — IA e operador)
// ---------------------------------------------------------------------------

export interface InboxSendResult {
  messageId: string | null;
}

// POST /inbox/conversations/{id}/messages — envia texto/midia numa conversa
// existente (dentro da janela de 24h, sem template). Corpo real:
// { accountId, message, attachmentUrl?, attachmentType?, voiceNote? }.
export async function sendInboxMessage(input: {
  apiKey: string;
  accountId: string;
  conversationId: string;
  text?: string;
  attachmentUrl?: string;
  attachmentType?: 'image' | 'video' | 'audio' | 'file';
  voiceNote?: boolean;
}): Promise<InboxSendResult> {
  const body: Record<string, unknown> = { accountId: input.accountId };
  if (input.attachmentUrl) {
    body.attachmentUrl = input.attachmentUrl;
    body.attachmentType = input.voiceNote ? 'audio' : (input.attachmentType ?? 'file');
    if (input.voiceNote) body.voiceNote = true;
    if (input.text) body.message = input.text;
  } else {
    body.message = input.text ?? '';
  }
  const res = await zfetch(
    input.apiKey,
    `/inbox/conversations/${encodeURIComponent(input.conversationId)}/messages`,
    { method: 'POST', body: JSON.stringify(body) },
  );
  return { messageId: pickString(res, ['_id', 'id', 'messageId']) ?? pickStringFromData(res) };
}

// POST /inbox/conversations/{id}/messages com template — usado para reabrir a
// conversa fora da janela de 24h (Meta só aceita template fora da janela).
// Shape real (WhatsApp): template.elements = [{ name, language, components }].
export async function sendInboxTemplate(input: {
  apiKey: string;
  accountId: string;
  conversationId: string;
  name: string;
  language: string;
  components: unknown[];
}): Promise<InboxSendResult> {
  const res = await zfetch(
    input.apiKey,
    `/inbox/conversations/${encodeURIComponent(input.conversationId)}/messages`,
    {
      method: 'POST',
      body: JSON.stringify({
        accountId: input.accountId,
        template: { elements: [{ name: input.name, language: input.language, components: input.components }] },
      }),
    },
  );
  return { messageId: pickString(res, ['_id', 'id', 'messageId']) ?? pickStringFromData(res) };
}

function pickStringFromData(body: unknown): string | null {
  if (body && typeof body === 'object' && 'data' in (body as Record<string, unknown>)) {
    return pickString((body as Record<string, unknown>).data, ['_id', 'id', 'messageId']);
  }
  return null;
}

// POST /inbox/conversations — cria (ou reusa) a conversa 1:1 a partir do
// telefone (participantId). Corpo real: { accountId, participantId, message }.
export async function createInboxConversation(input: {
  apiKey: string;
  accountId: string;
  participantId: string; // telefone E.164 / wa_id
  message?: string;
}): Promise<{ conversationId: string | null; messageId: string | null }> {
  const body: Record<string, unknown> = {
    accountId: input.accountId,
    participantId: input.participantId,
  };
  if (input.message) body.message = input.message;
  const res = await zfetch(input.apiKey, '/inbox/conversations', {
    method: 'POST',
    body: JSON.stringify(body),
  });
  const data =
    res && typeof res === 'object' && 'data' in (res as Record<string, unknown>)
      ? (res as Record<string, unknown>).data
      : res;
  return {
    conversationId: pickString(data, ['conversationId', '_id', 'id']),
    messageId: pickString(data, ['messageId', 'lastMessageId']),
  };
}

// ---------------------------------------------------------------------------
// Broadcasts (disparo em massa)
// ---------------------------------------------------------------------------

export interface BroadcastTemplate {
  name: string;
  language: string;
  components: unknown[];
}

// POST /broadcasts → cria o broadcast e devolve o id.
export async function createBroadcast(input: {
  apiKey: string;
  profileId: string;
  accountId: string;
  name: string;
  template: BroadcastTemplate;
}): Promise<string> {
  const res = await zfetch(input.apiKey, '/broadcasts', {
    method: 'POST',
    body: JSON.stringify({
      profileId: input.profileId,
      accountId: input.accountId,
      platform: 'whatsapp',
      name: input.name,
      template: input.template,
    }),
  });
  // Resposta real: { broadcast: { id, name, status } }.
  const root = (res ?? {}) as Record<string, unknown>;
  const data = (root.broadcast ?? root.data ?? root) as Record<string, unknown>;
  const id = pickString(data, ['id', '_id', 'broadcastId']);
  if (!id) throw new ZernioError('Zernio nao retornou o id do broadcast.');
  return id;
}

// POST /broadcasts/{id}/recipients — aceita phones[], contactIds[] ou useSegment.
export async function addBroadcastRecipients(input: {
  apiKey: string;
  broadcastId: string;
  phones?: string[];
  contactIds?: string[];
  useSegment?: boolean;
}): Promise<void> {
  const body: Record<string, unknown> = {};
  if (input.useSegment) body.useSegment = true;
  else if (input.contactIds?.length) body.contactIds = input.contactIds;
  else if (input.phones?.length) body.phones = input.phones;
  await zfetch(input.apiKey, `/broadcasts/${encodeURIComponent(input.broadcastId)}/recipients`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

// POST /broadcasts/{id}/schedule — agenda envio futuro.
export async function scheduleBroadcast(input: {
  apiKey: string;
  broadcastId: string;
  scheduledAt: string;
}): Promise<void> {
  await zfetch(input.apiKey, `/broadcasts/${encodeURIComponent(input.broadcastId)}/schedule`, {
    method: 'POST',
    body: JSON.stringify({ scheduledAt: input.scheduledAt }),
  });
}

// POST /broadcasts/{id}/send — envio imediato.
export async function sendBroadcast(input: {
  apiKey: string;
  broadcastId: string;
}): Promise<void> {
  await zfetch(input.apiKey, `/broadcasts/${encodeURIComponent(input.broadcastId)}/send`, {
    method: 'POST',
    body: JSON.stringify({}),
  });
}

export interface BroadcastRecipient {
  phone: string | null;        // E.164/wa_id do destinatario (chave de correlacao)
  status: string | null;       // status cru do Zernio (sent/delivered/read/failed/...)
  error: string | null;        // motivo, quando failed
  messageId: string | null;    // zernio/meta message id, quando disponivel
}

// GET /broadcasts/{id}/recipients — status de entrega por destinatario. O evento
// de webhook do Zernio NAO carrega o broadcastId, entao este endpoint eh a unica
// forma de reconciliar delivered/read/failed de campanha (consumido pelo job de
// polling sync-broadcast-status).
// ASSUMIDO: resposta { recipients: [...] } (ou data[]/array cru); cada item com
// { phone/to/wa_id, status/state, error/reason, messageId }. Confirmar na API real.
export async function getBroadcastRecipients(
  apiKey: string,
  broadcastId: string,
): Promise<BroadcastRecipient[]> {
  const res = await zfetch(
    apiKey,
    `/broadcasts/${encodeURIComponent(broadcastId)}/recipients`,
  );
  const root = (res ?? {}) as Record<string, unknown>;
  const list = Array.isArray(root.recipients)
    ? root.recipients
    : Array.isArray(root.data)
      ? root.data
      : Array.isArray(res)
        ? (res as unknown[])
        : [];
  return (list as Record<string, unknown>[]).map((r) => ({
    phone: pickString(r, ['phone', 'phoneNumber', 'to', 'wa_id', 'recipient', 'msisdn']),
    status: pickString(r, ['status', 'state', 'deliveryStatus']),
    error: pickString(r, ['error', 'errorMessage', 'error_message', 'reason']),
    messageId: pickString(r, ['messageId', 'message_id', 'zernioMessageId', 'wamid']),
  }));
}

// ---------------------------------------------------------------------------
// WhatsApp number / templates
// ---------------------------------------------------------------------------

export interface ZernioNumberInfo {
  messaging_limit_tier: string | null;
  quality_rating: string | null;
  health_status: string | null;
  display_phone_number: string | null;
  verified_name: string | null;
}

// Resposta real aninhada: { phone: { display_phone_number, verified_name,
// quality_rating, messaging_limit_tier, status, health_status }, waba: {...} }.
export async function getNumberInfo(apiKey: string, accountId: string): Promise<ZernioNumberInfo> {
  const res = await zfetch(
    apiKey,
    `/whatsapp/number-info?accountId=${encodeURIComponent(accountId)}`,
  );
  const root = ((res as Record<string, unknown>) ?? {});
  const phone = (root.phone && typeof root.phone === 'object'
    ? root.phone
    : root) as Record<string, unknown>;
  return {
    messaging_limit_tier: pickString(phone, ['messaging_limit_tier', 'messagingLimitTier']),
    quality_rating: pickString(phone, ['quality_rating', 'qualityRating']),
    health_status: pickString(phone, ['status', 'connection_status']),
    display_phone_number: pickString(phone, ['display_phone_number', 'displayPhoneNumber']),
    verified_name: pickString(phone, ['verified_name', 'verifiedName', 'name']),
  };
}

// POST /media/upload-direct — sobe o binário (máx 25MB, auto-delete em 7 dias)
// e devolve a `url` para usar no attachmentUrl do send message. NÃO usa zfetch
// porque o corpo é binário (Content-Type = mime do arquivo), não JSON.
// ASSUMIDO: binário cru no body + filename via query. Confirmar na doc real.
export async function uploadMediaDirect(input: {
  apiKey: string;
  bytes: Uint8Array;
  filename: string;
  contentType: string;
}): Promise<string> {
  const MAX_BYTES = 25 * 1024 * 1024;
  if (input.bytes.byteLength > MAX_BYTES) {
    throw new ZernioError('Arquivo excede o limite de 25MB do Zernio.', 400);
  }
  let res: Response;
  try {
    res = await fetch(
      `${ZERNIO_API_BASE_URL}/media/upload-direct?filename=${encodeURIComponent(input.filename)}`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${input.apiKey}`,
          'Content-Type': input.contentType,
        },
        body: input.bytes,
      },
    );
  } catch (err) {
    throw new ZernioError(
      `Falha de rede ao subir mídia: ${err instanceof Error ? err.message : 'erro'}`,
    );
  }
  const text = await res.text();
  let body: unknown = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }
  if (!res.ok) {
    const msg =
      body && typeof body === 'object'
        ? pickString(body as Record<string, unknown>, ['error', 'message'])
        : null;
    throw new ZernioError(msg ?? `Zernio upload-direct respondeu ${res.status}`);
  }
  const data =
    body && typeof body === 'object' && 'data' in (body as Record<string, unknown>)
      ? (body as Record<string, unknown>).data
      : body;
  const url = pickString((data ?? {}) as Record<string, unknown>, ['url', 'link', 'href']);
  if (!url) throw new ZernioError('Zernio upload-direct não retornou url.');
  return url;
}

export type ZernioTemplateCategory = 'MARKETING' | 'UTILITY' | 'AUTHENTICATION';

// POST /whatsapp/templates — submete template para aprovacao na Meta via Zernio.
export async function createTemplate(input: {
  apiKey: string;
  accountId: string;
  name: string;
  category: ZernioTemplateCategory;
  language: string;
  components: unknown[];
}): Promise<{ id: string | null; status: string | null }> {
  const res = await zfetch(input.apiKey, '/whatsapp/templates', {
    method: 'POST',
    body: JSON.stringify({
      accountId: input.accountId,
      name: input.name,
      category: input.category,
      language: input.language,
      components: input.components,
    }),
  });
  // Resposta real: { success, template: { id, name, status, category, language } }.
  const root = (res ?? {}) as Record<string, unknown>;
  const data = (root.template ?? root.data ?? root) as Record<string, unknown>;
  return {
    id: pickString(data, ['id', '_id', 'templateId']),
    status: pickString(data, ['status', 'meta_status']),
  };
}

// GET /whatsapp/templates?accountId= → lista os templates da WABA direto da Meta.
// Usado para sincronizar o status localmente (fallback ao webhook).
export async function listTemplates(
  apiKey: string,
  accountId: string,
): Promise<Array<{ id: string | null; name: string | null; status: string | null }>> {
  const res = await zfetch(
    apiKey,
    `/whatsapp/templates?accountId=${encodeURIComponent(accountId)}`,
  );
  const root = (res ?? {}) as Record<string, unknown>;
  const list = Array.isArray(root.templates)
    ? root.templates
    : Array.isArray(root.data)
      ? root.data
      : [];
  return (list as Record<string, unknown>[]).map((t) => ({
    id: pickString(t, ['id', '_id', 'templateId']),
    name: pickString(t, ['name', 'templateName']),
    status: pickString(t, ['status', 'meta_status']),
  }));
}
