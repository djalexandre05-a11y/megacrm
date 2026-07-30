import { useCallback, useEffect, useState } from 'react';
import { getSupabase } from '@/lib/supabase';
import { useAppUser } from '@/app/providers/AppUserProvider';
import type { Contact, ContactWithTags, Tag } from '@/types/db';

export type ContactSort = 'recent' | 'oldest' | 'name' | 'first_seen';

interface UseContactsInput {
  search?: string;
  tagId?: string | null;
  source?: string | null;
  sort?: ContactSort;
  page?: number;
  pageSize?: number;
}

interface UseContactsResult {
  contacts: ContactWithTags[];
  total: number;
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
  create: (
    input: Pick<Contact, 'phone'> & Partial<Pick<Contact, 'name' | 'email' | 'custom_fields'>> & { tag_ids?: string[] },
  ) => Promise<Contact | null>;
  update: (
    id: string,
    patch: Partial<Pick<Contact, 'name' | 'email' | 'phone' | 'custom_fields'>> & { tag_ids?: string[] },
  ) => Promise<void>;
  remove: (ids: string[]) => Promise<void>;
  assignTags: (contactIds: string[], tagIds: string[]) => Promise<void>;
}

const PAGE_SIZE_DEFAULT = 25;

export function useContacts({
  search = '',
  tagId = null,
  source = null,
  sort = 'recent',
  page = 1,
  pageSize = PAGE_SIZE_DEFAULT,
}: UseContactsInput = {}): UseContactsResult {
  const { userId } = useAppUser();
  const [contacts, setContacts] = useState<ContactWithTags[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    setError(null);
    const supabase = getSupabase();

    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;

    // When a tag filter is active, pre-filter contact_ids via contact_tags and
    // pass the list to the main query. A nested join would return too many
    // duplicated rows; two small queries is simpler and lets us paginate.
    let contactIdsForTag: string[] | null = null;
    if (tagId) {
      const { data: links, error: linksErr } = await supabase
        .from('contact_tags')
        .select('contact_id')
        .eq('tag_id', tagId);
      if (linksErr) {
        setError(linksErr.message);
        setLoading(false);
        return;
      }
      contactIdsForTag = (links ?? []).map((l) => l.contact_id as string);
      if (contactIdsForTag.length === 0) {
        setContacts([]);
        setTotal(0);
        setLoading(false);
        return;
      }
    }

    let query = supabase
      .from('contacts')
      .select('*', { count: 'exact' })
      .range(from, to);

    // Ordenação (coluna "Primeiro registro" e nome também ordenáveis).
    if (sort === 'oldest') query = query.order('created_at', { ascending: true });
    else if (sort === 'name') query = query.order('name', { ascending: true, nullsFirst: false });
    else if (sort === 'first_seen') query = query.order('first_seen_at', { ascending: false });
    else query = query.order('created_at', { ascending: false });

    if (contactIdsForTag) {
      query = query.in('id', contactIdsForTag);
    }

    if (source) {
      query = query.eq('source', source);
    }

    if (search.trim()) {
      const pattern = `%${search.trim()}%`;
      query = query.or(`name.ilike.${pattern},phone.ilike.${pattern},email.ilike.${pattern}`);
    }

    const { data, error: err, count } = await query;
    if (err) {
      setError(err.message);
      setLoading(false);
      return;
    }

    const ids = (data ?? []).map((c) => c.id as string);
    if (ids.length === 0) {
      setContacts([]);
      setTotal(count ?? 0);
      setLoading(false);
      return;
    }

    const { data: linkRows, error: linkErr } = await supabase
      .from('contact_tags')
      .select('contact_id, tag:tag_id(id, name, color, created_at, updated_at)')
      .in('contact_id', ids);
    if (linkErr) {
      setError(linkErr.message);
      setLoading(false);
      return;
    }

    const byContact = new Map<string, Tag[]>();
    for (const row of linkRows ?? []) {
      const contactId = row.contact_id as string;
      const tag = row.tag as unknown as Tag | null;
      if (!tag) continue;
      const arr = byContact.get(contactId) ?? [];
      arr.push(tag);
      byContact.set(contactId, arr);
    }

    // Origem: traffic_type do deal mais recente de cada contato (coluna Origem).
    const { data: dealRows } = await supabase
      .from('deals')
      .select('contact_id, traffic_type, created_at')
      .in('contact_id', ids)
      .order('created_at', { ascending: false });
    const trafficByContact = new Map<string, string | null>();
    for (const d of (dealRows ?? []) as Array<{ contact_id: string; traffic_type: string | null }>) {
      if (!trafficByContact.has(d.contact_id)) trafficByContact.set(d.contact_id, d.traffic_type);
    }

    const merged: ContactWithTags[] = (data ?? []).map((c) => ({
      ...(c as Contact),
      tags: byContact.get(c.id as string) ?? [],
      traffic_type: trafficByContact.get(c.id as string) ?? null,
    }));

    setContacts(merged);
    setTotal(count ?? 0);
    setLoading(false);
  }, [userId, search, tagId, source, sort, page, pageSize]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const create: UseContactsResult['create'] = async (input) => {
    if (!userId) return null;
    const { tag_ids = [], ...contactPayload } = input;
    const supabase = getSupabase();
    const { data, error: err } = await supabase
      .from('contacts')
      .insert({
        phone: contactPayload.phone,
        name: contactPayload.name ?? null,
        email: contactPayload.email ?? null,
        custom_fields: contactPayload.custom_fields ?? {},
      })
      .select()
      .single();
    if (err) {
      setError(err.message);
      throw new Error(translateContactError(err.message));
    }
    const created = data as Contact;
    if (tag_ids.length > 0) {
      await assignTagsTo([created.id], tag_ids);
    }
    await reload();
    return created;
  };

  const update: UseContactsResult['update'] = async (id, patch) => {
    if (!userId) return;
    const { tag_ids, ...rest } = patch;
    const supabase = getSupabase();
    const { error: err } = await supabase.schema('whatsapp_hub').from('contacts').update(rest).eq('id', id);
    if (err) {
      setError(err.message);
      throw new Error(translateContactError(err.message));
    }
    if (tag_ids) {
      // Replace the tag set: delete old links, insert new ones.
      await supabase.schema('whatsapp_hub').from('contact_tags').delete().eq('contact_id', id);
      if (tag_ids.length > 0) {
        await supabase
          .from('contact_tags')
          .insert(tag_ids.map((tag_id) => ({ contact_id: id, tag_id })));
      }
    }
    await reload();
  };

  const remove: UseContactsResult['remove'] = async (ids) => {
    if (ids.length === 0) return;
    const supabase = getSupabase();
    const { error: err } = await supabase.schema('whatsapp_hub').from('contacts').delete().in('id', ids);
    if (err) {
      setError(err.message);
      throw new Error(translateContactError(err.message));
    }
    await reload();
  };

  const assignTags: UseContactsResult['assignTags'] = async (contactIds, tagIds) => {
    if (!userId || contactIds.length === 0 || tagIds.length === 0) return;
    await assignTagsTo(contactIds, tagIds);
    await reload();
  };

  return { contacts, total, loading, error, reload, create, update, remove, assignTags };
}

