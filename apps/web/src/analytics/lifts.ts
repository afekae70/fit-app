/**
 * Strength, exercise by exercise: how each lift has moved, and when it was at its best.
 *
 * Every figure comes from the shared calculations the app shows its own user — `epley1RM`,
 * `bestEstimated1RM`, `assessStall` — so a coach reading "bench is stalling" here and a trainee
 * reading it on the phone are reading one verdict, not two that happen to agree.
 *
 * Only the sets that count: done, not warm-ups, with a weight and a number of reps. A timed or
 * distance exercise has no strength line and is left to the volume and the workout list.
 */

import {
  assessStall,
  epley1RM,
  isReliableRepRange,
  type StallAssessment,
  type WorkingSet,
} from '@fit/shared/calculations';
import { EXERCISE_BY_KEY } from '@fit/shared/catalog';
import type { CoachSession, CoachSet } from '@fit/shared/coaching';

import { localDate } from './dates.js';

/** A set that can carry a strength figure. */
function asWorkingSet(set: CoachSet): WorkingSet | null {
  if (set.is_warmup === 1 || set.weight_kg === null || set.reps === null) return null;
  if (set.reps < 1 || set.weight_kg < 0) return null;
  return { weightKg: set.weight_kg, reps: set.reps };
}

/** One workout's best effort on one exercise. */
export interface LiftPoint {
  sessionId: string;
  /** The local day of the workout. */
  date: string;
  startedAt: string;
  /** Best estimated one-rep max of the workout's working sets, kg. */
  e1rm: number;
  /** The set that produced it. */
  weightKg: number;
  reps: number;
  /** Weight times reps over the workout's working sets of this exercise. */
  volumeKg: number;
}

/**
 * An exercise's strength line, oldest first: one point per workout that had a reliable set.
 *
 * A workout of nothing but fifteen-rep sets has no point — the estimate is not trustworthy past
 * twelve, and the shared calculation leaves it out for that reason.
 */
export function liftSeries(sessions: readonly CoachSession[], exerciseKey: string): LiftPoint[] {
  const points: LiftPoint[] = [];
  for (const session of sessions) {
    const working: WorkingSet[] = [];
    for (const exercise of session.exercises) {
      if (exercise.exerciseKey !== exerciseKey) continue;
      for (const set of exercise.sets) {
        const lift = asWorkingSet(set);
        if (lift) working.push(lift);
      }
    }
    // The best estimated one-rep max, and the set that gave it — the first of equals, as it
    // was the record when it was done. The shared `bestEstimated1RM`, kept with its set.
    let top: WorkingSet | null = null;
    let best = -1;
    for (const lift of working) {
      if (!isReliableRepRange(lift.reps)) continue;
      const e1rm = epley1RM(lift.weightKg, lift.reps);
      if (e1rm > best) {
        best = e1rm;
        top = lift;
      }
    }
    if (!top) continue;
    points.push({
      sessionId: session.id,
      date: localDate(new Date(session.startedAt)),
      startedAt: session.startedAt,
      e1rm: round1(best),
      weightKg: top.weightKg,
      reps: top.reps,
      volumeKg: Math.round(working.reduce((sum, lift) => sum + lift.weightKg * lift.reps, 0)),
    });
  }
  return points.sort((a, b) =>
    a.startedAt < b.startedAt ? -1 : a.startedAt > b.startedAt ? 1 : 0,
  );
}

const round1 = (value: number) => Math.round(value * 10) / 10;

export interface ExerciseSummary {
  exerciseKey: string;
  /** Workouts in which it was done. */
  sessions: number;
  workingSets: number;
  volumeKg: number;
  /** The local day it was last done. */
  lastDone: string;
  /** The best estimated one-rep max in the period, and when; null for a lift with no reliable set. */
  bestE1rm: number | null;
  bestDate: string | null;
  /** The first and the latest workout's figures, for the change across the period. */
  firstE1rm: number | null;
  latestE1rm: number | null;
  /** The shared stall verdict over the last eight workouts. */
  stall: StallAssessment;
}

/**
 * Every exercise done in these workouts, most often done first.
 *
 * Most often first because that is what a coach scans for: the lifts the programme is built on
 * are the ones done every week, and a lift done once is not yet a trend.
 */
