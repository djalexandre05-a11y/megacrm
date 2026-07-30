import { useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card } from '@/components/ui/card';
import { getSupabase } from '@/lib/supabase';
import { useAuth } from '@/app/providers/AuthProvider';
import { isNotifSoundEnabled, setNotifSoundEnabled } from '@/lib/soundPrefs';

export function AccountSettings() {
  const { user } = useAuth();
  const [newEmail, setNewEmail] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [updatingEmail, setUpdatingEmail] = useState(false);
  const [updatingPassword, setUpdatingPassword] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(isNotifSoundEnabled);

  const toggleSound = (next: boolean) => {
    setNotifSoundEnabled(next);
    setSoundEnabled(next);
    toast.success(next ? 'Som das notificações ativado.' : 'Som das notificações desativado.');
  };

  const handleEmailUpdate = async (e: FormEvent) => {
    e.preventDefault();
    const target = newEmail.trim();
    if (!target) {
      toast.error('Informe o novo e-mail.');
      return;
    }
    if (target === user?.email) {
      toast.error('Esse já é o e-mail atual.');
      return;
    }
    setUpdatingEmail(true);
    const supabase = getSupabase();
    const { error } = await supabase.auth.updateUser({ email: target });
    setUpdatingEmail(false);
    if (error) {
      toast.error('Falha ao alterar e-mail', { description: error.message });
      return;
    }
    toast.success('E-mail atualizado. Pode ser que precise reconfirmar pelo link enviado.');
    setNewEmail('');
  };

  const handlePasswordUpdate = async (e: FormEvent) => {
    e.preventDefault();
    if (newPassword.length < 8) {
      toast.error('A nova senha precisa ter pelo menos 8 caracteres.');
      return;
    }
    if (newPassword !== confirmPassword) {
      toast.error('As senhas não coincidem.');
      return;
    }
    setUpdatingPassword(true);
    const supabase = getSupabase();
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    setUpdatingPassword(false);
    if (error) {
      toast.error('Falha ao alterar senha', { description: error.message });
      return;
    }
    toast.success('Senha atualizada.');
    setNewPassword('');
    setConfirmPassword('');
  };

  return (
    <div className="space-y-5">
      <Card>
        <div className="space-y-4">
          <header>
            <h2 className="text-lg font-bold">Notificações</h2>
            <p className="text-sm text-[var(--color-text-secondary)]">
              Preferência salva neste navegador.
            </p>
          </header>
          <label className="flex items-center gap-3 rounded-lg border border-[rgba(59,130,246,0.15)] bg-white/[0.02] px-4 py-3 cursor-pointer">
            <input
              type="checkbox"
              checked={soundEnabled}
              onChange={(e) => toggleSound(e.target.checked)}
              className="h-4 w-4 accent-[var(--accent-primary)]"
            />
            <span className="text-sm font-medium text-[var(--color-text-primary)]">
              Tocar som ao receber notificações
            </span>
          </label>
        </div>
      </Card>

      <Card>
        <form onSubmit={handleEmailUpdate} className="space-y-4">
          <header>
            <h2 className="text-lg font-bold">E-mail</h2>
            <p className="text-sm text-[var(--color-text-secondary)]">
              Atual:{' '}
              <span className="font-mono text-[var(--color-text-primary)]">
                {user?.email ?? '—'}
              </span>
            </p>
          </header>
          <div className="space-y-2">
            <Label htmlFor="new_email">Novo e-mail</Label>
            <Input
              id="new_email"
              type="email"
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
              disabled={updatingEmail}
            />
          </div>
          <div className="flex justify-end">
            <Button type="submit" disabled={updatingEmail || !newEmail}>
              {updatingEmail ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Salvando...
                </>
              ) : (
                'Atualizar e-mail'
              )}
            </Button>
          </div>
        </form>
      </Card>

      <Card>
        <form onSubmit={handlePasswordUpdate} className="space-y-4">
          <header>
            <h2 className="text-lg font-bold">Senha</h2>
            <p className="text-sm text-[var(--color-text-secondary)]">
              Mínimo 8 caracteres. A sessão continua ativa após a alteração.
            </p>
          </header>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="new_pw">Nova senha</Label>
              <Input
                id="new_pw"
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                disabled={updatingPassword}
                autoComplete="new-password"
                minLength={8}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirm_pw">Confirmar nova senha</Label>
              <Input
                id="confirm_pw"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                disabled={updatingPassword}
                autoComplete="new-password"
                minLength={8}
              />
            </div>
          </div>
          <div className="flex justify-end">
            <Button type="submit" disabled={updatingPassword || !newPassword || !confirmPassword}>
              {updatingPassword ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Salvando...
                </>
              ) : (
                'Atualizar senha'
              )}
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
