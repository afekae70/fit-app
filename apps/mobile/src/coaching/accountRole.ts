/**
 * What kind of account this is — a trainee, a coach, an administrator — as something the rest
 * of the app can show.
 *
 * The answer lives on the server and nowhere else: a coach is a coach because the owner named
 * them, and stops being one the moment the owner says so. It is also the kind of thing a screen
 * wants to draw immediately, before any request has come back, and to go on drawing in a gym
 * with no signal. So the last answer is remembered on the phone, per account, and shown until
 * a fresh one replaces it.
 *
 * What is remembered is only ever a label. Nothing is allowed or refused because of it — every
 * coaching call is checked on the server, whatever this says — so a remembered "coach" that
 * has since been taken away shows a wrong word for a moment and opens no door.
 *
 * This file is the part with no React and no storage in it: what a remembered answer looks
 * like, and how one is read back.
 */

export interface AccountRole {
  role: 'coach' | 'trainee';
  /** May appoint coaches. Shown beside the role; an administrator is still one or the other. */
  isAdmin: boolean;
}

const safe = (userId: string) => userId.replace(/[^A-Za-z0-9_-]/g, '_') || 'local';

/** Where one account's last known role is kept. Per account: two people can share a phone. */
export function accountRoleKey(userId: string): string {
  return `account-role-${safe(userId)}`;
}

/** The form a role is remembered in. Short and readable, so a stored value can be eyeballed. */
export function serialiseRole(role: AccountRole): string {
  return role.isAdmin ? `${role.role}+admin` : role.role;
}

/**
 * A remembered role, read back. Null for nothing stored, and for anything not recognised — a
 * value written by some other version is treated as no answer rather than guessed at.
 */
export function parseStoredRole(raw: string | null | undefined): AccountRole | null {
  if (!raw) return null;
  const [role, flag, ...rest] = raw.split('+');
  if (rest.length > 0) return null;
  if (role !== 'coach' && role !== 'trainee') return null;
  if (flag !== undefined && flag !== 'admin') return null;
  return { role, isAdmin: flag === 'admin' };
}
