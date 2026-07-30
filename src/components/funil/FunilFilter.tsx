import { useMemo, useState } from 'react';
import { ChevronDown, Filter, X } from 'lucide-react';
import type { CustomField, Deal, LeadType, Temperature } from '@/types/crm';
import { getDealOrigin } from '@/lib/dealOrigin';

// ----------------------------------------------------------------------------
// Filtro do funil — dropdown que restringe os negócios exibidos no board.
// Opera client-side sobre os deals já carregados por usePipeline.
// ----------------------------------------------------------------------------

export interface DealFilter {
  name: string;
  phone: string;
  email: string;
  createdFrom: string;
  createdTo: string;
  interactionFrom: string;
  interactionTo: string;
  purchaseFrom: string;
  purchaseTo: string;
  channels: string[];   // canal de mensageria: whatsapp | instagram | uazapi
  origins: string[];    // origem (badge): Meta Ads | Orgânico | Google Ads | TikTok Ads | LinkedIn Ads
  tagIds: string[];
  productIds: string[];
  temperatures: Temperature[];
  leadTypes: LeadType[];
  // custom_field_id → substring/valor buscado.
  fields: Record<string, string>;
}

export const EMPTY_FILTER: DealFilter = {
  name: '',
  phone: '',
  email: '',
  createdFrom: '',
  createdTo: '',
  interactionFrom: '',
  interactionTo: '',
  purchaseFrom: '',
  purchaseTo: '',
  channels: [],
  origins: [],
  tagIds: [],
  productIds: [],
  temperatures: [],
  leadTypes: [],
  fields: {},
};

const TEMPS: Temperature[] = ['Frio', 'Morno', 'Quente'];
const LEAD_TYPES: LeadType[] = ['Lead', 'Cliente'];
// Canal de mensageria (valor no banco → rótulo).
const CHANNELS: { value: string; label: string }[] = [
  { value: 'whatsapp', label: 'WhatsApp' },
  { value: 'instagram', label: 'Instagram' },
  { value: 'uazapi', label: 'Uazapi' },
];
// Origem = badge de alto nível de getDealOrigin. Para "Orgânico" casamos pelo
// tom (traffic_type='organico'), que cobre qualquer origem orgânica mesmo sem um
// origin_channel *_organico específico; os demais casam pelo badge da plataforma.
const ORIGINS = ['Meta Ads', 'Orgânico', 'Google Ads', 'TikTok Ads', 'LinkedIn Ads'];

function originBucket(d: Deal): string {
  const o = getDealOrigin(d);
  return o.tone === 'organico' ? 'Orgânico' : o.badge;
}

// Número de grupos de filtro ativos (para o badge no botão).
export function countActiveFilters(f: DealFilter): number {
  let n = 0;
  if (f.name.trim()) n++;
  if (f.phone.trim()) n++;
  if (f.email.trim()) n++;
  if (f.createdFrom || f.createdTo) n++;
  if (f.interactionFrom || f.interactionTo) n++;
  if (f.purchaseFrom || f.purchaseTo) n++;
  if (f.channels.length) n++;
  if (f.origins.length) n++;
  if (f.tagIds.length) n++;
  if (f.productIds.length) n++;
  if (f.temperatures.length) n++;
  if (f.leadTypes.length) n++;
  if (Object.values(f.fields).some((v) => v.trim())) n++;
  return n;
}

function withinRange(value: string | null, from: string, to: string): boolean {
  if (!from && !to) return true;
  if (!value) return false;
  const t = new Date(value).getTime();
  if (from && t < new Date(`${from}T00:00:00`).getTime()) return false;
  if (to && t > new Date(`${to}T23:59:59.999`).getTime()) return false;
  return true;
}

