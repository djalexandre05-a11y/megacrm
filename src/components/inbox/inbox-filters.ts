import type { ConversationWithContact } from '@/types/inbox';

// Estado dos filtros do inbox (Módulo 7). O canal fica aqui junto para
// persistência unificada, mas é renderizado como segmented control à parte.
export type ChannelFilter = 'all' | 'whatsapp' | 'instagram' | 'uazapi';
export type Atendente = 'ia' | 'humano';
export type StatusBucket = 'abertas' | 'fechadas' | 'arquivadas';
export type JanelaFilter = 'any' | 'dentro' | 'fora';

export interface InboxFilterState {
  channel: ChannelFilter;
  atendente: Atendente[]; // vazio = qualquer
  status: StatusBucket[]; // default ['abertas']; vazio = qualquer
  assigned: string | 'unassigned' | 'any';
  tagIds: string[]; // any-match; vazio = qualquer
  janela: JanelaFilter;
}

export const DEFAULT_FILTERS: InboxFilterState = {
  channel: 'all',
  atendente: [],
  status: ['abertas'],
  assigned: 'any',
  tagIds: [],
  janela: 'any',
};

const DAY_MS = 24 * 60 * 60 * 1000;

// Bucket de status derivado: arquivada domina; senão closed → fechadas; senão
// aberta (ai_active | human_active).
function statusBucket(c: ConversationWithContact): StatusBucket {
  if (c.archived) return 'arquivadas';
  if (c.status === 'closed') return 'fechadas';
  return 'abertas';
}

export function isWithinWindow(c: ConversationWithContact, now: number): boolean {
  return Boolean(c.lastInboundAt) && now - new Date(c.lastInboundAt as string).getTime() < DAY_MS;
}

// Predicado central: uma conversa passa se satisfaz TODOS os eixos ativos (AND).
export function matchesFilters(
  c: ConversationWithContact,
  f: InboxFilterState,
  now: number,
): boolean {
  if (f.channel !== 'all' && c.channel !== f.channel) return false;

  if (f.status.length > 0 && !f.status.includes(statusBucket(c))) return false;

  if (f.atendente.length > 0) {
    const want: string[] = f.atendente.map((a) => (a === 'ia' ? 'ai_active' : 'human_active'));
    if (!want.includes(c.status)) return false;
  }

  if (f.assigned === 'unassigned') {
    if (c.assigned_to) return false;
  } else if (f.assigned !== 'any') {
    if (c.assigned_to !== f.assigned) return false;
  }

  if (f.tagIds.length > 0) {
    const hit = c.tagIds.some((t) => f.tagIds.includes(t));
    if (!hit) return false;
  }

  if (f.janela !== 'any') {
    const within = isWithinWindow(c, now);
    if (f.janela === 'dentro' && !within) return false;
    if (f.janela === 'fora' && within) return false;
  }

  return true;
}

// Quantos eixos (fora canal) estão ativos — alimenta o badge do botão Filtros.
export function activeFilterCount(f: InboxFilterState): number {
  let n = 0;
  if (f.atendente.length > 0) n++;
  // status conta como ativo só quando difere do default (['abertas']).
  const isDefaultStatus =
    f.status.length === 1 && f.status[0] === 'abertas';
  if (!isDefaultStatus) n++;
  if (f.assigned !== 'any') n++;
  if (f.tagIds.length > 0) n++;
  if (f.janela !== 'any') n++;
  return n;
}

// ---- Persistência em querystring ------------------------------------------
// Namespace f* para não colidir com ?conversation= / ?contact= já usados.
export function readFiltersFromParams(sp: URLSearchParams): InboxFilterState {
  const csv = (v: string | null): string[] => (v ? v.split(',').filter(Boolean) : []);
  const ch = sp.get('fch');
  const channel: ChannelFilter =
    ch === 'whatsapp' || ch === 'instagram' || ch === 'uazapi' ? ch : 'all';
  const atendente = csv(sp.get('fat')).filter(
    (v): v is Atendente => v === 'ia' || v === 'humano',
  );
  const status = sp.has('fst')
    ? csv(sp.get('fst')).filter(
        (v): v is StatusBucket => v === 'abertas' || v === 'fechadas' || v === 'arquivadas',
      )
    : DEFAULT_FILTERS.status;
  const assigned = sp.get('fas') ?? 'any';
  const tagIds = csv(sp.get('ftg'));
  const jw = sp.get('fjw');
  const janela: JanelaFilter = jw === 'dentro' || jw === 'fora' ? jw : 'any';
  return { channel, atendente, status, assigned, tagIds, janela };
}

// Aplica os params de filtro num objeto de params existente (preserva os
// demais, ex.: conversation). Só grava o que difere do default.
export function writeFiltersToParams(
  sp: URLSearchParams,
  f: InboxFilterState,
): URLSearchParams {
  const next = new URLSearchParams(sp);
  const setOrDel = (key: string, val: string, on: boolean) => {
    if (on) next.set(key, val);
    else next.delete(key);
  };
  setOrDel('fch', f.channel, f.channel !== 'all');
  setOrDel('fat', f.atendente.join(','), f.atendente.length > 0);
  const isDefaultStatus = f.status.length === 1 && f.status[0] === 'abertas';
  setOrDel('fst', f.status.join(','), !isDefaultStatus);
  setOrDel('fas', f.assigned, f.assigned !== 'any');
  setOrDel('ftg', f.tagIds.join(','), f.tagIds.length > 0);
  setOrDel('fjw', f.janela, f.janela !== 'any');
  return next;
}
