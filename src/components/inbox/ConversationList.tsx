import { Bot, Inbox, Instagram, MessageCircle, Smartphone, User } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ConversationChannel, ConversationWithContact } from '@/types/inbox';

// Badge de canal: distingue de onde a conversa veio (WhatsApp x Instagram).
function channelBadge(channel: ConversationChannel | undefined) {
  if (channel === 'instagram') {
    return { Icon: Instagram, label: 'Instagram', color: 'text-[#E1306C]' };
  }
  if (channel === 'uazapi') {
    return { Icon: Smartphone, label: 'Uazapi', color: 'text-[#F59E0B]' };
  }
  return { Icon: MessageCircle, label: 'WhatsApp', color: 'text-[#25D366]' };
}

interface ConversationListProps {
  conversations: ConversationWithContact[];
  loading: boolean;
  selectedId: string | null;
  onSelect: (id: string) => void;
}

function statusBadge(status: ConversationWithContact['status']) {
  switch (status) {
    case 'ai_active':
      return { Icon: Bot, label: 'IA', color: 'text-[var(--accent-primary)]' };
    case 'human_active':
      return { Icon: User, label: 'Humano', color: 'text-[var(--color-success)]' };
    case 'closed':
      return { Icon: Inbox, label: 'Fechada', color: 'text-[var(--color-text-secondary)]' };
  }
}

function formatTimestamp(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  const today = new Date();
  if (d.toDateString() === today.toDateString()) {
    return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  }
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
}

export function ConversationList({
  conversations,
  loading,
  selectedId,
  onSelect,
}: ConversationListProps) {
  if (loading) {
    return (
      <div className="p-6 text-center text-label opacity-60">Carregando...</div>
    );
  }
  if (conversations.length === 0) {
    return (
      <div className="p-6 text-center">
        <div className="text-label mb-2">Nenhuma conversa ainda</div>
        <div className="text-xs text-[var(--color-text-secondary)] opacity-70 max-w-[240px] mx-auto">
          Conversas aparecem aqui assim que um contato enviar a primeira mensagem
          ou você simular uma mensagem inbound (botão acima).
        </div>
      </div>
    );
  }

  return (
    <ul className="divide-y divide-[rgba(59,130,246,0.06)]">
      {conversations.map((c) => {
        const badge = statusBadge(c.status);
        const Icon = badge.Icon;
        const chan = channelBadge(c.channel);
        const ChanIcon = chan.Icon;
        const isActive = c.id === selectedId;
        const contact = c.contact;
        const displayName = contact?.name?.trim() || contact?.phone || '—';
        return (
          <li key={c.id}>
            <button
              type="button"
              onClick={() => onSelect(c.id)}
              className={cn(
                'w-full text-left p-3 transition-colors',
                'hover:bg-white/[0.03]',
                isActive && 'bg-[rgba(59,130,246,0.08)] border-l-2 border-[var(--accent-primary)]',
                !isActive && 'border-l-2 border-transparent',
              )}
            >
              <div className="flex items-start gap-3">
                <div className="relative shrink-0">
                  <div className="h-10 w-10 rounded-full bg-gradient-to-br from-white/10 to-white/5 flex items-center justify-center text-sm font-semibold text-[var(--color-text-primary)]">
                    {displayName.slice(0, 2).toUpperCase()}
                  </div>
                  <span
                    title={chan.label}
                    className="absolute -bottom-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-[#0A0A0F] ring-1 ring-[rgba(59,130,246,0.2)]"
                  >
                    <ChanIcon className={cn('h-2.5 w-2.5', chan.color)} />
                  </span>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-sm font-semibold text-[var(--color-text-primary)] truncate">
                      {displayName}
                    </div>
                    <div className="text-[10px] text-[var(--color-text-secondary)] shrink-0">
                      {formatTimestamp(c.last_message_at)}
                    </div>
                  </div>
                  <div className="text-xs text-[var(--color-text-secondary)] truncate mt-0.5">
                    {c.lastMessagePreview ?? <span className="opacity-40">—</span>}
                  </div>
                  <div className="flex items-center gap-2 mt-1.5">
                    <span className={cn('inline-flex items-center gap-1 text-[10px] uppercase tracking-wide font-semibold', badge.color)}>
                      <Icon className="h-3 w-3" />
                      {badge.label}
                    </span>
                    {c.ai_paused && (
                      <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wide font-semibold text-[#FBBF24]">
                        ⏸ IA pausada
                      </span>
                    )}
                    {c.unread_count > 0 && (
                      <span className="ml-auto text-[10px] font-bold bg-[var(--accent-primary)] text-white rounded-full px-2 py-0.5">
                        {c.unread_count}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
