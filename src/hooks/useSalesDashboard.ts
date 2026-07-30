import { useCallback, useEffect, useState } from 'react';
import { getSupabase } from '@/lib/supabase';
import { type PeriodRange } from '@/lib/dashboard';

// ============================================================================
// Métricas do Dashboard.
// Por padrão calcula de DADOS REAIS (deals no período). Com o "Modo de
// Demonstração" ligado (app_settings.demo_mode, em Configurações →
// Credenciais → Configurações Avançadas), exibe dados fictícios — apenas
// para demonstração visual da plataforma.
// ============================================================================

function generateFakeMetrics(range: PeriodRange): SalesMetrics {
  const dayMs = 86400000;
  const rangeDays = Math.max(1, Math.round((range.to.getTime() - range.from.getTime()) / dayMs));

  const series: DaySeriesPoint[] = [];
  for (let i = 0; i < rangeDays; i++) {
    const d = new Date(range.from.getTime() + i * dayMs);
    series.push({
      day: d.toISOString().slice(0, 10),
      value: Math.round((3 + Math.random() * 8) * 100) * 100,
      count: Math.floor(1 + Math.random() * 5),
    });
  }

  const wonCount = series.reduce((s, p) => s + p.count, 0);
  const wonValue = series.reduce((s, p) => s + p.value, 0);

  const lostSeries = series.map((p) => ({
    day: p.day,
    value: Math.round(p.value * 0.2 * Math.random()),
    count: Math.max(0, Math.floor(p.count * 0.3 * Math.random())),
  }));
  const lostCount = lostSeries.reduce((s, p) => s + p.count, 0);
  const lostValue = lostSeries.reduce((s, p) => s + p.value, 0);

  const owners = [
    { id: 'u1', name: 'Ana Silva' },
    { id: 'u2', name: 'Carlos Oliveira' },
    { id: 'u3', name: 'Mariana Santos' },
    { id: 'u4', name: 'Rafael Costa' },
  ];

  const ranking = owners.map((o) => ({
    owner_id: o.id,
    value: Math.round((5000 + Math.random() * 45000) / 100) * 100,
    count: Math.floor(3 + Math.random() * 20),
  })).sort((a, b) => b.value - a.value);

  const byOwner = owners.map((o) => ({
    owner_id: o.id,
    ms: Math.round(1800000 + Math.random() * 7200000),
    count: Math.floor(3 + Math.random() * 15),
  }));

  const closeByOwner = owners.map((o) => ({
    owner_id: o.id,
    ms: Math.round(43200000 + Math.random() * 259200000),
    count: Math.floor(3 + Math.random() * 15),
  }));

  return {
    won: { count: wonCount, value: wonValue, series },
    lost: {
      count: lostCount,
      value: lostValue,
      series: lostSeries,
      reasons: [
        { name: 'Preço', value: 0, count: 4 },
        { name: 'Concorrência', value: 0, count: 3 },
        { name: 'Timing', value: 0, count: 2 },
        { name: 'Sem motivo', value: 0, count: 1 },
      ],
    },
    ranking,
    forecast: { value: Math.round((85000 + Math.random() * 65000) / 100) * 100, openCount: 12 },
    firstResponse: { avgMs: 3600000 + Math.round(Math.random() * 3600000), byOwner },
    closeTime: { avgMs: 172800000 + Math.round(Math.random() * 259200000), byOwner: closeByOwner },
    origin: {
      hasData: true,
      traffic: [
        { name: 'organico', value: 0, count: 28 },
        { name: 'pago', value: 0, count: 15 },
        { name: 'manual', value: 0, count: 7 },
      ],
      channel: [
        { name: 'instagram_ads', value: 0, count: 18 },
        { name: 'google_ads', value: 0, count: 12 },
        { name: 'facebook_ads', value: 0, count: 8 },
        { name: 'linkedin_ads', value: 0, count: 5 },
        { name: 'tiktok_ads', value: 0, count: 3 },
      ],
      campaign: [
        { name: 'Lancamento Q3', value: 0, count: 10 },
        { name: 'Reactivacao', value: 0, count: 6 },
        { name: 'Promo Julho', value: 0, count: 4 },
      ],
      ads: [
        { name: 'Meta Ads - Lead', value: 0, count: 8 },
        { name: 'Google Ads - Search', value: 0, count: 5 },
        { name: 'TikTok Ads - View', value: 0, count: 3 },
      ],
      organicPosts: [
        { name: 'Post carrossel', value: 0, count: 6 },
        { name: 'Reels tutorial', value: 0, count: 4 },
        { name: 'Story promoção', value: 0, count: 3 },
      ],
    },
  };
}

