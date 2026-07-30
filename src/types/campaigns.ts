import type { TemplateButton } from './templates';

export type CampaignStatus = 'draft' | 'scheduled' | 'sending' | 'completed' | 'paused' | 'failed';
export type CampaignContactStatus = 'pending' | 'sent' | 'delivered' | 'read' | 'replied' | 'failed';
export type FollowUpTrigger = 'no_reply';

// Mirrors the JSONB shape the dispatcher consumes.
export type VariableSource =
  | { source: 'literal'; value: string }
  | { source: 'contact_field'; field: 'name' | 'email' | 'phone' }
  | { source: 'custom_field'; field: string };

export interface AudienceFilter {
  all?: boolean;
  tag_ids?: string[];
  custom_fields?: Record<string, string>;
}

export interface Campaign {
  id: string;
  name: string;
  template_id: string;
  status: CampaignStatus;
  scheduled_at: string | null;
  audience_filter: AudienceFilter;
  variable_mapping: Record<string, VariableSource>;
  total_contacts: number;
  sent: number;
  delivered: number;
  read: number;
  replied: number;
  failed: number;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface FollowUpRule {
  id: string;
  campaign_id: string | null;
  trigger_condition: FollowUpTrigger;
  delay_hours: number;
  template_id: string;
  sequence_order: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export type { TemplateButton };
