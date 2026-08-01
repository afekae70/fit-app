/**
 * Classifies the query params `app/auth/callback.tsx` receives from a confirmation or
 * password-recovery deep link. Pulled out as a pure function so the dispatch logic is
 * unit-testable — the screen component itself is JSX and can't run under vitest.
 */

export type CallbackClassification =
  | { kind: 'signup'; code: string }
  | { kind: 'recovery'; code: string }
  | { kind: 'invalid' };

export interface CallbackParams {
  code?: string;
  type?: string;
}

/**
 * GoTrue always attaches `type` to these redirect URLs (`signup`, `recovery`, `email_change`,
 * ...) alongside the PKCE `code`. Anything without both a code and a recognised type is not a
 * link this screen knows how to complete — most likely opened by hand, already used, or from a
 * future Supabase auth flow this app doesn't support yet.
 */
export function classifyCallbackParams({ code, type }: CallbackParams): CallbackClassification {
  if (!code) return { kind: 'invalid' };
  if (type === 'signup' || type === 'email_change') return { kind: 'signup', code };
  if (type === 'recovery') return { kind: 'recovery', code };
  return { kind: 'invalid' };
}
