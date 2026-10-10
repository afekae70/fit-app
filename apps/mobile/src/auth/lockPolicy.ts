/**
 * When the app asks for a fingerprint, and when it does not.
 *
 * The part with no React and no native code in it — the decisions, so they can be tested. What
 * shows the system's fingerprint prompt is `appLock.ts`; what is on screen is `LockScreen.tsx`.
 *
 * ## What the lock is
 *
 * A door, not a vault. The session that signs the account in is on the phone either way; this
 * is for the phone left on a table, or handed to someone to look at a photo. It asks on the
 * way in and otherwise stays out of the way.
 *
 * ## The rules
 *
 *  - **On opening the app**, when someone is already signed in. Not straight after signing in
 *    with a password: they have just proved who they are the long way.
 *  - **On coming back to it** after it has been out of sight for a few minutes. Not every time
 *    it leaves the foreground — choosing a profile picture leaves the app and returns to it,
 *    and so does the fingerprint prompt itself.
 *  - **Never during a workout.** A fingerprint reader does not read a sweaty finger, and
 *    between sets is exactly when the phone is put down for longer than a few minutes and
 *    picked up by a hand that has just been holding a bar. Being kept out of the workout in
 *    progress is a worse failure than the door being open for the hour it lasts.
 *  - **Only for an account that asked for it**, with the switch in settings, and only where it
 *    can work: no fingerprint enrolled on the phone means no lock and no switch.
 */

/** How long the app can be out of sight before coming back to it asks again. */
export const RELOCK_AFTER_MS = 5 * 60 * 1000;

const safe = (userId: string) => userId.replace(/[^A-Za-z0-9_-]/g, '_') || 'local';

/** Where one account's choice is kept on this phone. Per account: two people can share one. */
export function appLockKey(userId: string): string {
  return `app-lock-${safe(userId)}`;
}

/**
 * The stored choice, read back. Off until it has been turned on.
 *
 * It began as on by default, and the owner changed that the day it shipped: being asked for a
 * fingerprint by an app that never mentioned one is a surprise, and for most people a training
 * log is not something to lock. So it is offered in settings and waits to be chosen. Anything
 * that is not exactly "on" — nothing stored, or a value some other version wrote — is off.
 */
export function parseLockSetting(raw: string | null | undefined): boolean {
  return raw === 'on';
}

export function serialiseLockSetting(on: boolean): string {
  return on ? 'on' : 'off';
}

interface Standing {
  /** The account's own switch. */
  enabled: boolean;
  /** The phone has a fingerprint (or equivalent) enrolled and can ask for it. */
  available: boolean;
  workoutInProgress: boolean;
}

/** Opening the app: is the door shut? */
export function locksOnOpen(state: Standing & { signedInJustNow: boolean }): boolean {
  if (!state.enabled || !state.available) return false;
  if (state.signedInJustNow) return false;
  return !state.workoutInProgress;
}

/** Coming back to the app after `awayMs` out of sight: is the door shut again? */
export function locksOnReturn(state: Standing & { awayMs: number }): boolean {
  if (!state.enabled || !state.available) return false;
  if (state.workoutInProgress) return false;
  return state.awayMs >= RELOCK_AFTER_MS;
}

export type UnlockFailure =
  /** They closed the prompt. Nothing went wrong; the button is still there. */
  | 'cancelled'
  /** Too many wrong attempts — the phone itself has stopped accepting fingerprints for now. */
  | 'locked_out'
  | 'failed';

/**
 * What a failed prompt was, from what the system said about it.
 *
 * The prompt comes from the library that keeps secrets (see `appLock.ts`), and it reports every
 * outcome that is not success as one kind of error with a sentence in it. The sentences are the
 * library's own and are matched loosely, because the difference only decides which line of
 * text is shown: misreading one shows the general message instead of the specific one.
 */
export function interpretUnlockError(message: string): UnlockFailure {
  if (/cancel/i.test(message)) return 'cancelled';
  if (/lockout/i.test(message)) return 'locked_out';
  return 'failed';
}

/**
 * The name under "welcome back": the one they gave, or failing that the part of the address
 * they sign in with that comes before the @ — which is what the home screen calls them too.
 */
export function lockGreetingName(
  displayName: string | null | undefined,
  email: string | null | undefined,
): string {
  const given = displayName?.trim();
  if (given) return given;
  return (email ?? '').split('@')[0] ?? '';
}
