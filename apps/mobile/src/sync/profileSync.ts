/**
 * Keeping the profile — and the profile picture — the same on the phone and in the cloud.
 *
 * The profile is not one of `SYNC_TABLES`, and not because it was forgotten. Those are lists of
 * rows: many of them, each with an id, created and deleted. The profile is one row per person
 * that is never created or deleted by hand, keyed differently on each side (`user_id` here,
 * `id` there), and edited a field at a time from four different screens. What it needs is not
 * "which rows changed" but "which *fields* did, and where".
 *
 * ## Three copies of every field
 *
 * For each field there is the value on this phone, the value on the server, and the value the
 * two last agreed on — kept on the phone in `profile.synced_json`. Comparing the three says
 * which side moved:
 *
 *   - phone and server agree                      → nothing to do
 *   - the phone differs from the agreement        → it was changed here: send it
 *   - only the server differs from the agreement  → it was changed elsewhere: take it
 *
 * So a goal changed on one phone and a height changed on another both survive, which a
 * whole-row "latest wins" would not manage. Where both sides changed the same field, this
 * phone's value is sent — the same rule the rest of sync follows, push before pull.
 *
 * ## The first meeting never blanks anything
 *
 * With no agreement yet there is no telling who changed what, so the rule is different: a field
 * this phone has a value for is sent, and a field it has nothing for is filled from the server.
 * Nothing is ever replaced by nothing.
 *
 * That is the case that matters most. A reinstalled app has an empty profile and a server full
 * of answers; treating "empty" as the newer value — which is what comparing timestamps would
 * do, the moment any screen saved a single field — would wipe the name, height and goal from
 * the only place they still existed.
 *
 * ## The picture
 *
 * A file, not a field, so it travels separately (see `PhotoPort`) and the profile row carries
 * only its name tag, `avatar_version`. The tag goes through the same three-way comparison. The
 * transfer happens first and the tag is written only once it has succeeded, so the row never
 * names a picture that is not there; a transfer that fails leaves the agreement untouched and
 * is simply attempted again next time, in the same direction.
 *
 * ## What never travels
 *
 * `role` and `coach_code` live on the same server row and are not in the list below. Whether an
 * account is a coach is decided by the owner, on the server. This file never sends them, and
 * since 0011 the server would refuse them if it did.
 */

import type { SqlExecutor } from '../db/executor.js';
import type { Clock } from '../db/workouts.js';

/** The fields a person fills in, under the name both sides give them. */
export const PROFILE_FIELDS = [
  'display_name',
  'birth_date',
  'sex',
  'bmr_formula_sex',
  'height_cm',
  'activity_level',
  'goal',
  'unit_preference',
] as const;

/** The profile picture's name tag. Compared like a field, moved like a file. */
export const PHOTO_FIELD = 'avatar_version';

export type ProfileField = (typeof PROFILE_FIELDS)[number] | typeof PHOTO_FIELD;

/** A field's value once it has been put in the one form both sides are compared in. */
export type ProfileValue = string | number | null;

/** What the two sides last agreed on. A field that is absent has never been agreed. */
export type Agreement = Partial<Record<ProfileField, ProfileValue>>;

/** The server's side of it: one row, read and written by the account that owns it. */
export interface ProfileTransport {
  /** The account's row as the server has it, or null if it has none yet. */
  fetch(userId: string): Promise<Record<string, unknown> | null>;
  /** Write these fields and no others. Rejects if the server will not take them. */
  update(userId: string, changes: Record<string, ProfileValue>): Promise<void>;
}

/**
 * Moving the picture itself. Everything here touches files or the network, so it is handed in:
 * the app passes the real thing and the tests pass one that only remembers what it was asked.
 *
 * Each of these rejects when it did not happen. That is the signal to leave the tag alone.
 */
export interface PhotoPort {
  /** Send the picture on this phone to the server, under this tag. */
  upload(userId: string, version: string): Promise<void>;
  /** Fetch the picture with this tag and make it the one this phone shows. */
  download(userId: string, version: string): Promise<void>;
  /** Delete a picture from the server that nothing names any more. */
  removeRemote(userId: string, version: string): Promise<void>;
  /** Go back to the initials on this phone. */
  removeLocal(userId: string): Promise<void>;
}

