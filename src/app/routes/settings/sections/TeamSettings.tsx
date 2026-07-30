import { useEffect, useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { Loader2, Mail, UserRound, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card } from '@/components/ui/card';
import { getSupabase } from '@/lib/supabase';
import { useAppUser } from '@/app/providers/AppUserProvider';

type Role = 'admin' | 'operator';

// supabase.functions.invoke zera `data` em respostas não-2xx (o erro vira
// FunctionsHttpError com o Response em `.context`). Lê o corpo pra mostrar a
// mensagem amigável da função (ex.: "Já existe um usuário com esse e-mail")
// em vez do genérico "Edge Function returned a non-2xx status code".
async function invokeErrorMessage(error: unknown, data: { error?: string } | null): Promise<string> {
  if (data?.error) return data.error;
  const ctx = (error as { context?: Response } | null)?.context;
  if (ctx && typeof ctx.json === 'function') {
    try {
      const body = (await ctx.json()) as { error?: string };
      if (body?.error) return body.error;
    } catch {
      /* corpo não-JSON */
    }
  }
  return (error as { message?: string } | null)?.message ?? 'Erro desconhecido';
}

interface MemberRow {
  id: string;
  role: Role;
  user_id: string;
  email: string | null;
  accepted_at: string | null;
}

export function TeamSettings() {
  const { userId, role: callerRole } = useAppUser();
  const isOwner = callerRole === 'admin';

  const [members, setMembers] = useState<MemberRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role>('operator');
  const [inviting, setInviting] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);

  const loadAll = async () => {
    if (!userId) return;
    const supabase = getSupabase();

    // app_users tem só user_id; os e-mails vêm da RPC list_operators (join com
    // auth.users, SECURITY DEFINER). Merge por user_id.
    const [membersRes, opsRes] = await Promise.all([
      supabase
        .from('app_users')
        .select('id, role, user_id, accepted_at')
        .order('invited_at', { ascending: true }),
      supabase.schema('whatsapp_hub').rpc('list_operators'),
    ]);

    if (membersRes.error) {
      toast.error('Não foi possível carregar a equipe', {
        description: membersRes.error.message,
      });
    } else {
      const emailByUser = new Map<string, string>(
        ((opsRes.data ?? []) as { user_id: string; email: string }[]).map((o) => [o.user_id, o.email]),
      );
      setMembers(
        (membersRes.data ?? []).map((row) => ({
          id: row.id as string,
          role: row.role as Role,
          user_id: row.user_id as string,
          email: emailByUser.get(row.user_id as string) ?? null,
          accepted_at: (row.accepted_at as string | null) ?? null,
        })),
      );
    }

    setLoading(false);
  };

  useEffect(() => {
    void loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, isOwner]);

  const handleInvite = async (e: FormEvent) => {
    e.preventDefault();
    if (!email.trim()) {
      toast.error('Informe um e-mail.');
      return;
    }

    setInviting(true);
    const supabase = getSupabase();
    const { data, error } = await supabase.functions.invoke('invite-team-member', {
      // app_url = domínio atual (produção na Vercel) para o link do e-mail não
      // cair em localhost.
      body: { email: email.trim(), role, app_url: window.location.origin },
    });
    setInviting(false);

    if (error || !data?.ok) {
      toast.error('Falha ao enviar convite', {
        description: await invokeErrorMessage(error, data),
      });
      return;
    }

    toast.success(`Convite enviado para ${email.trim()}`, {
      description: 'O Supabase enviou o e-mail; o convidado define a senha pelo link.',
    });

    setEmail('');
    void loadAll();
  };

  const handleRemove = async (member: MemberRow) => {
    const label = member.email ?? member.user_id;
    if (!window.confirm(`Remover ${label} da equipe? Esta ação é irreversível.`)) return;

    setRemovingId(member.user_id);
    const supabase = getSupabase();
    const { data, error } = await supabase.functions.invoke('delete-team-member', {
      body: { user_id: member.user_id },
    });
    setRemovingId(null);

    if (error || !data?.ok) {
      toast.error('Falha ao remover membro', {
        description: await invokeErrorMessage(error, data),
      });
      return;
    }

    toast.success(`${label} removido da equipe.`);
    void loadAll();
  };

  return (
    <Card>
      <div className="space-y-6">
        <header className="space-y-1">
          <h2 className="text-xl font-bold text-display">Equipe</h2>
          <p className="text-sm text-[var(--color-text-secondary)]">
            {isOwner
              ? 'Convide novos membros por e-mail. O Supabase envia o convite e o membro define a senha pelo link.'
              : 'Apenas o owner desta instância pode convidar membros.'}
          </p>
        </header>

        {isOwner && (
          <form
            onSubmit={handleInvite}
            className="grid grid-cols-1 md:grid-cols-[1fr_160px_auto] gap-3 items-end"
          >
            <div className="space-y-2">
              <Label htmlFor="invite_email">E-mail</Label>
              <Input
                id="invite_email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="operador@suaempresa.com"
                disabled={inviting}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="invite_role">Role</Label>
              <select
                id="invite_role"
                value={role}
                onChange={(e) => setRole(e.target.value as Role)}
                disabled={inviting}
                className="h-11 w-full rounded-lg border border-[rgba(59,130,246,0.2)] bg-white/[0.03] px-4 text-sm text-[var(--color-text-primary)]"
              >
                <option value="admin">Admin</option>
                <option value="operator">Operador</option>
              </select>
            </div>
            <Button type="submit" disabled={inviting}>
              {inviting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Enviando...
                </>
              ) : (
                <>
                  <Mail className="h-4 w-4" />
                  Convidar
                </>
              )}
            </Button>
          </form>
        )}

        <div className="space-y-2">
          <div className="text-label">Membros atuais</div>
          {loading ? (
            <div className="text-sm text-[var(--color-text-secondary)] opacity-60">
              Carregando...
            </div>
          ) : members.length === 0 ? (
            <div className="text-sm text-[var(--color-text-secondary)] opacity-60">
              Nenhum membro ainda.
            </div>
          ) : (
            <ul className="divide-y divide-[rgba(59,130,246,0.08)] rounded-lg border border-[rgba(59,130,246,0.1)] bg-white/[0.02]">
              {members.map((m) => (
                <li
                  key={m.id}
                  className="flex items-center justify-between p-3 gap-3"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="h-8 w-8 rounded-full bg-white/5 flex items-center justify-center">
                      <UserRound className="h-4 w-4 text-[var(--color-text-secondary)]" />
                    </div>
                    <div className="text-sm min-w-0">
                      <div className="text-[var(--color-text-primary)] truncate max-w-[280px]">
                        {m.email ?? m.user_id}
                      </div>
                      <div className="text-[var(--color-text-secondary)] text-xs">
                        {m.accepted_at
                          ? `Aceitou em ${new Date(m.accepted_at).toLocaleDateString('pt-BR')}`
                          : 'Convite pendente'}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <span className="text-xs uppercase tracking-wide font-semibold text-[var(--accent-primary)]">
                      {m.role === 'admin' ? 'Owner' : 'Operador'}
                    </span>
                    {isOwner && m.user_id !== userId && (
                      <button
                        type="button"
                        onClick={() => void handleRemove(m)}
                        disabled={removingId === m.user_id}
                        aria-label={`Remover ${m.email ?? m.user_id}`}
                        title="Remover membro"
                        className="flex h-8 w-8 items-center justify-center rounded-lg text-[var(--color-text-secondary)] transition hover:bg-[rgba(239,68,68,0.12)] hover:text-[#EF4444] disabled:opacity-50"
                      >
                        {removingId === m.user_id ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Trash2 className="h-4 w-4" />
                        )}
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </Card>
  );
}
