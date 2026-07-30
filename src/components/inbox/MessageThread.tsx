import { useEffect, useRef } from 'react';
import { Bot, Check, CheckCheck, Clock, FileText, StickyNote, User } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Message } from '@/types/inbox';
import type { ThreadMessage } from '@/hooks/useMessages';

interface MessageThreadProps {
  messages: ThreadMessage[];
  loading: boolean;
  onRetry?: (tempId: string) => void;
  onDismiss?: (tempId: string) => void;
}

function StatusTicks({ status }: { status: Message['meta_status'] }) {
  if (!status) return null;
  if (status === 'failed') return <span className="text-[var(--color-error)] text-[10px]">falhou</span>;
  if (status === 'read') return <CheckCheck className="h-3 w-3 text-[#3B82F6]" />;
  if (status === 'delivered') return <CheckCheck className="h-3 w-3 opacity-60" />;
  return <Check className="h-3 w-3 opacity-60" />;
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

function SenderIcon({ sender }: { sender: Message['sender_type'] }) {
  if (sender === 'ai') return <Bot className="h-3.5 w-3.5" />;
  if (sender === 'operator') return <User className="h-3.5 w-3.5" />;
  return null;
}

const MEDIA_LABEL: Record<string, string> = {
  image: 'Imagem',
  audio: 'Áudio',
  video: 'Vídeo',
  document: 'Documento',
};

const MEDIA_RECEIVED: Record<string, string> = {
  image: 'Imagem recebida',
  audio: 'Áudio recebido',
  video: 'Vídeo recebido',
  document: 'Documento recebido',
};

// Renderiza mídia quando `media_url` já é uma URL http(s). No modelo Zernio,
// tanto a mídia inbound (URL do attachment no webhook) quanto a outbound do
// operador (URL do /media/upload-direct) chegam já como URL — o placeholder
// abaixo só aparece em linhas antigas sem URL resolvida.
function MediaContent({ message }: { message: Message }) {
  const url = message.media_url ?? '';
  const isHttp = /^https?:\/\//i.test(url);
  const label = MEDIA_LABEL[message.content_type] ?? 'Mídia';
  const caption = message.content?.trim();

  if (isHttp) {
    // Toda mídia passa pelo proxy /api/media — as URLs do Zernio/Meta precisam
    // de Bearer token para download e o browser não consegue acessá-las direto.
    const proxyUrl = `/api/media?url=${encodeURIComponent(url)}`;
    
    if (message.content_type === 'image') {
      return (
        <div className="space-y-1">
          <img src={proxyUrl} alt={caption || label} className="max-h-64 rounded-lg" loading="lazy" />
          {caption && <div className="whitespace-pre-wrap break-words">{caption}</div>}
        </div>
      );
    }
    if (message.content_type === 'audio') {
      return <audio controls src={proxyUrl} className="max-w-full" />;
    }
    if (message.content_type === 'video') {
      return <video controls src={proxyUrl} className="max-h-64 rounded-lg" />;
    }
    return (
      <a href={proxyUrl} target="_blank" rel="noopener noreferrer" className="underline break-all">
        {caption || `Abrir ${label.toLowerCase()}`}
      </a>
    );
  }

  // Sem URL resolvida — placeholder informativo (ver débito técnico: pipeline
  // de download de mídia da Meta ainda não implementado).
  const received = MEDIA_RECEIVED[message.content_type] ?? 'Mídia recebida';
  return (
    <div className="italic opacity-80">
      {received}
      {caption ? `: ${caption}` : ' — visualização indisponível nesta versão.'}
    </div>
  );
}

function FailedActions({
  tempId,
  onRetry,
  onDismiss,
  inverse,
}: {
  tempId: string;
  onRetry?: (tempId: string) => void;
  onDismiss?: (tempId: string) => void;
  inverse?: boolean;
}) {
  // inverse=true → dentro do balão azul (texto claro); senão card claro.
  const base = inverse ? 'text-white/90' : 'text-[var(--color-error)]';
  return (
    <div className={cn('mt-1 flex items-center gap-2 text-[10px]', base)}>
      <span className="font-semibold">Não enviou.</span>
      <button type="button" onClick={() => onRetry?.(tempId)} className="underline hover:opacity-80">
        Reenviar
      </button>
      <button type="button" onClick={() => onDismiss?.(tempId)} className="underline opacity-70 hover:opacity-100">
        Descartar
      </button>
    </div>
  );
}

export function MessageThread({ messages, loading, onRetry, onDismiss }: MessageThreadProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Auto-scroll to newest message. Setting block to 'end' and using a ref
    // target below the last bubble avoids fighting with user scroll-up.
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages.length]);

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-label opacity-60">Carregando mensagens...</div>
      </div>
    );
  }

  if (messages.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-label opacity-60">Nenhuma mensagem nesta conversa.</div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-6 space-y-3">
      {messages.map((m) => {
        const isNote = m.is_private_note;
        const isInbound = m.direction === 'inbound';

        if (isNote) {
          // Internal note — no bubble alignment; full-width yellow-tinted card.
          return (
            <div
              key={m.id}
              className={cn(
                'mx-auto max-w-[85%] rounded-lg border border-[rgba(245,158,11,0.25)] bg-[rgba(245,158,11,0.06)] p-3',
                m._state === 'pending' && 'opacity-70',
              )}
            >
              <div className="flex items-center gap-2 text-[10px] uppercase tracking-wide text-[#FBBF24] mb-1">
                <StickyNote className="h-3 w-3" />
                Nota privada entre operadores
                <span className="ml-auto opacity-70 inline-flex items-center gap-1">
                  {m._state === 'pending' && <Clock className="h-3 w-3 animate-pulse" />}
                  {formatTime(m.created_at)}
                </span>
              </div>
              <div className="text-sm text-[var(--color-text-primary)] whitespace-pre-wrap break-words">
                {m.content}
              </div>
              {m._state === 'failed' && m._tempId && (
                <FailedActions tempId={m._tempId} onRetry={onRetry} onDismiss={onDismiss} />
              )}
            </div>
          );
        }

        return (
          <div
            key={m.id}
            className={cn('flex', isInbound ? 'justify-start' : 'justify-end')}
          >
            <div
              className={cn(
                'max-w-[70%] rounded-2xl px-4 py-2.5 text-sm shadow-sm transition-opacity',
                isInbound
                  ? 'bg-white/[0.04] text-[var(--color-text-primary)] rounded-bl-md'
                  : 'bg-[var(--accent-primary)] text-white rounded-br-md',
                m._state === 'pending' && 'opacity-70',
                m._state === 'failed' && 'ring-1 ring-[var(--color-error)]',
              )}
            >
              {!isInbound && m.sender_type !== 'contact' && (
                <div className="flex items-center gap-1 text-[10px] uppercase tracking-wide opacity-70 mb-1">
                  <SenderIcon sender={m.sender_type} />
                  {m.sender_type === 'ai' ? 'IA' : 'Operador'}
                </div>
              )}
              {m.content_type === 'text' || m.content_type === 'note' ? (
                <div className="whitespace-pre-wrap break-words">{m.content}</div>
              ) : m.content_type === 'template' ? (
                // Template é texto renderizado (body com variáveis já substituídas),
                // não mídia — exibe o conteúdo com um rótulo discreto de template.
                <div className="space-y-1">
                  <div className="flex items-center gap-1 text-[10px] uppercase tracking-wide opacity-70">
                    <FileText className="h-3 w-3" />
                    Template
                  </div>
                  <div className="whitespace-pre-wrap break-words">{m.content}</div>
                </div>
              ) : (
                <MediaContent message={m} />
              )}
              <div
                className={cn(
                  'flex items-center gap-1 text-[10px] mt-1 opacity-70',
                  isInbound ? 'justify-start' : 'justify-end',
                )}
              >
                <span>{formatTime(m.created_at)}</span>
                {!isInbound && m._state === 'pending' && (
                  <Clock className="h-3 w-3 animate-pulse" aria-label="enviando" />
                )}
                {!isInbound && m._state !== 'pending' && m._state !== 'failed' && (
                  <StatusTicks status={m.meta_status} />
                )}
              </div>
              {m._state === 'failed' && m._tempId && (
                <FailedActions tempId={m._tempId} onRetry={onRetry} onDismiss={onDismiss} inverse />
              )}
            </div>
          </div>
        );
      })}
      <div ref={bottomRef} />
    </div>
  );
}
