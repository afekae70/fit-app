/**
 * Normalises Supabase/GoTrue's own error strings (always in English, regardless of device
 * locale) into a stable key the UI translates. Kept in its own module with no other imports —
 * `AuthProvider.tsx` pulls in `expo-secure-store`/`expo-sqlite` transitively (via `storage.ts`
 * and `db/provider.ts`), neither of which can load under vitest, so this pure string-matching
 * logic needs to live somewhere those native modules aren't in the import chain to be testable.
 */
export function friendlyAuthError(message: string): string {
  if (/invalid login credentials/i.test(message)) return 'invalid_credentials';
  if (/already registered/i.test(message)) return 'already_registered';
  if (/password should be at least/i.test(message)) return 'weak_password';
  if (/email not confirmed/i.test(message)) return 'email_not_confirmed';
  // GoTrue's per-request cooldown ("for security purposes, you can only request this after N
  // seconds") and its daily send-volume limit are two different messages with the same remedy —
  // wait and try again — so they share one user-facing key.
  if (/email rate limit exceeded/i.test(message)) return 'rate_limited';
  if (/for security purposes, you can only request this after/i.test(message)) return 'rate_limited';
  if (/new password should be different/i.test(message)) return 'same_password';
  // Covers an expired, already-used, or wrong-device confirmation/recovery link — PKCE's code
  // verifier is stored locally at request time and read back at exchange time, so a link opened
  // on a different device (or a second tap after the code was already consumed) fails here.
  if (/code verifier|invalid.*grant|invalid.*code/i.test(message)) return 'link_expired';
  return 'unknown';
}

/**
 * Shared between `AuthGate.tsx` and `app/auth/callback.tsx` — both surface the same set of
 * error keys (either from `friendlyAuthError` or, for `password_mismatch`, a purely local
 * client-side check) and must translate them identically.
 */
export const AUTH_ERROR_I18N_KEY: Record<string, string> = {
  invalid_credentials: 'auth.errorInvalidCredentials',
  already_registered: 'auth.errorAlreadyRegistered',
  weak_password: 'auth.errorWeakPassword',
  email_not_confirmed: 'auth.errorEmailNotConfirmed',
  not_configured: 'auth.errorNotConfigured',
  rate_limited: 'auth.errorRateLimited',
  same_password: 'auth.errorSamePassword',
  link_expired: 'auth.errorLinkExpired',
  password_mismatch: 'auth.errorPasswordMismatch',
  unknown: 'auth.errorUnknown',
};
