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
  /**
   * Rate of perceived exertion, 6-10, or null when it was not rated.
   *
   * How hard the set actually was, which the weight and the reps together still do not say:
   * eight reps left in reserve and eight reps to the edge are the same row otherwise.
   */
  rpe: number | null;
  /** The set was taken to the point where another rep was not going to happen. */
  toFailure: boolean;
  /** Continues the set above it, lighter and with no rest between them. */
  isDrop: boolean;
}

export interface DerivedExercise {
  name: string;
  sets: readonly DerivedSet[];
}

/* -------------------------------------------------------------------------- */
/* Set labels                                                                  */
/* -------------------------------------------------------------------------- */

export interface SetLabel {
  kind: 'warmup' | 'working' | 'drop';
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
export function labelSets(
  sets: readonly { isWarmup: boolean; isDrop?: boolean }[],
): SetLabel[] {
  let warmups = 0;
  let working = 0;
  return sets.map((set) => {
    if (set.isWarmup) return { kind: 'warmup' as const, ordinal: ++warmups };
    // A drop set continues the set above it rather than being a new one. Numbering it would
    // turn "three sets of curls" into five and disagree with the volume, which counts the drops
    // as work but not as separate sets.
    if (set.isDrop) return { kind: 'drop' as const, ordinal: working };
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

/* -------------------------------------------------------------------------- */
/* Stations                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * The exercises grouped into what you stand at, rather than what is listed.
 *
 * A superset is two or three exercises performed together with no rest between them, so showing
 * one of them alone would be the screen fighting the training. A station is a run of consecutive
 * exercises linked by `supersetWithNext`, and everything else is a station of one.
 *
 * Takes the links as plain booleans rather than the rows they came from: the grouping is about
 * adjacency and nothing else, and a helper that knew about session rows could not be tested
 * without building them.
 */
export function stations(links: readonly boolean[]): number[][] {
  const groups: number[][] = [];
  let current: number[] = [];

  for (let index = 0; index < links.length; index += 1) {
    current.push(index);
    // A link on the final exercise points at nothing. Treated as the end of the run rather than
    // as an error: the flag can outlive the exercise that followed it.
    const linked = links[index] === true && index < links.length - 1;
    if (!linked) {
      groups.push(current);
      current = [];
    }
  }

  return groups;
}

/**
 * Whether an exercise is finished.
 *
 * Warm-ups do not count either way — a ramp is not the work, and leaving one unticked should not
 * hold the whole exercise open. An exercise with no working sets at all is unfinished rather than
 * complete: an empty card is something still to do, and calling it done would march straight past
 * the exercise somebody just added.
 */
export function isExerciseDone(
  sets: readonly { done: boolean; isWarmup: boolean }[],
): boolean {
  const working = sets.filter((set) => !set.isWarmup);
  return working.length > 0 && working.every((set) => set.done);
}

/**
 * The station to be standing at, or null once every one of them is finished.
 *
 * Scanned from the top rather than tracked as a cursor, for the same reason `nextSet` is: people
 * work out of order, skip something and come back to it, and a cursor would be wrong the moment
 * they did. Null is a real answer — it is what the screen uses to offer finishing instead.
 */
export function firstUnfinishedStation(
  groups: readonly (readonly number[])[],
  done: readonly boolean[],
): number | null {
  for (const [index, group] of groups.entries()) {
    if (group.some((exercise) => !done[exercise])) return index;
  }
  return null;
}

/**
 * Where a horizontal drag across the focused exercise lands.
 *
 * Left to right, always: dragging the card leftwards brings the next exercise in from the right,
 * the way a filmstrip runs forward. Deliberately not mirrored for Hebrew — see the swipe handler
 * in the workout screen for why a workout reads as a sequence in time rather than as a sentence.
 *
 * Returns null for a drag that should snap back: too short to mean anything, or reaching past
 * either end of the workout. Null rather than the current station so the caller can tell "stay
 * here because nothing happened" from "move to where you already are", which animate differently.
 *
 * The threshold scales with the screen but stops at 80px, so a large phone does not demand a
 * longer swipe than a thumb comfortably makes.
 */
export function swipeTarget(
  dx: number,
  station: number,
  count: number,
  width: number,
): number | null {
  const threshold = Math.min(80, width * 0.22);
  if (Math.abs(dx) < threshold) return null;
  const target = dx < 0 ? station + 1 : station - 1;
  return target >= 0 && target < count ? target : null;
}
