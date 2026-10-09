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

import { getExecutor } from '../db/provider.js';
import { claimLocalData } from './claimLocalData.js';
import { getSupabaseClient } from './client.js';
import { friendlyAuthError } from './friendlyAuthError.js';
import { deleteAccount, type DeleteAccountOutcome } from './deleteAccount.js';
import { secureClaimStorage } from './storage.js';
import { deleteLocalAvatar } from '../profile/avatar.js';
import { removeCloudAvatars, resendAvatarLater } from '../profile/avatarCloud.js';

export interface AuthState {
  /** Undefined while the stored session is still being read; null once confirmed absent. */
  session: Session | null | undefined;
  /** False when app.json has no Supabase project configured yet. */
  isConfigured: boolean;
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  signUp: (email: string, password: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
  /**
   * Deletes the signed-in account: on the server, then everything of theirs on this device.
   * Irreversible, so the screen that calls it asks twice. See deleteAccount.ts for the order.
   */
  deleteAccount: () => Promise<DeleteAccountOutcome>;
  /** Sends a "reset your password" email with a link back into the app (see auth/callback.tsx). */
  resetPassword: (email: string) => Promise<{ error: string | null }>;
  /** Sets a new password — only meaningful once a recovery session exists (see auth/reset-password.tsx). */
  updatePassword: (newPassword: string) => Promise<{ error: string | null }>;
  /** Completes the PKCE round trip for a password-recovery deep link (see auth/callback.tsx). */
  exchangeCode: (code: string) => Promise<{ error: string | null }>;
}

/** Where the password-recovery email redirects back into the app (see app/auth/callback.tsx).
 *  The only email this app still sends: signing up no longer waits on one. */
const AUTH_CALLBACK_URL = 'fitapp://auth/callback';

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const client = useMemo(() => getSupabaseClient(), []);
  const [session, setSession] = useState<Session | null | undefined>(undefined);

  useEffect(() => {
    if (!client) {
      setSession(null);
      return;
    }

    let cancelled = false;

    // Idempotent by design (see claimLocalData.ts) — safe to call from both this initial
    // resolution and the onAuthStateChange subscription below without coordinating them,
    // even though both can fire for the same session on cold start.
    const claimIfSignedIn = (nextSession: Session | null) => {
      if (!nextSession) return;
      void getExecutor().then((db) => claimLocalData(db, nextSession.user.id, secureClaimStorage));
    };

    void client.auth.getSession().then(({ data }) => {
      if (cancelled) return;
      setSession(data.session);
      claimIfSignedIn(data.session);
    });

    // Keeps `session` current across sign-in, sign-out, and silent token refresh — without
    // this, a refreshed access token would sit in SecureStore while the coach screen kept
    // sending the stale one from the initial getSession() call.
    const { data: subscription } = client.auth.onAuthStateChange((_event, nextSession) => {
      if (cancelled) return;
      setSession(nextSession);
      claimIfSignedIn(nextSession);
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
        const { data, error } = await client.auth.signUp({ email, password });
        if (error) return { error: friendlyAuthError(error.message) };
        /*
         * Signing up is meant to sign you in: no confirmation email, no link to come back by.
         *
         * Whether it does is not this app's decision. It is a switch on the Supabase project
         * ("Confirm email"), and with it on the server makes the account and withholds the
         * session until a link in an email is followed. Nothing here can override that, and
         * pretending it worked would leave someone on a sign-in form that refuses a password
         * they have just chosen. So the case is named, and the screen says what happened.
         */
        if (!data.session) return { error: 'confirmation_required' };
        return { error: null };
      },
      signOut: async () => {
        await client?.auth.signOut();
      },
      deleteAccount: async () => {
        if (!client || !session) return { status: 'not_signed_in' };
        const db = await getExecutor();
        return deleteAccount({
          // Narrowed to the two things deletion uses, which keeps the module testable against
          // a stand-in and out of the Supabase client's generics.
          client: { rpc: (fn) => client.rpc(fn), auth: client.auth },
          db,
          userId: session.user.id,
          // Not `removeAvatar`: that records the change on the profile so it can be synced,
          // and by this point there is no profile left to record it on.
          clearDeviceState: deleteLocalAvatar,
          removeServerFiles: (userId) => removeCloudAvatars(client, userId),
          afterServerRefused: (userId) => resendAvatarLater(db, userId),
        });
      },
      resetPassword: async (email) => {
        if (!client) return { error: 'not_configured' };
        const { error } = await client.auth.resetPasswordForEmail(email, {
          redirectTo: AUTH_CALLBACK_URL,
        });
        return { error: error ? friendlyAuthError(error.message) : null };
      },
      updatePassword: async (newPassword) => {
        if (!client) return { error: 'not_configured' };
        const { error } = await client.auth.updateUser({ password: newPassword });
        return { error: error ? friendlyAuthError(error.message) : null };
      },
      exchangeCode: async (code) => {
        if (!client) return { error: 'not_configured' };
        const { error } = await client.auth.exchangeCodeForSession(code);
        return { error: error ? friendlyAuthError(error.message) : null };
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
