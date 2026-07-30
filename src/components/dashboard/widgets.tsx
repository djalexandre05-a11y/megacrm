import { HelpCircle } from 'lucide-react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type {
  DaySeriesPoint,
  NameCount,
  OwnerAgg,
  OwnerDuration,
} from '@/hooks/useSalesDashboard';
import { brl, formatDuration } from '@/lib/dashboard';

const TOOLTIP_STYLE = {
  background: 'rgba(15,18,35,0.95)',
  border: '1px solid rgba(59,130,246,0.25)',
  borderRadius: 10,
  fontSize: 12,
} as const;

const PALETTE = ['#3B82F6', '#60A5FA', '#10B981', '#FBBF24', '#A78BFA', '#F87171', '#94A3B8'];

export function WidgetCard({
  title,
  subtitle,
  headerRight,
  children,
}: {
  title: string;
  subtitle?: string;
  headerRight?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="glass-card p-5">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-label">{title}</div>
          {subtitle && <div className="text-sm text-[var(--color-text-secondary)]">{subtitle}</div>}
        </div>
        {headerRight}
      </div>
      {children}
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="flex h-40 items-center justify-center text-xs text-[var(--color-text-secondary)] opacity-60">
      {text}
    </div>
  );
}

// --- Vendas ganhas / perdidas: KPI + série temporal ------------------------
export function SalesKpiWidget({
  title,
  count,
  value,
  series,
  color,
}: {
  title: string;
  count: number;
  value: number;
  series: DaySeriesPoint[];
  color: string;
}) {
  return (
    <WidgetCard
      title={title}
      headerRight={
        <span
          className="shrink-0 inline-flex min-w-[1.75rem] items-center justify-center rounded-full px-2.5 py-0.5 text-sm font-bold"
          style={{ color, backgroundColor: `${color}1f` }}
        >
          {count.toLocaleString('pt-BR')}
        </span>
      }
    >
      <div className="text-stat" style={{ color }}>
        {brl(value)}
      </div>
      <div className="mt-3 h-24">
        {count === 0 ? (
          <EmptyState text="Sem registros no período." />
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={series} margin={{ top: 4, right: 4, left: 4, bottom: 0 }}>
              <defs>
                <linearGradient id={`grad-${title}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={color} stopOpacity={0.4} />
                  <stop offset="100%" stopColor={color} stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis dataKey="day" hide />
              <Tooltip
                contentStyle={TOOLTIP_STYLE}
                labelFormatter={(d) => String(d).slice(5)}
                formatter={(v) => [v as number, 'Qtd']}
              />
              <Area type="monotone" dataKey="count" stroke={color} strokeWidth={2} fill={`url(#grad-${title})`} />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>
    </WidgetCard>
  );
}

// --- Ranking de vendedores --------------------------------------------------
export function RankingWidget({
  ranking,
  ownerName,
}: {
  ranking: OwnerAgg[];
  ownerName: (id: string | null) => string;
}) {
  const data = ranking.map((r) => ({ name: ownerName(r.owner_id), value: r.value, count: r.count }));
  return (
    <WidgetCard title="Ranking de vendedores" subtitle="Por valor ganho no período">
      <div className="h-64">
        {data.length === 0 ? (
          <EmptyState text="Nenhuma venda no período." />
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} layout="vertical" margin={{ top: 4, right: 12, left: 90, bottom: 0 }}>
              <XAxis type="number" tick={{ fontSize: 11, fill: '#94A3B8' }} stroke="rgba(59,130,246,0.2)" tickFormatter={(v) => brl(Number(v))} />
              <YAxis type="category" dataKey="name" width={90} tick={{ fontSize: 11, fill: '#CBD5E1' }} stroke="rgba(59,130,246,0.2)" />
              <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v) => [brl(Number(v)), 'Ganho']} />
              <Bar dataKey="value" fill="#10B981" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
    </WidgetCard>
  );
}

// --- Forecast ---------------------------------------------------------------
export function ForecastWidget({
  value,
  openCount,
  loading,
}: {
  value: number;
  openCount: number;
  loading?: boolean;
}) {
  return (
    <WidgetCard
      title="Forecast"
      headerRight={
        <span className="group relative inline-flex cursor-help text-[var(--color-text-secondary)] transition hover:text-[var(--color-text-primary)]">
          <HelpCircle className="h-4 w-4" />
          <span className="pointer-events-none absolute right-0 top-6 z-20 w-64 rounded-lg border border-[rgba(59,130,246,0.25)] bg-[#0A0A0F] px-3 py-2 text-xs leading-5 text-[var(--color-text-primary)] opacity-0 shadow-[0_0_30px_rgba(59,130,246,0.15)] transition-opacity duration-200 group-hover:opacity-100">
            Receita projetada de todo o pipeline aberto, não depende do período selecionado
          </span>
        </span>
      }
    >
      {loading ? (
        <div className="text-stat text-[var(--accent-secondary)] opacity-40">—</div>
      ) : openCount === 0 ? (
        <>
          <div className="text-stat text-[var(--accent-secondary)]">{brl(0)}</div>
          <div className="mt-1 text-sm text-[var(--color-text-secondary)]">Nenhum negócio em aberto.</div>
        </>
      ) : (
        <>
          <div className="text-stat text-[var(--accent-secondary)]">{brl(value)}</div>
          <div className="mt-1 text-sm text-[var(--color-text-secondary)]">
            {openCount.toLocaleString('pt-BR')} negócio{openCount !== 1 ? 's' : ''} aberto{openCount !== 1 ? 's' : ''}
          </div>
        </>
      )}
      <p className="mt-3 text-xs text-[var(--color-text-secondary)] opacity-70">
        Ajuste a probabilidade de cada estágio em Funil → gerenciar estágios.
      </p>
    </WidgetCard>
  );
}

// --- Tempo médio (1ª resposta / conclusão) ----------------------------------
export function DurationWidget({
  title,
  subtitle,
  avgMs,
  byOwner,
  ownerName,
}: {
  title: string;
  subtitle: string;
  avgMs: number | null;
  byOwner: OwnerDuration[];
  ownerName: (id: string | null) => string;
}) {
  return (
    <WidgetCard title={title} subtitle={subtitle}>
      <div className="text-stat text-[var(--color-text-primary)]">{formatDuration(avgMs)}</div>
      <div className="mt-3 space-y-1.5">
        {byOwner.length === 0 ? (
          <div className="text-xs text-[var(--color-text-secondary)] opacity-60">Sem dados suficientes.</div>
        ) : (
          byOwner.slice(0, 6).map((o) => (
            <div key={o.owner_id ?? 'none'} className="flex items-center justify-between text-xs">
              <span className="truncate text-[var(--color-text-secondary)]">{ownerName(o.owner_id)}</span>
              <span className="font-mono text-[var(--color-text-primary)]">{formatDuration(o.ms)}</span>
            </div>
          ))
        )}
      </div>
    </WidgetCard>
  );
}

// --- Origem: donut ----------------------------------------------------------
export function OriginDonutWidget({
  title,
  data,
  labelMap,
  emptyText,
}: {
  title: string;
  data: NameCount[];
  labelMap?: Record<string, string>;
  emptyText: string;
}) {
  const total = data.reduce((s, d) => s + d.count, 0);
  const slices = data.map((d, i) => ({
    name: labelMap?.[d.name] ?? d.name,
    value: d.count,
    fill: PALETTE[i % PALETTE.length],
  }));
  return (
    <WidgetCard title={title} subtitle={total > 0 ? `${total} leads` : undefined}>
      <div className="h-56">
        {total === 0 ? (
          <EmptyState text={emptyText} />
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={slices} dataKey="value" nameKey="name" innerRadius={50} outerRadius={80} paddingAngle={2} stroke="none">
                {slices.map((s, i) => (
                  <Cell key={i} fill={s.fill} />
                ))}
              </Pie>
              <Tooltip
                contentStyle={TOOLTIP_STYLE}
                formatter={(v, n) => [`${v} (${Math.round((Number(v) / total) * 100)}%)`, n]}
              />
            </PieChart>
          </ResponsiveContainer>
        )}
      </div>
      {total > 0 && (
        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
          {slices.map((s) => (
            <span key={s.name} className="inline-flex items-center gap-1.5 text-[11px] text-[var(--color-text-secondary)]">
              <span className="h-2 w-2 rounded-full" style={{ background: s.fill }} />
              {s.name} · {Math.round((s.value / total) * 100)}%
            </span>
          ))}
        </div>
      )}
    </WidgetCard>
  );
}

// --- Origem: barras horizontais ---------------------------------------------
export function OriginBarsWidget({
  title,
  data,
  labelMap,
  emptyText,
}: {
  title: string;
  data: NameCount[];
  labelMap?: Record<string, string>;
  emptyText: string;
}) {
  const total = data.reduce((s, d) => s + d.count, 0);
  const rows = data.slice(0, 8).map((d) => ({
    name: labelMap?.[d.name] ?? d.name,
    count: d.count,
    pct: total > 0 ? Math.round((d.count / total) * 100) : 0,
  }));
  return (
    <WidgetCard title={title} subtitle={total > 0 ? `${total} leads` : undefined}>
      <div style={{ height: Math.max(160, rows.length * 34) }}>
        {rows.length === 0 ? (
          <EmptyState text={emptyText} />
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 36, left: 100, bottom: 0 }}>
              <XAxis type="number" tick={{ fontSize: 11, fill: '#94A3B8' }} stroke="rgba(59,130,246,0.2)" allowDecimals={false} />
              <YAxis type="category" dataKey="name" width={100} tick={{ fontSize: 11, fill: '#CBD5E1' }} stroke="rgba(59,130,246,0.2)" />
              <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v, _n, item) => [`${v} (${(item?.payload as { pct: number }).pct}%)`, 'Leads']} />
              <Bar dataKey="count" fill="#3B82F6" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
    </WidgetCard>
  );
}
