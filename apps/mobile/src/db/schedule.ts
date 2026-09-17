/**
 * The weekly calendar — which workouts are committed to on a given date.
 *
 * A date holds nothing (undecided), a rest day, or one or more workouts in order. Several
 * workouts is a real pattern, not an edge case — weights in the morning and abs in the evening —
 * and a calendar that could only say one thing per day forced the second one out of the plan.
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
  position: number;
}

/**
 * What a date holds.
 *
 *   undefined  nothing decided — the rotation owns it
 *   null       a rest day the user chose
 *   string[]   one or more workouts, in the order they are done — never empty
 *
 * Three states, not two. Collapsing undecided into rest would stop the rotation filling days
 * nobody planned; collapsing rest into undecided would refill a day deliberately kept free.
 */
export type DayDecision = string[] | null | undefined;

/** The decision a set of rows for one date adds up to. Rows must already be in position order. */
function decisionOf(rows: readonly { plan_day_id: string | null }[]): DayDecision {
  if (rows.length === 0) return undefined;
  const workouts = rows.map((row) => row.plan_day_id).filter((id): id is string => id !== null);
  // A workout outranks a stray rest row for the same date. The writes below never produce both,
  // but a date that somehow held both is a date with training on it.
  return workouts.length > 0 ? workouts : null;
}

/** Rows for a span of dates, grouped by date, each group in position order. */
function groupByDate(rows: readonly ScheduledDayRow[]): Map<string, ScheduledDayRow[]> {
  const byDate = new Map<string, ScheduledDayRow[]>();
  for (const row of rows) {
    const group = byDate.get(row.scheduled_on) ?? [];
    group.push(row);
    byDate.set(row.scheduled_on, group);
  }
  return byDate;
}

/* Position first; the rest only settles order for rows written before positions existed. */
const DAY_ORDER = 'ORDER BY scheduled_on, position, updated_at, id';

/** One day of a week as the editor shows it. */
export interface ScheduledDay {
  /** `YYYY-MM-DD`, local. */
  date: string;
  /** 0 = Sunday … 6 = Saturday. */
  weekday: number;
  /**
   * The first committed workout, or null for a rest day.
   *
   * `null` and "no entry" are different facts and both reach here as null — use `planned` to
   * tell them apart. A rest day the user chose should not be quietly refilled by the rotation.
   */
  planDayId: string | null;
  /** Every committed workout, in order. Empty for a rest day and for an undecided one. */
  planDayIds: string[];
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
 * What is committed for one date — see `DayDecision`.
 *
 * Callers that collapse `undefined` and `null` put a workout on a day the user deliberately
 * cleared, or refuse one on a day nobody decided.
 */
export async function scheduledFor(
  db: SqlExecutor,
  userId: string,
  date: string,
): Promise<DayDecision> {
  const rows = await db.all<{ plan_day_id: string | null }>(
    `SELECT plan_day_id FROM scheduled_days
      WHERE user_id = ? AND scheduled_on = ? AND deleted_at IS NULL
      ORDER BY position, updated_at, id`,
    [userId, date],
  );
  return decisionOf(rows);
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
      WHERE user_id = ? AND scheduled_on >= ? AND scheduled_on <= ? AND deleted_at IS NULL
      ${DAY_ORDER}`,
    [userId, dates[0], dates[6]],
  );
  const byDate = groupByDate(rows);

  return dates.map((date) => {
    const decision = decisionOf(byDate.get(date) ?? []);
    return {
      date,
      weekday: parseLocalDate(date).getDay(),
      planDayId: decision?.[0] ?? null,
      planDayIds: decision ?? [],
      planned: decision !== undefined,
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
 * Replace everything decided for one date.
 *
 * `null` records a rest day, a list records those workouts in that order, and duplicates in the
 * list are dropped — the same workout twice on one date is a typo, not a plan.
 *
 * Rows are deleted rather than tombstoned. The calendar is local only (it is not in the sync
 * tables), so there is nobody to tell about a deletion, and with several rows per date a
 * tombstone would have to be matched to the row it shadows — which is exactly the kind of
 * bookkeeping that ends with a cleared workout reappearing.
 */
export async function setScheduledWorkouts(
  db: SqlExecutor,
  userId: string,
  newId: IdFactory,
  date: string,
  planDayIds: readonly string[] | null,
  clock: Clock = defaultClock,
): Promise<void> {
  const now = clock();
  await db.run(`DELETE FROM scheduled_days WHERE user_id = ? AND scheduled_on = ?`, [userId, date]);

  const entries: (string | null)[] = planDayIds === null ? [null] : [...new Set(planDayIds)];
  for (const [position, planDayId] of entries.entries()) {
    await db.run(
      `INSERT INTO scheduled_days (id, user_id, scheduled_on, plan_day_id, position, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [newId(), userId, date, planDayId, position, now],
    );
  }
}