export type PhotoOutcome =
  /** The same picture on both sides, or none on either. */
  | 'unchanged'
  | 'uploaded'
  | 'downloaded'
  /** Removed from the server, because it was removed here. */
  | 'cleared'
  /** Removed from this phone, because it was removed elsewhere. */
  | 'removed'
  /** A transfer did not happen. It is attempted again on the next run. */
  | 'failed'
  /** The server has nowhere to keep one yet (0011 has not been run), or no port was given. */
  | 'unsupported';

export interface ProfileSyncResult {
  /**
   * `no_row` — the server has no profile for this account yet; nothing was compared.
   * `raced` — the profile was edited on this phone while this ran, so what was learned was not
   * written down. Whatever was sent has arrived; the rest is worked out again next time.
   */
  outcome: 'synced' | 'no_row' | 'raced';
  /** Field names only. What they hold is nobody's business in a log. */
  pushed: ProfileField[];
  pulled: ProfileField[];
  /** Fields this phone holds in a form the server would refuse. Left alone on both sides. */
  unsendable: ProfileField[];
  photo: PhotoOutcome;
  photoError?: string;
}

/**
 * What each choice field may hold. These are the server's CHECK constraints, restated: a value
 * outside them would have the whole update refused, taking the valid fields down with it.
 */
const CHOICES: Partial<Record<ProfileField, readonly string[]>> = {
  sex: ['male', 'female', 'other'],
  bmr_formula_sex: ['male', 'female'],
  activity_level: ['sedentary', 'light', 'moderate', 'active', 'very_active'],
  goal: ['cut', 'maintain', 'bulk'],
  unit_preference: ['metric', 'imperial'],
};

/**
 * One value, in the form the two sides are compared in — or `undefined` for a value that has
 * no such form, which callers treat as "do not touch this field".
 *
 * Comparing raw values would never settle. The server keeps height to two decimals, so 180.34
 * typed in feet and inches comes back as itself only by luck; it keeps a date of birth as a
 * date, so one stored here with a time on the end would differ from its own echo for ever, and
 * be sent again on every run.
 */
export function canonical(field: ProfileField, raw: unknown): ProfileValue | undefined {
  if (raw === null || raw === undefined) return null;
  // Every field is text or a number. Anything else is not a value at all.
  if (typeof raw !== 'string' && typeof raw !== 'number') return undefined;

  switch (field) {
    case 'height_cm': {
      const cm = typeof raw === 'number' ? raw : Number(raw);
      if (!Number.isFinite(cm)) return undefined;
      const rounded = Math.round(cm * 100) / 100;
      // The server's own range check.
      return rounded > 50 && rounded < 260 ? rounded : undefined;
    }
    case 'birth_date': {
      const day = String(raw).slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return undefined;
      const parsed = new Date(`${day}T00:00:00.000Z`);
      // The 31st of February parses, and comes back as the 3rd of March.
      if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== day) {
        return undefined;
      }
      return day;
    }
    case 'display_name':
      return String(raw);
    case 'avatar_version': {
      // It becomes part of a file path on the server, so only what is safe in one.
      const tag = String(raw);
      return /^[A-Za-z0-9_-]{1,64}$/.test(tag) ? tag : undefined;
    }
    default: {
      const choice = String(raw);
      return CHOICES[field]?.includes(choice) ? choice : undefined;
    }
  }
}

/** A picture's tag, which unlike the other fields is only ever text. */
function photoTag(raw: unknown): string | null | undefined {
  const tag = canonical(PHOTO_FIELD, raw);
  return typeof tag === 'number' ? undefined : tag;
}

export type Decision = 'same' | 'push' | 'pull';

/**
 * Which way one field goes. `agreed` is `undefined` when the two sides have never compared it.
 *
 * See the top of the file. The only line that is not obvious is the first meeting: a value
 * wins over no value, in either direction, and between two values this phone's is kept.
 */
export function decide(
  mine: ProfileValue,
  theirs: ProfileValue,
  agreed: ProfileValue | undefined,
): Decision {
  if (mine === theirs) return 'same';
  if (agreed === undefined) return mine !== null ? 'push' : 'pull';
  return mine === agreed ? 'pull' : 'push';
}

