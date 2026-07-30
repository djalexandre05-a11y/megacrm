// ----------------------------------------------------------------------------
// Tipos da camada CRM (schema whatsapp_hub) — funil, entrega e educação.
// O CRM ancora no `contacts` existente: a mesma pessoa atravessa as 3 fases.
// ----------------------------------------------------------------------------

export type PipelineKind = 'comercial' | 'projeto' | 'educacao';
export type DealStatus = 'open' | 'won' | 'lost';
export type ProjectStatus = 'active' | 'on_hold' | 'done' | 'cancelled';
export type TaskStatus = 'todo' | 'doing' | 'done';
export type EnrollmentStatus = 'active' | 'completed' | 'dropped' | 'paused';

export type LeadType = 'Lead' | 'Cliente';
export type Temperature = 'Frio' | 'Morno' | 'Quente';

// Tipos de "próxima ação" (follow-up manual do corretor) — subconjunto de
// crm_activity_type usado como ação agendada (due_at + done). 'note' e
// 'stage_change' ficam de fora.
export type ActionType = 'followup' | 'call' | 'meeting' | 'task';

export const ACTION_TYPE_LABEL: Record<ActionType, string> = {
  followup: 'Retornar',
  call: 'Ligar',
  meeting: 'Reunião',
  task: 'Tarefa',
};

// Uma ação agendada = linha em crm_activities com due_at preenchido e done=false.
export interface NextAction {
  id: string;
  deal_id: string | null;
  contact_id: string | null;
  type: ActionType;
  title: string | null;
  due_at: string;
  done: boolean;
  created_at: string;
  // Preenchido só no escopo de contato (embedding deal:deal_id(title)).
  deal_title?: string | null;
}

// Cores dos badges de temperatura (frio = azul/cinza, morno = amarelo, quente = laranja/vermelho).
export const TEMPERATURE_STYLE: Record<Temperature, { label: string; className: string; dot: string }> = {
  Frio: { label: 'Frio', className: 'bg-[rgba(96,165,250,0.14)] text-[#60A5FA]', dot: 'bg-[#60A5FA]' },
  Morno: { label: 'Morno', className: 'bg-[rgba(245,158,11,0.14)] text-[#FBBF24]', dot: 'bg-[#FBBF24]' },
  Quente: { label: 'Quente', className: 'bg-[rgba(239,68,68,0.14)] text-[#F87171]', dot: 'bg-[#F87171]' },
};

export interface Pipeline {
  id: string;
  name: string;
  kind: PipelineKind;
  position: number;
  is_default: boolean;
  created_at: string;
}

export interface Stage {
  id: string;
  pipeline_id: string;
  name: string;
  position: number;
  is_won: boolean;
  is_lost: boolean;
  color: string | null;
  // Probabilidade de fechamento (0..100) — usada no forecast do dashboard (M3).
  probability: number;
  // Critério que diz à IA o que caracteriza este estágio (M8). Sem critério, a
  // IA não move para cá.
  ai_criteria: string | null;
  created_at: string;
}

export interface Product {
  id: string;
  name: string;
}

export interface Tag {
  id: string;
  name: string;
  color: string;
}

// Contato resumido embutido nas queries (PostgREST embedding via FK).
export interface ContactLite {
  id: string;
  name: string | null;
  phone: string;
  email?: string | null;
}

// Contato completo carregado no drawer do card do funil.
export interface ContactFull {
  id: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  source: string | null;
  custom_fields: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

export const CONTACT_SOURCE_LABEL: Record<string, string> = {
  whatsapp: 'WhatsApp',
  instagram: 'Instagram',
  import: 'Importação (Excel)',
  manual: 'Cadastro manual',
};

// ---- Campos customizáveis (definições + valores por deal) ----
export type CustomFieldType = 'text' | 'number' | 'date' | 'select' | 'boolean';

export interface CustomField {
  id: string;
  label: string;
  field_type: CustomFieldType;
  options: string[] | null;
  required: boolean;
  position: number;
  created_at: string;
}

export interface CustomFieldValue {
  id: string;
  custom_field_id: string;
  deal_id: string;
  value: string | null;
  updated_at: string;
}

export const CUSTOM_FIELD_TYPE_LABEL: Record<CustomFieldType, string> = {
  text: 'Texto',
  number: 'Número',
  date: 'Data',
  select: 'Seleção',
  boolean: 'Sim/Não',
};

export interface Deal {
  id: string;
  contact_id: string;
  pipeline_id: string | null;
  stage_id: string | null;
  title: string;
  value: number | null;
  currency: string;
  status: DealStatus;
  expected_close: string | null;
  won_at: string | null;
  lost_at: string | null;
  lost_reason: string | null;
  owner_id: string | null;
  lead_type: LeadType;
  temperature: Temperature;
  last_purchase_at: string | null;
  // Atendimento (Módulo 3): carimbados por trigger a partir das mensagens.
  first_contact_at: string | null;
  first_response_at: string | null;
  // Rastreio de origem (Módulo 4): utm_* + classificação derivada.
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_content: string | null;
  utm_term: string | null;
  traffic_type: string | null;   // 'organico' | 'pago' | 'manual'
  origin_channel: string | null;
  attribution_method: string | null; // 'ctwa' | 'codigo_rastreio' | 'utm_landing' | 'manual'
  created_at: string;
  updated_at: string;
  contact?: ContactLite | null;
  // Tags embutidas no board (para os chips no card). PostgREST: deal_tags(tag(*)).
  tags?: Tag[];
  // Produtos do negócio (para o subtítulo do card). PostgREST: deal_products(product(*)).
  products?: { id: string; name: string }[];
  // Próxima ação pendente mais próxima (para o badge no card do funil). Anexada
  // por usePipeline a partir de crm_activities (due_at not null, done=false).
  next_action?: { id: string; due_at: string; type: ActionType } | null;
  // Valores dos campos personalizados por deal (custom_field_id → valor), usados
  // pelo filtro do funil. PostgREST: custom_field_values(custom_field_id, value).
  field_values?: Record<string, string>;
  // Canal de mensageria do contato (whatsapp/instagram/uazapi), derivado da
  // conversa. Usado pelo filtro de Canal do funil.
  channel?: string | null;
}

export interface Project {
  id: string;
  contact_id: string;
  deal_id: string | null;
  pipeline_id: string | null;
  stage_id: string | null;
  name: string;
  status: ProjectStatus;
  client_status: string | null;
  start_date: string | null;
  due_date: string | null;
  owner_id: string | null;
  created_at: string;
  updated_at: string;
  contact?: ContactLite | null;
}

export interface Course {
  id: string;
  name: string;
  description: string | null;
  created_at: string;
}

export interface Class {
  id: string;
  course_id: string;
  name: string;
  start_date: string | null;
  end_date: string | null;
  created_at: string;
}

export interface Enrollment {
  id: string;
  contact_id: string;
  class_id: string;
  status: EnrollmentStatus;
  progress: number;
  enrolled_at: string;
  contact?: ContactLite | null;
}

export const PROJECT_STATUS_LABEL: Record<ProjectStatus, string> = {
  active: 'Ativo',
  on_hold: 'Pausado',
  done: 'Concluído',
  cancelled: 'Cancelado',
};

export const ENROLLMENT_STATUS_LABEL: Record<EnrollmentStatus, string> = {
  active: 'Ativo',
  completed: 'Concluído',
  dropped: 'Desistiu',
  paused: 'Pausado',
};
