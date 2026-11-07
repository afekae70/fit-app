/**
 * The monthly review: every exercise of a month, judged once for the month as a whole — did it
 * get better, even slightly, stay the same, or go down — with something to try for the ones
 * that did not get better.
 *
 * Asked for by the owner (2026-11-07), and then made precise: the verdict is "once a month,
 * across the whole month, whether I progressed even a little or not — and not session after
 * session".
 *
 * ## What the month is set against
 *
 * The last time the exercise was done before the month began, if that was within the last
 * LOOKBACK_DAYS. Otherwise the month's own first session, and the rest of the month is set
 * against that.
 *
 * ## What the month did
 *
 * Set by set, the best the month produced: for the first working set, the best first set of any
 * session in the month; for the second, the best second set; and so on. "Best" is the app's one
 * rule (`setBySet.ts`): heavier, then more reps at the same weight. One good day in the month is
 * enough to count — that is what "even a little" means — and a bad last session does not undo it.
 *
 * Those are set against the same sets before the month. More sets improved than got worse is
 * improved; more worse than improved is declined; otherwise the same. A set done in the month
 * that was not there before counts as improved, and one never reached in the month as worse.
 *
 * ## Tips
 *
 * For the exercises that did not improve, the first rule that applies:
 *  1. Declined because the weight came down, or because there were fewer sets: say which.
 *  2. The reps fall away across the sets of the last session (12, 10, 7): more rest.
 *  3. Done once or twice in the month: frequency comes before anything cleverer.
 *  4. The month before did not improve either: a lighter week, or a variation.
 *  5. Otherwise: one more rep per set, then the next weight up.
 *
 * Pure. The sets come from `db/monthlyReview.ts`.
 */

import type { UnitPreference } from '../schemas/units.js';

