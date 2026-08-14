/**
 * The weekly calendar — which workout is committed to on a given date.
 *
 * This sits alongside the rotation in `home.ts`, not instead of it. The rotation answers "what
 * comes next if you simply train"; the calendar answers "what did you sit down on Saturday and
 * commit to for this week". Where a date has a row, the calendar wins. Where it has none, the
 * rotation still decides — so a user who never opens the week editor sees no change at all.
 *
 * Everything here works in LOCAL dates as `YYYY-MM-DD` strings, never `Date` objects crossing a
 * boundary. A workout planned for Sunday is planned for the user's Sunday; storing an instant
 * would make it land on Saturday evening for anyone east of UTC, which is most of this app's
 * users.
 */

import type { SqlExecutor } from './executor.js';
import type { Clock, IdFactory } from './workouts.js';

const defaultClock: Clock = () => new Date().toISOString();

/** Sunday. The Israeli week starts on Sunday and Saturday is when the next one gets planned. */
const WEEK_STARTS_ON = 0;

export interface ScheduledDayRow {
  id: string;
  user_id: string;
  scheduled_on: string;
  plan_day_id: string | null;
}

/** One day of a week as the editor shows it. */
export interface ScheduledDay {
  /** `YYYY-MM-DD`, local. */
  date: string;
  /** 0 = Sunday … 6 = Saturday. */
  weekday: number;
  /**
   * The committed workout, or null for a rest day.
   *
   * `null` and "no entry" are different facts and both reach here as null — use `planned` to
   * tell them apart. A rest day the user chose should not be quietly refilled by the rotation.
   */
  planDayId: string | null;
  /** True when the user has decided this day, either a workout or a rest. */
  planned: boolean;
}

/* -------------------------------------------------------------------------- */
/* Date arithmetic                                                             */
/* -------------------------------------------------------------------------- */