/** The agreement as stored. Anything unreadable is no agreement at all, which is the safe side. */
export function parseAgreement(json: string | null | undefined): Agreement {
  if (!json) return {};
  try {
    const parsed: unknown = JSON.parse(json);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const agreement: Agreement = {};
    for (const field of [...PROFILE_FIELDS, PHOTO_FIELD] as ProfileField[]) {
      if (!(field in parsed)) continue;
      const value = canonical(field, (parsed as Record<string, unknown>)[field]);
      if (value !== undefined) agreement[field] = value;
    }
    return agreement;
  } catch {
    return {};
  }
}

/** Always in the same field order, so two equal agreements are the same text. */
function serialiseAgreement(agreement: Agreement): string {
  const ordered: Agreement = {};
  for (const field of [...PROFILE_FIELDS, PHOTO_FIELD] as ProfileField[]) {
    if (field in agreement) ordered[field] = agreement[field];
  }
  return JSON.stringify(ordered);
}

const defaultClock: Clock = () => new Date().toISOString();

const NOTHING: Omit<ProfileSyncResult, 'outcome'> = {
  pushed: [],
  pulled: [],
  unsendable: [],
  photo: 'unchanged',
};

/**
 * One exchange of the profile between this phone and the server.
 *
 * Rejects only when the server could not be read or would not take the update; the caller logs
 * that and carries on, since nothing here is worth failing the rest of sync for. A picture that
 * would not move is not a rejection — the fields still go, and `photo` says `failed`.
 */
