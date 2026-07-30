import { useCallback, useEffect, useMemo, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { ChevronDown, Copy, KeyRound, Loader2, Smartphone } from 'lucide-react';
import { toast } from 'sonner';
import { CredentialField } from '@/components/credentials/CredentialField';
import { InstagramCard } from './sections/InstagramCard';
import { UazapiCard } from './sections/UazapiCard';
import { useAppUser } from '@/app/providers/AppUserProvider';
import { useAuth } from '@/app/providers/AuthProvider';
import { setupConfig } from '../../../../setup.config';

type ExistsMap = Record<string, { exists: boolean }>;

type ZernioNumber = {
  display_phone_number: string | null;
  verified_name: string | null;
  messaging_limit_tier: string | null;
  quality_rating: string | null;
  health_status: string | null;
};

type ZernioStatus = {
  connected: boolean;
  accountId: string | null;
  webhook_url: string | null;
  number: ZernioNumber | null;
};

export default function CredentialsPage() {
  const { role, loading } = useAppUser();
  const { session } = useAuth();
  const [exists, setExists] = useState<ExistsMap>({});
  const [changed, setChanged] = useState<Record<string, string>>({});
  const [valid, setValid] = useState<Record<string, boolean>>({});
  const [hydrating, setHydrating] = useState(true);
  const [saving, setSaving] = useState(false);
  const [zernio, setZernio] = useState<ZernioStatus | null>(null);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [uazapiRefresh, setUazapiRefresh] = useState(0);
  const [demoMode, setDemoMode] = useState<boolean | null>(null);

  // Modo de Demonstração (dados fictícios no dashboard) — flag no singleton
  // whatsapp_hub.app_settings (escrita admin-only via RLS).
  useEffect(() => {
    if (!session) return;
    void (async () => {
      const { getSupabase } = await import('@/lib/supabase');
      const { data } = await getSupabase().from('app_settings').select('demo_mode').eq('id', 1).maybeSingle();
      setDemoMode(Boolean((data as { demo_mode?: boolean } | null)?.demo_mode));
    })();
  }, [session]);

  const toggleDemoMode = async () => {
    const next = !demoMode;
    setDemoMode(next);
    const { getSupabase } = await import('@/lib/supabase');
    const { error } = await getSupabase().from('app_settings').update({ demo_mode: next }).eq('id', 1);
    if (error) {
      setDemoMode(!next);
      toast.error('Falha ao alterar o modo de demonstração.');
    } else {
      toast.success(next ? 'Modo de Demonstração ATIVADO.' : 'Modo de Demonstração desativado.');
    }
  };

  // app_url sai da UI (derivado do deploy); llm_provider/llm_api_key vão para
  // "Configurações Avançadas". Zernio + OpenAI ficam como campos principais.
  const ADVANCED_KEYS = ['llm_provider', 'llm_api_key'];
  // instagram_access_token é gerenciado no card "Canais", não aqui.
  const HIDDEN_KEYS = ['app_url', 'instagram_access_token'];
  const mainFields = setupConfig.appCredentials.filter(
    (f) => !ADVANCED_KEYS.includes(f.key) && !HIDDEN_KEYS.includes(f.key),
  );
  const advancedFields = setupConfig.appCredentials.filter((f) => ADVANCED_KEYS.includes(f.key));

  const loadZernioStatus = useCallback(async () => {
    if (!session) return;
    try {
      const res = await fetch('/api/zernio-connect', {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      const body = (await res.json()) as ZernioStatus & { success?: boolean };
      if (res.ok) setZernio(body);
    } catch {
      // Status e informativo; uma falha aqui nao bloqueia a edicao de chaves.
    }
  }, [session]);

  useEffect(() => {
    if (!session) return;
    const keys = setupConfig.appCredentials.map((field) => field.key).join(',');
    fetch(`/api/credentials?keys=${encodeURIComponent(keys)}`, {
      headers: { Authorization: `Bearer ${session.access_token}` },
    })
      .then((res) => res.json())
      .then((body: ExistsMap) => setExists(body))
      .catch((err: unknown) => {
        toast.error('Falha ao carregar credenciais', {
          description: err instanceof Error ? err.message : 'Erro interno',
        });
      })
      .finally(() => setHydrating(false));
    void loadZernioStatus();
  }, [session, loadZernioStatus]);

  const onChange = useCallback((key: string, value: string | null) => {
    setChanged((prev) => {
      const next = { ...prev };
      if (value === null) delete next[key];
      else next[key] = value;
      return next;
    });
  }, []);

  const modifiedKeys = useMemo(() => Object.keys(changed), [changed]);
  const canSave = modifiedKeys.length > 0 && modifiedKeys.every((key) => valid[key]);

  const save = async () => {
    setSaving(true);
    try {
      const res = await fetch('/api/credentials', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session?.access_token ?? ''}`,
        },
        body: JSON.stringify({ credentials: changed }),
      });
      const body = await res.json();
      if (!res.ok || !body.success) throw new Error(body.message ?? 'Falha ao salvar.');
      toast.success('Credenciais atualizadas.');
      setExists((prev) => {
        const next = { ...prev };
        for (const key of modifiedKeys) next[key] = { exists: true };
        return next;
      });

      // Trocar a Zernio API Key invalida a conta/numero/webhook resolvidos —
      // re-resolve server-side (mesma rota do wizard) e atualiza o status.
      // Salvar chaves Uazapi atualiza o card de status (webhook URL aparece na hora).
      if (modifiedKeys.some((k) => k.startsWith('uazapi_'))) {
        setUazapiRefresh((n) => n + 1);
      }

      if (modifiedKeys.includes('zernio_api_key')) {
        const connectRes = await fetch('/api/zernio-connect', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session?.access_token ?? ''}`,
          },
          body: JSON.stringify({}),
        });
        const connectBody = await connectRes.json();
        if (!connectRes.ok || !connectBody.success) {
          toast.warning('Chave salva, mas a reconexao com o Zernio falhou.', {
            description: connectBody.message ?? 'Tente novamente.',
          });
        } else if (connectBody.webhookWarning) {
          toast.warning('Reconectado, mas o webhook nao foi registrado.', {
            description: connectBody.webhookWarning,
          });
        }
        await loadZernioStatus();
      }

      setChanged({});
      setValid({});
    } catch (err) {
      toast.error('Falha ao salvar credenciais', {
        description: err instanceof Error ? err.message : 'Erro interno',
      });
    } finally {
      setSaving(false);
    }
  };

  if (loading || hydrating) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-[#60A5FA]" />
      </div>
    );
  }

  if (role !== 'admin') {
    return <Navigate to="/dashboard" replace />;
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6 pb-24">
      <header className="flex items-center gap-4">
        <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-[rgba(59,130,246,0.15)] bg-white/[0.02] backdrop-blur-[40px]">
          <KeyRound className="h-5 w-5 text-[#60A5FA]" />
        </div>
        <div>
          <div className="text-[11px] font-medium uppercase tracking-[0.1em] text-[#94A3B8]">
            Configuracoes
          </div>
          <h1 className="text-2xl font-semibold text-[#F8FAFC]">Credenciais de aplicacao</h1>
          <p className="text-sm text-[#94A3B8]">
            Edite as chaves de API usadas pela ferramenta. Alteracoes entram em vigor sem redeploy.
          </p>
        </div>
      </header>

      {zernio ? (
        <div className="rounded-xl border border-[rgba(59,130,246,0.15)] bg-white/[0.02] p-5 backdrop-blur-[40px]">
          <div className="flex items-start gap-4">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-[rgba(59,130,246,0.15)] bg-white/[0.02]">
              <Smartphone className="h-5 w-5 text-[#60A5FA]" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-medium uppercase tracking-[0.1em] text-[#94A3B8]">
                  WhatsApp via Zernio
                </span>
                <span
                  className={[
                    'rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.05em]',
                    zernio.connected
                      ? 'bg-[rgba(16,185,129,0.12)] text-[#10B981]'
                      : 'bg-[rgba(239,68,68,0.12)] text-[#EF4444]',
                  ].join(' ')}
                >
                  {zernio.connected ? 'Conectado' : 'Nao conectado'}
                </span>
              </div>
              {zernio.connected && zernio.number ? (
                <>
                  <div className="mt-1 text-lg font-semibold text-[#F8FAFC]">
                    {zernio.number.display_phone_number ?? '—'}
                    {zernio.number.verified_name ? (
                      <span className="ml-2 text-sm font-normal text-[#94A3B8]">
                        {zernio.number.verified_name}
                      </span>
                    ) : null}
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {[
                      ['Tier', zernio.number.messaging_limit_tier],
                      ['Qualidade', zernio.number.quality_rating],
                      ['Saude', zernio.number.health_status],
                    ]
                      .filter(([, value]) => value && String(value).toUpperCase() !== 'UNKNOWN')
                      .map(([label, value]) => (
                        <span
                          key={label}
                          className="rounded-full border border-[rgba(59,130,246,0.2)] bg-white/[0.02] px-3 py-1 text-[11px] text-[#CBD5E1]"
                        >
                          {label}: <span className="font-mono text-[#F8FAFC]">{value}</span>
                        </span>
                      ))}
                  </div>
                </>
              ) : (
                <p className="mt-1 text-sm text-[#94A3B8]">
                  Salve a Zernio API Key para resolver o numero conectado e o tier.
                </p>
              )}
              {zernio.webhook_url ? (
                <div className="mt-3 space-y-2">
                  <button
                    onClick={() => {
                        fetch('/api/zernio-connect/sync-history', {
                            method: 'POST',
                            headers: { Authorization: `Bearer ${session?.access_token ?? ''}` }
                        }).then(() => toast.success('Sincronização iniciada!'));
                    }}
                    className="mb-2 text-[10px] uppercase tracking-wide text-[var(--accent-primary)] underline"
                  >
                    Sincronizar Histórico Antigo
                  </button>
                  <div className="text-[11px] uppercase tracking-wide text-[var(--color-text-secondary)]">
                    Webhook para receber mensagens (cadastre no Zernio)
                  </div>
                  <div className="flex items-start gap-2">
                    <code className="min-w-0 flex-1 break-all rounded-lg border border-[rgba(59,130,246,0.2)] bg-white/[0.03] px-3 py-2 text-xs text-[var(--color-text-primary)]">
                      {zernio.webhook_url}
                    </code>
                    <button
                      onClick={() => {
                        void navigator.clipboard
                          .writeText(zernio.webhook_url ?? '')
                          .then(() => toast.success('URL do webhook copiada.'))
                          .catch(() => toast.error('Não foi possível copiar — copie manualmente.'));
                      }}
                      aria-label="Copiar URL do webhook"
                      className="rounded-lg border border-[rgba(59,130,246,0.2)] bg-white/[0.03] p-2 text-[var(--color-text-secondary)] transition hover:border-[var(--accent-primary)] hover:text-[var(--color-text-primary)]"
                    >
                      <Copy className="h-4 w-4" />
                    </button>
                  </div>
                  <p className="text-[11px] leading-4 text-[var(--color-text-secondary)]">
                    Ao salvar a Zernio API Key, o webhook é registrado automaticamente. Use esta URL
                    caso precise cadastrá-la manualmente no painel do Zernio.
                  </p>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      {/* Saúde das conexões (movidas da antiga aba Canais) */}
      <UazapiCard refreshKey={uazapiRefresh} />
      <InstagramCard />

      <div className="space-y-4">
        {mainFields.map((field) => (
          <CredentialField
            key={`${field.key}:${exists[field.key]?.exists ? 'set' : 'empty'}`}
            field={field}
            initialHasValue={Boolean(exists[field.key]?.exists)}
            onChange={onChange}
            onValidationChange={(key, ok) => setValid((prev) => ({ ...prev, [key]: ok }))}
          />
        ))}
      </div>

      <div className="rounded-xl border border-[rgba(59,130,246,0.12)] bg-white/[0.02]">
        <button
          type="button"
          onClick={() => setAdvancedOpen((v) => !v)}
          className="flex w-full items-center justify-between px-5 py-4 text-left"
        >
          <div>
            <div className="text-sm font-semibold text-[#F8FAFC]">Configurações Avançadas</div>
            <div className="text-[13px] text-[#94A3B8]">
              Provider de LLM e chave alternativa. Sem isso, a IA usa OpenAI por padrão.
            </div>
          </div>
          <ChevronDown
            className={`h-5 w-5 shrink-0 text-[#94A3B8] transition-transform ${advancedOpen ? 'rotate-180' : ''}`}
          />
        </button>
        {advancedOpen && (
          <div className="space-y-4 border-t border-[rgba(59,130,246,0.1)] p-5">
            {/* Modo de Demonstração */}
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[rgba(59,130,246,0.12)] bg-white/[0.02] p-4">
              <div className="min-w-0">
                <div className="text-sm font-semibold text-[#F8FAFC]">Modo de Demonstração</div>
                <p className="text-[13px] text-[#94A3B8]">
                  Esse modo ativa a exibição de dados fictícios na plataforma apenas para demonstração visual.
                </p>
              </div>
              <button
                type="button"
                onClick={() => void toggleDemoMode()}
                disabled={demoMode === null}
                className={[
                  'rounded-lg px-4 py-2 text-sm font-semibold transition disabled:opacity-50',
                  demoMode
                    ? 'bg-gradient-to-br from-[#1E3A8A] to-[#3B82F6] text-white'
                    : 'border border-[rgba(59,130,246,0.25)] text-[#94A3B8] hover:border-[#3B82F6] hover:text-[#F8FAFC]',
                ].join(' ')}
              >
                {demoMode === null ? '…' : demoMode ? 'Ativado' : 'Desativado'}
              </button>
            </div>
            {advancedFields.map((field) => (
              <CredentialField
                key={`${field.key}:${exists[field.key]?.exists ? 'set' : 'empty'}`}
                field={field}
                initialHasValue={Boolean(exists[field.key]?.exists)}
                onChange={onChange}
                onValidationChange={(key, ok) => setValid((prev) => ({ ...prev, [key]: ok }))}
              />
            ))}
          </div>
        )}
      </div>

      <div className="fixed inset-x-0 bottom-0 border-t border-[rgba(59,130,246,0.15)] bg-[#0A0A0F]/90 px-4 py-4 backdrop-blur-xl">
        <div className="mx-auto flex max-w-6xl justify-end">
          <button
            type="button"
            disabled={!canSave || saving}
            onClick={save}
            className="min-h-12 w-full rounded-xl bg-[linear-gradient(135deg,#1E3A8A_0%,#3B82F6_100%)] px-8 py-4 text-base font-medium text-white shadow-[0_8px_40px_rgba(59,130,246,0.4),0_0_60px_rgba(59,130,246,0.2)] transition-[box-shadow,opacity] duration-[400ms] ease-[cubic-bezier(0.4,0,0.2,1)] hover:shadow-[0_8px_50px_rgba(59,130,246,0.6),0_0_80px_rgba(59,130,246,0.3)] disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none sm:w-auto"
          >
            {saving ? 'Salvando...' : 'Salvar alteracoes'}
          </button>
        </div>
      </div>
    </div>
  );
}