async function assignTagsTo(contactIds: string[], tagIds: string[]) {
  const supabase = getSupabase();
  const rows = contactIds.flatMap((contact_id) =>
    tagIds.map((tag_id) => ({ contact_id, tag_id })),
  );
  // upsert handles duplicates — composite PK is (contact_id, tag_id).
  const { error } = await supabase
    .schema('whatsapp_hub')
    .from('contact_tags')
    .upsert(rows, { onConflict: 'contact_id,tag_id' });
  if (error) throw new Error(translateContactError(error.message));
}

// Maps the most common Postgres/PostgREST errors to actionable pt-BR messages
// so a non-technical operator sees "telefone já cadastrado" instead of a raw
// "duplicate key value violates unique constraint" string.
function translateContactError(message: string): string {
  const lower = message.toLowerCase();
  if (lower.includes('duplicate key') && lower.includes('phone')) {
    return 'Já existe um contato com este telefone.';
  }
  if (lower.includes('duplicate key')) {
    return 'Registro duplicado — verifique os dados informados.';
  }
  if (lower.includes('row-level security') || lower.includes('permission denied')) {
    return 'Você não tem permissão para esta ação.';
  }
  if (lower.includes('violates check constraint') || lower.includes('invalid input')) {
    return 'Dados inválidos — revise os campos e tente novamente.';
  }
  return message || 'Não foi possível concluir a operação.';
}
