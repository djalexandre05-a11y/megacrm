import { useState } from 'react';
import { toast } from 'sonner';
import { CalendarClock, Check, Plus, X } from 'lucide-react';
import { ACTION_TYPE_LABEL, type ActionType, type NextAction } from '@/types/crm';
import { dueBadge } from '@/lib/nextAction';

// Seção reutilizável "Próxima ação" — usada no drawer do funil, no painel da
// conversa (inbox) e na página do contato. A âncora é sempre um negócio (deal).
interface NextActionsProps {
  actions: NextAction[];
  onAdd: (text: string, dueAt: string, type: ActionType, dealId?: string) => void | Promise<void>;
  onComplete: (id: string) => void | Promise<void>;
  onRemove: (id: string) => void | Promise<void>;
  // Drawer/inbox: âncora fixa. Se null e sem dealOptions → seção desabilitada.
  fixedDealId?: string | null;
  // Página do contato: escolhe o negócio no formulário e rotula cada ação.
  dealOptions?: { id: string; title: string }[];
  showDealLabel?: boolean;
  disabledHint?: string;
}

const inputCls =
  'w-full rounded-lg border border-[rgba(59,130,246,0.2)] bg-white/[0.03] px-3 py-2 text-sm text-[var(--color-text-primary)] outline-none focus:border-[var(--accent-primary)]';

export function NextActions({
  actions,
  onAdd,
  onComplete,
  onRemove,
  fixedDealId,
  dealOptions,
  showDealLabel,
  disabledHint,
}: NextActionsProps) {
  const usesPicker = Array.isArray(dealOptions);
  const [text, setText] = useState('');
  const [dueAt, setDueAt] = useState('');
  const [type, setType] = useState<ActionType>('followup');
  const [dealId, setDealId] = useState('');
  const [saving, setSaving] = useState(false);

  // Sem negócio para ancorar: mostra a dica e não renderiza o formulário.
  const disabled = usesPicker ? dealOptions!.length === 0 : !fixedDealId;

  const submit = async () => {
    if (!text.trim() || !dueAt) return;
    const targetDeal = usesPicker ? dealId || dealOptions![0]?.id : fixedDealId ?? undefined;
    if (!targetDeal) return;
    setSaving(true);
    try {
      // datetime-local é hora local; toISOString normaliza para UTC.
      await onAdd(text.trim(), new Date(dueAt).toISOString(), type, targetDeal);
      setText('');
      setDueAt('');
      setType('followup');
      toast.success('Ação agendada.');
    } catch (err) {
      toast.error('Falha', { description: err instanceof Error ? err.message : String(err) });
    } finally {
      setSaving(false);
    }
  };

  const handleComplete = async (id: string) => {
    try {
      await onComplete(id);
      toast.success('Ação concluída.');
    } catch (err) {
      toast.error('Falha', { description: err instanceof Error ? err.message : String(err) });
    }
  };

  return (
    <section className="space-y-3">
      <div className="text-label flex items-center gap-1.5">
        <CalendarClock className="h-3 w-3" /> Próxima ação
      </div>

      {disabled ? (
        <p className="text-xs text-[var(--color-text-secondary)]">
          {disabledHint ?? 'Crie um negócio para agendar ações.'}
        </p>
      ) : (
        <>
          {actions.length === 0 ? (
            <p className="text-sm text-[var(--color-text-secondary)] opacity-70">Nenhuma ação agendada.</p>
          ) : (
            <ol className="space-y-2">
              {actions.map((a, i) => (
                <ActionRow
                  key={a.id}
                  action={a}
                  highlight={i === 0}
                  showDealLabel={showDealLabel}
                  onComplete={() => handleComplete(a.id)}
                  onRemove={() => onRemove(a.id)}
                />
              ))}
            </ol>
          )}

          {/* Formulário de agendamento */}
          <div className="space-y-2 rounded-lg border border-[rgba(59,130,246,0.12)] bg-white/[0.02] p-3">
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void submit()}
              placeholder="Ex.: Ligar para o cliente, retornar proposta…"
              className={inputCls}
            />
            <div className="flex flex-wrap gap-2">
              <input
                type="datetime-local"
                value={dueAt}
                onChange={(e) => setDueAt(e.target.value)}
                className={`${inputCls} flex-1`}
              />
              <select value={type} onChange={(e) => setType(e.target.value as ActionType)} className={`${inputCls} flex-1`}>
                {(Object.keys(ACTION_TYPE_LABEL) as ActionType[]).map((t) => (
                  <option key={t} value={t}>{ACTION_TYPE_LABEL[t]}</option>
                ))}
              </select>
            </div>
            {usesPicker && (
              <select value={dealId} onChange={(e) => setDealId(e.target.value)} className={inputCls}>
                {dealOptions!.map((d) => (
                  <option key={d.id} value={d.id}>{d.title}</option>
                ))}
              </select>
            )}
            <button
              onClick={submit}
              disabled={saving || !text.trim() || !dueAt}
              className="inline-flex w-full items-center justify-center gap-1 rounded-lg bg-gradient-to-br from-[#1E3A8A] to-[#3B82F6] px-4 py-2 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-60"
            >
              <Plus className="h-4 w-4" /> {saving ? 'Agendando…' : 'Agendar'}
            </button>
          </div>
        </>
      )}
    </section>
  );
}

function ActionRow({
  action,
  highlight,
  showDealLabel,
  onComplete,
  onRemove,
}: {
  action: NextAction;
  highlight: boolean;
  showDealLabel?: boolean;
  onComplete: () => void | Promise<void>;
  onRemove: () => void | Promise<void>;
}) {
  const badge = dueBadge(action.due_at);
  return (
    <li
      className={
        'flex items-start gap-2 rounded-lg p-3 ' +
        (highlight
          ? 'border border-[rgba(59,130,246,0.25)] bg-white/[0.03]'
          : 'border border-transparent bg-white/[0.015]')
      }
    >
      <button
        onClick={onComplete}
        aria-label="Concluir ação"
        className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border border-[rgba(59,130,246,0.4)] text-transparent transition hover:border-[var(--accent-primary)] hover:bg-[var(--accent-primary)] hover:text-white"
      >
        <Check className="h-3 w-3" />
      </button>
      <div className="min-w-0 flex-1">
        <p className="whitespace-pre-wrap text-sm text-[var(--color-text-primary)]">{action.title}</p>
        <div className="mt-1 flex flex-wrap items-center gap-1.5">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-[var(--color-text-secondary)]">
            {ACTION_TYPE_LABEL[action.type]}
          </span>
          <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ${badge.className}`}>
            {badge.full}
          </span>
          {showDealLabel && action.deal_title && (
            <span className="truncate text-[10px] text-[var(--color-text-secondary)]">· {action.deal_title}</span>
          )}
        </div>
      </div>
      <button
        onClick={onRemove}
        aria-label="Remover ação"
        className="shrink-0 text-[var(--color-text-secondary)] opacity-70 transition hover:opacity-100"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </li>
  );
}