export interface NameCount {
  name: string;
  value: number;
  count: number;
}
export interface DaySeriesPoint {
  day: string;
  value: number;
  count: number;
}
export interface OwnerAgg {
  owner_id: string | null;
  value: number;
  count: number;
}
export interface OwnerDuration {
  owner_id: string | null;
  ms: number | null;
  count: number;
}

export interface SalesMetrics {
  won: { count: number; value: number; series: DaySeriesPoint[] };
  lost: { count: number; value: number; series: DaySeriesPoint[]; reasons: NameCount[] };
  ranking: OwnerAgg[];
  forecast: { value: number; openCount: number };
  firstResponse: { avgMs: number | null; byOwner: OwnerDuration[] };
  closeTime: { avgMs: number | null; byOwner: OwnerDuration[] };
  origin: {
    hasData: boolean;
    traffic: NameCount[];
    channel: NameCount[];
    campaign: NameCount[];
    ads: NameCount[];
    organicPosts: NameCount[];
  };
}

interface DealRow {
  value: number | null;
  status: string;
  owner_id: string | null;
  created_at: string;
  won_at: string | null;
  lost_at: string | null;
  lost_reason: string | null;
  first_contact_at: string | null;
  first_response_at: string | null;
  traffic_type: string | null;
  origin_channel: string | null;
  utm_campaign: string | null;
  utm_content: string | null;
}

const EMPTY: SalesMetrics = {
  won: { count: 0, value: 0, series: [] },
  lost: { count: 0, value: 0, series: [], reasons: [] },
  ranking: [],
  forecast: { value: 0, openCount: 0 },
  firstResponse: { avgMs: null, byOwner: [] },
  closeTime: { avgMs: null, byOwner: [] },
  origin: { hasData: false, traffic: [], channel: [], campaign: [], ads: [], organicPosts: [] },
};

function daySeries(range: PeriodRange, rows: { at: string; value: number }[]): DaySeriesPoint[] {
  const dayMs = 86400000;
  const days = Math.max(1, Math.round((range.to.getTime() - range.from.getTime()) / dayMs));
  const byDay = new Map<string, { value: number; count: number }>();
  for (const r of rows) {
    const day = r.at.slice(0, 10);
    const cur = byDay.get(day) ?? { value: 0, count: 0 };
    cur.value += r.value;
    cur.count += 1;
    byDay.set(day, cur);
  }
  const series: DaySeriesPoint[] = [];
  for (let i = 0; i < days; i++) {
    const day = new Date(range.from.getTime() + i * dayMs).toISOString().slice(0, 10);
    const hit = byDay.get(day);
    series.push({ day, value: hit?.value ?? 0, count: hit?.count ?? 0 });
  }
  return series;
}