// Filtro puro aplicado ao board. Um deal passa se satisfaz TODOS os critérios.
export function applyDealFilter(deals: Deal[], f: DealFilter): Deal[] {
  const name = f.name.trim().toLowerCase();
  const email = f.email.trim().toLowerCase();
  const phoneDigits = f.phone.replace(/\D/g, '');
  return deals.filter((d) => {
    const c = d.contact;
    if (name && !(c?.name ?? '').toLowerCase().includes(name)) return false;
    if (phoneDigits && !(c?.phone ?? '').replace(/\D/g, '').includes(phoneDigits)) return false;
    if (email && !(c?.email ?? '').toLowerCase().includes(email)) return false;
    if (!withinRange(d.created_at, f.createdFrom, f.createdTo)) return false;
    if (!withinRange(d.updated_at, f.interactionFrom, f.interactionTo)) return false;
    if (!withinRange(d.last_purchase_at, f.purchaseFrom, f.purchaseTo)) return false;
    if (f.channels.length && !f.channels.includes(d.channel ?? '')) return false;
    if (f.origins.length && !f.origins.includes(originBucket(d))) return false;
    if (f.tagIds.length && !(d.tags ?? []).some((t) => f.tagIds.includes(t.id))) return false;
    if (f.productIds.length && !(d.products ?? []).some((p) => f.productIds.includes(p.id))) return false;
    if (f.temperatures.length && !f.temperatures.includes(d.temperature)) return false;
    if (f.leadTypes.length && !f.leadTypes.includes(d.lead_type)) return false;
    for (const [fid, val] of Object.entries(f.fields)) {
      const q = val.trim().toLowerCase();
      if (!q) continue;
      if (!(d.field_values?.[fid] ?? '').toLowerCase().includes(q)) return false;
    }
    return true;
  });
}

function toggle<T>(arr: T[], v: T): T[] {
  return arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v];
}

