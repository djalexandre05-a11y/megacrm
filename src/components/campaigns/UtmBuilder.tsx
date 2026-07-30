import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { ChevronDown, Copy, Loader2, Save, ShieldCheck, Trash2 } from 'lucide-react';
import { getSupabaseCredentials } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useUtmLinks, type UtmLink, type UtmDestinationType } from '@/hooks/useUtmLinks';
import { buildUtmUrl, buildRedirectorUrl, UTM_PRESETS } from '@/lib/utm';
import { LoadErrorBanner } from '@/components/LoadErrorBanner';

async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

// Exemplo mostrado no passo 2 do snippet — o único ajuste é o data-ah-form na tag <form>.
const FORM_EXAMPLE = `<form data-ah-form>
  <input name="nome" placeholder="Seu nome" />
  <input name="telefone" placeholder="Seu WhatsApp" />
  <input name="email" placeholder="Seu e-mail" />
  <button type="submit">Enviar</button>
</form>`;

const DESTINATIONS: { value: UtmDestinationType; label: string; hint: string }[] = [
  { value: 'landing', label: 'Landing page', hint: 'Site com o snippet do CRM' },
  { value: 'whatsapp', label: 'WhatsApp', hint: 'wa.me com código de rastreio' },
  { value: 'instagram', label: 'Instagram', hint: 'Perfil / link da bio' },
  { value: 'other', label: 'Outro', hint: 'Qualquer URL' },
];

