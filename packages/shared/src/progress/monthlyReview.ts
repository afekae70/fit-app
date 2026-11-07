/**
 * The monthly review: every exercise of a month, where it ended against where it started, and
 * which ones are stuck — with one concrete thing to try for each of those.
 *
 * Asked for by the owner (2026-11-07): once a month, every exercise, by sets, weight and reps —
 * "to see where I am progressing and where I am stuck, so I can improve where I am stuck".
 *
 * ## What a month is read against
 *
 * The last time the exercise was done before the month began, if that was within the last
 * LOOKBACK_DAYS; otherwise the month's own first session. The month's last session is set
 * against it set by set, with the same rule as everywhere else in the app (`setBySet.ts`):
 * heavier is better, then more reps at the same weight, and a set more or fewer counts.
 *
 * ## Stuck
 *
 * Stuck is about now, not about the month as a whole. Three sessions in a row in which nothing
 * got better than the session before is stuck, even if the month started with a jump — the jump
 * is over. So is ending the month exactly where it began, with at least two sessions to show
 * for it. One repeat on its own is only "holding": a single unchanged session is a normal week.
 *
 * Declining wins over stuck: an exercise below where the month started is told so first.
 *
 * ## Tips
 *
 * Rules read off the sets themselves, the first that applies:
 *  1. The reps fall away across the sets (12, 10, 7): the later sets need more rest.
 *  2. Declining because the weight came down, or because there were fewer sets: say which.
 *  3. Done once or twice in the month: frequency comes before anything cleverer.
 *  4. Five sessions or more without anything better: a lighter week, or a variation.
 *  5. Otherwise, stuck at a weight: one more rep per set, then the next weight up.
 *
 * Pure. The sets come from `db/monthlyReview.ts`.
 */

import type { UnitPreference } from '@fit/shared';

import {
  improved,
  NO_TALLY,
  pairSets,
  tallyOf,
  topSet,
  worse,
  type SetPair,
  type Tally,
  type WorkingSet,
} from './setBySet.js';

/** One session of one exercise: its working sets in the order they were done. */
export interface SessionSets {
  sessionId: string;
  startedAt: string;
  sets: WorkingSet[];
}

export type MonthStatus = 'stuck' | 'declining' | 'progressing' | 'holding' | 'new';

/** The order the review lists them in: what needs attention first. */
export const STATUS_ORDER: readonly MonthStatus[] = [
  'stuck',
  'declining',
  'progressing',
  'holding',
  'new',
];

export type Tip =
  | { kind: 'fadingSets'; firstReps: number; lastReps: number }
  | { kind: 'lighter'; fromKg: number; toKg: number }
  | { kind: 'fewerSets'; from: number; to: number }
  | { kind: 'lowFrequency'; sessions: number }
  | { kind: 'longPlateau'; sessions: number }
  | { kind: 'addRep'; sessions: number; weightKg: number; targetReps: number }
  | { kind: 'addRepBodyweight'; sessions: number; targetReps: number };

/** What changed between where the month started and where it ended. */
export interface Gain {
  /** The top set's weight, end minus start. Zero when either had none. */
  weightKg: number;
  /** The top set's reps, when the weight did not change. Zero otherwise. */
  reps: number;
  /** Working sets in the session, end minus start. */
  sets: number;
}

export interface ExerciseMonth {
  exerciseKey: string;
  status: MonthStatus;
  /** Sessions of this exercise in the month. */
  sessions: number;
  /** What the month is read against. Null for an exercise done once, and never before. */
  from: SessionSets | null;
  /** Whether `from` is from before the month, rather than the month's own first session. */
  fromBeforeMonth: boolean;
  /** The month's last session. */
  to: SessionSets;
  /** `to` set against `from`, place by place. Empty without a `from`. */
  pairs: SetPair[];
  tally: Tally;
  gain: Gain | null;
  /** Sessions in a row, ending with the last, with nothing better than the one before. */
  flat: number;
  tip: Tip | null;
}

export interface MonthTotals {
  /** Workouts with at least one working set ticked off. */
  sessions: number;
  /** Working sets ticked off. */
  sets: number;
}

export interface MonthReview {
  month: string;
  exercises: ExerciseMonth[];
  counts: Record<MonthStatus, number>;
  totals: MonthTotals;
  /** The calendar month before, for comparison. */
  previous: MonthTotals;
}

/** How far back the session a month is read against may be. Older than that, start afresh. */
export const LOOKBACK_DAYS = 90;

const DAY_MS = 24 * 60 * 60 * 1000;
const WEIGHT_EPSILON = 0.01;

