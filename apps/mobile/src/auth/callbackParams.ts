/**
 * Classifies the query params `app/auth/callback.tsx` receives from a password-recovery deep
 * link. Pulled out as a pure function so the dispatch logic is unit-testable — the screen
 * component itself is JSX and can't run under vitest.
 */

export type CallbackClassification =
  | { kind: 'code'; code: string }
  | { kind: 'expired' }
  | { kind: 'invalid' };

export interface CallbackParams {
  code?: string;
  type?: string;
  /** GoTrue's own verdict on a link it refused, e.g. `otp_expired`. */
  error_code?: string;
  error?: string;
}

/**
 * What arrives depends on GoTrue, and the app uses the PKCE flow: after the email link is
 * verified, GoTrue redirects to `fitapp://auth/callback?code=…` and nothing else — no `type`.
 * Whether that code is a password recovery is known on this phone, not from the URL: when the
 * reset was asked for, auth-js stored its code verifier marked `/recovery`, and
 * `exchangeCodeForSession` reports it back as `redirectType` (see `AuthProvider.exchangeCode`).
 *
 * This used to demand `type=recovery`, which a PKCE redirect never carries — so every genuine
 * reset link was turned away as expired (fixed 2026-11-07, reported as "password reset does
 * not work").
 *
 * A link that does name a type other than recovery (a sign-up confirmation from before signing
 * up stopped waiting on one, an email change, a magic link) is still not completed. A link
 * GoTrue itself refused comes back with `error_code` instead of a code, and is told as expired.
 */
export function classifyCallbackParams({
  code,
  type,
  error_code: errorCode,
  error,
}: CallbackParams): CallbackClassification {
  if (errorCode || error) return { kind: 'expired' };
  if (!code) return { kind: 'invalid' };
  if (type !== undefined && type !== 'recovery') return { kind: 'invalid' };
  return { kind: 'code', code };
}