/**
 * Commit one date to a single workout, or to rest when `planDayId` is null.
 *
 * Replaces whatever the date held — including a second workout. Use `addScheduledWorkout` to put
 * another workout on a day that already has one.
 */
export async function setScheduledDay(
  db: SqlExecutor,
  userId: string,
  newId: IdFactory,
  date: string,
  planDayId: string | null,
  clock: Clock = defaultClock,
): Promise<void> {
  await setScheduledWorkouts(db, userId, newId, date, planDayId === null ? null : [planDayId], clock);
}

/**
 * Add a workout after the ones already on a date.
 *
 * On a rest day it replaces the rest — deciding to train is the newer decision. A workout
 * already on the date is left where it is rather than added twice.
 */
export async function addScheduledWorkout(
  db: SqlExecutor,
  userId: string,
  newId: IdFactory,
  date: string,
  planDayId: string,
  clock: Clock = defaultClock,
): Promise<void> {
  const current = await scheduledFor(db, userId, date);
  const workouts = Array.isArray(current) ? current : [];
  if (workouts.includes(planDayId)) return;
  await setScheduledWorkouts(db, userId, newId, date, [...workouts, planDayId], clock);
}

/**
 * Take one workout off a date, keeping the others in order.
 *
 * Removing the last one leaves the date undecided rather than turning it into a rest day: taking
 * a workout out of the plan is not the same statement as choosing to rest.
 */
export async function removeScheduledWorkout(
  db: SqlExecutor,
  userId: string,
  newId: IdFactory,
  date: string,
  planDayId: string,
  clock: Clock = defaultClock,
): Promise<void> {
  const current = await scheduledFor(db, userId, date);
  if (!Array.isArray(current) || !current.includes(planDayId)) return;
  const remaining = current.filter((id) => id !== planDayId);
  if (remaining.length === 0) {
    await clearScheduledDay(db, userId, date);
    return;
  }
  await setScheduledWorkouts(db, userId, newId, date, remaining, clock);
}

/** Undo every decision for a date, returning it to the rotation. */
export async function clearScheduledDay(db: SqlExecutor, userId: string, date: string): Promise<void> {
  await db.run(`DELETE FROM scheduled_days WHERE user_id = ? AND scheduled_on = ?`, [userId, date]);
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
    await setScheduledWorkouts(
      db,
      userId,
      newId,
      destination.date,
      day.planDayIds.length > 0 ? day.planDayIds : null,
      clock,
    );
    copied = true;
  }
  return copied;
}

/* -------------------------------------------------------------------------- */
/* Months                                                                      */
/* -------------------------------------------------------------------------- */

/** How far back to look for a week worth repeating. Two months covers a planned previous month. */
const LOOKBACK_WEEKS = 8;

/** `YYYY-MM` for the month a local date falls in. */
export function monthKey(date: string): string {
  return date.slice(0, 7);
}

/**
 * Move a `YYYY-MM` by whole months.
 *
 * Done in integer months rather than through `Date.setMonth`, which overflows: one month after
 * January 31st lands on March 3rd, and a calendar that skips February when opened on the 31st is
 * a bug nobody reproduces on the day they go looking for it.
 */
export function addMonths(month: string, delta: number): string {
  const [year, mon] = month.split('-').map(Number);
  const total = (year ?? 1970) * 12 + ((mon ?? 1) - 1) + delta;
  const nextYear = Math.floor(total / 12);
  const nextMonth = total - nextYear * 12 + 1;
  return `${nextYear}-${String(nextMonth).padStart(2, '0')}`;
}

export interface MonthCell {
  /** `YYYY-MM-DD`, local. */
  date: string;
  /** False for days borrowed from the neighbouring months to complete the first and last rows. */
  inMonth: boolean;
}