/* -------------------------------------------------------------------------- */
/* Months                                                                     */
/* -------------------------------------------------------------------------- */

/** `YYYY-MM` in the device's local calendar. */
export function monthOf(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

/** The month `by` months after `month` (negative for before). */
export function shiftMonth(month: string, by: number): string {
  const [year, index] = month.split('-').map(Number) as [number, number];
  return monthOf(new Date(year, index - 1 + by, 1));
}

/** Local midnight on the first of the month, and on the first of the next. */
export function monthBounds(month: string): { start: Date; end: Date } {
  const [year, index] = month.split('-').map(Number) as [number, number];
  return { start: new Date(year, index - 1, 1), end: new Date(year, index, 1) };
}

/**
 * The month the review opens on: the last whole month, because the review is of a month — and
 * on the first of every month a new one is ready. If last month has nothing in it, the current
 * month so far; if that is empty too, the latest month that has anything.
 */
export function defaultMonth(months: readonly string[], today: Date): string {
  const current = monthOf(today);
  const previous = shiftMonth(current, -1);
  if (months.includes(previous)) return previous;
  if (months.includes(current)) return current;
  return [...months].sort().at(-1) ?? current;
}

/** The months the review can be moved through: every month with training, and this one. */
export function reviewableMonths(months: readonly string[], today: Date): string[] {
  const current = monthOf(today);
  return [...new Set([...months, current])].filter((month) => month <= current).sort();
}

/* -------------------------------------------------------------------------- */
/* The review                                                                 */
/* -------------------------------------------------------------------------- */

const at = (session: SessionSets) => new Date(session.startedAt).getTime();

/** Whether a session is better than the one before it: more sets improved than got worse. */
function better(now: SessionSets, then: SessionSets): boolean {
  const tally = tallyOf(pairSets(now.sets, then.sets));
  return improved(tally) > worse(tally);
}

function gainOf(from: SessionSets, to: SessionSets): Gain {
  const top = { from: topSet(from.sets), to: topSet(to.sets) };
  const sets = to.sets.length - from.sets.length;
  if (top.from && top.to) {
    const weightKg = (top.to.weightKg ?? 0) - (top.from.weightKg ?? 0);
    const sameWeight = Math.abs(weightKg) <= WEIGHT_EPSILON;
    return {
      weightKg: sameWeight ? 0 : weightKg,
      reps: sameWeight ? (top.to.reps ?? 0) - (top.from.reps ?? 0) : 0,
      sets,
    };
  }
  // Without a weight on either side, the most reps in a set is what moved.
  const mostReps = (session: SessionSets) => Math.max(0, ...session.sets.map((s) => s.reps ?? 0));
  return { weightKg: 0, reps: mostReps(to) - mostReps(from), sets };
}

/** The reps of the first set and of the last set done at the first set's weight. */
function fading(session: SessionSets): { firstReps: number; lastReps: number } | null {
  const [first] = session.sets;
  if (!first || first.reps === null) return null;
  const same = session.sets.filter(
    (set) =>
      set.reps !== null &&
      Math.abs((set.weightKg ?? 0) - (first.weightKg ?? 0)) <= WEIGHT_EPSILON,
  );
  const last = same.at(-1);
  if (!last || same.length < 2 || last.reps === null) return null;
  // Two reps or more, from a set of at least five: a drop from 3 to 1 is a heavy single's
  // business, not a rest problem.
  return first.reps >= 5 && first.reps - last.reps >= 2
    ? { firstReps: first.reps, lastReps: last.reps }
    : null;
}

function tipFor(
  status: MonthStatus,
  sessions: number,
  flat: number,
  from: SessionSets,
  to: SessionSets,
): Tip | null {
  if (status === 'progressing' || status === 'new') return null;

  const fade = fading(to);
  if (fade) return { kind: 'fadingSets', ...fade };

  const top = { from: topSet(from.sets), to: topSet(to.sets) };
  if (status === 'declining') {
    if (top.from && top.to && (top.to.weightKg ?? 0) < (top.from.weightKg ?? 0) - WEIGHT_EPSILON) {
      return { kind: 'lighter', fromKg: top.from.weightKg ?? 0, toKg: top.to.weightKg ?? 0 };
    }
    if (to.sets.length < from.sets.length) {
      return { kind: 'fewerSets', from: from.sets.length, to: to.sets.length };
    }
  }

  if (sessions <= 2) return { kind: 'lowFrequency', sessions };
  if (flat >= 5) return { kind: 'longPlateau', sessions: flat };

  if (top.to && top.to.weightKg !== null && top.to.reps !== null) {
    return {
      kind: 'addRep',
      sessions: Math.max(flat, 2),
      weightKg: top.to.weightKg,
      targetReps: top.to.reps + 2,
    };
  }
  const mostReps = Math.max(0, ...to.sets.map((s) => s.reps ?? 0));
  if (mostReps > 0) {
    return { kind: 'addRepBodyweight', sessions: Math.max(flat, 2), targetReps: mostReps + 1 };
  }
  return null;
}

/** One exercise's month, or null when it was not done in the month. */
export function reviewExercise(
  exerciseKey: string,
  history: readonly SessionSets[],
  month: string,
): ExerciseMonth | null {
  const { start, end } = monthBounds(month);
  const sorted = [...history].sort((a, b) => at(a) - at(b));
  const inMonth = sorted.filter((s) => at(s) >= start.getTime() && at(s) < end.getTime());
  const to = inMonth.at(-1);
  if (!to) return null;

  const baseline =
    sorted
      .filter((s) => at(s) < start.getTime() && at(s) >= start.getTime() - LOOKBACK_DAYS * DAY_MS)
      .at(-1) ?? null;
  const line = baseline ? [baseline, ...inMonth] : inMonth;
  const from = baseline ?? (inMonth.length >= 2 ? inMonth[0]! : null);

  // How many sessions, counting back from the last, did nothing better than the one before.
  let flat = 1;
  for (let i = line.length - 1; i > 0 && !better(line[i]!, line[i - 1]!); i--) flat++;

  if (!from) {
    return {
      exerciseKey,
      status: 'new',
      sessions: inMonth.length,
      from: null,
      fromBeforeMonth: false,
      to,
      pairs: [],
      tally: { ...NO_TALLY },
      gain: null,
      flat,
      tip: null,
    };
  }

  const pairs = pairSets(to.sets, from.sets);
  const tally = tallyOf(pairs);
  const net = improved(tally) - worse(tally);
  const comparisons = line.length - 1;

  let status: MonthStatus;
  if (net < 0) status = 'declining';
  else if (flat >= 3) status = 'stuck';
  else if (net > 0) status = 'progressing';
  else status = comparisons >= 2 ? 'stuck' : 'holding';

  return {
    exerciseKey,
    status,
    sessions: inMonth.length,
    from,
    fromBeforeMonth: baseline !== null,
    to,
    pairs,
    tally,
    gain: gainOf(from, to),
    flat,
    tip: tipFor(status, inMonth.length, flat, from, to),
  };
}

function totalsBetween(
  history: ReadonlyMap<string, readonly SessionSets[]>,
  start: Date,
  end: Date,
): MonthTotals {
  const sessions = new Set<string>();
  let sets = 0;
  for (const line of history.values()) {
    for (const session of line) {
      const time = at(session);
      if (time < start.getTime() || time >= end.getTime() || session.sets.length === 0) continue;
      sessions.add(session.sessionId);
      sets += session.sets.length;
    }
  }
  return { sessions: sessions.size, sets };
}

/** The whole month: every exercise done in it, the stuck ones first. */
export function reviewMonth(
  history: ReadonlyMap<string, readonly SessionSets[]>,
  month: string,
): MonthReview {
  const exercises: ExerciseMonth[] = [];
  for (const [key, line] of history) {
    const reviewed = reviewExercise(key, line, month);
    if (reviewed) exercises.push(reviewed);
  }
  exercises.sort(
    (a, b) =>
      STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status) ||
      b.sessions - a.sessions ||
      a.exerciseKey.localeCompare(b.exerciseKey),
  );

  const counts = Object.fromEntries(STATUS_ORDER.map((status) => [status, 0])) as Record<
    MonthStatus,
    number
  >;
  for (const exercise of exercises) counts[exercise.status] += 1;

  const { start, end } = monthBounds(month);
  const before = monthBounds(shiftMonth(month, -1));
  return {
    month,
    exercises,
    counts,
    totals: totalsBetween(history, start, end),
    previous: totalsBetween(history, before.start, before.end),
  };
}

/**
 * The next weight up from `weightKg`, in kilograms: the smallest step a gym usually has.
 *
 * 2.5 kg, or 1 kg under 20 kg (dumbbells and machines step finer); in pounds, 5 lb, or 2.5 lb
 * under 45 lb. Returned in kilograms because every weight in the app is stored that way.
 */
export function nextWeightKg(weightKg: number, unit: UnitPreference): number {
  if (unit === 'imperial') {
    const lb = weightKg / 0.45359237;
    return (lb + (lb < 45 ? 2.5 : 5)) * 0.45359237;
  }
  return weightKg + (weightKg < 20 ? 1 : 2.5);
}
