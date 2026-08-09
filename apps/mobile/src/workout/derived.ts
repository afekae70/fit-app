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

export interface DerivedSet {
  weightKg: number | null;
  reps: number | null;
  done: boolean;
}

export interface DerivedExercise {
  name: string;
  sets: readonly DerivedSet[];
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

/** The handoff's step sizes: plates come in 2.5kg pairs, reps in ones. */
export const WEIGHT_STEP_KG = 2.5;
export const REPS_STEP = 1;

/**
 * Nudge a weight, keeping it on the step grid and never below zero.
 *
 * Snapped rather than simply added: a value carried over from a previous session (82.5) or typed
 * by hand (83) should still land on a plate-loadable number after a tap, not drift 0.5 off the
 * grid and stay there for the rest of the workout.
 */
export function stepWeight(current: number | null, direction: 1 | -1): number {
  const from = current ?? 0;
  const stepped = Math.round(from / WEIGHT_STEP_KG) * WEIGHT_STEP_KG + direction * WEIGHT_STEP_KG;
  // Rounded again because 2.5 has no exact binary form: 0.1 + 2.5 lands on 2.6000000000000005,
  // which would then render with a tail of decimals in a 21px numeral field.
  return Math.max(0, Math.round(stepped * 100) / 100);
}

/** Reps never go below zero, and a set that has none yet starts at one on the first tap up. */
export function stepReps(current: number | null, direction: 1 | -1): number {
  if (current === null) return direction === 1 ? 1 : 0;
  return Math.max(0, current + direction * REPS_STEP);
}
