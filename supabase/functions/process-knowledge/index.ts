// ============================================================================
// process-knowledge
// ----------------------------------------------------------------------------
// Takes a knowledge_base row and turns it into searchable RAG chunks:
//
//   1. Loads the target KB row.
//   2. Fetches plaintext from the source (raw text passed in, or URL fetch
//      with a rough HTML-strip).
//   3. Chunks the text into ~500-token windows with 50-token overlap. We
//      approximate tokens as chars / 4 — cheap heuristic that's accurate
//      enough for embeddings, and keeps the chunker dependency-free.
//   4. Calls OpenAI embeddings in batches of 100 inputs with openai_api_key
//      from encrypted app settings to produce 1536-dim vectors.
//   5. Inserts the chunks + vectors into knowledge_chunks and marks the KB
//      status='ready' (or 'error' on failure).
// ============================================================================

import { requireAdmin, AuthError } from '../_shared/auth.ts';
import { getAdminClient } from '../_shared/supabase-admin.ts';
import { loadAppCredentials } from '../_shared/tenant-credentials.ts';
import { jsonResponse, preflight } from '../_shared/cors.ts';
import { extractText, getDocumentProxy } from 'https://esm.sh/unpdf@0.12.1';

type SourceType = 'text' | 'url' | 'pdf';

interface Payload {
  knowledge_base_id?: string;
  source_type?: SourceType;
  // For text: raw text. For url: the URL. For pdf: the storage file_path
  // under bucket whatsapp-hub-knowledge.
  content?: string;
}

const KNOWLEDGE_BUCKET = 'whatsapp-hub-knowledge';

const CHUNK_CHARS = 2000;   // ~500 tokens
const OVERLAP_CHARS = 200;  // ~50 tokens
const EMBED_MODEL = 'text-embedding-3-small';
const EMBED_DIMS = 1536;
const EMBED_BATCH = 100;

