/**
 * Everything the active-workout screen displays but never stores.
 *
 * The handoff is explicit that these are derived on every render: done/total counts, the header
 * progress bar, per-exercise volume, the next-set label and the rest ring's offset. Keeping them
 * as state would mean two sources of truth for the same fact, and the one that drifts is always
 * the copy — a set edited after being ticked would leave the volume showing the old number.
 *
 * Pure functions in a `.ts` file, deliberately apart from the screen: vitest cannot parse `.tsx`
 * in this project, and this is the part of that screen where an error is silent. A volume that is
 * quietly wrong looks exactly like a volume that is right.
 */

import type { UnitPreference } from '@fit/shared';

import { displayWeightToKg, kgToDisplay } from '../units.js';

export interface DerivedSet {
  weightKg: number | null;
  reps: number | null;
  done: boolean;
  /**
   * A ramp toward the work rather than the work itself.
   *
   * Stored since the warm-up button shipped, and until now invisible: the flag kept these sets
   * out of volume, personal records and the progression charts while the rows on screen looked
   * exactly like the ones that counted. A number that is excluded from everything and says so
   * nowhere is worse than one that is simply included.
   */
  isWarmup: boolean;
}

export interface DerivedExercise {
  name: string;
  sets: readonly DerivedSet[];
}

/* -------------------------------------------------------------------------- */
/* Set labels                                                                  */
/* -------------------------------------------------------------------------- */

export interface SetLabel {
  kind: 'warmup' | 'working';
  /** Position within its own kind, from 1. */
  ordinal: number;
}

/**
 * Number the working sets as if the warm-ups were not there.
 *
 * Rows were numbered by their position in the list, so ramping toward a lift turned "three sets
 * of eight" into sets four, five and six. The count that matters to a lifter — and the one the
 * volume and the charts already use — counts working sets alone, and the labels should agree
 * with the arithmetic rather than with the array index.
 *
 * Warm-ups are counted separately rather than skipped, so a card knows which ramp step it is
 * looking at even though the label only shows the kind.
 *
 * Position is respected, not sorted: a warm-up logged between two working sets is unusual, but
 * it is what happened, and renumbering it away would be the screen editing the record.
 */
export function labelSets(sets: readonly { isWarmup: boolean }[]): SetLabel[] {
  let warmups = 0;
  let working = 0;
  return sets.map((set) => {
    if (set.isWarmup) return { kind: 'warmup' as const, ordinal: ++warmups };
    return { kind: 'working' as const, ordinal: ++working };
  });
}

/* -------------------------------------------------------------------------- */
/* Progress                                                                    */
/* -------------------------------------------------------------------------- */

export interface SetProgress {
  done: number;
  total: number;
  /** 0–1, for the 4px track under the header. */
  fraction: number;
}

/**
 * How much of the workout is behind you.
 *
 * A workout with no sets reads as 0, not as complete. Dividing by zero would give NaN, which
 * React Native renders as a zero-width bar — indistinguishable from "not started", but only by
 * accident, and only until someone interpolates it into a width.
 */
export function setProgress(exercises: readonly DerivedExercise[]): SetProgress {
  let done = 0;
  let total = 0;
  for (const exercise of exercises) {
    for (const set of exercise.sets) {
      total += 1;
      if (set.done) done += 1;
    }
  }
  return { done, total, fraction: total === 0 ? 0 : done / total };
}

/* -------------------------------------------------------------------------- */
/* Volume                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Kilograms moved on this exercise: weight × reps, summed over the sets actually performed.
 *
 * Only completed sets count. The rest are a plan, and a plan is not volume — otherwise adding
 * three empty sets to the card would inflate the number before a single rep was lifted.
 *
 * A set missing either value contributes nothing rather than being treated as zero-weight or
 * one-rep. Bodyweight work is the common case here and it genuinely has no barbell load; guessing
 * would put a number on the card that no one lifted.
 */
export function exerciseVolume(sets: readonly DerivedSet[]): number {
  let total = 0;
  for (const set of sets) {
    if (!set.done) continue;
    if (set.weightKg === null || set.reps === null) continue;
    total += set.weightKg * set.reps;
  }
  return total;
}

/** Volume across every exercise — the number the finish summary reports. */
export function sessionVolume(exercises: readonly DerivedExercise[]): number {
  return exercises.reduce((sum, e) => sum + exerciseVolume(e.sets), 0);
}

/* -------------------------------------------------------------------------- */
/* The next set                                                                */
/* -------------------------------------------------------------------------- */

