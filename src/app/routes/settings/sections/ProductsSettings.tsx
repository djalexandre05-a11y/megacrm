import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Loader2, Package, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { getSupabase } from '@/lib/supabase';

// Configurações → Produtos. Catálogo de produtos atribuíveis a leads/negócios
// (via deal_products no drawer do lead). Quantidade (estoque) só para Físico —
// o CHECK do banco espelha essa regra.

export type ProductType = 'curso' | 'mentoria' | 'consultoria' | 'ebook' | 'app' | 'ia' | 'fisico';

interface Product {
  id: string;
  name: string;
  product_type: ProductType;
  quantity: number | null;
  created_at: string;
}

const TYPE_LABEL: Record<ProductType, string> = {
  curso: 'Curso',
  mentoria: 'Mentoria',
  consultoria: 'Consultoria',
  ebook: 'Ebook',
  app: 'App',
  ia: 'IA',
  fisico: 'Físico',
};

const selectCls =
  'rounded-lg border border-[rgba(59,130,246,0.2)] bg-white/[0.03] px-2 py-2 text-sm text-[var(--color-text-primary)] outline-none focus:border-[var(--accent-primary)] [&>option]:bg-[#0A0A0F]';

export function ProductsSettings() {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState('');
  const [type, setType] = useState<ProductType>('curso');
  const [quantity, setQuantity] = useState('');

  const reload = useCallback(async () => {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('products')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) toast.error('Falha ao carregar produtos', { description: error.message });
    setProducts((data ?? []) as Product[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const addProduct = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      toast.error('Informe o nome do produto.');
      return;
    }
    setSaving(true);
    const supabase = getSupabase();
    const { error } = await supabase.from('products').insert({
      name: trimmed,
      product_type: type,
      // Quantidade só vale para Físico (CHECK no banco garante).
      quantity: type === 'fisico' && quantity !== '' ? Math.max(0, Number(quantity) || 0) : null,
    });
    setSaving(false);
    if (error) {
      const msg = /duplicate|unique/i.test(error.message)
        ? 'Já existe um produto com esse nome.'
        : error.message;
      toast.error('Falha ao cadastrar', { description: msg });
      return;
    }
    toast.success('Produto cadastrado.');
    setName('');
    setQuantity('');
    void reload();
  };

  const removeProduct = async (p: Product) => {
    if (!confirm(`Remover "${p.name}"? Ele será desvinculado dos negócios.`)) return;
    const supabase = getSupabase();
    const { error } = await supabase.from('products').delete().eq('id', p.id);
    if (error) {
      toast.error('Falha ao remover', { description: error.message });
      return;
    }
    setProducts((prev) => prev.filter((x) => x.id !== p.id));
  };

  const updateQuantity = async (p: Product, raw: string) => {
    const q = raw === '' ? null : Math.max(0, Number(raw) || 0);
    const supabase = getSupabase();
    const { error } = await supabase.from('products').update({ quantity: q }).eq('id', p.id);
    if (error) {
      toast.error('Falha ao atualizar quantidade', { description: error.message });
      return;
    }
    setProducts((prev) => prev.map((x) => (x.id === p.id ? { ...x, quantity: q } : x)));
  };

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <header>
        <div className="text-label">Produtos</div>
        <h2 className="text-xl font-bold text-display">Catálogo de produtos</h2>
        <p className="text-sm text-[var(--color-text-secondary)]">
          Produtos podem ser atribuídos a leads/negócios na ficha do lead (Funil). Apenas
          produtos do tipo Físico têm quantidade (estoque).
        </p>
      </header>

      {/* Cadastro */}
      <div className="glass-card space-y-3 p-4">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_160px_120px_auto]">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Nome do produto"
          />
          <select value={type} onChange={(e) => setType(e.target.value as ProductType)} className={selectCls}>
            {(Object.keys(TYPE_LABEL) as ProductType[]).map((t) => (
              <option key={t} value={t}>{TYPE_LABEL[t]}</option>
            ))}
          </select>
          {type === 'fisico' ? (
            <Input
              type="number"
              min={0}
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              placeholder="Qtd."
            />
          ) : (
            <div />
          )}
          <Button type="button" onClick={addProduct} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            Cadastrar
          </Button>
        </div>
      </div>

      {/* Lista */}
      <div className="glass-card p-4">
        {loading ? (
          <div className="py-8 text-center text-label opacity-60">Carregando...</div>
        ) : products.length === 0 ? (
          <div className="py-8 text-center text-sm text-[var(--color-text-secondary)] opacity-60">
            Nenhum produto cadastrado ainda.
          </div>
        ) : (
          <div className="space-y-1.5">
            {products.map((p) => (
              <div
                key={p.id}
                className="flex flex-wrap items-center gap-3 rounded-lg border border-[rgba(59,130,246,0.08)] bg-white/[0.02] px-3 py-2"
              >
                <Package className="h-4 w-4 shrink-0 text-[var(--accent-secondary)]" />
                <span className="min-w-0 flex-1 truncate text-sm font-medium text-[var(--color-text-primary)]">
                  {p.name}
                </span>
                <span className="rounded-full border border-[rgba(59,130,246,0.25)] bg-[rgba(59,130,246,0.1)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--accent-secondary)]">
                  {TYPE_LABEL[p.product_type] ?? p.product_type}
                </span>
                {p.product_type === 'fisico' ? (
                  <label className="flex items-center gap-1.5 text-xs text-[var(--color-text-secondary)]">
                    Qtd.
                    <input
                      type="number"
                      min={0}
                      defaultValue={p.quantity ?? ''}
                      onBlur={(e) => {
                        const v = e.target.value;
                        if (v !== String(p.quantity ?? '')) void updateQuantity(p, v);
                      }}
                      className="w-20 rounded border border-[rgba(59,130,246,0.2)] bg-white/[0.03] px-2 py-1 text-xs text-[var(--color-text-primary)] outline-none focus:border-[var(--accent-primary)]"
                    />
                  </label>
                ) : null}
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => void removeProduct(p)}
                  aria-label="Remover produto"
                >
                  <Trash2 className="h-4 w-4 text-[var(--color-error)]" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