import {
  compareSet,
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

export type MonthStatus = 'improved' | 'same' | 'declined' | 'new';

/** The order the review lists them in, which is also the order of its shortcuts. */
export const STATUS_ORDER: readonly MonthStatus[] = ['improved', 'same', 'declined', 'new'];

export type Tip =
  | { kind: 'lighter'; fromKg: number; toKg: number }
  | { kind: 'fewerSets'; from: number; to: number }
  | { kind: 'fadingSets'; firstReps: number; lastReps: number }
  | { kind: 'lowFrequency'; sessions: number }
  | { kind: 'twoMonths' }
  | { kind: 'addRep'; weightKg: number; targetReps: number }
  | { kind: 'addRepBodyweight'; targetReps: number };

/** One set of the month's best, and the day it was done. */
export interface BestSet {
  set: WorkingSet;
  startedAt: string;
}

/** What changed between the start and the month's best. */
export interface Gain {
  /** The top set's weight, best minus start. Zero when either had none. */
  weightKg: number;
  /** The top set's reps, when the weight did not change. Zero otherwise. */
  reps: number;
  /** Working sets, best minus start. */
  sets: number;
}

export interface ExerciseMonth {
  exerciseKey: string;
  status: MonthStatus;
  /** Sessions of this exercise in the month. */
  sessions: number;
  /** What the month is set against. Null for an exercise done once, and never before. */
  from: SessionSets | null;
  /** Whether `from` is from before the month, rather than the month's own first session. */
  fromBeforeMonth: boolean;
  /** The month's best, set by set. For a new exercise, its one session. */
  best: BestSet[];
  /** `best` against `from`, place by place. Empty without a `from`. */
  pairs: SetPair[];
  tally: Tally;
  gain: Gain | null;
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

/** How far back the session a month is set against may be. Older than that, start afresh. */
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

interface Judged {
  inMonth: SessionSets[];
  from: SessionSets | null;
  fromBeforeMonth: boolean;
  best: BestSet[];
  pairs: SetPair[];
  tally: Tally;
  status: MonthStatus;
}

/** The best set in each place across these sessions. */
function bestByPlace(sessions: readonly SessionSets[]): BestSet[] {
  const best: BestSet[] = [];
  for (const session of sessions) {
    session.sets.forEach((set, place) => {
      const held = best[place];
      if (!held || compareSet(set, held.set) === 'up') {
        best[place] = { set, startedAt: session.startedAt };
      }
    });
  }
  return best;
}

function judge(history: readonly SessionSets[], month: string): Judged | null {
  const { start, end } = monthBounds(month);
  const sorted = [...history].sort((a, b) => at(a) - at(b));
  const inMonth = sorted.filter((s) => at(s) >= start.getTime() && at(s) < end.getTime());
  if (inMonth.length === 0) return null;

  const baseline =
    sorted
      .filter((s) => at(s) < start.getTime() && at(s) >= start.getTime() - LOOKBACK_DAYS * DAY_MS)
      .at(-1) ?? null;
  const from = baseline ?? (inMonth.length >= 2 ? inMonth[0]! : null);

  if (!from) {
    return {
      inMonth,
      from: null,
      fromBeforeMonth: false,
      best: bestByPlace(inMonth),
      pairs: [],
      tally: { ...NO_TALLY },
      status: 'new',
    };
  }

  // Without a session before the month, the first one is the start, and only the rest count.
  const best = bestByPlace(baseline ? inMonth : inMonth.slice(1));
  const pairs = pairSets(
    best.map((b) => b.set),
    from.sets,
  );
  const tally = tallyOf(pairs);
  const net = improved(tally) - worse(tally);
  return {
    inMonth,
    from,
    fromBeforeMonth: baseline !== null,
    best,
    pairs,
    tally,
    status: net > 0 ? 'improved' : net < 0 ? 'declined' : 'same',
  };
}

function gainOf(from: readonly WorkingSet[], best: readonly WorkingSet[]): Gain {
  const top = { from: topSet(from), best: topSet(best) };
  const sets = best.length - from.length;
  if (top.from && top.best) {
    const weightKg = (top.best.weightKg ?? 0) - (top.from.weightKg ?? 0);
    const sameWeight = Math.abs(weightKg) <= WEIGHT_EPSILON;
    return {
      weightKg: sameWeight ? 0 : weightKg,
      reps: sameWeight ? (top.best.reps ?? 0) - (top.from.reps ?? 0) : 0,
      sets,
    };
  }
  // Without a weight on either side, the most reps in a set is what moved.
  const mostReps = (sets: readonly WorkingSet[]) => Math.max(0, ...sets.map((s) => s.reps ?? 0));
  return { weightKg: 0, reps: mostReps(best) - mostReps(from), sets };
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

function tipFor(judged: Judged, previous: MonthStatus | null): Tip | null {
  const { status, from, best, inMonth } = judged;
  if (status === 'improved' || status === 'new' || !from) return null;

  const bestSets = best.map((b) => b.set);
  const top = { from: topSet(from.sets), best: topSet(bestSets) };
  if (status === 'declined') {
    if (top.from && top.best && (top.best.weightKg ?? 0) < (top.from.weightKg ?? 0) - WEIGHT_EPSILON) {
      return { kind: 'lighter', fromKg: top.from.weightKg ?? 0, toKg: top.best.weightKg ?? 0 };
    }
    if (bestSets.length < from.sets.length) {
      return { kind: 'fewerSets', from: from.sets.length, to: bestSets.length };
    }
  }

  const fade = fading(inMonth.at(-1)!);
  if (fade) return { kind: 'fadingSets', ...fade };

  if (inMonth.length <= 2) return { kind: 'lowFrequency', sessions: inMonth.length };
  if (previous === 'same' || previous === 'declined') return { kind: 'twoMonths' };

  const reference = top.best ?? top.from;
  if (reference && reference.weightKg !== null && reference.reps !== null) {
    return { kind: 'addRep', weightKg: reference.weightKg, targetReps: reference.reps + 2 };
  }
  const mostReps = Math.max(0, ...bestSets.map((s) => s.reps ?? 0));
  return mostReps > 0 ? { kind: 'addRepBodyweight', targetReps: mostReps + 1 } : null;
}

/** One exercise's month, or null when it was not done in the month. */
export function reviewExercise(
  exerciseKey: string,
  history: readonly SessionSets[],
  month: string,
): ExerciseMonth | null {
  const judged = judge(history, month);
  if (!judged) return null;
  const previous = judge(history, shiftMonth(month, -1))?.status ?? null;
  return {
    exerciseKey,
    status: judged.status,
    sessions: judged.inMonth.length,
    from: judged.from,
    fromBeforeMonth: judged.fromBeforeMonth,
    best: judged.best,
    pairs: judged.pairs,
    tally: judged.tally,
    gain: judged.from
      ? gainOf(
          judged.from.sets,
          judged.best.map((b) => b.set),
        )
      : null,
    tip: tipFor(judged, previous),
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

/** The whole month: every exercise done in it, in the order of STATUS_ORDER. */
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
