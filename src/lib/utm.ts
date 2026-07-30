// Utilitários do gerador de URLs com UTM (Módulo 4.2 + redirecionador Fase 1).

import { getSupabaseCredentials } from './supabase';

export type DestinationType = 'landing' | 'whatsapp' | 'instagram' | 'other';

// Base do redirecionador /r/. Por padrão aponta para a Edge Function
// redirect-tracker no domínio do Supabase (sempre funciona). Se o cliente
// configurar o rewrite de vaidade `/r/` no domínio do CRM, basta setar
// VITE_REDIRECT_BASE (ex.: "https://crm.com/r") que os links passam a usá-lo.
export function getRedirectorBase(): string {
  const override = import.meta.env.VITE_REDIRECT_BASE as string | undefined;
  if (override) return override.replace(/\/$/, '');
  const creds = getSupabaseCredentials();
  const url = creds?.url?.replace(/\/$/, '') ?? '';
  return `${url}/functions/v1/redirect-tracker`;
}

// URL blindada final: o clique passa SEMPRE pelo redirecionador, que grava a
// tracking_session antes de mandar ao destino real.
export function buildRedirectorUrl(slug: string): string {
  return `${getRedirectorBase()}/${slug}`;
}

export interface UtmParams {
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  utm_content?: string;
  utm_term?: string;
}

const UTM_KEYS: (keyof UtmParams)[] = [
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_content',
  'utm_term',
];

// Monta a URL final: preserva query existente da base e adiciona/atualiza os
// utm_* preenchidos (encode automático via URL API). Fallback string-based se a
// base não for uma URL absoluta válida.
export function buildUtmUrl(baseUrl: string, params: UtmParams): string {
  const base = baseUrl.trim();
  if (!base) return '';

  const entries = UTM_KEYS.map((k) => [k, (params[k] ?? '').trim()] as const).filter(
    ([, v]) => v !== '',
  );

  try {
    const url = new URL(base);
    for (const [k, v] of entries) url.searchParams.set(k, v);
    return url.toString();
  } catch {
    // Base sem protocolo/relativa: monta manualmente preservando query/hash.
    if (entries.length === 0) return base;
    const [beforeHash, hash] = base.split('#');
    const sep = beforeHash.includes('?') ? '&' : '?';
    const qs = entries
      .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
      .join('&');
    return `${beforeHash}${sep}${qs}${hash ? '#' + hash : ''}`;
  }
}

export interface UtmPreset {
  label: string;
  traffic: 'organico' | 'pago';
  source: string;
  medium: string;
}

// Presets rápidos por canal — pré-preenchem source/medium coerentes com a
// derivação server-side (medium pago → traffic_type 'pago').
export const UTM_PRESETS: UtmPreset[] = [
  { label: 'Instagram orgânico', traffic: 'organico', source: 'instagram', medium: 'organic' },
  { label: 'Facebook orgânico', traffic: 'organico', source: 'facebook', medium: 'organic' },
  { label: 'Google orgânico', traffic: 'organico', source: 'google', medium: 'organic' },
  { label: 'TikTok orgânico', traffic: 'organico', source: 'tiktok', medium: 'organic' },
  { label: 'LinkedIn orgânico', traffic: 'organico', source: 'linkedin', medium: 'organic' },
  { label: 'Meta Ads', traffic: 'pago', source: 'instagram', medium: 'paid_social' },
  { label: 'Google Ads', traffic: 'pago', source: 'google', medium: 'cpc' },
  { label: 'TikTok Ads', traffic: 'pago', source: 'tiktok', medium: 'paid_social' },
  { label: 'LinkedIn Ads', traffic: 'pago', source: 'linkedin', medium: 'paid_social' },
  { label: 'YouTube Ads', traffic: 'pago', source: 'youtube', medium: 'cpc' },
];