function stripHtml(html: string): string {
  // Remove <script>/<style> blocks entirely, drop remaining tags, collapse
  // whitespace. Good enough for marketing copy / FAQ pages; NOT a parser.
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

function chunkText(text: string): string[] {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (!clean) return [];
  const chunks: string[] = [];
  let cursor = 0;
  while (cursor < clean.length) {
    const end = Math.min(clean.length, cursor + CHUNK_CHARS);
    chunks.push(clean.slice(cursor, end).trim());
    if (end === clean.length) break;
    cursor = end - OVERLAP_CHARS;
  }
  return chunks.filter((c) => c.length > 0);
}

async function embedBatch(apiKey: string, inputs: string[]): Promise<number[][]> {
  const res = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ model: EMBED_MODEL, input: inputs }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`OpenAI embeddings ${res.status}: ${err}`);
  }
  const body = await res.json();
  const rows = (body?.data ?? []) as Array<{ embedding: number[]; index: number }>;
  rows.sort((a, b) => a.index - b.index);
  return rows.map((r) => r.embedding);
}

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;

  try {
    await requireAdmin(req);

    let body: Payload;
    try {
      body = await req.json();
    } catch {
      return jsonResponse({ ok: false, error: 'JSON inválido.' }, { status: 400 });
    }

    if (!body.knowledge_base_id || !body.source_type || !body.content) {
      return jsonResponse(
        { ok: false, error: 'knowledge_base_id, source_type e content são obrigatórios.' },
        { status: 400 },
      );
    }

    const admin = getAdminClient();

    const { data: kbRow, error: kbErr } = await admin
      .from('knowledge_base')
      .select('id')
      .eq('id', body.knowledge_base_id)
      .maybeSingle();
    if (kbErr) return jsonResponse({ ok: false, error: kbErr.message }, { status: 500 });
    if (!kbRow) {
      return jsonResponse({ ok: false, error: 'Knowledge base não encontrada.' }, { status: 404 });
    }

    const fail = async (msg: string, status = 500) => {
      await admin
        .from('knowledge_base')
        .update({ status: 'error' })
        .eq('id', body.knowledge_base_id);
      return jsonResponse({ ok: false, error: msg }, { status });
    };

    const creds = await loadAppCredentials();
    if (!creds.openai_api_key) {
      return fail('Credencial openai_api_key nao configurada. Acesse /settings/credentials.', 400);
    }

    // 1. Resolve plaintext.
    let plaintext = '';
    if (body.source_type === 'text') {
      plaintext = body.content.trim();
    } else if (body.source_type === 'url') {
      try {
        const urlRes = await fetch(body.content, {
          headers: { 'User-Agent': 'whatsapp-hub-knowledge/1.0' },
        });
        if (!urlRes.ok) {
          return fail(`Falha ao buscar URL: HTTP ${urlRes.status}`);
        }
        const html = await urlRes.text();
        plaintext = stripHtml(html);
      } catch (err) {
        return fail(`Falha ao buscar URL: ${err instanceof Error ? err.message : String(err)}`);
      }
    } else if (body.source_type === 'pdf') {
      try {
        // body.content is the storage path inside whatsapp-hub-knowledge.
        // Single-org install: no tenant prefix to validate.
        const { data: blob, error: dlErr } = await admin.storage
          .from(KNOWLEDGE_BUCKET)
          .download(body.content);
        if (dlErr || !blob) {
          return fail(`Falha ao baixar PDF: ${dlErr?.message ?? 'desconhecido'}`);
        }
        const buffer = new Uint8Array(await blob.arrayBuffer());
        const doc = await getDocumentProxy(buffer);
        const { text } = await extractText(doc, { mergePages: true });
        plaintext = Array.isArray(text) ? text.join('\n') : text;
        // Persist file_path on the KB row so the UI can link back to it.
        await admin
          .from('knowledge_base')
          .update({ file_path: body.content, type: 'pdf' })
          .eq('id', body.knowledge_base_id);
      } catch (err) {
        return fail(`Falha ao extrair PDF: ${err instanceof Error ? err.message : String(err)}`);
      }
    } else {
      return fail('source_type inválido (use text, url ou pdf).', 400);
    }

    if (!plaintext) {
      return fail('Nenhum texto extraído do source.', 400);
    }

    // 2. Clear any previous chunks for idempotent re-processing.
    await admin
      .from('knowledge_chunks')
      .delete()
      .eq('knowledge_base_id', body.knowledge_base_id);

    // 3. Chunk.
    const chunks = chunkText(plaintext);
    if (chunks.length === 0) {
      return fail('Nenhum chunk gerado do texto.', 400);
    }

    // 4. Embed in batches.
    const rows: Array<{
      knowledge_base_id: string;
      content: string;
      embedding: number[];
      metadata: Record<string, unknown>;
    }> = [];

    try {
      for (let i = 0; i < chunks.length; i += EMBED_BATCH) {
        const batch = chunks.slice(i, i + EMBED_BATCH);
        const vectors = await embedBatch(creds.openai_api_key, batch);
        if (vectors.length !== batch.length || vectors.some((v) => v.length !== EMBED_DIMS)) {
          throw new Error('Embeddings retornados em shape inesperado.');
        }
        batch.forEach((chunkText, idx) => {
          rows.push({
            knowledge_base_id: body.knowledge_base_id!,
            content: chunkText,
            embedding: vectors[idx],
            metadata: { index: i + idx, source_type: body.source_type },
          });
        });
      }
    } catch (err) {
      return fail(err instanceof Error ? err.message : 'Falha ao gerar embeddings.');
    }

    // 5. Insert chunks + flip status.
    const { error: insErr } = await admin
      .from('knowledge_chunks')
      .insert(rows);
    if (insErr) return fail(`Falha ao gravar chunks: ${insErr.message}`);

    await admin
      .from('knowledge_base')
      .update({
        status: 'ready',
        file_size_bytes: new TextEncoder().encode(plaintext).length,
      })
      .eq('id', body.knowledge_base_id);

    return jsonResponse({
      ok: true,
      chunks: rows.length,
      total_chars: plaintext.length,
    });
  } catch (err) {
    if (err instanceof AuthError) {
      return jsonResponse({ ok: false, error: err.message }, { status: err.status });
    }
    console.error('process-knowledge error', err);
    return jsonResponse(
      { ok: false, error: err instanceof Error ? err.message : 'Erro interno' },
      { status: 500 },
    );
  }
});
