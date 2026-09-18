/**
 * Names for a user's saved profile picture — apart from `avatar.ts` so they can be tested
 * without the native modules that file needs.
 *
 * SecureStore keys and file names both allow only a narrow set of characters, and a user id is
 * whatever the auth provider issued. Anything outside letters, digits, `-` and `_` becomes `_`.
 */

const safe = (userId: string) => userId.replace(/[^A-Za-z0-9_-]/g, '_') || 'local';

export function avatarStoreKey(userId: string): string {
  return `avatar-${safe(userId)}`;
}

/** A fresh name per picture, so a replaced photo can never be served from an image cache. */
export function avatarFileName(userId: string, now: number): string {
  return `avatar-${safe(userId)}-${now}.jpg`;
}
