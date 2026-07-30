// Minimal TypeScript shape of the whatsapp_hub tables this module touches.
// Not a full Supabase codegen — we only model the columns we actively read
// or write so the editor catches typos without dragging in the whole schema.

export interface Tag {
  id: string;
  name: string;
  color: string;
  created_at: string;
  updated_at: string;
}

export interface Contact {
  id: string;
  // Nullable desde o canal Instagram: contatos de DM não têm telefone —
  // são identificados por instagram_id.
  phone: string | null;
  name: string | null;
  email: string | null;
  kind?: 'lead' | 'cliente' | null;
  instagram_id?: string | null;
  source?: string | null;
  // Data do primeiro registro do contato (Módulo 5) — coluna da lista.
  first_seen_at?: string | null;
  custom_fields: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface ContactTag {
  contact_id: string;
  tag_id: string;
  created_at: string;
}

export interface ContactWithTags extends Contact {
  tags: Tag[];
  // Origem derivada do deal mais recente (Módulo 5): 'organico' | 'pago' | 'manual'.
  traffic_type?: string | null;
}
