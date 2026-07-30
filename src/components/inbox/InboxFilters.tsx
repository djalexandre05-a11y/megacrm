import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Clock, SlidersHorizontal, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Operator } from '@/hooks/useOperators';
import type { Tag } from '@/types/crm';
import {
  activeFilterCount,
  DEFAULT_FILTERS,
  type Atendente,
  type InboxFilterState,
  type JanelaFilter,
  type StatusBucket,
} from './inbox-filters';

interface Props {
  filters: InboxFilterState;
  onChange: (next: InboxFilterState) => void;
  operators: Operator[];
  tags: Tag[];
}

function toggle<T>(arr: T[], v: T): T[] {
  return arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v];
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'rounded-full px-3 py-1 text-xs font-semibold border transition-colors',
        active
          ? 'border-[var(--accent-primary)] bg-[rgba(59,130,246,0.15)] text-[var(--color-text-primary)]'
          : 'border-[rgba(59,130,246,0.15)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:border-[rgba(59,130,246,0.35)]',
      )}
    >
      {children}
    </button>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <div className="text-label">{label}</div>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </div>
  );
}

const ATENDENTE_OPTS: { v: Atendente; label: string }[] = [
  { v: 'ia', label: 'IA' },
  { v: 'humano', label: 'Humano' },
];
const STATUS_OPTS: { v: StatusBucket; label: string }[] = [
  { v: 'abertas', label: 'Abertas' },
  { v: 'fechadas', label: 'Fechadas' },
  { v: 'arquivadas', label: 'Arquivadas' },
];
const JANELA_OPTS: { v: JanelaFilter; label: string }[] = [
  { v: 'any', label: 'Qualquer' },
  { v: 'dentro', label: 'Dentro de 24h' },
  { v: 'fora', label: 'Fora de 24h' },
];

export function InboxFilters({ filters, onChange, operators, tags }: Props) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [anchor, setAnchor] = useState<{ top: number; right: number } | null>(null);
  const count = activeFilterCount(filters);

  // O popover é renderizado num portal no <body> porque o ancestral `.glass-card`
  // (backdrop-filter + overflow-hidden) cria um containing block que recortaria
  // tanto `absolute` quanto `fixed`. Reposiciona a partir do retângulo do botão.
  useLayoutEffect(() => {
    if (!open) return;
    const reposition = () => {
      const r = triggerRef.current?.getBoundingClientRect();
      if (r) setAnchor({ top: r.bottom + 8, right: window.innerWidth - r.right });
    };
    reposition();
    window.addEventListener('resize', reposition);
    window.addEventListener('scroll', reposition, true);
    return () => {
      window.removeEventListener('resize', reposition);
      window.removeEventListener('scroll', reposition, true);
    };
  }, [open]);

  // Fecha ao clicar fora (considera o botão e o painel no portal).
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (rootRef.current?.contains(t) || panelRef.current?.contains(t)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const set = (patch: Partial<InboxFilterState>) => onChange({ ...filters, ...patch });

  const panel = (
    <div className="space-y-4 p-4">
      <div className="flex items-center justify-between sm:hidden">
        <div className="text-sm font-semibold text-[var(--color-text-primary)]">Filtros</div>
        <button
          onClick={() => setOpen(false)}
          aria-label="Fechar filtros"
          className="h-9 w-9 flex items-center justify-center rounded-lg text-[var(--color-text-secondary)] hover:bg-white/5"
        >
          <X className="h-4.5 w-4.5" />
        </button>
      </div>

      <Section label="Canal">
        {([['all','Todos'],['whatsapp','WhatsApp'],['instagram','Instagram'],['uazapi','Uazapi']] as const).map(([v, label]) => (
          <Chip key={v} active={filters.channel === v} onClick={() => set({ channel: v })}>
            {label}
          </Chip>
        ))}
      </Section>

      <Section label="Atendente">
        {ATENDENTE_OPTS.map((o) => (
          <Chip
            key={o.v}
            active={filters.atendente.includes(o.v)}
            onClick={() => set({ atendente: toggle(filters.atendente, o.v) })}
          >
            {o.label}
          </Chip>
        ))}
      </Section>

      <Section label="Status">
        {STATUS_OPTS.map((o) => (
          <Chip
            key={o.v}
            active={filters.status.includes(o.v)}
            onClick={() => set({ status: toggle(filters.status, o.v) })}
          >
            {o.label}
          </Chip>
        ))}
      </Section>

      <div className="space-y-2">
        <div className="text-label">Atribuído a</div>
        <select
          value={filters.assigned}
          onChange={(e) => set({ assigned: e.target.value })}
          className="h-10 w-full rounded-lg border border-[rgba(59,130,246,0.2)] bg-white/[0.03] px-3 text-sm text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--accent-primary)]"
        >
          <option value="any">Qualquer</option>
          <option value="unassigned">Não atribuído</option>
          {operators.map((o) => (
            <option key={o.user_id} value={o.user_id}>
              {o.email}
            </option>
          ))}
        </select>
      </div>

      {tags.length > 0 && (
        <Section label="Tags (qualquer)">
          {tags.map((t) => (
            <Chip
              key={t.id}
              active={filters.tagIds.includes(t.id)}
              onClick={() => set({ tagIds: toggle(filters.tagIds, t.id) })}
            >
              {t.name}
            </Chip>
          ))}
        </Section>
      )}

      <Section label="Janela de 24h">
        {JANELA_OPTS.map((o) => (
          <Chip
            key={o.v}
            active={filters.janela === o.v}
            onClick={() => set({ janela: o.v })}
          >
            {o.v === 'any' ? (
              o.label
            ) : (
              <span className="inline-flex items-center gap-1">
                <Clock className="h-3 w-3" />
                {o.label}
              </span>
            )}
          </Chip>
        ))}
      </Section>

      <div className="flex justify-end border-t border-[rgba(59,130,246,0.08)] pt-3">
        <button
          type="button"
          onClick={() => onChange({ ...DEFAULT_FILTERS })}
          className="text-xs font-semibold text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
        >
          Limpar filtros
        </button>
      </div>
    </div>
  );

  return (
    <div className="relative" ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          'flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-semibold transition-colors',
          count > 0
            ? 'border-[var(--accent-primary)] bg-[rgba(59,130,246,0.12)] text-[var(--color-text-primary)]'
            : 'border-[rgba(59,130,246,0.2)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]',
        )}
      >
        <SlidersHorizontal className="h-3.5 w-3.5" />
        Filtros
        {count > 0 && (
          <span className="ml-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-[var(--accent-primary)] px-1 text-[10px] font-bold text-white">
            {count}
          </span>
        )}
      </button>

      {open &&
        createPortal(
          <>
            {/* Desktop: popover ancorado. Mobile: bottom-sheet com overlay. */}
            <div
              className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm sm:hidden"
              onClick={() => setOpen(false)}
            />
            <div
              ref={panelRef}
              style={
                anchor
                  ? ({ '--pop-top': `${anchor.top}px`, '--pop-right': `${anchor.right}px` } as React.CSSProperties)
                  : undefined
              }
              className={cn(
                'z-50 bg-[#0F1223] border border-[rgba(59,130,246,0.25)] shadow-[0_0_40px_rgba(0,0,0,0.6)]',
                'fixed inset-x-0 bottom-0 max-h-[80vh] overflow-y-auto rounded-t-2xl',
                'sm:inset-x-auto sm:bottom-auto sm:w-80 sm:rounded-xl',
                'sm:top-[var(--pop-top)] sm:right-[var(--pop-right)]',
              )}
            >
              {panel}
            </div>
          </>,
          document.body,
        )}
    </div>
  );
}