/** A local `YYYY-MM-DD`, avoiding `toISOString` which converts to UTC first. */
export function localDate(date: Date): string {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** Parsed as local midnight, so the round trip through `localDate` is stable. */
export function parseLocalDate(date: string): Date {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(year ?? 1970, (month ?? 1) - 1, day ?? 1);
}

export function addDays(date: string, days: number): string {
  const parsed = parseLocalDate(date);
  parsed.setDate(parsed.getDate() + days);
  return localDate(parsed);
}

/** The Sunday on or before `date`. */
export function weekStart(date: string): string {
  const parsed = parseLocalDate(date);
  const shift = (parsed.getDay() - WEEK_STARTS_ON + 7) % 7;
  return addDays(date, -shift);
}

/**
 * The Sunday that begins the week after the one containing `date`.
 *
 * This is what "the coming week" means on a Saturday — and, deliberately, on every other day
 * too. Planning on Wednesday should reach the same week Saturday would, or the button would
 * mean something different depending on when it was pressed.
 */
export function nextWeekStart(date: string): string {
  return addDays(weekStart(date), 7);
}

/** The seven dates of the week beginning at `start`, Sunday first. */
export function weekDates(start: string): string[] {
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}

/* -------------------------------------------------------------------------- */
/* Reads                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * What is committed for one date.
 *
 * Returns `undefined` when nothing has been decided, distinct from `null` for a chosen rest day.
 * Callers that collapse the two put a workout on a day the user deliberately cleared.
 */
export async function scheduledFor(
  db: SqlExecutor,
  userId: string,
  date: string,
): Promise<string | null | undefined> {
  const row = await db.get<{ plan_day_id: string | null }>(
    `SELECT plan_day_id FROM scheduled_days
      WHERE user_id = ? AND scheduled_on = ? AND deleted_at IS NULL`,
    [userId, date],
  );
  return row === null ? undefined : row.plan_day_id;
}

/** A whole week, always seven entries, unplanned days included. */
export async function getWeek(
  db: SqlExecutor,
  userId: string,
  start: string,
): Promise<ScheduledDay[]> {
  const dates = weekDates(start);
  const rows = await db.all<ScheduledDayRow>(
    `SELECT * FROM scheduled_days
      WHERE user_id = ? AND scheduled_on >= ? AND scheduled_on <= ? AND deleted_at IS NULL`,
    [userId, dates[0], dates[6]],
  );
  const byDate = new Map(rows.map((row) => [row.scheduled_on, row]));

  return dates.map((date) => {
    const row = byDate.get(date);
    return {
      date,
      weekday: parseLocalDate(date).getDay(),
      planDayId: row?.plan_day_id ?? null,
      planned: row !== undefined,
    };
  });
}

/** True when no day of the week has been decided yet — what the Saturday prompt keys off. */
export async function isWeekUnplanned(
  db: SqlExecutor,
  userId: string,
  start: string,
): Promise<boolean> {
  const week = await getWeek(db, userId, start);
  return week.every((day) => !day.planned);
}

/* -------------------------------------------------------------------------- */
/* Writes                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Commit one date.
 *
 * `planDayId` null records a rest day; `clear` removes the decision entirely and hands the date
 * back to the rotation. Upsert by `(user_id, scheduled_on)`, which the UNIQUE constraint makes
 * the natural key — editing Sunday twice must not leave two Sundays.
 */
export async function setScheduledDay(
  db: SqlExecutor,
  userId: string,
  newId: IdFactory,
  date: string,
  planDayId: string | null,
  clock: Clock = defaultClock,
): Promise<void> {
  const now = clock();
  const existing = await db.get<{ id: string }>(
    `SELECT id FROM scheduled_days WHERE user_id = ? AND scheduled_on = ?`,
    [userId, date],
  );

  if (existing) {
    // `deleted_at = NULL` matters: re-planning a date that was cleared has to revive the row,
    // not leave a tombstone shadowing the new decision.
    await db.run(
      `UPDATE scheduled_days SET plan_day_id = ?, updated_at = ?, deleted_at = NULL WHERE id = ?`,
      [planDayId, now, existing.id],
    );
    return;
  }

  await db.run(
    `INSERT INTO scheduled_days (id, user_id, scheduled_on, plan_day_id, updated_at)
     VALUES (?, ?, ?, ?, ?)`,
    [newId(), userId, date, planDayId, now],
  );
}

/** Undo a decision, returning the date to the rotation. */
export async function clearScheduledDay(
  db: SqlExecutor,
  userId: string,
  date: string,
  clock: Clock = defaultClock,
): Promise<void> {
  const at = clock();
  await db.run(
    `UPDATE scheduled_days SET deleted_at = ?, updated_at = ? WHERE user_id = ? AND scheduled_on = ?`,
    [at, at, userId, date],
  );
}

/**
 * Copy the most recently planned week onto `start`.
 *
 * The weekly ritual is meant to be a confirmation, not a blank form. Most weeks look like the
 * last one, so the editor opens pre-filled and the user changes what differs — which is the
 * difference between a habit that survives and a chore that gets skipped.
 *
 * Only fills days that have no decision yet, so calling it never overwrites something already
 * committed for that week.
 */
export async function seedWeekFromPrevious(
  db: SqlExecutor,
  userId: string,
  newId: IdFactory,
  start: string,
  clock: Clock = defaultClock,
): Promise<boolean> {
  const source = await db.get<{ scheduled_on: string }>(
    `SELECT scheduled_on FROM scheduled_days
      WHERE user_id = ? AND scheduled_on < ? AND deleted_at IS NULL
      ORDER BY scheduled_on DESC LIMIT 1`,
    [userId, start],
  );
  if (!source) return false;

  const previous = await getWeek(db, userId, weekStart(source.scheduled_on));
  const target = await getWeek(db, userId, start);

  let copied = false;
  for (const [index, day] of previous.entries()) {
    if (!day.planned) continue;
    const destination = target[index];
    if (!destination || destination.planned) continue;
    await setScheduledDay(db, userId, newId, destination.date, day.planDayId, clock);
    copied = true;
  }
  return copied;
}
