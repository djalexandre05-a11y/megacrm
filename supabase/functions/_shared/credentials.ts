import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const decoder = new TextDecoder();
const encoder = new TextEncoder();
const cache = new Map<string, { value: string | null; expiresAt: number }>();

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i += 1) {
    bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

async function getCryptoKey(
  usages: KeyUsage[] = ['decrypt'],
): Promise<CryptoKey> {
  const hex = Deno.env.get('CRYPTO_KEY');
  if (!hex || !/^[a-f0-9]{64}$/i.test(hex)) {
    throw new Error('CRYPTO_KEY ausente ou invalida');
  }
  return crypto.subtle.importKey(
    'raw',
    hexToBytes(hex),
    { name: 'AES-GCM' },
    false,
    usages,
  );
}

function getSupabaseAdmin() {
  const url = Deno.env.get('SUPABASE_URL');
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) {
    throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY ausentes');
  }
  return createClient(url, key, { auth: { persistSession: false } });
}

async function decrypt(payload: string): Promise<string> {
  const [ivHex, tagHex, cipherHex] = payload.split(':');
  if (!ivHex || !tagHex || !cipherHex) {
    throw new Error('Payload de criptografia malformado');
  }
  const iv = hexToBytes(ivHex);
  const tag = hexToBytes(tagHex);
  const cipher = hexToBytes(cipherHex);
  const combined = new Uint8Array(cipher.length + tag.length);
  combined.set(cipher);
  combined.set(tag, cipher.length);
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    await getCryptoKey(['decrypt']),
    combined,
  );
  return decoder.decode(plain);
}

// Formato identico ao Node (src/lib/credentials.ts): "ivHex:tagHex:cipherHex",
// AES-256-GCM, IV de 12 bytes. WebCrypto anexa a tag (16 bytes) ao fim do
// ciphertext — separamos para casar o layout do Node.
async function encrypt(plaintext: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const out = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      await getCryptoKey(['encrypt']),
      encoder.encode(plaintext),
    ),
  );
  const tag = out.slice(out.length - 16);
  const cipher = out.slice(0, out.length - 16);
  return `${bytesToHex(iv)}:${bytesToHex(tag)}:${bytesToHex(cipher)}`;
}

export async function getCredential(key: string): Promise<string | null> {
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from('app_settings')
    .select('value_encrypted')
    .eq('key', key)
    .maybeSingle();
  if (error) throw error;
  const value = data?.value_encrypted ? await decrypt(data.value_encrypted) : null;
  cache.set(key, { value, expiresAt: Date.now() + 60_000 });
  return value;
}

export async function getCredentials(keys: string[]): Promise<Record<string, string | null>> {
  const values: Record<string, string | null> = {};
  await Promise.all(keys.map(async (key) => {
    values[key] = await getCredential(key);
  }));
  return values;
}

// Escreve (cifrado) uma credencial em public.app_settings. Usado por handlers
// server-side que precisam atualizar derivados (ex.: cache de number-info
// quando chega um evento de saude do numero pelo webhook). A escrita normal de
// credenciais de setup continua sendo via api/credentials (Node).
export async function setCredential(key: string, plaintext: string): Promise<void> {
  const supabase = getSupabaseAdmin();
  const { error } = await supabase
    .from('app_settings')
    .upsert({
      key,
      value_encrypted: await encrypt(plaintext),
      updated_at: new Date().toISOString(),
    });
  if (error) throw error;
  cache.set(key, { value: plaintext, expiresAt: Date.now() + 60_000 });
}

export function formatMissingCredential(key: string): string {
  return `Credencial ${key} nao configurada. Acesse /settings/credentials.`;
}

export function encodeWebhookVerifyToken(value: string): Uint8Array {
  return encoder.encode(value);
}
