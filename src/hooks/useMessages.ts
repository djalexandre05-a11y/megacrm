import { useCallback, useEffect, useMemo, useState } from 'react';
import { getSupabase } from '@/lib/supabase';
import { useAppUser } from '@/app/providers/AppUserProvider';
import type { Message } from '@/types/inbox';

// Mensagem exibida na thread: pode ser uma linha real do banco ou um balão
// OTIMISTA (ainda sendo enviado). Os campos `_...` só existem no cliente.
export type ThreadMessage = Message & {
  _tempId?: string;
  _state?: 'pending' | 'sent' | 'failed';
  _realId?: string;
  _retry?: { text: string; isPrivate: boolean };
};

export interface SendResult {
  ok: boolean;
  zernioError?: string | null;
}

interface UseMessagesResult {
  messages: ThreadMessage[];
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
  sendText: (text: string, isPrivate: boolean) => Promise<SendResult>;
  retry: (tempId: string) => Promise<SendResult>;
  dismissFailed: (tempId: string) => void;
}

export function useMessages(conversationId: string | null): UseMessagesResult {
  const { userId } = useAppUser();
  const [real, setReal] = useState<Message[]>([]);
  const [optimistic, setOptimistic] = useState<ThreadMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!conversationId) {
      setReal([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    const supabase = getSupabase();
    const { data, error: err } = await supabase.schema('whatsapp_hub')
      .from('messages')
      .select('*')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: true });
    if (err) setError(err.message);
    else setReal((data ?? []) as Message[]);
    setLoading(false);
  }, [conversationId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  // Troca de conversa: descarta balões otimistas da conversa anterior.
  useEffect(() => {
    setOptimistic([]);
  }, [conversationId]);

  // Realtime: append new messages + update existing (meta_status transitions).
  useEffect(() => {
    if (!userId || !conversationId) return;
    const supabase = getSupabase();
    const suffix = Math.random().toString(36).slice(2, 10);
    const channel = supabase
      .channel(`messages:${conversationId}:${suffix}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'whatsapp_hub',
          table: 'messages',
          filter: `conversation_id=eq.${conversationId}`,
        },
        (payload) => {
          if (payload.eventType === 'INSERT') {
            const next = payload.new as Message;
            setReal((prev) => (prev.some((m) => m.id === next.id) ? prev : [...prev, next]));
          } else if (payload.eventType === 'UPDATE') {
            const updated = payload.new as Message;
            setReal((prev) => prev.map((m) => (m.id === updated.id ? updated : m)));
          } else if (payload.eventType === 'DELETE') {
            const removed = payload.old as Message;
            setReal((prev) => prev.filter((m) => m.id !== removed.id));
          }
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [userId, conversationId]);

  // Casa um balão otimista com a linha real correspondente. Preferimos o id
  // (_realId ↔ real.id), mas o realtime costuma trazer a linha real ANTES de a
  // função resolver e setar _realId — por isso também casamos por conteúdo
  // (direção + nota + texto), consumindo cada linha real no máximo uma vez.
  // Assim o balão de "enviando" some sem nunca duplicar a mensagem.
  const reconcile = useCallback(
    (bubbles: ThreadMessage[]): ThreadMessage[] => {
      if (bubbles.length === 0) return bubbles;
      const realById = new Set(real.map((m) => m.id));
      const consumed = new Set<string>();
      return bubbles.filter((o) => {
        if (o._realId && realById.has(o._realId)) return false;
        const match = real.find(
          (m) =>
            !consumed.has(m.id) &&
            m.direction === 'outbound' &&
            m.sender_type === 'operator' &&
            Boolean(m.is_private_note) === Boolean(o.is_private_note) &&
            m.content === o.content,
        );
        if (match) {
          consumed.add(match.id);
          return false;
        }
        return true;
      });
    },
    [real],
  );

  // Remove do estado os balões já conciliados (evita crescer indefinidamente).
  useEffect(() => {
    setOptimistic((prev) => {
      const next = reconcile(prev);
      return next.length === prev.length ? prev : next;
    });
  }, [real, reconcile]);

  const messages = useMemo<ThreadMessage[]>(() => {
    const stillPending = reconcile(optimistic);
    return [...(real as ThreadMessage[]), ...stillPending].sort(
      (a, b) => +new Date(a.created_at) - +new Date(b.created_at),
    );
  }, [real, optimistic, reconcile]);

  // Executa (ou re-executa) o envio de um balão otimista e concilia o estado.
  const doSend = useCallback(
    async (tempId: string, text: string, isPrivate: boolean): Promise<SendResult> => {
      if (!conversationId) return { ok: false };
      setOptimistic((prev) =>
        prev.map((o) => (o._tempId === tempId ? { ...o, _state: 'pending' } : o)),
      );
      const supabase = getSupabase();
      const { data, error: err } = await supabase.functions.invoke('send-operator-message', {
        body: { conversation_id: conversationId, content: text, is_private_note: isPrivate },
      });
      if (err || !data?.ok) {
        setOptimistic((prev) =>
          prev.map((o) => (o._tempId === tempId ? { ...o, _state: 'failed' } : o)),
        );
        return { ok: false, zernioError: data?.error ?? err?.message ?? null };
      }
      setOptimistic((prev) =>
        prev.map((o) =>
          o._tempId === tempId
            ? { ...o, _state: 'sent', _realId: (data.message_id as string) ?? undefined }
            : o,
        ),
      );
      return { ok: true, zernioError: (data.zernio_error as string | undefined) ?? null };
    },
    [conversationId],
  );

  const sendText = useCallback(
    async (text: string, isPrivate: boolean): Promise<SendResult> => {
      const trimmed = text.trim();
      if (!conversationId || !trimmed) return { ok: false };
      const tempId = `temp-${crypto.randomUUID()}`;
      const bubble: ThreadMessage = {
        id: tempId,
        conversation_id: conversationId,
        direction: 'outbound',
        sender_type: 'operator',
        sender_id: userId,
        content_type: isPrivate ? 'note' : 'text',
        content: trimmed,
        media_url: null,
        zernio_message_id: null,
        meta_status: null,
        is_private_note: isPrivate,
        created_at: new Date().toISOString(),
        _tempId: tempId,
        _state: 'pending',
        _retry: { text: trimmed, isPrivate },
      };
      setOptimistic((prev) => [...prev, bubble]);
      return doSend(tempId, trimmed, isPrivate);
    },
    [conversationId, userId, doSend],
  );

  const retry = useCallback(
    async (tempId: string): Promise<SendResult> => {
      const bubble = optimistic.find((o) => o._tempId === tempId);
      if (!bubble?._retry) return { ok: false };
      return doSend(tempId, bubble._retry.text, bubble._retry.isPrivate);
    },
    [optimistic, doSend],
  );

  const dismissFailed = useCallback((tempId: string) => {
    setOptimistic((prev) => prev.filter((o) => o._tempId !== tempId));
  }, []);

  return { messages, loading, error, reload, sendText, retry, dismissFailed };
}
