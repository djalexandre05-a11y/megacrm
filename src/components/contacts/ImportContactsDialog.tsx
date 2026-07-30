import { useEffect, useMemo, useState, type ChangeEvent } from 'react';
import { toast } from 'sonner';
import * as XLSX from 'xlsx';
import { CheckCircle2, FileUp, Loader2, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { getSupabase } from '@/lib/supabase';
import { useAppUser } from '@/app/providers/AppUserProvider';
import { normalizePhone } from '@/lib/phone';

type FieldMapping =
  | { kind: 'skip' }
  | { kind: 'phone' }
  | { kind: 'name' }
  | { kind: 'email' }
  | { kind: 'custom'; name: string };

interface ImportContactsDialogProps {
  open: boolean;
  onClose: () => void;
  onDone?: () => void;
}

interface ImportReport {
  totalRows: number;
  imported: number;
  invalid: number;
  duplicates: number;
  errors: { row: number; reason: string }[];
}

const CHUNK_SIZE = 500;

function readFile(file: File): Promise<string[][]> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = new Uint8Array(reader.result as ArrayBuffer);
        const wb = XLSX.read(data, { type: 'array' });
        const firstSheet = wb.SheetNames[0];
        const ws = wb.Sheets[firstSheet];
        const rows = XLSX.utils.sheet_to_json<string[]>(ws, {
          header: 1,
          raw: false,
          defval: '',
        });
        resolve(rows.map((r) => r.map((c) => (c == null ? '' : String(c).trim()))));
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(file);
  });
}

function guessInitialMapping(headers: string[]): FieldMapping[] {
  return headers.map((h) => {
    const low = h.toLowerCase();
    if (/(phone|telefone|celular|whats)/.test(low)) return { kind: 'phone' };
    if (/(name|nome)/.test(low)) return { kind: 'name' };
    if (/(email|e-mail|mail)/.test(low)) return { kind: 'email' };
    return { kind: 'skip' };
  });
}

