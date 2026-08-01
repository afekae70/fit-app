/**
 * Provides the id every local SQLite query is scoped by.
 *
 * Deliberately just context plumbing — resolving *which* id (a real Supabase user, or the
 * `'local'` pseudo-user used before any sign-in / while Supabase is unconfigured) is `AppGate`'s
 * job. This component trusts that invariant rather than re-deriving it, so there is exactly one
 * place in the app that decides what "the current user" means.
 */

import { createContext, useContext, type ReactNode } from 'react';

const CurrentUserContext = createContext<string | null>(null);

export function CurrentUserProvider({
  userId,
  children,
}: {
  userId: string;
  children: ReactNode;
}) {
  return <CurrentUserContext.Provider value={userId}>{children}</CurrentUserContext.Provider>;
}

/** Always a real id — every screen renders inside `AppGate`, which enforces that. */
export function useCurrentUserId(): string {
  const ctx = useContext(CurrentUserContext);
  if (ctx === null) {
    throw new Error('useCurrentUserId() must be used inside <CurrentUserProvider>.');
  }
  return ctx;
}
