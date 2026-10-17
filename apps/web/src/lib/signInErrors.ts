/** What the auth server's refusal of a sign-in means, in the cases the page words differently. */

export type Failure = 'credentials' | 'unconfirmed' | 'offline' | 'other' | 'notConfigured';

/** What the auth server's refusal means, in the words this page has for it. */
export function readSignInError(error: {
  message?: string | undefined;
  status?: number | undefined;
  code?: string | undefined;
}): Failure {
  const message = (error.message ?? '').toLowerCase();
  if (error.code === 'email_not_confirmed' || message.includes('not confirmed'))
    return 'unconfirmed';
  if (error.code === 'invalid_credentials' || message.includes('invalid login'))
    return 'credentials';
  if (error.status === 0 || /fetch|network|failed to/i.test(message)) return 'offline';
  return 'other';
}
