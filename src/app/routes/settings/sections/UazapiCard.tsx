import { useCallback, useEffect, useState } from 'react';
import { Copy, Loader2, Smartphone } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/app/providers/AuthProvider';

type UazapiStatus = {
  configured: boolean;
  connected?: boolean;
  logged_in?: boolean;
  instance_name?: string | null;
  webhook_url?: string | null;
  error?: string;
};

// Card de saúde da conexão Uazapi (API não-oficial). O status vem de
// GET /instance/status via /api/uazapi-status (token nunca no browser).
// Inclui a URL do webhook a cadastrar na Uazapi + registro automático.
// `refreshKey` força re-fetch quando as credenciais Uazapi mudam abaixo.
export function UazapiCard({ refreshKey = 0 }: { refreshKey?: number }) {
  const { session } = useAuth();
  const [status, setStatus] = useState<UazapiStatus | null>(null);
  const [registering, setRegistering] = useState(false);

  const load = useCallback(async () => {
    if (!session) return;
    try {
      const res = await fetch('/api/uazapi-status', {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      const body = (await res.json()) as UazapiStatus & { success?: boolean };
      if (res.ok) setStatus(body);
    } catch {
      // status é informativo
    }
  }, [session]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  const registerWebhook = async () => {
    setRegistering(true);
    try {
      const res = await fetch('/api/uazapi-status', {
        method: 'POST',
        headers: { Authorization: `Bearer ${session?.access_token ?? ''}` },
      });
      const body = await res.json();
      if (!res.ok || !body.success) throw new Error(body.message ?? 'Falha ao registrar.');
      toast.success('Webhook registrado na Uazapi.');
    } catch (err) {
      toast.error('Falha ao registrar o webhook', {
        description: err instanceof Error ? err.message : 'Erro interno',
      });
    } finally {
      setRegistering(false);
    }
  };

  const copyHook = async () => {
    if (!status?.webhook_url) return;
    try {
      await navigator.clipboard.writeText(status.webhook_url);
      toast.success('URL do webhook copiada.');
    } catch {
      toast.error('Não foi possível copiar — copie manualmente.');
    }
  };

  return (
    <div className="rounded-xl border border-[rgba(59,130,246,0.15)] bg-white/[0.02] p-5 backdrop-blur-[40px]">
      <div className="flex items-start gap-4">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-[rgba(245,158,11,0.25)] bg-[rgba(245,158,11,0.08)]">
          <Smartphone className="h-5 w-5 text-[#F59E0B]" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-medium uppercase tracking-[0.1em] text-[#94A3B8]">
              WhatsApp via Uazapi
            </span>
            {status === null ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin text-[var(--color-text-secondary)]" />
            ) : !status.configured ? (
              <span className="rounded-full bg-[rgba(148,163,184,0.12)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.05em] text-[var(--color-text-secondary)]">
                Não configurado
              </span>
            ) : (
              <span
                className={[
                  'rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.05em]',
                  status.connected
                    ? 'bg-[rgba(16,185,129,0.12)] text-[#10B981]'
                    : 'bg-[rgba(239,68,68,0.12)] text-[#EF4444]',
                ].join(' ')}
              >
                {status.connected ? 'Conectado' : 'Não conectado'}
              </span>
            )}
          </div>

          {status?.configured ? (
            <>
              {status.instance_name ? (
                <div className="mt-1 text-lg font-semibold text-[#F8FAFC]">{status.instance_name}</div>
              ) : null}
              {status.error ? (
                <p className="mt-1 text-sm text-[#EF4444]">{status.error}</p>
              ) : null}
              {status.webhook_url ? (
                <div className="mt-3 space-y-2">
                  <div className="text-[11px] uppercase tracking-wide text-[var(--color-text-secondary)]">
                    Webhook para receber mensagens (cadastre na Uazapi)
                  </div>
                  <div className="flex items-start gap-2">
                    <code className="min-w-0 flex-1 break-all rounded-lg border border-[rgba(59,130,246,0.2)] bg-white/[0.03] px-3 py-2 text-xs text-[var(--color-text-primary)]">
                      {status.webhook_url}
                    </code>
                    <button
                      onClick={copyHook}
                      aria-label="Copiar URL do webhook"
                      className="rounded-lg border border-[rgba(59,130,246,0.2)] bg-white/[0.03] p-2 text-[var(--color-text-secondary)] transition hover:border-[var(--accent-primary)] hover:text-[var(--color-text-primary)]"
                    >
                      <Copy className="h-4 w-4" />
                    </button>
                  </div>
                  <button
                    onClick={registerWebhook}
                    disabled={registering}
                    className="rounded-lg bg-gradient-to-br from-[#1E3A8A] to-[#3B82F6] px-4 py-2 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
                  >
                    {registering ? 'Registrando…' : 'Registrar webhook automaticamente'}
                  </button>
                </div>
              ) : null}
            </>
          ) : status !== null ? (
            <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
              Preencha a Uazapi Server URL e o Instance Token nos campos abaixo para ativar.
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
