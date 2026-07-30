import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Archive, ArchiveRestore, Bot, CircleX, Clock, Pause, Pin, Play, Mail, Phone, RotateCcw, SquareKanban } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { AddToPipelineDialog } from '@/components/crm/AddToPipelineDialog';
import type { ConversationWithContact } from '@/types/inbox';
import type { Operator } from '@/hooks/useOperators';
import { useContactDeals } from '@/hooks/useContactDeals';
import { useNextActions } from '@/hooks/useNextActions';
import { NextActions } from '@/components/crm/NextActions';
import { ContactTagsEditor } from './ContactTagsEditor';
import { CustomFieldsEditor } from './CustomFieldsEditor';

interface ContactPanelProps {
  conversation: ConversationWithContact;
  withinWindow: boolean;
  operators: Operator[];
  onPauseAI: () => Promise<void>;
  onResumeAI: () => Promise<void>;
  onClose: () => Promise<void>;
  onReopen: () => Promise<void>;
  onAssign: (userId: string | null) => Promise<void>;
  onSetActiveDeal: (dealId: string | null) => Promise<void>;
  onPinNote: (note: string | null) => Promise<void>;
  onArchive: (archived: boolean) => Promise<void>;
  onContactRefresh?: () => void;
}

function Badge({ tone, children }: { tone: 'green' | 'amber' | 'gray'; children: React.ReactNode }) {
  const cls =
    tone === 'green'
      ? 'bg-[rgba(16,185,129,0.12)] text-[var(--color-success)]'
      : tone === 'amber'
        ? 'bg-[rgba(245,158,11,0.12)] text-[#FBBF24]'
        : 'bg-white/5 text-[var(--color-text-secondary)]';
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold ${cls}`}>
      {children}
    </span>
  );
}

export function ContactPanel({
  conversation, withinWindow, operators,
  onPauseAI, onResumeAI, onClose, onReopen, onAssign, onSetActiveDeal, onPinNote, onArchive, onContactRefresh,
}: ContactPanelProps) {
  const contact = conversation.contact;
  const displayName = contact?.name?.trim() || contact?.phone || '—';
  const [noteDraft, setNoteDraft] = useState(conversation.pinned_note ?? '');
  const [showPipelineDialog, setShowPipelineDialog] = useState(false);
  const [savingNote, setSavingNote] = useState(false);
  const { deals: openDeals, reload: reloadDeals } = useContactDeals(contact?.id);
  const na = useNextActions({ dealId: conversation.active_deal_id, contactId: contact?.id });

  // Re-sincroniza o rascunho da nota ao TROCAR de conversa (chaveado por id, não
  // por pinned_note — assim um update realtime da MESMA conversa não apaga o que
  // o operador está digitando). Sem isso, a nota de uma conversa vazava para a
  // seguinte e podia ser salva na conversa errada.
  useEffect(() => {
    setNoteDraft(conversation.pinned_note ?? '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversation.id]);

  const handlePause = async () => {
    try {
      await onPauseAI();
      toast.success('IA pausada — você assumiu esta conversa.');
    } catch (err) {
      toast.error('Falha', { description: err instanceof Error ? err.message : String(err) });
    }
  };

  const handleResume = async () => {
    try {
      await onResumeAI();
      toast.success('IA reativada.');
    } catch (err) {
      toast.error('Falha', { description: err instanceof Error ? err.message : String(err) });
    }
  };

  const handleClose = async () => {
    if (!confirm('Fechar esta conversa?')) return;
    try {
      await onClose();
      toast.success('Conversa fechada.');
    } catch (err) {
      toast.error('Falha', { description: err instanceof Error ? err.message : String(err) });
    }
  };

  const handleReopen = async () => {
    try {
      await onReopen();
      toast.success('Conversa reaberta — você assumiu o atendimento.');
    } catch (err) {
      toast.error('Falha', { description: err instanceof Error ? err.message : String(err) });
    }
  };

  const handleArchive = async () => {
    try {
      await onArchive(!conversation.archived);
      toast.success(conversation.archived ? 'Conversa desarquivada.' : 'Conversa arquivada.');
    } catch (err) {
      toast.error('Falha', { description: err instanceof Error ? err.message : String(err) });
    }
  };

  const isClosed = conversation.status === 'closed';

  const handleSaveNote = async () => {
    setSavingNote(true);
    try {
      await onPinNote(noteDraft);
      toast.success('Nota fixa salva.');
    } catch (err) {
      toast.error('Falha', { description: err instanceof Error ? err.message : String(err) });
    } finally {
      setSavingNote(false);
    }
  };

  return (
    <div className="h-full p-5 space-y-5 overflow-y-auto">
      <div className="text-center">
        <div className="h-16 w-16 mx-auto rounded-full bg-gradient-to-br from-[#1E3A8A] to-[#3B82F6] flex items-center justify-center text-lg font-bold text-white shadow-[0_0_30px_rgba(59,130,246,0.25)]">
          {displayName.slice(0, 2).toUpperCase()}
        </div>
        <div className="mt-3 text-lg font-bold text-display text-[var(--color-text-primary)]">
          {displayName}
        </div>
        {contact?.phone && (
          <div className="text-xs font-mono text-[var(--color-text-secondary)] mt-0.5">
            {contact.phone}
          </div>
        )}
        <div className="mt-3 flex flex-wrap justify-center gap-1.5">
          <Badge tone={isClosed ? 'gray' : conversation.ai_paused ? 'amber' : 'green'}>
            {isClosed ? <CircleX className="h-3 w-3" /> : <Bot className="h-3 w-3" />}
            {isClosed ? 'Fechada' : conversation.ai_paused ? 'IA pausada' : 'IA ativa'}
          </Badge>
          <Badge tone={withinWindow ? 'green' : 'amber'}>
            <Clock className="h-3 w-3" />
            {withinWindow ? 'Janela 24h aberta' : 'Janela 24h fechada'}
          </Badge>
        </div>
      </div>

      {/* Nota fixa da conversa */}
      <div className="space-y-2">
        <div className="text-label flex items-center gap-1.5"><Pin className="h-3 w-3" /> Nota fixa</div>
        <textarea
          value={noteDraft}
          onChange={(e) => setNoteDraft(e.target.value)}
          rows={2}
          placeholder="Nota visível no topo da conversa…"
          className="w-full rounded-lg border border-[rgba(245,158,11,0.25)] bg-[rgba(245,158,11,0.04)] px-3 py-2 text-sm text-[var(--color-text-primary)] focus:outline-none focus:border-[#FBBF24] resize-none"
        />
        {noteDraft !== (conversation.pinned_note ?? '') && (
          <Button size="sm" variant="outline" onClick={handleSaveNote} disabled={savingNote}>
            Salvar nota
          </Button>
        )}
      </div>

      {/* Atribuir a operador */}
      <div className="space-y-2">
        <div className="text-label">Atribuído a</div>
        <select
          value={conversation.assigned_to ?? ''}
          onChange={async (e) => {
            try {
              await onAssign(e.target.value || null);
              toast.success('Atribuição atualizada.');
            } catch (err) {
              toast.error('Falha', { description: err instanceof Error ? err.message : String(err) });
            }
          }}
          className="h-11 w-full rounded-lg border border-[rgba(59,130,246,0.2)] bg-white/[0.03] px-3 text-sm text-[var(--color-text-primary)]"
        >
          <option value="">Ninguém</option>
          {operators.map((op) => (
            <option key={op.user_id} value={op.user_id}>
              {op.email} {op.role === 'admin' ? '(admin)' : ''}
            </option>
          ))}
        </select>
      </div>

      {/* Negócio ativo — qual oportunidade esta conversa está tratando quando o
          contato tem vários negócios abertos. Independente do responsável. */}
      <div className="space-y-2">
        <div className="text-label flex items-center gap-1.5"><SquareKanban className="h-3 w-3" /> Negócio ativo</div>
        {openDeals.length > 0 ? (
          <select
            value={conversation.active_deal_id ?? ''}
            onChange={async (e) => {
              try {
                await onSetActiveDeal(e.target.value || null);
                toast.success('Negócio ativo atualizado.');
              } catch (err) {
                toast.error('Falha', { description: err instanceof Error ? err.message : String(err) });
              }
            }}
            className="h-11 w-full rounded-lg border border-[rgba(59,130,246,0.2)] bg-white/[0.03] px-3 text-sm text-[var(--color-text-primary)]"
          >
            <option value="">Nenhum</option>
            {openDeals.map((d) => (
              <option key={d.id} value={d.id}>{d.title}</option>
            ))}
          </select>
        ) : (
          <p className="text-xs text-[var(--color-text-secondary)]">
            Nenhum negócio aberto. Use <b className="text-[var(--color-text-primary)]">Adicionar ao pipeline</b> abaixo para criar um.
          </p>
        )}
      </div>

      {/* Próxima ação — ancorada no negócio ativo da conversa */}
      <NextActions
        fixedDealId={conversation.active_deal_id}
        disabledHint="Selecione um negócio ativo acima para agendar uma ação."
        actions={na.actions}
        onAdd={(t, d, ty) => na.addAction({ text: t, dueAt: d, type: ty })}
        onComplete={na.completeAction}
        onRemove={na.removeAction}
      />

      {/* Tags rápidas */}
      {contact?.id && <ContactTagsEditor contactId={contact.id} />}

      <div className="space-y-2">
        <div className="text-label">Contato</div>
        <div className="space-y-2 text-sm">
          {contact?.email ? (
            <div className="flex items-center gap-2 text-[var(--color-text-secondary)]">
              <Mail className="h-3.5 w-3.5" />
              <span className="truncate">{contact.email}</span>
            </div>
          ) : null}
          <div className="flex items-center gap-2 text-[var(--color-text-secondary)]">
            <Phone className="h-3.5 w-3.5" />
            <span className="font-mono">{contact?.phone ?? '—'}</span>
          </div>
        </div>
      </div>

      {/* Campos personalizados (editáveis) */}
      {contact?.id && (
        <CustomFieldsEditor
          contactId={contact.id}
          customFields={contact.custom_fields ?? {}}
          onSaved={onContactRefresh}
        />
      )}

      <div className="space-y-2">
        <div className="text-label">Ações</div>
        {isClosed ? (
          <Button variant="outline" className="w-full justify-start" onClick={handleReopen}>
            <RotateCcw className="h-4 w-4" />
            Reabrir conversa
          </Button>
        ) : (
          <>
            {conversation.ai_paused ? (
              <Button variant="outline" className="w-full justify-start" onClick={handleResume}>
                <Play className="h-4 w-4" />
                Retomar IA
              </Button>
            ) : (
              <Button variant="outline" className="w-full justify-start" onClick={handlePause}>
                <Pause className="h-4 w-4" />
                Pausar IA
              </Button>
            )}
            <Button variant="ghost" className="w-full justify-start" onClick={handleClose}>
              <CircleX className="h-4 w-4 text-[var(--color-error)]" />
              Fechar conversa
            </Button>
          </>
        )}
        <Button variant="outline" className="w-full justify-start" onClick={() => setShowPipelineDialog(true)}>
          <SquareKanban className="h-4 w-4" />
          Adicionar ao pipeline
        </Button>
        <Button variant="ghost" className="w-full justify-start" onClick={handleArchive}>
          {conversation.archived ? (
            <>
              <ArchiveRestore className="h-4 w-4" />
              Desarquivar conversa
            </>
          ) : (
            <>
              <Archive className="h-4 w-4" />
              Arquivar conversa
            </>
          )}
        </Button>
      </div>

      <div className="pt-3 border-t border-[rgba(59,130,246,0.08)] text-[10px] text-[var(--color-text-secondary)] opacity-70 space-y-0.5">
        <div>Status: {conversation.status}</div>
        <div>IA: {conversation.ai_paused ? 'pausada' : 'ativa'}</div>
        <div>Criada: {new Date(conversation.created_at).toLocaleString('pt-BR')}</div>
      </div>

      {showPipelineDialog && contact && (
        <AddToPipelineDialog
          open
          onClose={() => setShowPipelineDialog(false)}
          contactId={contact.id}
          contactName={contact.name}
          contactPhone={contact.phone}
          onDone={() => void reloadDeals()}
        />
      )}
    </div>
  );
}