function countBy(rows: DealRow[], pick: (r: DealRow) => string | null): NameCount[] {
  const map = new Map<string, number>();
  for (const r of rows) {
    const key = pick(r);
    if (!key) continue;
    map.set(key, (map.get(key) ?? 0) + 1);
  }
  return [...map.entries()]
    .map(([name, count]) => ({ name, value: 0, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);
}

function ownerDurations(
  rows: DealRow[],
  from: (r: DealRow) => string | null,
  to: (r: DealRow) => string | null,
): { avgMs: number | null; byOwner: OwnerDuration[] } {
  const durations: { owner: string | null; ms: number }[] = [];
  for (const r of rows) {
    const a = from(r);
    const b = to(r);
    if (!a || !b) continue;
    const ms = new Date(b).getTime() - new Date(a).getTime();
    if (ms >= 0) durations.push({ owner: r.owner_id, ms });
  }
  if (!durations.length) return { avgMs: null, byOwner: [] };
  const avgMs = Math.round(durations.reduce((s, d) => s + d.ms, 0) / durations.length);
  const byOwnerMap = new Map<string | null, { total: number; count: number }>();
  for (const d of durations) {
    const cur = byOwnerMap.get(d.owner) ?? { total: 0, count: 0 };
    cur.total += d.ms;
    cur.count += 1;
    byOwnerMap.set(d.owner, cur);
  }
  const byOwner = [...byOwnerMap.entries()].map(([owner_id, v]) => ({
    owner_id,
    ms: Math.round(v.total / v.count),
    count: v.count,
  }));
  return { avgMs, byOwner };
}

async function loadRealMetrics(range: PeriodRange): Promise<SalesMetrics> {
  const supabase = getSupabase();
  const fromIso = range.from.toISOString();
  const toIso = range.to.toISOString();
  const SELECT =
    'value, status, owner_id, created_at, won_at, lost_at, lost_reason, first_contact_at, first_response_at, traffic_type, origin_channel, utm_campaign, utm_content';

  const [wonRes, lostRes, createdRes, openRes] = await Promise.all([
    supabase.from('deals').select(SELECT).eq('status', 'won').gte('won_at', fromIso).lte('won_at', toIso),
    supabase.from('deals').select(SELECT).eq('status', 'lost').gte('lost_at', fromIso).lte('lost_at', toIso),
    supabase.from('deals').select(SELECT).gte('created_at', fromIso).lte('created_at', toIso),
    supabase.from('deals').select('value, stage:stage_id(probability)').eq('status', 'open'),
  ]);

  const won = (wonRes.data ?? []) as DealRow[];
  const lost = (lostRes.data ?? []) as DealRow[];
  const created = (createdRes.data ?? []) as DealRow[];

  // Ranking por responsável (valor ganho no período).
  const rankMap = new Map<string | null, { value: number; count: number }>();
  for (const d of won) {
    const cur = rankMap.get(d.owner_id) ?? { value: 0, count: 0 };
    cur.value += Number(d.value) || 0;
    cur.count += 1;
    rankMap.set(d.owner_id, cur);
  }
  const ranking = [...rankMap.entries()]
    .map(([owner_id, v]) => ({ owner_id, ...v }))
    .sort((a, b) => b.value - a.value);

  // Forecast (mesma conta do widget dedicado — pipeline aberto ponderado).
  let forecastValue = 0;
  let openCount = 0;
  for (const d of (openRes.data ?? []) as unknown as { value: number | null; stage: { probability: number | null } | null }[]) {
    openCount++;
    forecastValue += (Number(d.value) || 0) * (Number(d.stage?.probability ?? 0) / 100);
  }

  const trafficRows = created.filter((d) => d.traffic_type || d.origin_channel || d.utm_campaign);

  return {
    won: {
      count: won.length,
      value: won.reduce((s, d) => s + (Number(d.value) || 0), 0),
      series: daySeries(range, won.map((d) => ({ at: d.won_at!, value: Number(d.value) || 0 }))),
    },
    lost: {
      count: lost.length,
      value: lost.reduce((s, d) => s + (Number(d.value) || 0), 0),
      series: daySeries(range, lost.map((d) => ({ at: d.lost_at!, value: Number(d.value) || 0 }))),
      reasons: countBy(lost, (d) => d.lost_reason?.trim() || 'Sem motivo'),
    },
    ranking,
    forecast: { value: Math.round(forecastValue), openCount },
    firstResponse: ownerDurations(created, (d) => d.first_contact_at, (d) => d.first_response_at),
    closeTime: ownerDurations(won, (d) => d.created_at, (d) => d.won_at),
    origin: {
      hasData: trafficRows.length > 0,
      traffic: countBy(created, (d) => d.traffic_type),
      channel: countBy(created, (d) => d.origin_channel),
      campaign: countBy(created, (d) => d.utm_campaign),
      ads: countBy(created.filter((d) => d.traffic_type === 'pago'), (d) => d.utm_content),
      organicPosts: countBy(created.filter((d) => d.traffic_type === 'organico'), (d) => d.utm_content),
    },
  };
}

export function useSalesDashboard(range: PeriodRange) {
  const [metrics, setMetrics] = useState<SalesMetrics>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const supabase = getSupabase();
      const { data: cfg } = await supabase
        .from('app_settings')
        .select('demo_mode')
        .eq('id', 1)
        .maybeSingle();
      if ((cfg as { demo_mode?: boolean } | null)?.demo_mode) {
        setMetrics(generateFakeMetrics(range));
      } else {
        setMetrics(await loadRealMetrics(range));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao carregar métricas.');
      setMetrics(EMPTY);
    } finally {
      setLoading(false);
    }
  }, [range]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { metrics, loading, error, reload };
}