const inputCls =
  'w-full rounded-md border border-[rgba(59,130,246,0.2)] bg-white/[0.03] px-2 py-1 text-sm text-[var(--color-text-primary)] outline-none focus:border-[var(--accent-primary)]';

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full px-2.5 py-1 text-xs font-medium transition ${
        active
          ? 'bg-[var(--accent-primary)] text-white'
          : 'border border-[rgba(59,130,246,0.25)] text-[var(--color-text-secondary)] hover:border-[var(--accent-primary)]'
      }`}
    >
      {children}
    </button>
  );
}

function FieldBlock({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <div className="text-label">{label}</div>
      {children}
    </div>
  );
}

export function FunilFilter({
  deals,
  customFields,
  productCatalog,
  value,
  onChange,
}: {
  deals: Deal[];
  customFields: CustomField[];
  productCatalog: { id: string; name: string }[];
  value: DealFilter;
  onChange: (next: DealFilter) => void;
}) {
  const [open, setOpen] = useState(false);
  const [productsOpen, setProductsOpen] = useState(false);
  const active = countActiveFilters(value);
  const set = <K extends keyof DealFilter>(k: K, v: DealFilter[K]) => onChange({ ...value, [k]: v });

  // Tags e produtos são derivados dos deals carregados (evita queries extras).
  const tags = useMemo(() => {
    const m = new Map<string, { id: string; name: string; color: string }>();
    for (const d of deals) for (const t of d.tags ?? []) m.set(t.id, t);
    return Array.from(m.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [deals]);
  // Todos os produtos cadastrados (catálogo), não só os presentes nos deals.
  const products = useMemo(
    () => [...productCatalog].sort((a, b) => a.name.localeCompare(b.name)),
    [productCatalog],
  );

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className={`inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm transition ${
          active
            ? 'border-[var(--accent-primary)] bg-[rgba(59,130,246,0.1)] text-[var(--accent-secondary)]'
            : 'border-[rgba(59,130,246,0.25)] bg-white/[0.03] text-[var(--color-text-primary)] hover:border-[var(--accent-primary)]'
        }`}
      >
        <Filter className="h-4 w-4 opacity-80" />
        Filtrar
        {active > 0 && (
          <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-[var(--accent-primary)] px-1.5 text-[11px] font-semibold text-white">
            {active}
          </span>
        )}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-20 mt-1 max-h-[75vh] w-[22rem] overflow-y-auto rounded-lg border border-[rgba(59,130,246,0.25)] bg-[#0A0A0F] p-4 shadow-[0_0_30px_rgba(59,130,246,0.15)]">
            <div className="mb-3 flex items-center justify-between">
              <span className="text-sm font-semibold text-[var(--color-text-primary)]">Filtros</span>
              <div className="flex items-center gap-2">
                {active > 0 && (
                  <button
                    onClick={() => onChange(EMPTY_FILTER)}
                    className="text-xs text-[var(--accent-secondary)] hover:text-[var(--accent-primary)]"
                  >
                    Limpar
                  </button>
                )}
                <button onClick={() => setOpen(false)} className="text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]">
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            <div className="space-y-4">
              <FieldBlock label="Nome">
                <input value={value.name} onChange={(e) => set('name', e.target.value)} placeholder="Buscar por nome…" className={inputCls} />
              </FieldBlock>

              <FieldBlock label="Telefone">
                <input value={value.phone} onChange={(e) => set('phone', e.target.value)} placeholder="Buscar por telefone…" className={inputCls} />
              </FieldBlock>

              <FieldBlock label="E-mail">
                <input value={value.email} onChange={(e) => set('email', e.target.value)} placeholder="Buscar por e-mail…" className={inputCls} />
              </FieldBlock>

              <FieldBlock label="Criado em">
                <div className="flex items-center gap-2">
                  <input type="date" value={value.createdFrom} onChange={(e) => set('createdFrom', e.target.value)} className={inputCls} />
                  <span className="text-xs text-[var(--color-text-secondary)]">até</span>
                  <input type="date" value={value.createdTo} onChange={(e) => set('createdTo', e.target.value)} className={inputCls} />
                </div>
              </FieldBlock>

              <FieldBlock label="Última interação">
                <div className="flex items-center gap-2">
                  <input type="date" value={value.interactionFrom} onChange={(e) => set('interactionFrom', e.target.value)} className={inputCls} />
                  <span className="text-xs text-[var(--color-text-secondary)]">até</span>
                  <input type="date" value={value.interactionTo} onChange={(e) => set('interactionTo', e.target.value)} className={inputCls} />
                </div>
              </FieldBlock>

              <FieldBlock label="Última compra">
                <div className="flex items-center gap-2">
                  <input type="date" value={value.purchaseFrom} onChange={(e) => set('purchaseFrom', e.target.value)} className={inputCls} />
                  <span className="text-xs text-[var(--color-text-secondary)]">até</span>
                  <input type="date" value={value.purchaseTo} onChange={(e) => set('purchaseTo', e.target.value)} className={inputCls} />
                </div>
              </FieldBlock>

              <FieldBlock label="Temperatura">
                <div className="flex flex-wrap gap-1.5">
                  {TEMPS.map((t) => (
                    <Chip key={t} active={value.temperatures.includes(t)} onClick={() => set('temperatures', toggle(value.temperatures, t))}>
                      {t}
                    </Chip>
                  ))}
                </div>
              </FieldBlock>

              <FieldBlock label="Lead ou cliente">
                <div className="flex flex-wrap gap-1.5">
                  {LEAD_TYPES.map((t) => (
                    <Chip key={t} active={value.leadTypes.includes(t)} onClick={() => set('leadTypes', toggle(value.leadTypes, t))}>
                      {t}
                    </Chip>
                  ))}
                </div>
              </FieldBlock>

              <FieldBlock label="Canal">
                <div className="flex flex-wrap gap-1.5">
                  {CHANNELS.map((ch) => (
                    <Chip key={ch.value} active={value.channels.includes(ch.value)} onClick={() => set('channels', toggle(value.channels, ch.value))}>
                      {ch.label}
                    </Chip>
                  ))}
                </div>
              </FieldBlock>

              <FieldBlock label="Origem">
                <div className="flex flex-wrap gap-1.5">
                  {ORIGINS.map((o) => (
                    <Chip key={o} active={value.origins.includes(o)} onClick={() => set('origins', toggle(value.origins, o))}>
                      {o}
                    </Chip>
                  ))}
                </div>
              </FieldBlock>

              {tags.length > 0 && (
                <FieldBlock label="Tags">
                  <div className="flex flex-wrap gap-1.5">
                    {tags.map((t) => (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => set('tagIds', toggle(value.tagIds, t.id))}
                        className={`rounded-full px-2.5 py-1 text-xs font-medium transition ${
                          value.tagIds.includes(t.id) ? 'text-white' : 'text-[var(--color-text-secondary)]'
                        }`}
                        style={
                          value.tagIds.includes(t.id)
                            ? { background: t.color }
                            : { background: `${t.color}22`, border: `1px solid ${t.color}55` }
                        }
                      >
                        {t.name}
                      </button>
                    ))}
                  </div>
                </FieldBlock>
              )}

              {products.length > 0 && (
                <FieldBlock label="Produto">
                  <div>
                    <button
                      type="button"
                      onClick={() => setProductsOpen((v) => !v)}
                      className={`flex w-full items-center justify-between gap-2 rounded-md border px-2 py-1.5 text-sm transition ${
                        value.productIds.length
                          ? 'border-[var(--accent-primary)] text-[var(--color-text-primary)]'
                          : 'border-[rgba(59,130,246,0.2)] text-[var(--color-text-secondary)] hover:border-[var(--accent-primary)]'
                      }`}
                    >
                      <span className="truncate">
                        {value.productIds.length === 0
                          ? 'Todos os produtos'
                          : `${value.productIds.length} selecionado(s)`}
                      </span>
                      <ChevronDown className={`h-4 w-4 shrink-0 opacity-70 transition ${productsOpen ? 'rotate-180' : ''}`} />
                    </button>
                    {productsOpen && (
                      <div className="mt-1 max-h-44 space-y-0.5 overflow-y-auto rounded-md border border-[rgba(59,130,246,0.2)] bg-white/[0.02] p-1">
                        {products.map((p) => {
                          const on = value.productIds.includes(p.id);
                          return (
                            <button
                              key={p.id}
                              type="button"
                              onClick={() => set('productIds', toggle(value.productIds, p.id))}
                              className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm text-[var(--color-text-primary)] transition hover:bg-white/5"
                            >
                              <input type="checkbox" readOnly checked={on} className="h-3.5 w-3.5 accent-[var(--accent-primary)]" />
                              <span className="truncate">{p.name}</span>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </FieldBlock>
              )}

              {customFields.length > 0 && (
                <FieldBlock label="Campos personalizados">
                  <div className="space-y-2">
                    {customFields.map((cf) => {
                      const v = value.fields[cf.id] ?? '';
                      const update = (nv: string) => set('fields', { ...value.fields, [cf.id]: nv });
                      return (
                        <div key={cf.id} className="space-y-1">
                          <div className="text-xs text-[var(--color-text-secondary)]">{cf.label}</div>
                          {cf.field_type === 'select' && cf.options?.length ? (
                            <select value={v} onChange={(e) => update(e.target.value)} className={inputCls}>
                              <option value="">Qualquer</option>
                              {cf.options.map((o) => (
                                <option key={o} value={o}>{o}</option>
                              ))}
                            </select>
                          ) : cf.field_type === 'boolean' ? (
                            <select value={v} onChange={(e) => update(e.target.value)} className={inputCls}>
                              <option value="">Qualquer</option>
                              <option value="true">Sim</option>
                              <option value="false">Não</option>
                            </select>
                          ) : (
                            <input
                              type={cf.field_type === 'date' ? 'date' : cf.field_type === 'number' ? 'number' : 'text'}
                              value={v}
                              onChange={(e) => update(e.target.value)}
                              placeholder={`Filtrar por ${cf.label.toLowerCase()}…`}
                              className={inputCls}
                            />
                          )}
                        </div>
                      );
                    })}
                  </div>
                </FieldBlock>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