export function exerciseSummaries(sessions: readonly CoachSession[]): ExerciseSummary[] {
  const keys = new Map<
    string,
    { sessions: Set<string>; sets: number; volume: number; last: string }
  >();
  for (const session of sessions) {
    const day = localDate(new Date(session.startedAt));
    for (const exercise of session.exercises) {
      if (!exercise.exerciseKey) continue;
      const entry = keys.get(exercise.exerciseKey) ?? {
        sessions: new Set<string>(),
        sets: 0,
        volume: 0,
        last: day,
      };
      let counted = false;
      for (const set of exercise.sets) {
        if (set.is_warmup === 1) continue;
        counted = true;
        entry.sets += 1;
        entry.volume += (set.weight_kg ?? 0) * (set.reps ?? 0);
      }
      if (!counted) continue;
      entry.sessions.add(session.id);
      if (day > entry.last) entry.last = day;
      keys.set(exercise.exerciseKey, entry);
    }
  }

  const summaries: ExerciseSummary[] = [];
  for (const [exerciseKey, entry] of keys) {
    const series = liftSeries(sessions, exerciseKey);
    let best: LiftPoint | null = null;
    for (const point of series) if (!best || point.e1rm > best.e1rm) best = point;
    summaries.push({
      exerciseKey,
      sessions: entry.sessions.size,
      workingSets: entry.sets,
      volumeKg: Math.round(entry.volume),
      lastDone: entry.last,
      bestE1rm: best?.e1rm ?? null,
      bestDate: best?.date ?? null,
      firstE1rm: series[0]?.e1rm ?? null,
      latestE1rm: series[series.length - 1]?.e1rm ?? null,
      stall: assessStall(
        series.map((point) => ({
          date: new Date(point.startedAt),
          bestE1rmKg: point.e1rm,
          totalVolumeLoad: point.volumeKg,
        })),
      ),
    });
  }
  return summaries.sort(
    (a, b) =>
      b.sessions - a.sessions ||
      b.volumeKg - a.volumeKg ||
      a.exerciseKey.localeCompare(b.exerciseKey),
  );
}

/** A lift's change across the period, as a percentage of where it started; null without two points. */
export function changePercent(
  summary: Pick<ExerciseSummary, 'firstE1rm' | 'latestE1rm'>,
): number | null {
  const { firstE1rm, latestE1rm } = summary;
  if (firstE1rm === null || latestE1rm === null || firstE1rm <= 0) return null;
  return Math.round(((latestE1rm - firstE1rm) / firstE1rm) * 1000) / 10;
}

export interface NewRecord {
  exerciseKey: string;
  date: string;
  e1rm: number;
  weightKg: number;
  reps: number;
  /** The best before it, from the history that was loaded; null when it was the first. */
  previousE1rm: number | null;
}

/**
 * Records set in a period: workouts whose estimated one-rep max beat everything before them.
 *
 * `history` is everything loaded, the period and what came before it; only records falling on
 * or after `from` are returned, but "before" reaches back through all of it. A lift seen for the
 * first time in the period is not a record — there is nothing it beat — which keeps a new
 * exercise from flooding the list.
 */
export function recordsSince(history: readonly CoachSession[], from: string): NewRecord[] {
  const records: NewRecord[] = [];
  const keys = new Set<string>();
  for (const session of history) {
    for (const exercise of session.exercises)
      if (exercise.exerciseKey) keys.add(exercise.exerciseKey);
  }
  for (const key of keys) {
    let best: number | null = null;
    for (const point of liftSeries(history, key)) {
      if (best !== null && point.e1rm > best && point.date >= from) {
        records.push({
          exerciseKey: key,
          date: point.date,
          e1rm: point.e1rm,
          weightKg: point.weightKg,
          reps: point.reps,
          previousE1rm: best,
        });
      }
      if (best === null || point.e1rm > best) best = point.e1rm;
    }
  }
  return records.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
}

/** An exercise's name in Hebrew, or its key when the catalogue does not know it. */
export function exerciseName(key: string | null): string {
  if (!key) return '—';
  return EXERCISE_BY_KEY.get(key)?.nameHe ?? key;
}
