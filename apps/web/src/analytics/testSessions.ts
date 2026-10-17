/**
 * Workouts for tests, written the short way.
 *
 * `day` is a local date and the workout starts at six in the evening of it, local time, so a
 * test reads the same in any time zone the suite runs in.
 */

import type { CoachSession, CoachSet } from '@fit/shared/coaching';

import { parseDay } from './dates.js';

let counter = 0;

export interface ShortExercise {
  key: string;
  /** Working sets as [kg, reps]. */
  sets: readonly (readonly [number, number])[];
  /** Warm-up sets as [kg, reps], drawn before the working ones. */
  warmups?: readonly (readonly [number, number])[];
}

export function set(
  weight: number | null,
  reps: number | null,
  extra: Partial<CoachSet> = {},
): CoachSet {
  counter += 1;
  return {
    id: `set-${counter}`,
    weight_kg: weight,
    reps,
    duration_seconds: null,
    distance_m: null,
    rpe: null,
    is_warmup: 0,
    is_drop: 0,
    to_failure: 0,
    ...extra,
  };
}

export function workout(
  day: string,
  exercises: readonly ShortExercise[],
  extra: Partial<CoachSession> & { minutes?: number } = {},
): CoachSession {
  counter += 1;
  const start = parseDay(day);
  start.setHours(18, 0, 0, 0);
  const { minutes = 60, ...rest } = extra;
  return {
    id: `session-${counter}`,
    name: null,
    planDayId: null,
    startedAt: start.toISOString(),
    endedAt: new Date(start.getTime() + minutes * 60_000).toISOString(),
    rpe: null,
    note: null,
    exercises: exercises.map((exercise) => ({
      exerciseKey: exercise.key,
      supersetWithNext: false,
      sets: [
        ...(exercise.warmups ?? []).map(([w, r]) => set(w, r, { is_warmup: 1 })),
        ...exercise.sets.map(([w, r]) => set(w, r)),
      ],
    })),
    ...rest,
  };
}

export const BENCH = 'Barbell Bench Press';
export const SQUAT = 'Back Squat';
