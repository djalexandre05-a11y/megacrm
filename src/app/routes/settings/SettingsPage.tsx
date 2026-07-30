import type React from 'react';
import { useMemo, useState } from 'react';
import {
  KeyRound,
  Package,
  Settings as SettingsIcon,
  UserCircle2,
  Users,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAppUser } from '@/app/providers/AppUserProvider';
import { AccountSettings } from './sections/AccountSettings';
import { TeamSettings } from './sections/TeamSettings';
import { LeadAssignmentSettings } from './sections/LeadAssignmentSettings';
import { ProductsSettings } from './sections/ProductsSettings';
import CredentialsPage from './CredentialsPage';

type TabId =
  | 'account'
  | 'team'
  | 'products'
  | 'credentials';

interface TabDef {
  id: TabId;
  label: string;
  hint: string;
  icon: LucideIcon;
  adminOnly?: boolean;
  render: () => React.ReactNode;
}

export default function SettingsPage() {
  const { role } = useAppUser();
  const [active, setActive] = useState<TabId>('account');

  const tabs: TabDef[] = useMemo(
    () =>
      (
        [
          {
            id: 'account',
            label: 'Conta',
            hint: 'E-mail e senha',
            icon: UserCircle2,
            render: () => <AccountSettings />,
          },
          {
            id: 'team',
            label: 'Equipe',
            hint: 'Convites e roles',
            icon: Users,
            adminOnly: true,
            render: () => (
              <div className="space-y-6">
                <TeamSettings />
                <LeadAssignmentSettings />
              </div>
            ),
          },
          {
            id: 'products',
            label: 'Produtos',
            hint: 'Catálogo atribuível a leads',
            icon: Package,
            adminOnly: true,
            render: () => <ProductsSettings />,
          },
          {
            id: 'credentials',
            label: 'Credenciais',
            hint: 'Chaves de API e conexões',
            icon: KeyRound,
            adminOnly: true,
            render: () => <CredentialsPage />,
          },
        ] as TabDef[]
      ).filter((t) => !t.adminOnly || role === 'admin'),
    [role],
  );

  // Operador só enxerga "Conta"; admin vê tudo. Garante que a aba ativa
  // sempre exista na lista visível (default 'account' funciona p/ ambos).
  const current = tabs.find((t) => t.id === active) ?? tabs[0];

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div className="flex items-center gap-4">
        <div className="h-12 w-12 rounded-xl glass-card flex items-center justify-center">
          <SettingsIcon className="h-5 w-5 text-[var(--accent-primary)]" />
        </div>
        <div>
          <div className="text-label">Seção</div>
          <h1 className="text-2xl font-bold text-display">Configurações</h1>
          <p className="text-sm text-[var(--color-text-secondary)]">
            Conta, equipe e credenciais
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-[260px_1fr] gap-5">
        <aside className="glass-card p-2 h-fit sticky top-2">
          <nav className="flex flex-col gap-1">
            {tabs.map((t) => {
              const Icon = t.icon;
              const isActive = t.id === active;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setActive(t.id)}
                  className={cn(
                    'flex items-center gap-3 p-2.5 rounded-lg text-left transition-colors',
                    isActive
                      ? 'bg-[rgba(59,130,246,0.1)] text-[var(--color-text-primary)]'
                      : 'text-[var(--color-text-secondary)] hover:bg-white/[0.03]',
                  )}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  <div className="min-w-0">
                    <div className="text-sm font-semibold leading-tight">{t.label}</div>
                    <div className="text-[10px] text-[var(--color-text-secondary)] truncate">
                      {t.hint}
                    </div>
                  </div>
                </button>
              );
            })}
          </nav>
        </aside>

        <div className="min-h-[60vh]">{current.render()}</div>
      </div>
    </div>
  );
}
