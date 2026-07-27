/**
 * Session state for the one feature that needs it: the AI coach.
 *
 * Deliberately not a whole-app gate. Every other screen reads and writes local SQLite and works
 * fully offline — that was a considered design decision from Phase 2, not an oversight, and
 * forcing a login for it would be a regression. Auth exists solely to put a real user id on the
 * bearer token the coach endpoint checks, so the paid Claude/OpenAI calls behind it cannot be
 * run by an anonymous caller who found the server's URL.
 */

import type { Session } from '@supabase/supabase-js';
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import { getSupabaseClient } from './client.js';

export interface AuthState {
  /** Undefined while the stored session is still being read; null once confirmed absent. */
  session: Session | null | undefined;
  /** False when app.json has no Supabase project configured yet. */
  isConfigured: boolean;
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  signUp: (email: string, password: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

/** Supabase's own error strings are in English regardless of device locale; normalised here so
 * the sign-in screen can show a message in the user's language instead of raw GoTrue text. */
function friendlyAuthError(message: string): string {
  if (/invalid login credentials/i.test(message)) return 'invalid_credentials';
  if (/already registered/i.test(message)) return 'already_registered';
  if (/password should be at least/i.test(message)) return 'weak_password';
  if (/email not confirmed/i.test(message)) return 'email_not_confirmed';
  return 'unknown';
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const client = useMemo(() => getSupabaseClient(), []);
  const [session, setSession] = useState<Session | null | undefined>(undefined);

  useEffect(() => {
    if (!client) {
      setSession(null);
      return;
    }

    let cancelled = false;

    void client.auth.getSession().then(({ data }) => {
      if (!cancelled) setSession(data.session);
    });

    // Keeps `session` current across sign-in, sign-out, and silent token refresh — without
    // this, a refreshed access token would sit in SecureStore while the coach screen kept
    // sending the stale one from the initial getSession() call.
    const { data: subscription } = client.auth.onAuthStateChange((_event, nextSession) => {
      if (!cancelled) setSession(nextSession);
    });

    return () => {
      cancelled = true;
      subscription.subscription.unsubscribe();
    };
  }, [client]);

  const value = useMemo<AuthState>(
    () => ({
      session,
      isConfigured: client !== null,
      signIn: async (email, password) => {
        if (!client) return { error: 'not_configured' };
        const { error } = await client.auth.signInWithPassword({ email, password });
        return { error: error ? friendlyAuthError(error.message) : null };
      },
      signUp: async (email, password) => {
        if (!client) return { error: 'not_configured' };
        const { error } = await client.auth.signUp({ email, password });
        return { error: error ? friendlyAuthError(error.message) : null };
      },
      signOut: async () => {
        await client?.auth.signOut();
      },
    }),
    [client, session],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth() must be used inside <AuthProvider>.');
  return ctx;
}