export interface NextSet {
  exerciseName: string;
  /** 1-based, as shown to the user. */
  setNumber: number;
}

/**
 * What the rest timer should say is coming up.
 *
 * The first unfinished set, reading exercises in order. Null when everything is ticked — at that
 * point the banner has nothing useful to promise and the screen should be offering to finish
 * instead.
 *
 * Deliberately not "the set after the one just completed": people work out of order, skip a set,
 * come back to it. Scanning from the top always names something real.
 */
export function nextSet(exercises: readonly DerivedExercise[]): NextSet | null {
  for (const exercise of exercises) {
    for (const [index, set] of exercise.sets.entries()) {
      if (!set.done) return { exerciseName: exercise.name, setNumber: index + 1 };
    }
  }
  return null;
}

/* -------------------------------------------------------------------------- */
/* Rest ring                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Rest length when nothing prescribes one.
 *
 * Lived in `components/restTime.ts` alongside the pre-handoff timer's arithmetic. That module
 * went with `RestTimer`; the constant did not, because it is a training default rather than a
 * rendering detail, and this is where the rest maths now lives.
 */
export const DEFAULT_REST_SECONDS = 90;

/**
 * `stroke-dashoffset` for the countdown ring, given a circumference.
 *
 * Full circle at the start, empty at zero: offset = C × (1 − remaining/total), exactly as the
 * handoff specifies. Clamped at both ends because `remaining` comes from a deadline minus
 * `Date.now()` — a phone that sleeps through the end of a rest wakes with a negative remainder,
 * and an offset past the circumference draws the stroke back on again.
 */
export function restRingOffset(remainingSeconds: number, totalSeconds: number, circumference: number): number {
  if (totalSeconds <= 0) return circumference;
  const ratio = clamp01(remainingSeconds / totalSeconds);
  return circumference * (1 - ratio);
}

/**
 * Seconds as `m:ss`.
 *
 * Never negative: a rest that ran over while the phone was locked shows 0:00, not -0:07. The
 * timer's job at that point is to say "go", and a negative number reads as a fault.
 */
export function formatRemaining(seconds: number): string {
  const safe = Math.max(0, Math.ceil(seconds));
  const minutes = Math.floor(safe / 60);
  return `${minutes}:${`${safe % 60}`.padStart(2, '0')}`;
}

const clamp01 = (n: number): number => (n < 0 ? 0 : n > 1 ? 1 : n);

/* -------------------------------------------------------------------------- */
/* Steppers                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * The handoff's step sizes: plates come in 2.5kg pairs, reps in ones.
 *
 * The imperial grid is 5 lb rather than a converted 2.5 kg, because it describes the same
 * physical fact in the other system — American plates come in 45/25/10/5/2.5 lb, so a pair of
 * fives is the smallest ordinary jump. Stepping by 5.51 lb (2.5 kg converted) would land on
 * numbers no rack can actually make.
 */
export const WEIGHT_STEP_KG = 2.5;
export const WEIGHT_STEP_LB = 5;
export const REPS_STEP = 1;

/**
 * Nudge a weight, keeping it on the step grid and never below zero.
 *
 * Snapped rather than simply added: a value carried over from a previous session (82.5) or typed
 * by hand (83) should still land on a plate-loadable number after a tap, not drift 0.5 off the
 * grid and stay there for the rest of the workout.
 *
 * Snapping happens in the unit the user is *reading*, then converts back — the grid is a fact
 * about the plates in front of them, not about the storage format. Stored values stay metric
 * either way.
 */
export function stepWeight(
  current: number | null,
  direction: 1 | -1,
  unit: UnitPreference = 'metric',
): number {
  const step = unit === 'imperial' ? WEIGHT_STEP_LB : WEIGHT_STEP_KG;
  const fromDisplay = current === null ? 0 : kgToDisplay(current, unit);
  const steppedDisplay = Math.round(fromDisplay / step) * step + direction * step;

  const kg = displayWeightToKg(Math.max(0, steppedDisplay), unit);
  // Rounded because neither 2.5 nor the pound ratio has an exact binary form: 0.1 + 2.5 lands on
  // 2.6000000000000005, which would render with a tail of decimals in a 21px numeral field.
  return Math.max(0, Math.round(kg * 100) / 100);
}

/** Reps never go below zero, and a set that has none yet starts at one on the first tap up. */
export function stepReps(current: number | null, direction: 1 | -1): number {
  if (current === null) return direction === 1 ? 1 : 0;
  return Math.max(0, current + direction * REPS_STEP);
}
