import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ArrowLeft, Inbox as InboxIcon, Info, Pin, Search, X } from 'lucide-react';
import { useConversations } from '@/hooks/useConversations';
import { useMessages } from '@/hooks/useMessages';
import { useOperators } from '@/hooks/useOperators';
import { useTags } from '@/hooks/useTags';
import { ConversationList } from '@/components/inbox/ConversationList';
import { MessageThread } from '@/components/inbox/MessageThread';
import { MessageInput } from '@/components/inbox/MessageInput';
import { ContactPanel } from '@/components/inbox/ContactPanel';
import { InboxFilters } from '@/components/inbox/InboxFilters';
import {
  DEFAULT_FILTERS,
  matchesFilters,
  readFiltersFromParams,
  writeFiltersToParams,
  type InboxFilterState,
} from '@/components/inbox/inbox-filters';
import { LoadErrorBanner } from '@/components/LoadErrorBanner';

export default function InboxPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [filters, setFiltersState] = useState<InboxFilterState>(() =>
    readFiltersFromParams(searchParams),
  );
  const [selectedId, setSelectedId] = useState<string | null>(
    searchParams.get('conversation'),
  );
  const [search, setSearch] = useState('');
  // No mobile (<lg) mostramos uma coluna por vez: lista quando nada está
  // selecionado, senão a thread. O painel de contato vira um overlay.
  const [showPanelMobile, setShowPanelMobile] = useState(false);
  const { operators } = useOperators();
  const { tags } = useTags();

  // Persiste os filtros na querystring (namespace f*), preservando ?conversation.
  const updateFilters = (next: InboxFilterState) => {
    setFiltersState(next);
    setSearchParams((prev) => writeFiltersToParams(prev, next), { replace: true });
  };

  // Sync selectedId ↔ URL query. Notifications deep-link into the inbox with
  // ?conversation=<uuid> — we pick it up here and also update the URL when
  // the operator switches rows so sharing / bookmarks work.
  useEffect(() => {
    const fromUrl = searchParams.get('conversation');
    if (fromUrl && fromUrl !== selectedId) {
      setSelectedId(fromUrl);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  useEffect(() => {
    if (selectedId && searchParams.get('conversation') !== selectedId) {
      // Merge — não sobrescreve os params de filtro.
      setSearchParams(
        (prev) => {
          const p = new URLSearchParams(prev);
          p.set('conversation', selectedId);
          return p;
        },
        { replace: true },
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  const {
    conversations,
    loading: loadingConvs,
    error: convError,
    reload: reloadConvs,
    setStatus,
    setAiPaused,
    setAssigned,
    setActiveDeal,
    setPinnedNote,
    setArchived,
    markRead,
  } = useConversations();

  const visibleConversations = useMemo(() => {
    const now = Date.now();
    const q = search.trim().toLowerCase();
    return conversations.filter((c) => {
      if (!matchesFilters(c, filters, now)) return false;
      if (!q) return true;
      const name = c.contact?.name?.toLowerCase() ?? '';
      const phone = c.contact?.phone?.toLowerCase() ?? '';
      const preview = c.lastMessagePreview?.toLowerCase() ?? '';
      return name.includes(q) || phone.includes(q) || preview.includes(q);
    });
  }, [conversations, search, filters]);

  const { messages, loading: loadingMsgs, sendText, retry, dismissFailed } = useMessages(selectedId);

  const selected = useMemo(
    () => conversations.find((c) => c.id === selectedId) ?? null,
    [conversations, selectedId],
  );

  // Chips de filtros ativos (fora o canal, que tem controle próprio).
  const activeChips = useMemo(() => {
    const chips: { key: string; label: string; clear: () => void }[] = [];
    for (const a of filters.atendente) {
      chips.push({
        key: `at:${a}`,
        label: a === 'ia' ? 'Atendente: IA' : 'Atendente: Humano',
        clear: () => updateFilters({ ...filters, atendente: filters.atendente.filter((x) => x !== a) }),
      });
    }
    const isDefaultStatus = filters.status.length === 1 && filters.status[0] === 'abertas';
    if (!isDefaultStatus && filters.status.length > 0) {
      chips.push({
        key: 'st',
        label: `Status: ${filters.status.join(', ')}`,
        clear: () => updateFilters({ ...filters, status: DEFAULT_FILTERS.status }),
      });
    }
    if (filters.assigned !== 'any') {
      const label =
        filters.assigned === 'unassigned'
          ? 'Não atribuído'
          : operators.find((o) => o.user_id === filters.assigned)?.email ?? 'Atribuído';
      chips.push({
        key: 'as',
        label: `Atribuído: ${label}`,
        clear: () => updateFilters({ ...filters, assigned: 'any' }),
      });
    }
    for (const tid of filters.tagIds) {
      const name = tags.find((t) => t.id === tid)?.name ?? 'tag';
      chips.push({
        key: `tg:${tid}`,
        label: `Tag: ${name}`,
        clear: () => updateFilters({ ...filters, tagIds: filters.tagIds.filter((x) => x !== tid) }),
      });
    }
    if (filters.janela !== 'any') {
      chips.push({
        key: 'jw',
        label: filters.janela === 'dentro' ? 'Dentro de 24h' : 'Fora de 24h',
        clear: () => updateFilters({ ...filters, janela: 'any' }),
      });
    }
    return chips;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters, operators, tags]);

  // Janela de 24h: aberta se a última mensagem do CONTATO foi há menos de 24h.
  // Fora dela, a Meta só permite reiniciar com template.
  const withinWindow = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].direction === 'inbound') {
        return Date.now() - new Date(messages[i].created_at).getTime() < 24 * 60 * 60 * 1000;
      }
    }
    return false;
  }, [messages]);

  // Deep-link vindo do drawer do card do funil: ?contact=<uuid> seleciona a
  // conversa daquele contato assim que a lista carrega.
  useEffect(() => {
    const contactId = searchParams.get('contact');
    if (!contactId) return;
    const conv = conversations.find((c) => c.contact?.id === contactId);
    if (conv) setSelectedId(conv.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversations]);

  // Auto-select the first conversation only on desktop (lg+). No mobile,
  // auto-selecionar esconderia a lista e jogaria o usuário direto na thread.
  useEffect(() => {
    if (typeof window !== 'undefined' && !window.matchMedia('(min-width: 1024px)').matches) {
      return;
    }
    if (searchParams.get('contact')) return; // deixa o deep-link por contato decidir
    if (!selectedId && visibleConversations.length > 0) {
      setSelectedId(visibleConversations[0].id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleConversations, selectedId]);

  // Clear unread count when a conversation is open AND visible.
  useEffect(() => {
    if (selected && selected.unread_count > 0) {
      void markRead(selected.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, selected?.unread_count]);

  return (
    <div className="h-[calc(100vh-6rem)] flex flex-col">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-4">
          <div className="h-12 w-12 rounded-xl glass-card flex items-center justify-center">
            <InboxIcon className="h-5 w-5 text-[var(--accent-primary)]" />
          </div>
          <div>
            <div className="text-label">Seção</div>
            <h1 className="text-2xl font-bold text-display">Inbox</h1>
          </div>
        </div>
      </div>

      {convError && (
        <div className="mb-3">
          <LoadErrorBanner message={convError} onRetry={() => void reloadConvs()} />
        </div>
      )}

      <div className="flex-1 lg:grid lg:grid-cols-[300px_1fr_320px] gap-3 min-h-0">
        {/* Left: conversation list — no mobile some quando há conversa aberta */}
        <div
          className={`glass-card p-0 flex-col overflow-hidden h-full ${
            selectedId ? 'hidden lg:flex' : 'flex'
          }`}
        >
          <div className="p-3 border-b border-[rgba(59,130,246,0.08)] space-y-2">

            {/* Busca + botão de filtros avançados (7.2) */}
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[var(--color-text-secondary)]" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Buscar nome, telefone ou mensagem…"
                  className="w-full rounded-lg border border-[rgba(59,130,246,0.2)] bg-white/[0.03] pl-8 pr-3 py-2 text-xs text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--accent-primary)]"
                />
              </div>
              <InboxFilters
                filters={filters}
                onChange={updateFilters}
                operators={operators}
                tags={tags}
              />
            </div>

            {/* Chips de filtros ativos + contador */}
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div className="flex flex-wrap gap-1.5">
                {activeChips.map((chip) => (
                  <span
                    key={chip.key}
                    className="inline-flex items-center gap-1 rounded-full border border-[rgba(59,130,246,0.25)] bg-[rgba(59,130,246,0.1)] pl-2.5 pr-1 py-0.5 text-[11px] text-[var(--color-text-primary)]"
                  >
                    {chip.label}
                    <button
                      type="button"
                      onClick={chip.clear}
                      aria-label={`Remover filtro ${chip.label}`}
                      className="h-4 w-4 flex items-center justify-center rounded-full hover:bg-white/10"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}
                {activeChips.length > 0 && (
                  <button
                    type="button"
                    onClick={() => updateFilters({ ...DEFAULT_FILTERS, channel: filters.channel })}
                    className="text-[11px] font-semibold text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
                  >
                    Limpar filtros
                  </button>
                )}
              </div>
              <span className="text-[11px] text-[var(--color-text-secondary)] whitespace-nowrap">
                {visibleConversations.length} conversa{visibleConversations.length !== 1 ? 's' : ''}
              </span>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto">
            <ConversationList
              conversations={visibleConversations}
              loading={loadingConvs}
              selectedId={selectedId}
              onSelect={setSelectedId}
            />
          </div>
        </div>

        {/* Center: thread — no mobile ocupa a tela quando há conversa aberta */}
        <div
          className={`glass-card p-0 flex-col overflow-hidden h-full ${
            selectedId ? 'flex' : 'hidden lg:flex'
          }`}
        >
          {selected ? (
            <>
              <div className="p-3 border-b border-[rgba(59,130,246,0.08)] flex items-center gap-2">
                <button
                  onClick={() => setSelectedId(null)}
                  aria-label="Voltar à lista"
                  className="lg:hidden h-9 w-9 shrink-0 flex items-center justify-center rounded-lg text-[var(--color-text-secondary)] hover:bg-white/5 hover:text-[var(--color-text-primary)] transition-all duration-[400ms] ease-[cubic-bezier(0.4,0,0.2,1)]"
                >
                  <ArrowLeft className="h-4.5 w-4.5" />
                </button>
                <div className="min-w-0 flex-1">
                  <div className="font-semibold text-[var(--color-text-primary)] text-sm truncate">
                    {selected.contact?.name?.trim() || selected.contact?.phone || '—'}
                  </div>
                  <div className="text-[10px] font-mono text-[var(--color-text-secondary)] truncate">
                    {selected.contact?.phone}
                  </div>
                </div>
                <button
                  onClick={() => setShowPanelMobile(true)}
                  aria-label="Detalhes da conversa"
                  className="xl:hidden h-9 w-9 shrink-0 flex items-center justify-center rounded-lg text-[var(--color-text-secondary)] hover:bg-white/5 hover:text-[var(--color-text-primary)] transition-all duration-[400ms] ease-[cubic-bezier(0.4,0,0.2,1)]"
                >
                  <Info className="h-4.5 w-4.5" />
                </button>
              </div>
              {selected.pinned_note && (
                <div className="flex items-start gap-2 border-b border-[rgba(245,158,11,0.2)] bg-[rgba(245,158,11,0.06)] px-4 py-2 text-sm text-[#FBBF24]">
                  <Pin className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                  <span className="text-[var(--color-text-primary)] whitespace-pre-wrap break-words">{selected.pinned_note}</span>
                </div>
              )}
              <MessageThread
                messages={messages}
                loading={loadingMsgs}
                onRetry={retry}
                onDismiss={dismissFailed}
              />
              {selected.status !== 'closed' && (
                <MessageInput
                  conversationId={selected.id}
                  withinWindow={withinWindow}
                  onSendText={sendText}
                />
              )}
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-label opacity-60">
                Selecione uma conversa para ver a thread
              </div>
            </div>
          )}
        </div>

        {/* Right: contact panel — coluna fixa só em xl; abaixo disso é overlay */}
        <div className="hidden xl:block glass-card p-0 overflow-hidden h-full">
          {selected ? (
            <ContactPanel
              conversation={selected}
              withinWindow={withinWindow}
              operators={operators}
              onPauseAI={() => setAiPaused(selected.id, true)}
              onResumeAI={() => setAiPaused(selected.id, false)}
              onClose={() => setStatus(selected.id, 'closed')}
              onReopen={() => setStatus(selected.id, 'human_active')}
              onAssign={(uid) => setAssigned(selected.id, uid)}
              onSetActiveDeal={(dealId) => setActiveDeal(selected.id, dealId)}
              onPinNote={(note) => setPinnedNote(selected.id, note)}
              onArchive={(a) => setArchived(selected.id, a)}
              onContactRefresh={() => void reloadConvs()}
            />
          ) : (
            <div className="h-full flex items-center justify-center p-6">
              <div className="text-label opacity-60">Sem conversa selecionada</div>
            </div>
          )}
        </div>
      </div>

      {/* Overlay do painel de contato em telas < xl */}
      {selected && showPanelMobile && (
        <div className="fixed inset-0 z-50 xl:hidden">
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => setShowPanelMobile(false)}
          />
          <div className="absolute right-0 top-0 h-full w-80 max-w-[85vw] glass-surface border-l border-[rgba(59,130,246,0.15)] overflow-y-auto">
            <div className="flex justify-end p-2">
              <button
                onClick={() => setShowPanelMobile(false)}
                aria-label="Fechar detalhes"
                className="h-11 w-11 flex items-center justify-center rounded-lg text-[var(--color-text-secondary)] hover:bg-white/5 hover:text-[var(--color-text-primary)] transition-all duration-[400ms] ease-[cubic-bezier(0.4,0,0.2,1)]"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <ContactPanel
              conversation={selected}
              withinWindow={withinWindow}
              operators={operators}
              onPauseAI={() => setAiPaused(selected.id, true)}
              onResumeAI={() => setAiPaused(selected.id, false)}
              onClose={() => setStatus(selected.id, 'closed')}
              onReopen={() => setStatus(selected.id, 'human_active')}
              onAssign={(uid) => setAssigned(selected.id, uid)}
              onSetActiveDeal={(dealId) => setActiveDeal(selected.id, dealId)}
              onPinNote={(note) => setPinnedNote(selected.id, note)}
              onArchive={(a) => setArchived(selected.id, a)}
              onContactRefresh={() => void reloadConvs()}
            />
          </div>
        </div>
      )}
    </div>
  );
}
