// ============================================================================
// send-operator-message
// ----------------------------------------------------------------------------
// Operator or admin replies inside a conversation. We ALWAYS persist the
// message (so UI updates optimistically via realtime) and then optionally
// forward the message to Meta's session-messages endpoint — which only works
// if the contact has messaged the tenant in the last 24 h (Meta's session
// window). Failures there are recorded in meta_status but do NOT fail the
// DB write; the row carries the Meta error for ops visibility.
//
// is_private_note=true bypasses the Meta call entirely — private notes are
// internal and never touch WhatsApp.
// ============================================================================

import { requireCaller, AuthError } from '../_shared/auth.ts';
import { getAdminClient } from '../_shared/supabase-admin.ts';
import { jsonResponse, preflight } from '../_shared/cors.ts';
import { createInboxConversation, loadZernioContext, sendInboxMessage } from '../_shared/zernio.ts';
import { sendUazapiMessage } from '../_shared/whatsapp/outbound.ts';

interface Payload {
  conversation_id?: string;
  content?: string;
  is_private_note?: boolean;
}

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;

  try {
    const caller = await requireCaller(req);
    if (caller.role !== 'admin' && caller.role !== 'operator') {
      return jsonResponse({ ok: false, error: 'Sem permissão para enviar mensagens.' }, { status: 403 });
    }

    let body: Payload;
    try {
      body = await req.json();
    } catch {
      return jsonResponse({ ok: false, error: 'JSON inválido.' }, { status: 400 });
    }

    const conversationId = body.conversation_id?.trim();
    const content = (body.content ?? '').trim();
    const isPrivate = Boolean(body.is_private_note);

    if (!conversationId) return jsonResponse({ ok: false, error: 'conversation_id ausente.' }, { status: 400 });
    if (!content) return jsonResponse({ ok: false, error: 'Conteúdo vazio.' }, { status: 400 });

    // Meta Cloud API rejeita mensagens > 4096 caracteres no body de texto.
    // Notas privadas seguem o mesmo limite por consistência (e para evitar
    // BLOBs gigantes ocupando a tabela messages).
    const MAX_CONTENT_LENGTH = 4096;
    if (content.length > MAX_CONTENT_LENGTH) {
      return jsonResponse(
        { ok: false, error: `Conteúdo excede ${MAX_CONTENT_LENGTH} caracteres (limite da Meta Cloud API).` },
        { status: 400 },
      );
    }

    const admin = getAdminClient();

    const { data: conv, error: convErr } = await admin
      .from('conversations')
      .select('id, contact_id, status, channel, zernio_conversation_id')
      .eq('id', conversationId)
      .maybeSingle();
    if (convErr) return jsonResponse({ ok: false, error: convErr.message }, { status: 500 });
    if (!conv) {
      return jsonResponse({ ok: false, error: 'Conversa não encontrada.' }, { status: 404 });
    }

    // Insert the message row first. UI gets it from realtime immediately.
    const { data: inserted, error: insErr } = await admin
      .from('messages')
      .insert({
        conversation_id: conversationId,
        direction: 'outbound',
        sender_type: 'operator',
        sender_id: caller.userId,
        content_type: isPrivate ? 'note' : 'text',
        content,
        is_private_note: isPrivate,
      })
      .select()
      .single();
    if (insErr) return jsonResponse({ ok: false, error: insErr.message }, { status: 500 });
    const message = inserted as { id: string };

    // Bump conversation timestamps for ordering.
    await admin
      .from('conversations')
      .update({
        last_message_at: new Date().toISOString(),
        // If a human starts typing, flip the status so the AI pauses.
        ...(isPrivate
          ? {}
          : { status: 'human_active', ai_paused: true, assigned_to: caller.userId }),
      })
      .eq('id', conversationId);

    if (isPrivate) {
      return jsonResponse({ ok: true, message_id: message.id, sent_to_zernio: false });
    }

    const convRow = conv as { contact_id: string; channel: string | null; zernio_conversation_id: string | null };

    // Conversas do canal 'uazapi' respondem pelo provedor Uazapi (coexiste com
    // o WABA/Zernio — cada conversa sai por onde a mensagem chegou).
    if (convRow.channel === 'uazapi') {
      try {
        const { data: contactRow } = await admin
          .from('contacts').select('phone').eq('id', convRow.contact_id).maybeSingle();
        const phone = (contactRow as { phone?: string } | null)?.phone ?? null;
        if (!phone) throw new Error('Contato sem telefone.');
        const sent = await sendUazapiMessage(phone, content);
        await admin
          .from('messages')
          .update({ meta_status: 'sent', zernio_message_id: sent.messageId ? `uazapi:${sent.messageId}` : null })
          .eq('id', message.id);
        return jsonResponse({ ok: true, message_id: message.id, sent_via: 'uazapi' });
      } catch (err) {
        await admin.from('messages').update({ meta_status: 'failed' }).eq('id', message.id);
        return jsonResponse({
          ok: true,
          message_id: message.id,
          sent_via: 'uazapi',
          uazapi_error: err instanceof Error ? err.message : 'Erro ao enviar via Uazapi.',
        });
      }
    }

    // Envia via Zernio. Mensagem livre exige a janela de 24h aberta; fora dela
    // o Zernio responde com erro (registrado em meta_status, sem falhar o DB).
    let ctx: Awaited<ReturnType<typeof loadZernioContext>>;
    try {
      ctx = await loadZernioContext();
    } catch (err) {
      await admin.from('messages').update({ meta_status: 'failed' }).eq('id', message.id);
      return jsonResponse({
        ok: true,
        message_id: message.id,
        sent_to_zernio: false,
        zernio_error: err instanceof Error ? err.message : 'Credenciais Zernio ausentes.',
      });
    }

    try {
      let zernioConversationId = convRow.zernio_conversation_id;
      let zernioMessageId: string | null = null;

      if (!zernioConversationId) {
        const { data: contactRow } = await admin
          .from('contacts')
          .select('phone')
          .eq('id', convRow.contact_id)
          .maybeSingle();
        const phone = (contactRow as { phone?: string } | null)?.phone ?? null;
        if (!phone) throw new Error('Contato sem telefone.');
        const created = await createInboxConversation({ apiKey: ctx.apiKey, accountId: ctx.accountId, participantId: phone });
        zernioConversationId = created.conversationId;
        if (zernioConversationId) {
          await admin.from('conversations').update({ zernio_conversation_id: zernioConversationId }).eq('id', conversationId);
        }
      }
      if (!zernioConversationId) throw new Error('Nao foi possivel resolver a conversa no Zernio.');

      const sent = await sendInboxMessage({ apiKey: ctx.apiKey, accountId: ctx.accountId, conversationId: zernioConversationId, text: content });
      zernioMessageId = sent.messageId;

      await admin
        .from('messages')
        .update({ meta_status: 'sent', zernio_message_id: zernioMessageId })
        .eq('id', message.id);

      return jsonResponse({
        ok: true,
        message_id: message.id,
        sent_to_zernio: true,
        zernio_message_id: zernioMessageId,
      });
    } catch (err) {
      await admin.from('messages').update({ meta_status: 'failed' }).eq('id', message.id);
      return jsonResponse({
        ok: true,
        message_id: message.id,
        sent_to_zernio: false,
        zernio_error: err instanceof Error ? err.message : 'Erro ao enviar via Zernio.',
      });
    }
  } catch (err) {
    if (err instanceof AuthError) {
      return jsonResponse({ ok: false, error: err.message }, { status: err.status });
    }
    console.error('send-operator-message error', err);
    return jsonResponse(
      { ok: false, error: err instanceof Error ? err.message : 'Erro interno' },
      { status: 500 },
    );
  }
});
