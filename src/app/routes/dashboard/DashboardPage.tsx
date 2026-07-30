import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { LayoutDashboard, SlidersHorizontal, X } from 'lucide-react';
import { useSalesDashboard } from '@/hooks/useSalesDashboard';
import { useForecast } from '@/hooks/useForecast';
import { useDashboardPrefs } from '@/hooks/useDashboardPrefs';
import { useOperators } from '@/hooks/useOperators';
import {
  ORIGIN_CHANNEL_LABEL,
  PERIOD_PRESETS,
  TRAFFIC_LABEL,
  WIDGETS,
  periodRange,
  type PeriodKey,
  type WidgetKey,
} from '@/lib/dashboard';
import {
  DurationWidget,
  ForecastWidget,
  OriginBarsWidget,
  OriginDonutWidget,
  RankingWidget,
  SalesKpiWidget,
} from '@/components/dashboard/widgets';
import { LoadErrorBanner } from '@/components/LoadErrorBanner';
import { cn } from '@/lib/utils';

const NO_UTM = 'Sem dados de rastreio ainda.';

function isPeriodKey(v: string | null): v is PeriodKey {
  return v === '1d' || v === '7d' || v === '15d' || v === '30d' || v === '60d' || v === '90d' || v === 'this_month' || v === 'last_month' || v === 'custom';
}

