/**
 * Classifies the query params `app/auth/callback.tsx` receives from a password-recovery deep
 * link. Pulled out as a pure function so the dispatch logic is unit-testable — the screen
 * component itself is JSX and can't run under vitest.
 */

export type CallbackClassification = { kind: 'recovery'; code: string } | { kind: 'invalid' };

export interface CallbackParams {
  code?: string;
  type?: string;
}

/**
 * GoTrue always attaches `type` to these redirect URLs (`signup`, `recovery`, `email_change`,
 * ...) alongside the PKCE `code`. Recovery is the only one this app sends. A sign-up
 * confirmation link is not completed any more: signing up no longer waits on one, so a link of
 * that kind is left over from before, and there is nothing for it to finish. Anything else is
 * a link this screen does not know what to do with — opened by hand, already used, or from a
 * Supabase flow the app does not use.
 */
export function classifyCallbackParams({ code, type }: CallbackParams): CallbackClassification {
  if (!code) return { kind: 'invalid' };
  if (type === 'recovery') return { kind: 'recovery', code };
  return { kind: 'invalid' };
}
