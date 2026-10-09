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

/**
 * A tag for a picture: a short value that is different for every picture chosen.
 *
 * The phone and the server compare tags to learn whether they hold the same picture, which is
 * a good deal cheaper than comparing pictures. It also becomes the file's name on the server,
 * so it is made only of characters that are safe in a path.
 */
export function newAvatarVersion(now: number): string {
  return `p${Math.max(0, Math.floor(now)).toString(36)}`;
}

/**
 * Where a picture lives on the server: a folder per account, a file per tag.
 *
 * The folder is the account's id because that is what the server checks — a signed-in user may
 * read and write inside the folder named after them and nowhere else (0011). A file per tag,
 * rather than one file overwritten, so that two phones uploading at once cannot leave the row
 * naming one picture while the file holds the other.
 */
export function avatarObjectPath(userId: string, version: string): string {
  return `${userId}/${version}`;
}