/**
 * A month laid out as a calendar: whole weeks, Sunday first, seven cells a row.
 *
 * The first and last rows borrow days from the months either side, so a month is four to six
 * rows — February 2026 starts on a Sunday and is exactly four, August 2026 starts on a Saturday
 * and needs six. Fixing the grid at six rows would be simpler and would leave an empty row under
 * most months, which on a phone is a sixth of the screen spent on nothing.
 *
 * Built from `weekStart` and `addDays`, the same local-date arithmetic the week editor uses, so
 * the two views cannot disagree about which Sunday a date belongs to.
 */
export function monthGrid(month: string): MonthCell[][] {
  const end = `${addMonths(month, 1)}-01`;
  const rows: MonthCell[][] = [];
  // `YYYY-MM-DD` strings compare correctly as plain text, which is what makes this loop safe.
  for (let cursor = weekStart(`${month}-01`); cursor < end; cursor = addDays(cursor, 7)) {
    rows.push(weekDates(cursor).map((date) => ({ date, inMonth: monthKey(date) === month })));
  }
  return rows;
}

/**
 * Every decision between two local dates, inclusive.
 *
 * A date with workouts maps to their plan days in order, a chosen rest day maps to null, and an
 * undecided date is absent — so `has` answers "was this decided" and `get` answers "decided as
 * what". Folding rest and undecided into one value would lose the distinction the rotation
 * depends on.
 */
export async function getRange(
  db: SqlExecutor,
  userId: string,
  from: string,
  to: string,
): Promise<Map<string, string[] | null>> {
  const rows = await db.all<ScheduledDayRow>(
    `SELECT * FROM scheduled_days
      WHERE user_id = ? AND scheduled_on >= ? AND scheduled_on <= ? AND deleted_at IS NULL
      ${DAY_ORDER}`,
    [userId, from, to],
  );
  const range = new Map<string, string[] | null>();
  for (const [date, group] of groupByDate(rows)) {
    const decision = decisionOf(group);
    if (decision !== undefined) range.set(date, decision);
  }
  return range;
}

/**
 * Plan a month in one go, from a week that is already planned.
 *
 * Every undecided date from `today` to the end of the month takes what was chosen on the same
 * weekday in the source week — the workout, or the rest. Weekdays the source week left undecided
 * stay undecided, so the rotation keeps owning them exactly as before.
 *
 * It only ever fills. A date already decided keeps its decision, and nothing before `today` is
 * touched: rewriting the past of a calendar is not planning, and a fill that quietly changed
 * last week would make every other view of the calendar untrustworthy.
 *
 * The source is the fullest recently planned week — most days decided, the latest one if two
 * tie — not simply the week of the latest decision. Planning one special Sunday three weeks out
 * would otherwise make that single date the entire pattern, and a fully planned first week would
 * be ignored in favour of it.
 *
 * Returns how many dates it wrote, so the screen can say what happened.
 */
export async function repeatWeekAcrossMonth(
  db: SqlExecutor,
  userId: string,
  newId: IdFactory,
  month: string,
  today: string,
  clock: Clock = defaultClock,
): Promise<number> {
  const monthStart = `${month}-01`;
  const monthEnd = addDays(`${addMonths(month, 1)}-01`, -1);
  const lookbackStart = addDays(weekStart(monthStart), -7 * LOOKBACK_WEEKS);

  const recent = await getRange(db, userId, lookbackStart, monthEnd);

  const byWeek = new Map<string, Map<number, string[] | null>>();
  for (const [date, decision] of recent) {
    const start = weekStart(date);
    const week = byWeek.get(start) ?? new Map<number, string[] | null>();
    week.set(parseLocalDate(date).getDay(), decision);
    byWeek.set(start, week);
  }

  let pattern: Map<number, string[] | null> | undefined;
  let patternStart = '';
  for (const [start, week] of byWeek) {
    const fuller = !pattern || week.size > pattern.size;
    const laterTie = pattern !== undefined && week.size === pattern.size && start > patternStart;
    if (fuller || laterTie) {
      pattern = week;
      patternStart = start;
    }
  }
  if (!pattern) return 0;

  let written = 0;
  const first = today > monthStart ? today : monthStart;
  for (let date = first; date <= monthEnd; date = addDays(date, 1)) {
    if (recent.has(date)) continue;
    const weekday = parseLocalDate(date).getDay();
    if (!pattern.has(weekday)) continue;
    await setScheduledWorkouts(db, userId, newId, date, pattern.get(weekday) ?? null, clock);
    written += 1;
  }
  return written;
}