export async function syncProfile(
  db: SqlExecutor,
  transport: ProfileTransport,
  userId: string,
  photo: PhotoPort | null = null,
  clock: Clock = defaultClock,
): Promise<ProfileSyncResult> {
  const remote = await transport.fetch(userId);
  if (!remote) return { outcome: 'no_row', ...NOTHING };

  // Read after the fetch rather than before: everything between this read and the write at the
  // end is a window in which an edit on this phone would be missed, and the fetch is the one
  // slow step that can be kept out of it.
  const local = await db.get<Record<string, unknown>>(`SELECT * FROM profile WHERE user_id = ?`, [
    userId,
  ]);
  const agreed = parseAgreement(local?.synced_json as string | null | undefined);
  const nextAgreed: Agreement = { ...agreed };

  const toSend: Record<string, ProfileValue> = {};
  const toTake: Record<string, ProfileValue> = {};
  const unsendable: ProfileField[] = [];

  for (const field of PROFILE_FIELDS) {
    // A server that does not have the column yet. Not this field's turn.
    if (!(field in remote)) continue;
    const theirs = canonical(field, remote[field]);
    // Something on the server this version of the app does not understand. Leave both alone.
    if (theirs === undefined) continue;
    const mine = canonical(field, local?.[field]);
    if (mine === undefined) {
      unsendable.push(field);
      continue;
    }

    let decision = decide(mine, theirs, agreed[field]);
    // The server has no "never chosen" for units — the column is NOT NULL — so there is
    // nothing to send, and its value is as good as the default this phone would use anyway.
    if (decision === 'push' && mine === null && field === 'unit_preference') decision = 'pull';

    if (decision === 'same') nextAgreed[field] = mine;
    else if (decision === 'push') toSend[field] = mine;
    else toTake[field] = theirs;
  }

  /* ------------------------------------------------------------- the picture */
  let photoOutcome: PhotoOutcome = 'unchanged';
  let photoError: string | undefined;
  /** A picture on the server that will have nothing naming it once the update lands. */
  let orphan: string | null = null;

  if (!photo || !(PHOTO_FIELD in remote)) {
    photoOutcome = 'unsupported';
  } else {
    const theirs = photoTag(remote[PHOTO_FIELD]);
    const mine = photoTag(local?.[PHOTO_FIELD]);
    if (theirs !== undefined && mine !== undefined) {
      const decision = decide(mine, theirs, agreed[PHOTO_FIELD]);
      if (decision === 'same') {
        nextAgreed[PHOTO_FIELD] = mine;
      } else {
        try {
          if (decision === 'push') {
            if (mine !== null) await photo.upload(userId, mine);
            toSend[PHOTO_FIELD] = mine;
            orphan = theirs;
            photoOutcome = mine !== null ? 'uploaded' : 'cleared';
          } else {
            if (theirs !== null) await photo.download(userId, theirs);
            else await photo.removeLocal(userId);
            toTake[PHOTO_FIELD] = theirs;
            photoOutcome = theirs !== null ? 'downloaded' : 'removed';
          }
        } catch (error) {
          // The tag stays as it was on both sides, so the same transfer is tried again.
          photoOutcome = 'failed';
          photoError = error instanceof Error ? error.message : String(error);
        }
      }
    }
  }

  /* ------------------------------------------------------------------- send */
  const pushed = Object.keys(toSend) as ProfileField[];
  if (pushed.length > 0) {
    await transport.update(userId, toSend);
    for (const field of pushed) nextAgreed[field] = toSend[field];
  }
  if (orphan !== null && photo) {
    // Only now, with the row no longer pointing at it. If this fails the picture is merely
    // left behind in the user's own folder, where deleting the account still finds it.
    await photo.removeRemote(userId, orphan).catch(() => undefined);
  }

  /* ----------------------------------------------------- write down what was learned */
  const pulled = Object.keys(toTake) as ProfileField[];
  // What was taken is agreed on too — and is written in the same statement as the values
  // themselves, so the phone can never hold one without the other. Leaving these out would
  // have the next run see a value that differs from the agreement, conclude it was edited
  // here, and send the server's own answer back over whatever had changed there since.
  for (const field of pulled) nextAgreed[field] = toTake[field];
  const agreement = serialiseAgreement(nextAgreed);
  const previous = (local?.synced_json as string | null | undefined) ?? null;
  const result = { pushed, pulled, unsendable, photo: photoOutcome, photoError };

  if (pulled.length === 0 && agreement === previous) return { outcome: 'synced', ...result };

  const now = clock();
  let guard = local?.updated_at as string | undefined;
  if (!local) {
    // A phone that has never held a profile. `OR IGNORE`, so that a screen saving one at this
    // very moment wins the row, and the guard below then sees that it did.
    await db.run(`INSERT OR IGNORE INTO profile (user_id, updated_at) VALUES (?, ?)`, [
      userId,
      now,
    ]);
    guard = now;
  }

  /*
   * Guarded on the row being exactly as it was read.
   *
   * Between that read and here there was a request to the server, and possibly a picture going
   * one way or the other — seconds, on a bad connection, in which the user may have saved
   * something. Writing regardless would put the server's older answer on top of what they just
   * typed. With the guard the write simply does not happen: what they typed stays, differs from
   * the agreement, and is sent on the next run like any other edit.
   */
  const assignments = pulled.map((field) => `${field} = ?`);
  const params: unknown[] = pulled.map((field) => toTake[field]);
  assignments.push('synced_json = ?');
  params.push(agreement);
  if (pulled.length > 0) {
    assignments.push('updated_at = ?');
    params.push(now);
  }
  params.push(userId, guard);
  await db.run(
    `UPDATE profile SET ${assignments.join(', ')} WHERE user_id = ? AND updated_at = ?`,
    params,
  );

  const after = await db.get<{ synced_json: string | null }>(
    `SELECT synced_json FROM profile WHERE user_id = ?`,
    [userId],
  );
  if (after?.synced_json !== agreement) return { outcome: 'raced', ...result, pulled: [] };
  return { outcome: 'synced', ...result };
}

/**
 * The picture this phone's profile names is not on this phone.
 *
 * That is not the user removing it — removing it goes through `setAvatarVersion(null)` and is
 * sent like any change. This is a file that should be here and is not. So the tag is dropped
 * and, with it, the agreement about the tag: the next run then meets the server with nothing
 * and no history, which is the case that fetches the picture rather than deleting it there.
 */
export async function forgetMissingPhoto(
  db: SqlExecutor,
  userId: string,
  clock: Clock = defaultClock,
): Promise<void> {
  const row = await db.get<{ synced_json: string | null }>(
    `SELECT synced_json FROM profile WHERE user_id = ?`,
    [userId],
  );
  if (!row) return;
  const agreed = parseAgreement(row.synced_json);
  delete agreed[PHOTO_FIELD];
  await db.run(
    `UPDATE profile SET avatar_version = NULL, synced_json = ?, updated_at = ? WHERE user_id = ?`,
    [row.synced_json === null ? null : serialiseAgreement(agreed), clock(), userId],
  );
}