export function ImportContactsDialog({
  open,
  onClose,
  onDone,
}: ImportContactsDialogProps) {
  const { userId } = useAppUser();
  const [step, setStep] = useState<'upload' | 'map' | 'running' | 'done'>('upload');
  const [file, setFile] = useState<File | null>(null);
  const [rows, setRows] = useState<string[][]>([]);
  const [hasHeader, setHasHeader] = useState(true);
  const [mapping, setMapping] = useState<FieldMapping[]>([]);
  const [progress, setProgress] = useState(0);
  const [report, setReport] = useState<ImportReport | null>(null);
  // Tipo dos contatos importados: lead (entra no funil) ou cliente (Vendas & Recompra).
  const [tipo, setTipo] = useState<'lead' | 'cliente'>('lead');
  const [pipelines, setPipelines] = useState<{ id: string; name: string }[]>([]);
  const [stages, setStages] = useState<{ id: string; name: string; pipeline_id: string }[]>([]);
  const [pipelineId, setPipelineId] = useState('');
  const [stageId, setStageId] = useState('');
  const [temperature, setTemperature] = useState('');
  // Tags aplicadas a TODOS os contatos importados (opcional).
  const [allTags, setAllTags] = useState<{ id: string; name: string; color: string }[]>([]);
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);
  const [newTag, setNewTag] = useState('');

  // Carrega pipelines + estágios para a escolha do destino dos leads.
  useEffect(() => {
    if (!open) return;
    const supabase = getSupabase();
    void (async () => {
      const [p, st, tg] = await Promise.all([
        supabase.from('pipelines').select('id, name').order('position'),
        supabase.from('stages').select('id, name, pipeline_id').order('position'),
        supabase.from('tags').select('id, name, color').order('name'),
      ]);
      const ps = (p.data ?? []) as { id: string; name: string }[];
      setPipelines(ps);
      setStages((st.data ?? []) as { id: string; name: string; pipeline_id: string }[]);
      setAllTags((tg.data ?? []) as { id: string; name: string; color: string }[]);
      if (ps.length && !pipelineId) setPipelineId(ps[0].id);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const pipelineStages = useMemo(
    () => stages.filter((s) => s.pipeline_id === pipelineId),
    [stages, pipelineId],
  );
  useEffect(() => {
    if (pipelineStages.length && !pipelineStages.some((s) => s.id === stageId)) {
      setStageId(pipelineStages[0].id);
    }
  }, [pipelineStages, stageId]);

  const reset = () => {
    setStep('upload');
    setFile(null);
    setRows([]);
    setMapping([]);
    setProgress(0);
    setReport(null);
    setSelectedTagIds([]);
    setNewTag('');
  };

  const toggleTag = (id: string) =>
    setSelectedTagIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  // Cria uma tag nova (ou reaproveita a existente pelo nome) e já a marca.
  const addNewTag = async () => {
    const name = newTag.trim();
    if (!name) return;
    const existing = allTags.find((t) => t.name.toLowerCase() === name.toLowerCase());
    if (existing) {
      if (!selectedTagIds.includes(existing.id)) toggleTag(existing.id);
      setNewTag('');
      return;
    }
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('tags')
      .upsert({ name, color: '#60A5FA' }, { onConflict: 'name' })
      .select('id, name, color')
      .single();
    if (error || !data) {
      toast.error('Falha ao criar tag', { description: error?.message });
      return;
    }
    const tag = data as { id: string; name: string; color: string };
    setAllTags((prev) => (prev.some((t) => t.id === tag.id) ? prev : [...prev, tag]));
    setSelectedTagIds((prev) => (prev.includes(tag.id) ? prev : [...prev, tag.id]));
    setNewTag('');
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const handleFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    try {
      const parsed = await readFile(f);
      if (parsed.length === 0) {
        toast.error('Arquivo vazio.');
        return;
      }
      setFile(f);
      setRows(parsed);
      setMapping(guessInitialMapping(parsed[0] ?? []));
      setStep('map');
    } catch (err) {
      toast.error('Falha ao ler arquivo', {
        description: err instanceof Error ? err.message : String(err),
      });
    }
  };

  const headers = useMemo(() => {
    if (rows.length === 0) return [];
    return hasHeader ? rows[0] : rows[0].map((_, i) => `Coluna ${i + 1}`);
  }, [rows, hasHeader]);

  const previewBody = useMemo(() => {
    return hasHeader ? rows.slice(1, 11) : rows.slice(0, 10);
  }, [rows, hasHeader]);

  const phoneColumn = mapping.findIndex((m) => m.kind === 'phone');

  const runImport = async () => {
    if (!userId) return;
    if (phoneColumn === -1) {
      toast.error('Mapeie ao menos uma coluna para "Telefone".');
      return;
    }
    if (tipo === 'lead' && (!pipelineId || !stageId)) {
      toast.error('Selecione o pipeline e o estágio onde os leads entrarão.');
      return;
    }

    setStep('running');
    setProgress(0);

    const supabase = getSupabase();
    const data = hasHeader ? rows.slice(1) : rows;
    const total = data.length;

    const nameIdx = mapping.findIndex((m) => m.kind === 'name');
    const emailIdx = mapping.findIndex((m) => m.kind === 'email');
    const customCols = mapping
      .map((m, i) => (m.kind === 'custom' ? { i, name: m.name } : null))
      .filter((x): x is { i: number; name: string } => !!x);

    const seen = new Set<string>();
    const pending: Array<{
      phone: string;
      name: string | null;
      email: string | null;
      custom_fields: Record<string, string>;
      kind: 'lead' | 'cliente';
    }> = [];
    const errors: { row: number; reason: string }[] = [];
    let duplicates = 0;
    let invalid = 0;

    for (let i = 0; i < data.length; i++) {
      const r = data[i];
      const rawPhone = r[phoneColumn] ?? '';
      const parsed = normalizePhone(rawPhone);
      if (!parsed.ok) {
        invalid++;
        errors.push({ row: i + (hasHeader ? 2 : 1), reason: parsed.error });
        continue;
      }
      if (seen.has(parsed.e164)) {
        duplicates++;
        continue;
      }
      seen.add(parsed.e164);

      const custom: Record<string, string> = {};
      for (const c of customCols) {
        const v = r[c.i];
        if (v) custom[c.name] = v;
      }

      pending.push({
        phone: parsed.e164,
        name: nameIdx >= 0 ? (r[nameIdx] || null) : null,
        email: emailIdx >= 0 ? (r[emailIdx] || null) : null,
        custom_fields: custom,
        kind: tipo,
      });
    }

    // Chunked upsert — onConflict uses the UNIQUE(phone) constraint.
    let imported = 0;
    for (let i = 0; i < pending.length; i += CHUNK_SIZE) {
      const chunk = pending.slice(i, i + CHUNK_SIZE);
      const { error } = await supabase
        .from('contacts')
        .upsert(chunk, { onConflict: 'phone' });
      if (error) {
        errors.push({ row: -1, reason: `batch ${i / CHUNK_SIZE + 1}: ${error.message}` });
      } else {
        imported += chunk.length;
      }
      setProgress(Math.round(((i + chunk.length) / Math.max(pending.length, 1)) * 100));
    }

    // Tags → vincula as tags escolhidas a TODOS os contatos importados.
    if (selectedTagIds.length && pending.length) {
      const phones = pending.map((c) => c.phone);
      for (let i = 0; i < phones.length; i += CHUNK_SIZE) {
        const chunkPhones = phones.slice(i, i + CHUNK_SIZE);
        const { data: contactRows } = await supabase
          .from('contacts')
          .select('id')
          .in('phone', chunkPhones);
        const ids = ((contactRows ?? []) as { id: string }[]).map((c) => c.id);
        if (!ids.length) continue;
        const links = ids.flatMap((cid) => selectedTagIds.map((tid) => ({ contact_id: cid, tag_id: tid })));
        const { error: tagErr } = await supabase
          .from('contact_tags')
          .upsert(links, { onConflict: 'contact_id,tag_id', ignoreDuplicates: true });
        if (tagErr) errors.push({ row: -1, reason: `tags: ${tagErr.message}` });
      }
    }

    // Leads → cria o negócio no pipeline/estágio escolhidos (pula quem já tem
    // negócio aberto, para reimportações não duplicarem cards no funil).
    if (tipo === 'lead' && pipelineId && stageId && pending.length) {
      const phones = pending.map((c) => c.phone);
      for (let i = 0; i < phones.length; i += CHUNK_SIZE) {
        const chunkPhones = phones.slice(i, i + CHUNK_SIZE);
        const { data: contactRows } = await supabase
          .from('contacts')
          .select('id, name, phone')
          .in('phone', chunkPhones);
        const contacts = (contactRows ?? []) as { id: string; name: string | null; phone: string }[];
        if (!contacts.length) continue;
        const { data: openDeals } = await supabase
          .from('deals')
          .select('contact_id')
          .in('contact_id', contacts.map((c) => c.id))
          .eq('status', 'open');
        const hasDeal = new Set(((openDeals ?? []) as { contact_id: string }[]).map((d) => d.contact_id));
        const newDeals = contacts
          .filter((c) => !hasDeal.has(c.id))
          .map((c) => ({
            contact_id: c.id,
            pipeline_id: pipelineId,
            stage_id: stageId,
            title: c.name || c.phone,
            status: 'open',
            ...(temperature ? { temperature } : {}),
          }));
        if (newDeals.length) {
          const { error: dealErr } = await supabase.from('deals').insert(newDeals);
          if (dealErr) errors.push({ row: -1, reason: `deals: ${dealErr.message}` });
        }
      }
    }

    setReport({
      totalRows: total,
      imported,
      invalid,
      duplicates,
      errors: errors.slice(0, 20),
    });
    setStep('done');
    if (errors.length === 0) {
      toast.success(`${imported} contatos importados.`);
    } else {
      toast.warning(`${imported} importados, ${invalid + duplicates + errors.length} ignorados.`);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      title="Importar contatos"
      description="Aceita CSV e XLSX. Telefones são normalizados para E.164 (+55…); duplicados por telefone são mesclados."
      widthClass="max-w-4xl"
    >
      {step === 'upload' && (
        <label
          htmlFor="contacts_file"
          className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-[rgba(59,130,246,0.25)] bg-white/[0.02] p-10 cursor-pointer hover:border-[rgba(59,130,246,0.5)]"
        >
          <FileUp className="h-8 w-8 text-[var(--accent-primary)]" />
          <div className="text-center">
            <div className="font-semibold">Clique para selecionar um arquivo</div>
            <div className="text-sm text-[var(--color-text-secondary)]">
              .csv, .xlsx ou .xls
            </div>
          </div>
          <input
            id="contacts_file"
            type="file"
            accept=".csv,.xlsx,.xls"
            onChange={handleFile}
            className="sr-only"
          />
        </label>
      )}

      {step === 'map' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div className="text-sm text-[var(--color-text-secondary)]">
              <span className="font-mono text-[var(--color-text-primary)]">
                {file?.name}
              </span>
              {' '}·{' '}
              {rows.length} linhas
            </div>
            <label className="flex items-center gap-2 text-sm text-[var(--color-text-secondary)]">
              <input
                type="checkbox"
                checked={hasHeader}
                onChange={(e) => {
                  setHasHeader(e.target.checked);
                  setMapping(guessInitialMapping(e.target.checked ? rows[0] ?? [] : []));
                }}
                className="accent-[var(--accent-primary)]"
              />
              Primeira linha é cabeçalho
            </label>
          </div>

          <div className="rounded-lg border border-[rgba(59,130,246,0.1)] overflow-auto max-h-[340px]">
            <table className="w-full text-xs">
              <thead className="bg-white/[0.03] sticky top-0">
                <tr>
                  {headers.map((h, i) => (
                    <th key={i} className="p-2 text-left border-b border-[rgba(59,130,246,0.08)] min-w-[140px]">
                      <div className="font-semibold text-[var(--color-text-primary)] mb-1 truncate">
                        {h || `Coluna ${i + 1}`}
                      </div>
                      <select
                        value={
                          mapping[i]?.kind === 'custom'
                            ? `custom:${(mapping[i] as { kind: 'custom'; name: string }).name}`
                            : mapping[i]?.kind ?? 'skip'
                        }
                        onChange={(e) => {
                          const v = e.target.value;
                          setMapping((prev) => {
                            const next = [...prev];
                            if (v === 'skip') next[i] = { kind: 'skip' };
                            else if (v === 'phone') next[i] = { kind: 'phone' };
                            else if (v === 'name') next[i] = { kind: 'name' };
                            else if (v === 'email') next[i] = { kind: 'email' };
                            else if (v === 'custom-new') {
                              const name = prompt('Nome do campo personalizado:');
                              if (name?.trim()) next[i] = { kind: 'custom', name: name.trim() };
                            }
                            return next;
                          });
                        }}
                        className="w-full rounded border border-[rgba(59,130,246,0.15)] bg-black/20 px-2 py-1 text-xs text-[var(--color-text-primary)]"
                      >
                        <option value="skip">— ignorar —</option>
                        <option value="phone">📞 telefone</option>
                        <option value="name">👤 nome</option>
                        <option value="email">📧 e-mail</option>
                        {mapping[i]?.kind === 'custom' && (
                          <option value={`custom:${(mapping[i] as { kind: 'custom'; name: string }).name}`}>
                            ⚙ custom: {(mapping[i] as { kind: 'custom'; name: string }).name}
                          </option>
                        )}
                        <option value="custom-new">⚙ custom (novo…)</option>
                      </select>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {previewBody.map((r, i) => (
                  <tr key={i} className="border-b border-[rgba(59,130,246,0.04)]">
                    {headers.map((_, j) => (
                      <td key={j} className="p-2 text-[var(--color-text-secondary)] truncate max-w-[200px]">
                        {r[j] ?? ''}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Tipo dos contatos + destino dos leads */}
          <div className="space-y-3 rounded-xl border border-[rgba(59,130,246,0.12)] bg-white/[0.02] p-4">
            <div className="text-sm font-semibold text-[var(--color-text-primary)]">Esses contatos são…</div>
            <div className="flex gap-2">
              {([['lead', 'Leads (entram no funil)'], ['cliente', 'Clientes (Vendas & Recompra)']] as const).map(([v, label]) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setTipo(v)}
                  className={`rounded-lg border px-3 py-2 text-sm transition ${
                    tipo === v
                      ? 'border-[var(--accent-primary)] bg-[rgba(59,130,246,0.12)] text-[var(--color-text-primary)]'
                      : 'border-[rgba(59,130,246,0.2)] text-[var(--color-text-secondary)] hover:border-[rgba(59,130,246,0.4)]'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            {tipo === 'lead' && (
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                <label className="space-y-1 text-xs text-[var(--color-text-secondary)]">
                  Pipeline *
                  <select
                    value={pipelineId}
                    onChange={(e) => setPipelineId(e.target.value)}
                    className="w-full rounded-lg border border-[rgba(59,130,246,0.2)] bg-white/[0.03] px-2 py-2 text-sm text-[var(--color-text-primary)] outline-none focus:border-[var(--accent-primary)] [&>option]:bg-[#0A0A0F]"
                  >
                    {pipelines.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </label>
                <label className="space-y-1 text-xs text-[var(--color-text-secondary)]">
                  Estágio *
                  <select
                    value={stageId}
                    onChange={(e) => setStageId(e.target.value)}
                    className="w-full rounded-lg border border-[rgba(59,130,246,0.2)] bg-white/[0.03] px-2 py-2 text-sm text-[var(--color-text-primary)] outline-none focus:border-[var(--accent-primary)] [&>option]:bg-[#0A0A0F]"
                  >
                    {pipelineStages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </label>
                <label className="space-y-1 text-xs text-[var(--color-text-secondary)]">
                  Temperatura (opcional)
                  <select
                    value={temperature}
                    onChange={(e) => setTemperature(e.target.value)}
                    className="w-full rounded-lg border border-[rgba(59,130,246,0.2)] bg-white/[0.03] px-2 py-2 text-sm text-[var(--color-text-primary)] outline-none focus:border-[var(--accent-primary)] [&>option]:bg-[#0A0A0F]"
                  >
                    <option value="">—</option>
                    <option value="Frio">Frio</option>
                    <option value="Morno">Morno</option>
                    <option value="Quente">Quente</option>
                  </select>
                </label>
              </div>
            )}
          </div>

          {/* Tags aplicadas a todos os contatos importados */}
          <div className="space-y-2 rounded-xl border border-[rgba(59,130,246,0.12)] bg-white/[0.02] p-4">
            <div className="text-sm font-semibold text-[var(--color-text-primary)]">Tags (opcional)</div>
            <p className="text-xs text-[var(--color-text-secondary)]">Aplicadas a todos os contatos desta importação.</p>
            {allTags.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {allTags.map((t) => {
                  const on = selectedTagIds.includes(t.id);
                  return (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => toggleTag(t.id)}
                      className="rounded-full px-2.5 py-1 text-xs font-medium transition"
                      style={on ? { background: t.color, color: '#fff' } : { background: `${t.color}22`, border: `1px solid ${t.color}55`, color: 'var(--color-text-secondary)' }}
                    >
                      {t.name}
                    </button>
                  );
                })}
              </div>
            )}
            <div className="flex gap-2">
              <input
                value={newTag}
                onChange={(e) => setNewTag(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void addNewTag(); } }}
                placeholder="Criar nova tag e Enter…"
                className="flex-1 rounded-lg border border-[rgba(59,130,246,0.2)] bg-white/[0.03] px-2 py-1.5 text-sm text-[var(--color-text-primary)] outline-none focus:border-[var(--accent-primary)]"
              />
              <Button type="button" variant="outline" onClick={() => void addNewTag()} disabled={!newTag.trim()}>
                Adicionar
              </Button>
            </div>
          </div>

          <div className="flex justify-between gap-3">
            <Button variant="ghost" onClick={() => setStep('upload')}>
              Voltar
            </Button>
            <Button onClick={runImport} disabled={phoneColumn === -1}>
              Importar{' '}
              {hasHeader ? rows.length - 1 : rows.length} linhas
            </Button>
          </div>
          {phoneColumn === -1 && (
            <p className="text-xs text-[var(--color-error)]">
              Pelo menos uma coluna precisa ser mapeada como "Telefone".
            </p>
          )}
        </div>
      )}

      {step === 'running' && (
        <div className="py-10 flex flex-col items-center gap-4">
          <Loader2 className="h-8 w-8 animate-spin text-[var(--accent-primary)]" />
          <div className="text-sm text-[var(--color-text-primary)]">
            Importando... {progress}%
          </div>
          <div className="w-full max-w-md h-2 rounded-full bg-white/5 overflow-hidden">
            <div
              className="h-full bg-[var(--accent-primary)] transition-all"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      )}

      {step === 'done' && report && (
        <div className="space-y-4">
          <div className="flex items-center gap-3 rounded-lg border border-[rgba(16,185,129,0.3)] bg-[rgba(16,185,129,0.05)] p-4">
            <CheckCircle2 className="h-6 w-6 text-[var(--color-success)]" />
            <div className="text-sm">
              <div className="font-semibold">Importação concluída</div>
              <div className="text-[var(--color-text-secondary)]">
                {report.imported} contatos importados de {report.totalRows} linhas
                {report.invalid > 0 && ` · ${report.invalid} inválidos`}
                {report.duplicates > 0 && ` · ${report.duplicates} duplicados`}
              </div>
            </div>
          </div>

          {report.errors.length > 0 && (
            <div className="rounded-lg border border-[rgba(239,68,68,0.25)] bg-[rgba(239,68,68,0.04)] p-4 space-y-2">
              <div className="flex items-center gap-2 text-sm font-semibold">
                <AlertTriangle className="h-4 w-4 text-[var(--color-error)]" />
                Amostras de linhas ignoradas
              </div>
              <ul className="text-xs font-mono space-y-1 text-[var(--color-text-secondary)] max-h-[200px] overflow-auto">
                {report.errors.map((e, i) => (
                  <li key={i}>
                    {e.row > 0 ? `linha ${e.row}: ` : ''}
                    {e.reason}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="flex justify-end gap-2">
            <Button
              variant="ghost"
              onClick={() => {
                reset();
              }}
            >
              Nova importação
            </Button>
            <Button
              onClick={() => {
                onDone?.();
                handleClose();
              }}
            >
              Fechar
            </Button>
          </div>
        </div>
      )}

    </Dialog>
  );
}
