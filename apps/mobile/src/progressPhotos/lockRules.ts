/**
 * When the progress photos ask for a fingerprint.
 *
 * Photos of a body are the most private thing the app keeps, so they have a door of their own,
 * separate from the app lock in settings and on whether or not that is on: the app lock is for
 * a training log, which most people leave open, and this is for pictures, which they would not.
 *
 * The rules, decided here where they can be tested; the prompt itself is `unlockWithBiometrics`
 * in `auth/appLock.ts`, the one the app lock uses.
 *
 *  - **Every time the screen is opened**, unless it was unlocked a moment ago — going back to a
 *    photo just looked at, or coming back from the camera, should not ask twice.
 *  - **Again after time away.** Left on the screen and put down, it locks once the app has been
 *    out of sight for longer than that moment.
 *  - **Only where a fingerprint can be asked for.** A phone with none enrolled has no lock to
 *    offer; the screen says how to add one rather than pretend.
 */

/** How long an unlock is good for: long enough to step away to the camera and back. */
export const PHOTO_UNLOCK_GRACE_MS = 2 * 60 * 1000;

/** Whether opening the photos now has to ask for a fingerprint. */
export function needsUnlock(lastUnlockedAt: number | null, now: number): boolean {
  return lastUnlockedAt === null || now - lastUnlockedAt > PHOTO_UNLOCK_GRACE_MS;
}

/** Whether coming back to the app should lock the photos again. */
export function locksOnReturn(leftAt: number | null, now: number): boolean {
  return leftAt !== null && now - leftAt > PHOTO_UNLOCK_GRACE_MS;
}

/** The last unlock on this phone, while the app is running. Never stored: a restart asks again. */
let lastUnlockedAt: number | null = null;

export function photosUnlockedNow(now: number = Date.now()): void {
  lastUnlockedAt = now;
}

export function photosLastUnlockedAt(): number | null {
  return lastUnlockedAt;
}

/** For tests: forget the unlock, as a restart would. */
export function forgetPhotosUnlock(): void {
  lastUnlockedAt = null;
}