export default function DashboardPage() {
  const [params, setParams] = useSearchParams();
  const periodKey: PeriodKey = isPeriodKey(params.get('period')) ? (params.get('period') as PeriodKey) : '30d';
  const customFrom = params.get('from') ?? '';
  const customTo = params.get('to') ?? '';
  const [customizeOpen, setCustomizeOpen] = useState(false);

  const range = useMemo(
    () => periodRange(periodKey, customFrom, customTo),
    [periodKey, customFrom, customTo],
  );

  const { metrics, loading, error, reload } = useSalesDashboard(range);
  const forecast = useForecast();
  const { visibleMap, toggle } = useDashboardPrefs();
  const { operators } = useOperators();

  const ownerName = (id: string | null) => {
    if (!id) return 'Não atribuído';
    return operators.find((o) => o.user_id === id)?.email ?? 'Vendedor';
  };

  const setPeriod = (key: PeriodKey) => {
    const next = new URLSearchParams(params);
    next.set('period', key);
    if (key !== 'custom') {
      next.delete('from');
      next.delete('to');
    }
    setParams(next, { replace: true });
  };

  const setCustom = (which: 'from' | 'to', value: string) => {
    const next = new URLSearchParams(params);
    next.set('period', 'custom');
    next.set(which, value);
    setParams(next, { replace: true });
  };

  const handleToggle = async (key: WidgetKey) => {
    const id = await toggle(key);
    if (id) toast.success('Preferência salva.', { description: `dashboard_preferences: ${id}` });
  };

  const show = (key: WidgetKey) => visibleMap[key] !== false;

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div className="flex items-center gap-4">
          <div className="h-12 w-12 rounded-xl glass-card flex items-center justify-center">
            <LayoutDashboard className="h-5 w-5 text-[var(--accent-primary)]" />
          </div>
          <div>
            <div className="text-label">Seção</div>
            <h1 className="text-2xl font-bold text-display">Dashboard</h1>
            <p className="text-sm text-[var(--color-text-secondary)]">Vendas e atendimento</p>
          </div>
        </div>

        <button
          type="button"
          onClick={() => setCustomizeOpen((v) => !v)}
          className="flex items-center gap-1.5 rounded-lg border border-[rgba(59,130,246,0.2)] px-3 py-2 text-xs font-semibold text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
        >
          <SlidersHorizontal className="h-3.5 w-3.5" />
          Personalizar dashboard
        </button>
      </div>

      {/* Filtro de período (global) */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1 rounded-lg border border-[rgba(59,130,246,0.12)] p-1 bg-white/[0.02]">
          {PERIOD_PRESETS.map((p) => (
            <button
              key={p.key}
              onClick={() => setPeriod(p.key)}
              className={cn(
                'rounded-md px-3 py-1 text-xs font-semibold',
                periodKey === p.key
                  ? 'bg-[var(--accent-primary)] text-white'
                  : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]',
              )}
            >
              {p.label}
            </button>
          ))}
          <button
            onClick={() => setPeriod('custom')}
            className={cn(
              'rounded-md px-3 py-1 text-xs font-semibold',
              periodKey === 'custom'
                ? 'bg-[var(--accent-primary)] text-white'
                : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]',
            )}
          >
            Personalizado
          </button>
        </div>
        {periodKey === 'custom' && (
          <div className="flex items-center gap-2">
            <input
              type="date"
              value={customFrom}
              onChange={(e) => setCustom('from', e.target.value)}
              className="rounded-lg border border-[rgba(59,130,246,0.2)] bg-white/[0.03] px-2 py-1 text-xs text-[var(--color-text-primary)]"
            />
            <span className="text-xs text-[var(--color-text-secondary)]">até</span>
            <input
              type="date"
              value={customTo}
              onChange={(e) => setCustom('to', e.target.value)}
              className="rounded-lg border border-[rgba(59,130,246,0.2)] bg-white/[0.03] px-2 py-1 text-xs text-[var(--color-text-primary)]"
            />
          </div>
        )}
      </div>

      {error && <LoadErrorBanner message={error} onRetry={() => void reload()} />}

      {/* Painel de personalização */}
      {customizeOpen && (
        <div className="glass-card p-4">
          <div className="mb-3 flex items-center justify-between">
            <div className="text-label">Widgets exibidos</div>
            <button onClick={() => setCustomizeOpen(false)} aria-label="Fechar" className="text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]">
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
            {WIDGETS.map((w) => (
              <label key={w.key} className="flex items-center gap-2 rounded-lg border border-[rgba(59,130,246,0.12)] bg-white/[0.02] px-3 py-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={show(w.key)}
                  onChange={() => void handleToggle(w.key)}
                  className="accent-[var(--accent-primary)] h-4 w-4"
                />
                <span className="text-sm text-[var(--color-text-primary)]">{w.label}</span>
                <span className="ml-auto text-[10px] uppercase tracking-wide text-[var(--color-text-secondary)]">{w.group}</span>
              </label>
            ))}
          </div>
        </div>
      )}

      {loading ? (
        <div className="glass-card p-10 text-center text-label opacity-60">Carregando métricas...</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {show('vendas_ganhas') && (
            <SalesKpiWidget title="Vendas ganhas" count={metrics.won.count} value={metrics.won.value} series={metrics.won.series} color="#10B981" />
          )}
          {show('oportunidades_perdidas') && (
            <SalesKpiWidget title="Oportunidades perdidas" count={metrics.lost.count} value={metrics.lost.value} series={metrics.lost.series} color="#EF4444" />
          )}
          {show('forecast') && (
            <ForecastWidget value={forecast.value} openCount={forecast.openCount} loading={forecast.loading} />
          )}
          {show('ranking_vendedores') && (
            <div className="md:col-span-2">
              <RankingWidget ranking={metrics.ranking} ownerName={ownerName} />
            </div>
          )}
          {show('tempo_primeira_resposta') && (
            <DurationWidget
              title="Tempo médio de 1ª resposta"
              subtitle="Do 1º contato do lead à 1ª resposta humana"
              avgMs={metrics.firstResponse.avgMs}
              byOwner={metrics.firstResponse.byOwner}
              ownerName={ownerName}
            />
          )}
          {show('tempo_conclusao') && (
            <DurationWidget
              title="Tempo médio para concluir venda"
              subtitle="Da criação do negócio até marcar ganho"
              avgMs={metrics.closeTime.avgMs}
              byOwner={metrics.closeTime.byOwner}
              ownerName={ownerName}
            />
          )}
          {show('origem_trafego') && (
            <OriginDonutWidget title="% Origem do tráfego" data={metrics.origin.traffic} labelMap={TRAFFIC_LABEL} emptyText={NO_UTM} />
          )}
          {show('origem_canal') && (
            <OriginBarsWidget title="% Canal de origem" data={metrics.origin.channel} labelMap={ORIGIN_CHANNEL_LABEL} emptyText={NO_UTM} />
          )}
          {show('origem_campanha') && (
            <OriginBarsWidget title="% Campanha de origem" data={metrics.origin.campaign} emptyText={NO_UTM} />
          )}
          {show('origem_anuncios') && (
            <OriginBarsWidget title="% Anúncios de origem" data={metrics.origin.ads} emptyText={NO_UTM} />
          )}
          {show('origem_posts_organicos') && (
            <OriginBarsWidget title="% Posts orgânicos de origem" data={metrics.origin.organicPosts} emptyText={NO_UTM} />
          )}
        </div>
      )}
    </div>
  );
}