export function UtmBuilder() {
  const { links, loading, error, reload, create, remove } = useUtmLinks();
  const [destination, setDestination] = useState<UtmDestinationType>('landing');
  const [baseUrl, setBaseUrl] = useState('');
  const [waNumber, setWaNumber] = useState('');
  const [waMessage, setWaMessage] = useState('');
  const [source, setSource] = useState('');
  const [medium, setMedium] = useState('');
  const [campaign, setCampaign] = useState('');
  const [content, setContent] = useState('');
  const [term, setTerm] = useState('');
  const [label, setLabel] = useState('');
  const [saving, setSaving] = useState(false);
  const [lastLink, setLastLink] = useState<UtmLink | null>(null);
  const [snippetOpen, setSnippetOpen] = useState(false);

  // Snippet que a landing precisa ter para o form virar lead no CRM.
  const supabaseBase = (getSupabaseCredentials()?.url ?? '').replace(/\/$/, '');
  const snippetTag = supabaseBase
    ? `<script src="${window.location.origin}/ah-tracker.js"\n  data-endpoint="${supabaseBase}/functions/v1/ingest-lead"\n  data-auto></script>`
    : '';

  const isWhatsApp = destination === 'whatsapp';
  const baseLabel =
    destination === 'landing'
      ? 'URL da landing *'
      : destination === 'instagram'
        ? 'URL do perfil / bio *'
        : 'URL de destino *';

  // Preview do destino real (o que o clique acessa depois do redirecionador).
  // NUNCA incluir placeholder de código aqui: esta URL é copiável e já foi
  // parar em anúncio com "[CÓDIGO]" literal — o código real é gerado a cada
  // clique pelo redirecionador e anexado automaticamente ao texto.
  const destinationUrl = useMemo(() => {
    if (isWhatsApp) {
      const digits = waNumber.replace(/\D/g, '');
      if (!digits) return '';
      const text = waMessage.trim();
      return `https://wa.me/${digits}${text ? `?text=${encodeURIComponent(text)}` : ''}`;
    }
    return buildUtmUrl(baseUrl, {
      utm_source: source,
      utm_medium: medium,
      utm_campaign: campaign,
      utm_content: content,
      utm_term: term,
    });
  }, [isWhatsApp, waNumber, waMessage, baseUrl, source, medium, campaign, content, term]);

  const canGenerate =
    source.trim() !== '' &&
    medium.trim() !== '' &&
    (isWhatsApp ? waNumber.replace(/\D/g, '') !== '' : baseUrl.trim() !== '');

  const applyPreset = (p: (typeof UTM_PRESETS)[number]) => {
    setSource(p.source);
    setMedium(p.medium);
  };

  const handleCopy = async (text: string) => {
    const ok = await copyToClipboard(text);
    if (ok) toast.success('Link copiado.');
    else toast.error('Não foi possível copiar — copie manualmente.');
  };

  const handleGenerate = async () => {
    if (!canGenerate) return;
    setSaving(true);
    try {
      const digits = waNumber.replace(/\D/g, '');
      const resolvedBase = isWhatsApp ? `https://wa.me/${digits}` : baseUrl.trim();
      const row = await create({
        base_url: resolvedBase,
        utm_source: source.trim() || null,
        utm_medium: medium.trim() || null,
        utm_campaign: campaign.trim() || null,
        utm_content: content.trim() || null,
        utm_term: term.trim() || null,
        final_url: destinationUrl,
        label: label.trim() || null,
        destination_type: destination,
        wa_number: isWhatsApp ? digits : null,
        wa_message: isWhatsApp ? waMessage.trim() || null : null,
      });
      if (row) setLastLink(row);
      toast.success('Link rastreável gerado.');
      setLabel('');
    } catch (err) {
      toast.error('Falha ao gerar', { description: err instanceof Error ? err.message : String(err) });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (l: UtmLink) => {
    if (!confirm('Remover este link do histórico?')) return;
    try {
      await remove(l.id);
      if (lastLink?.id === l.id) setLastLink(null);
    } catch (err) {
      toast.error('Falha ao remover', { description: err instanceof Error ? err.message : String(err) });
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start gap-2">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-[var(--accent-primary)]" />
        <p className="text-sm text-[var(--color-text-secondary)]">
          Todo link nasce <strong className="text-[var(--color-text-primary)]">blindado</strong>: o clique passa por
          um redirecionador invisível que registra a origem antes de chegar ao destino — funciona mesmo no salto para
          o WhatsApp ou Instagram, onde a UTM na URL se perde.
        </p>
      </div>

      {/* Destino */}
      <div className="space-y-2">
        <div className="text-label">Destino do link</div>
        <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
          {DESTINATIONS.map((d) => (
            <button
              key={d.value}
              type="button"
              onClick={() => setDestination(d.value)}
              className={
                'rounded-xl border px-3 py-2 text-left transition-all duration-300 ' +
                (destination === d.value
                  ? 'border-[var(--accent-primary)] bg-[rgba(59,130,246,0.12)]'
                  : 'border-[rgba(59,130,246,0.15)] hover:border-[rgba(59,130,246,0.35)]')
              }
            >
              <div className="text-sm font-semibold text-[var(--color-text-primary)]">{d.label}</div>
              <div className="text-[10px] text-[var(--color-text-secondary)]">{d.hint}</div>
            </button>
          ))}
        </div>
      </div>

      {/* Presets */}
      <div className="space-y-2">
        <div className="text-label">Presets por canal</div>
        <div className="flex flex-wrap gap-1.5">
          {UTM_PRESETS.map((p) => (
            <button
              key={p.label}
              type="button"
              onClick={() => applyPreset(p)}
              className={
                'rounded-full px-3 py-1 text-xs font-semibold border transition-colors ' +
                (source === p.source && medium === p.medium
                  ? 'border-[var(--accent-primary)] bg-[rgba(59,130,246,0.15)] text-[var(--color-text-primary)]'
                  : 'border-[rgba(59,130,246,0.15)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:border-[rgba(59,130,246,0.35)]')
              }
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* Form */}
      <div className="glass-card p-5 space-y-4">
        {isWhatsApp ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="wa_number">Número do WhatsApp *</Label>
              <Input
                id="wa_number"
                value={waNumber}
                onChange={(e) => setWaNumber(e.target.value)}
                placeholder="+55 11 98888-7777"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="wa_message">Mensagem pré-preenchida</Label>
              <Input
                id="wa_message"
                value={waMessage}
                onChange={(e) => setWaMessage(e.target.value)}
                placeholder="Quero saber do desafio"
              />
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            <Label htmlFor="utm_base">{baseLabel}</Label>
            <Input
              id="utm_base"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="https://seusite.com/landing"
            />
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="utm_source">utm_source *</Label>
            <Input id="utm_source" value={source} onChange={(e) => setSource(e.target.value)} placeholder="instagram" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="utm_medium">utm_medium *</Label>
            <Input id="utm_medium" value={medium} onChange={(e) => setMedium(e.target.value)} placeholder="paid_social" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="utm_campaign">utm_campaign</Label>
            <Input id="utm_campaign" value={campaign} onChange={(e) => setCampaign(e.target.value)} placeholder="lancamento_julho" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="utm_content">utm_content (anúncio/criativo)</Label>
            <Input id="utm_content" value={content} onChange={(e) => setContent(e.target.value)} placeholder="video_a" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="utm_term">utm_term</Label>
            <Input id="utm_term" value={term} onChange={(e) => setTerm(e.target.value)} placeholder="palavra-chave" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="utm_label">Rótulo (opcional)</Label>
            <Input id="utm_label" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Story CTA julho" />
          </div>
        </div>

        {/* Preview do destino real */}
        <div className="space-y-2">
          <Label>Destino final (após o rastreio)</Label>
          <div className="rounded-lg border border-[rgba(59,130,246,0.2)] bg-white/[0.03] px-3 py-2 text-xs font-mono text-[var(--color-text-secondary)] break-all min-h-[40px]">
            {destinationUrl || <span className="opacity-40">Preencha os campos obrigatórios…</span>}
          </div>
          {isWhatsApp && destinationUrl ? (
            <p className="text-xs text-[var(--color-text-secondary)] opacity-70">
              O código de rastreio (ex.: <code>[A7X9]</code>) é gerado a cada clique e anexado
              automaticamente ao texto — não copie esta URL para anúncios; use o link rastreável.
            </p>
          ) : null}
        </div>

        <div className="flex justify-end">
          <Button type="button" onClick={handleGenerate} disabled={!canGenerate || saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Gerar link rastreável
          </Button>
        </div>
      </div>

      {/* Instruções do snippet — só faz sentido para destino landing */}
      {destination === 'landing' && snippetTag ? (
        <div className="glass-card">
          <button
            type="button"
            onClick={() => setSnippetOpen((v) => !v)}
            className="flex w-full items-center justify-between px-5 py-4 text-left"
          >
            <div>
              <div className="text-sm font-semibold text-[var(--color-text-primary)]">
                Como registrar os leads da landing (snippet)
              </div>
              <div className="text-[13px] text-[var(--color-text-secondary)]">
                Sem este código na landing, o clique é rastreado mas o formulário não vira lead no CRM.
              </div>
            </div>
            <ChevronDown
              className={`h-5 w-5 shrink-0 text-[var(--color-text-secondary)] transition-transform ${snippetOpen ? 'rotate-180' : ''}`}
            />
          </button>
          {snippetOpen ? (
            <div className="space-y-3 border-t border-[rgba(59,130,246,0.1)] p-5">
              <p className="text-sm text-[var(--color-text-secondary)]">
                <strong className="text-[var(--color-text-primary)]">1.</strong> Cole o código abaixo no{' '}
                <code className="text-[var(--accent-secondary)]">&lt;head&gt;</code> da sua landing page
                (funciona também antes de fechar o <code className="text-[var(--accent-secondary)]">&lt;/body&gt;</code>).
              </p>
              <div className="flex items-start gap-2">
                <pre className="min-w-0 flex-1 overflow-x-auto rounded-lg border border-[rgba(59,130,246,0.2)] bg-white/[0.03] px-3 py-2 text-xs text-[var(--color-text-primary)]">
                  {snippetTag}
                </pre>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={() => handleCopy(snippetTag)}
                  aria-label="Copiar snippet"
                >
                  <Copy className="h-4 w-4" />
                </Button>
              </div>
              <p className="text-sm text-[var(--color-text-secondary)]">
                <strong className="text-[var(--color-text-primary)]">2.</strong> Marque o formulário da sua
                landing com o atributo <code className="text-[var(--accent-secondary)]">data-ah-form</code>.
                É só acrescentar essa palavra dentro da tag{' '}
                <code className="text-[var(--accent-secondary)]">&lt;form&gt;</code> — nada mais muda no
                formulário. Exemplo:
              </p>
              <div className="flex items-start gap-2">
                <pre className="min-w-0 flex-1 overflow-x-auto rounded-lg border border-[rgba(59,130,246,0.2)] bg-white/[0.03] px-3 py-2 text-xs text-[var(--color-text-primary)]">
                  {FORM_EXAMPLE}
                </pre>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={() => handleCopy(FORM_EXAMPLE)}
                  aria-label="Copiar exemplo de formulário"
                >
                  <Copy className="h-4 w-4" />
                </Button>
              </div>
              <p className="text-sm text-[var(--color-text-secondary)]">
                Quando alguém enviar esse formulário, o lead entra no CRM já com a origem (UTMs) capturada.
                Os dados são lidos pelo <code className="text-[var(--accent-secondary)]">name</code> dos campos —
                funcionam automaticamente: <code>nome</code>, <code>name</code> ou <code>full_name</code> (nome);{' '}
                <code>telefone</code>, <code>phone</code>, <code>whatsapp</code> ou <code>tel</code> (telefone);{' '}
                <code>email</code> ou <code>e-mail</code> (e-mail). Se o seu campo tiver outro name, adicione{' '}
                <code className="text-[var(--accent-secondary)]">data-ah-field=&quot;nome&quot;</code> (ou{' '}
                <code>&quot;telefone&quot;</code>/<code>&quot;email&quot;</code>) direto no input.
              </p>
            </div>
          ) : null}
        </div>
      ) : null}

      {/* Link blindado recém-gerado */}
      {lastLink?.slug && (
        <div className="glass-card p-5 space-y-2">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-[var(--color-success)]" />
            <span className="text-sm font-semibold text-[var(--color-text-primary)]">Seu link rastreável</span>
          </div>
          <p className="text-xs text-[var(--color-text-secondary)]">
            Use este link nos anúncios e na bio. É ele que registra a origem de cada lead.
          </p>
          <div className="flex items-start gap-2">
            <div className="flex-1 min-w-0 rounded-lg border border-[rgba(59,130,246,0.25)] bg-white/[0.03] px-3 py-2 text-xs font-mono text-[var(--color-text-primary)] break-all">
              {buildRedirectorUrl(lastLink.slug)}
            </div>
            <Button
              type="button"
              size="icon"
              onClick={() => handleCopy(buildRedirectorUrl(lastLink.slug!))}
              aria-label="Copiar link rastreável"
            >
              <Copy className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      {/* Histórico */}
      <div className="space-y-2">
        <div className="text-label">Histórico de links</div>
        {error && <LoadErrorBanner message={error} onRetry={() => void reload()} />}
        <div className="glass-card p-4">
          {loading ? (
            <div className="py-8 text-center text-label opacity-60">Carregando...</div>
          ) : links.length === 0 ? (
            <div className="py-8 text-center text-sm text-[var(--color-text-secondary)] opacity-60">
              Nenhum link gerado ainda.
            </div>
          ) : (
            <div className="space-y-2">
              {links.map((l) => {
                const redirector = l.slug ? buildRedirectorUrl(l.slug) : l.final_url;
                return (
                  <div
                    key={l.id}
                    className="flex items-start gap-3 rounded-lg border border-[rgba(59,130,246,0.08)] bg-white/[0.02] p-3"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="rounded-full border border-[rgba(59,130,246,0.25)] bg-[rgba(59,130,246,0.1)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--accent-secondary)]">
                          {l.destination_type}
                        </span>
                        {l.label && (
                          <span className="text-sm font-semibold text-[var(--color-text-primary)]">{l.label}</span>
                        )}
                        {l.utm_campaign && (
                          <span className="rounded-full bg-white/5 px-2 py-0.5 text-[10px] text-[var(--color-text-secondary)]">
                            {l.utm_campaign}
                          </span>
                        )}
                      </div>
                      <div className="mt-1 text-xs font-mono text-[var(--accent-secondary)] break-all">{redirector}</div>
                      <div className="mt-0.5 text-[10px] font-mono text-[var(--color-text-secondary)] break-all opacity-70">
                        → {l.final_url}
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <Button size="icon" variant="ghost" onClick={() => handleCopy(redirector)} aria-label="Copiar">
                        <Copy className="h-4 w-4" />
                      </Button>
                      <Button size="icon" variant="ghost" onClick={() => handleDelete(l)} aria-label="Remover">
                        <Trash2 className="h-4 w-4 text-[var(--color-error)]" />
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
