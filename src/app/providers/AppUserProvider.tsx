import {
  createContext,
  useContext,
  useMemo,
  type ReactNode,
} from 'react';
import { useAuth } from './AuthProvider';

// ----------------------------------------------------------------------------
// AppUserProvider
// ----------------------------------------------------------------------------
// Self-hosted single-org build: there is no tenant concept. The only thing
// we surface to consumers is the role read from auth.jwt().app_metadata.role
// (populated by the on_auth_user_created trigger).
//
// Role gating elsewhere in the app should consume `useAppUser().role` instead
// of querying the DB; the JWT is the source of truth for access control.
// ----------------------------------------------------------------------------

export type AppRole = 'admin' | 'operator';

interface AppUserContextValue {
  userId: string | null;
  role: AppRole | null;
  loading: boolean;
}

const AppUserContext = createContext<AppUserContextValue | null>(null);

function readRoleFromUser(appMetadata: Record<string, unknown> | undefined): AppRole | null {
  if (!appMetadata) return null;
  const role = appMetadata['role'];
  if (role === 'admin' || role === 'operator') {
    return role;
  }
  return null;
}

export function AppUserProvider({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();

  const role = useMemo(
    () => readRoleFromUser(user?.app_metadata as Record<string, unknown> | undefined),
    [user],
  );

  const value = useMemo<AppUserContextValue>(
    () => ({ userId: user?.id ?? null, role, loading }),
    [user, role, loading],
  );

  return <AppUserContext.Provider value={value}>{children}</AppUserContext.Provider>;
}

export function useAppUser(): AppUserContextValue {
  const ctx = useContext(AppUserContext);
  if (!ctx) {
    throw new Error('useAppUser must be used inside <AppUserProvider>');
  }
  return ctx;
}
