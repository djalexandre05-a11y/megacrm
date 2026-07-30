import { useMemo, useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { Plus, Timer, Trash2, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog } from '@/components/ui/dialog';
import { useFollowUpRules } from '@/hooks/useFollowUpRules';
import { useTemplates } from '@/hooks/useTemplates';
import { useCampaigns } from '@/hooks/useCampaigns';
import type { FollowUpRule } from '@/types/campaigns';
import { LoadErrorBanner } from '@/components/LoadErrorBanner';

export default function FollowUpsPage() {
  const { rules, loading, error, reload, create, update, remove } = useFollowUpRules();
  const { templates } = useTemplates();
  const { campaigns } = useCampaigns();
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<FollowUpRule | null>(null);

  const approvedTemplates = useMemo(
    () => templates.filter((t) => t.status === 'approved'),
    [templates],
  );

  const templateName = (id: string) => templates.find((t) => t.id === id)?.name ?? '—';
  const campaignName = (id: string | null) =>
    id ? (campaigns.find((c) => c.id === id)?.name ?? '—') : 'Global (todas)';

  const handleDelete = async (rule: FollowUpRule) => {
    if (!confirm(`Remover regra (sequência ${rule.sequence_order})?`)) return;
    try {
      await remove(rule.id);
      toast.success('Regra removida.');
    } catch (err) {
      toast.error('Falha ao remover regra', {
        description: err instanceof Error ? err.message : String(err),
      });
    }
  };

  const handleToggleActive = async (rule: FollowUpRule) => {
    try {
      await update(rule.id, { is_active: !rule.is_active });
    } catch (err) {
      toast.error('Falha ao atualizar regra', {
        description: err instanceof Error ? err.message : String(err),
      });
    }
  };

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div className="flex items-center gap-4">
          <div className="h-12 w-12 rounded-xl glass-card flex items-center justify-center">
            <Timer className="h-5 w-5 text-[var(--accent-primary)]" />
          </div>
          <div>
            <div className="text-label">Seção</div>
            <h1 className="text-2xl font-bold text-display">Follow-ups</h1>
            <p className="text-sm text-[var(--color-text-secondary)]">
              Regras disparadas automaticamente quando o contato não responde
            </p>
          </div>
        </div>
        <Button
          onClick={() => {
            setEditing(null);
            setShowForm(true);
          }}
        >
          <Plus className="h-4 w-4" />
          Nova regra
        </Button>
      </div>

      {error && <LoadErrorBanner message={error} onRetry={() => void reload()} />}

      <div className="glass-card p-4">
        <div className="rounded-lg border border-[rgba(59,130,246,0.08)] overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="bg-white/[0.02] text-left">
                <th className="p-3 text-label">Seq</th>
                <th className="p-3 text-label">Escopo</th>
                <th className="p-3 text-label">Delay</th>
                <th className="p-3 text-label">Template</th>
                <th className="p-3 text-label">Ativa</th>
                <th className="p-3 w-40 text-right" />
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={6} className="p-6 text-center opacity-60">Carregando...</td></tr>
              ) : rules.length === 0 ? (
                <tr>
                  <td colSpan={6} className="p-6 text-center text-[var(--color-text-secondary)] opacity-60">
                    Nenhuma regra criada.
                  </td>
                </tr>
              ) : (
                rules.map((r) => (
                  <tr key={r.id} className="border-t border-[rgba(59,130,246,0.06)]">
                    <td className="p-3 font-mono">#{r.sequence_order}</td>
                    <td className="p-3 text-[var(--color-text-primary)]">
                      {campaignName(r.campaign_id)}
                    </td>
                    <td className="p-3 text-[var(--color-text-secondary)]">
                      {r.delay_hours}h após envio
                    </td>
                    <td className="p-3 font-mono text-[var(--color-text-secondary)]">
                      {templateName(r.template_id)}
                    </td>
                    <td className="p-3">
                      <button
                        onClick={() => handleToggleActive(r)}
                        className={
                          r.is_active
                            ? 'inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold bg-[rgba(16,185,129,0.12)] text-[var(--color-success)]'
                            : 'inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold bg-white/5 text-[var(--color-text-secondary)]'
                        }
                      >
                        {r.is_active ? 'Ativa' : 'Inativa'}
                      </button>
                    </td>
                    <td className="p-3 text-right space-x-1">
                      <Button size="sm" variant="ghost" onClick={() => { setEditing(r); setShowForm(true); }}>
                        Editar
                      </Button>
                      <Button size="icon" variant="ghost" onClick={() => handleDelete(r)}>
                        <Trash2 className="h-4 w-4 text-[var(--color-error)]" />
                      </Button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <FollowUpForm
        open={showForm}
        rule={editing}
        templates={approvedTemplates}
        campaigns={campaigns.map((c) => ({ id: c.id, name: c.name }))}
        onClose={() => setShowForm(false)}
        onSubmit={async (input) => {
          if (editing) await update(editing.id, input);
          else await create({ ...input, trigger_condition: 'no_reply' });
        }}
      />
    </div>
  );
}

function FollowUpForm({
  open,
  rule,
  templates,
  campaigns,
  onClose,
  onSubmit,
}: {
  open: boolean;
  rule: FollowUpRule | null;
  templates: Array<{ id: string; name: string }>;
  campaigns: Array<{ id: string; name: string }>;
  onClose: () => void;
  onSubmit: (input: {
    campaign_id: string | null;
    template_id: string;
    delay_hours: number;
    sequence_order: number;
    is_active: boolean;
  }) => Promise<void>;
}) {
  const [campaignId, setCampaignId] = useState<string>('');
  const [templateId, setTemplateId] = useState<string>('');
  const [delayHours, setDelayHours] = useState(24);
  const [sequence, setSequence] = useState(1);
  const [isActive, setIsActive] = useState(true);
  const [saving, setSaving] = useState(false);

  // Reset form fields on open / on edit target change.
  useMemo(() => {
    if (!open) return;
    setCampaignId(rule?.campaign_id ?? '');
    setTemplateId(rule?.template_id ?? '');
    setDelayHours(rule?.delay_hours ?? 24);
    setSequence(rule?.sequence_order ?? 1);
    setIsActive(rule?.is_active ?? true);
    return null;
  }, [open, rule]);

  const handle = async (e: FormEvent) => {
    e.preventDefault();
    if (!templateId) {
      toast.error('Selecione um template aprovado.');
      return;
    }
    setSaving(true);
    try {
      await onSubmit({
        campaign_id: campaignId || null,
        template_id: templateId,
        delay_hours: Number(delayHours),
        sequence_order: Number(sequence),
        is_active: isActive,
      });
      toast.success(rule ? 'Regra atualizada.' : 'Regra criada.');
      onClose();
    } catch (err) {
      toast.error('Falha ao salvar', {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} title={rule ? 'Editar regra' : 'Nova regra de follow-up'}>
      <form onSubmit={handle} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="fu_scope">Escopo</Label>
          <select
            id="fu_scope"
            value={campaignId}
            onChange={(e) => setCampaignId(e.target.value)}
            disabled={saving}
            className="h-11 w-full rounded-lg border border-[rgba(59,130,246,0.2)] bg-white/[0.03] px-3 text-sm text-[var(--color-text-primary)]"
          >
            <option value="">Global — aplicar em todas as campanhas</option>
            {campaigns.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2">
            <Label htmlFor="fu_seq">Sequência</Label>
            <Input
              id="fu_seq"
              type="number"
              min={1}
              value={sequence}
              onChange={(e) => setSequence(Number(e.target.value))}
              disabled={saving}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="fu_delay">Delay (horas)</Label>
            <Input
              id="fu_delay"
              type="number"
              min={1}
              value={delayHours}
              onChange={(e) => setDelayHours(Number(e.target.value))}
              disabled={saving}
            />
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="fu_tpl">Template de follow-up</Label>
          <select
            id="fu_tpl"
            value={templateId}
            onChange={(e) => setTemplateId(e.target.value)}
            disabled={saving}
            className="h-11 w-full rounded-lg border border-[rgba(59,130,246,0.2)] bg-white/[0.03] px-3 text-sm text-[var(--color-text-primary)]"
          >
            <option value="">— selecione um template aprovado —</option>
            {templates.map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
        </div>

        <label className="flex items-center gap-3">
          <input
            type="checkbox"
            checked={isActive}
            onChange={(e) => setIsActive(e.target.checked)}
            className="accent-[var(--accent-primary)] h-4 w-4"
          />
          <span className="text-sm">Ativa — enfileirar automaticamente</span>
        </label>

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="ghost" onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          <Button type="submit" disabled={saving}>
            {saving ? (
              <><Loader2 className="h-4 w-4 animate-spin" /> Salvando...</>
            ) : rule ? (
              'Salvar alterações'
            ) : (
              'Criar regra'
            )}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
