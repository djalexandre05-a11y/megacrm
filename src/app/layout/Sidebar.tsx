import { NavLink } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { NAV_ITEMS } from './nav-config';
import { useAppUser } from '@/app/providers/AppUserProvider';

export function Sidebar() {
  const { role } = useAppUser();
  const items = NAV_ITEMS.filter((item) => !item.adminOnly || role === 'admin');
  return (
    <aside
      className="hidden md:flex md:flex-col w-60 shrink-0 glass-surface border-r border-[rgba(59,130,246,0.1)]"
      aria-label="Navegação principal"
    >
      <div className="h-16 flex items-center gap-3 px-5 border-b border-[rgba(59,130,246,0.08)]">
        <img
          src="/agentise-mark.png"
          alt="Agentise"
          className="h-9 w-9 rounded-lg shadow-[0_0_20px_rgba(59,130,246,0.35)]"
        />
        <div className="leading-tight">
          <div className="text-[0.65rem] uppercase tracking-[0.12em] text-[var(--color-text-secondary)]">
            Agentise
          </div>
          <div className="text-sm font-bold text-[var(--color-text-primary)]">
            MEGACRM
          </div>
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-1">
        {items.map((item) => {
          const Icon = item.icon;
          return (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all',
                  'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-white/5',
                  isActive &&
                    'bg-gradient-to-r from-[rgba(59,130,246,0.18)] to-[rgba(59,130,246,0.04)] text-[var(--color-text-primary)] shadow-[inset_0_1px_0_rgba(59,130,246,0.15)]',
                )
              }
            >
              <Icon className="h-4 w-4" />
              <span>{item.label}</span>
            </NavLink>
          );
        })}
      </nav>

      <div className="px-4 py-4 border-t border-[rgba(59,130,246,0.08)] text-[0.65rem] uppercase tracking-[0.12em] text-[var(--color-text-secondary)] opacity-70">
        v0.1 · dev
      </div>
    </aside>
  );
}
