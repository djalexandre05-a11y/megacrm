import { useCallback, useEffect, useState } from 'react';
import { getSupabase } from '@/lib/supabase';
import type { ActionType, NextAction } from '@/types/crm';

// "Próxima ação" = crm_activities agendada (due_at preenchido, done=false),
// ancorada num negócio (deal). O filtro decide o escopo:
//   { dealId }    → ações daquele negócio (drawer do funil, inbox).
//   { contactId } → ações de todos os negócios do contato (página do contato),
//                   com o título do negócio embutido para rótulo.
interface NextActionsFilter {
  dealId?: string | null;
  contactId?: string | null;
}

interface AddActionInput {
  text: string;
  dueAt: string;          // ISO string
  type: ActionType;
  dealId?: string | null; // sobrepõe o dealId do filtro (usado no escopo de contato)
}

interface UseNextActionsResult {
  actions: NextAction[];
  next: NextAction | null;
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
  addAction: (input: AddActionInput) => Promise<void>;
  completeAction: (id: string) => Promise<void>;
  removeAction: (id: string) => Promise<void>;
}

const BASE_SELECT = 'id, deal_id, contact_id, type, title, due_at, done, created_at';

export function useNextActions(filter: NextActionsFilter): UseNextActionsResult {
  const { dealId, contactId } = filter;
  const [actions, setActions] = useState<NextAction[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!dealId && !contactId) {
      setActions([]);
      return;
    }
    setLoading(true);
    setError(null);
    const supabase = getSupabase();
    // No escopo de contato embutimos o título do negócio para rotular cada ação.
    const select = contactId && !dealId ? `${BASE_SELECT}, deal:deal_id(title)` : BASE_SELECT;
    let query = supabase
      .from('crm_activities')
      .select(select)
      .not('due_at', 'is', null)
      .eq('done', false)
      .order('due_at', { ascending: true });
    query = dealId ? query.eq('deal_id', dealId) : query.eq('contact_id', contactId as string);

    const { data, error: err } = await query;
    if (err) {
      setError(err.message);
      setActions([]);
    } else {
      const rows = (data ?? []) as unknown as Array<Record<string, unknown> & { deal?: { title: string } | null }>;
      setActions(
        rows.map((r) => ({
          id: r.id as string,
          deal_id: (r.deal_id as string | null) ?? null,
          contact_id: (r.contact_id as string | null) ?? null,
          type: r.type as ActionType,
          title: (r.title as string | null) ?? null,
          due_at: r.due_at as string,
          done: r.done as boolean,
          created_at: r.created_at as string,
          deal_title: r.deal?.title ?? null,
        })),
      );
    }
    setLoading(false);
  }, [dealId, contactId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const addAction = useCallback<UseNextActionsResult['addAction']>(
    async (input) => {
      const text = input.text.trim();
      if (!text) return;
      const targetDeal = input.dealId ?? dealId ?? null;
      const supabase = getSupabase();
      const { data: u } = await supabase.auth.getUser();
      const { error: err } = await supabase.from('crm_activities').insert({
        type: input.type,
        title: text,
        due_at: input.dueAt,
        deal_id: targetDeal,
        contact_id: contactId ?? null,
        owner_id: u?.user?.id ?? null,
      });
      if (err) {
        setError(err.message);
        return;
      }
      await reload();
    },
    [dealId, contactId, reload],
  );

  const completeAction = useCallback<UseNextActionsResult['completeAction']>(
    async (id) => {
      const supabase = getSupabase();
      const { error: err } = await supabase
        .from('crm_activities')
        .update({ done: true, done_at: new Date().toISOString() })
        .eq('id', id);
      if (err) {
        setError(err.message);
        return;
      }
      await reload();
    },
    [reload],
  );

  const removeAction = useCallback<UseNextActionsResult['removeAction']>(
    async (id) => {
      const supabase = getSupabase();
      const { error: err } = await supabase.from('crm_activities').delete().eq('id', id);
      if (err) {
        setError(err.message);
        return;
      }
      await reload();
    },
    [reload],
  );

  return {
    actions,
    next: actions[0] ?? null,
    loading,
    error,
    reload,
    addAction,
    completeAction,
    removeAction,
  };
}
