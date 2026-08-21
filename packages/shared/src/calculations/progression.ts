/**
 * What to lift today, given what was lifted last time.
 *
 * The app already shows last session's sets under every exercise and, when the session came
 * from a plan, the range it prescribed. What it never did was the arithmetic between them —
 * the user reads `82.5×8 · 82.5×8 · 82.5×8`, remembers the target was 8, and works out for
 * themselves that it is time to add weight. This does that step.
 *
 * ## Double progression
 *
 * Reps first, then weight. Fill the prescribed rep range at the current load; once every set
 * reaches the top of the range, the load goes up and the reps drop back to the bottom of it.
 * This is the standard for a reason — adding weight while sets are still falling short means
 * carrying a failed session forward into a heavier one.
 *
 * ## When nothing was prescribed
 *
 * Most sessions are not started from a plan, and those have no rep range at all. Rather than
 * invent one — any number chosen here would be a guess about someone else's training — the
 * gate becomes last session's own shape: **did every set hold the same reps?**
 *
 * Three sets of 8 is a load that was completed. `8, 7, 6` is a load that was not, whatever the
 * target was supposed to be, and the honest suggestion is to repeat it rather than to climb.
 * This needs at least two sets; a single set has no drop-off to show.
 *
 * ## The step size
 *
 * `WEIGHT_STEP_KG` — the same 2.5 kg the +/- buttons move by, doubled for the lower-body
 * patterns that carry enough load to make 2.5 kg noise. There is deliberately no table of
 * per-machine increments: a cable stack that only pins in fives is something the lifter can
 * see, and the suggestion lands on the same grid the steppers already use rather than a second
 * one that disagrees with them.
 */

import type { LoadType, MovementPattern } from '../catalog/exercises.js';

/** The app's stepper grid, and therefore the grid every suggestion lands on. */
const STEP_KG = 2.5;

/**
 * Patterns that move the whole body against the floor, where 2.5 kg is inside the noise of a
 * good night's sleep. Everything else — presses, rows, curls — climbs one step at a time.
 */
const LOWER_BODY: ReadonlySet<MovementPattern> = new Set(['squat', 'hinge', 'lunge']);

/** How far a stall backs off before building again. */
const DELOAD_FRACTION = 0.1;

export interface CompletedSet {
  weightKg: number | null;
  reps: number | null;
}

export interface ProgressionInput {
  /** Last session's **working** sets for this exercise, in order. Warm-ups must be excluded. */
  lastSets: readonly CompletedSet[];
  /** The plan's rep range, when the session came from one. */
  repsMin?: number | null;
  repsMax?: number | null;
  movementPattern: MovementPattern;
  /** Defaults to `weight_reps`, matching `ExerciseSeed`. */
  loadType?: LoadType;
  /** From `assessStall`. A stall outranks every other rule. */
  isStalling?: boolean;
}

export type ProgressionAdvice =
  /** The range is full at this load. Go up, and start the range again from the bottom. */
  | { kind: 'add_weight'; weightKg: number; reps: number; fromKg: number }
  /** The load stands; there are reps left in it. */
  | { kind: 'add_reps'; weightKg: number; reps: number; fromReps: number }
  /** Nothing has beaten the best in a while. Back off and build into it again. */
  | { kind: 'deload'; weightKg: number; reps: number; fromKg: number };

/** Round to the nearest step, staying clear of float drift on repeated 2.5s. */
function snap(kg: number, direction: 'down' | 'nearest'): number {
  const steps = kg / STEP_KG;
  const rounded = direction === 'down' ? Math.floor(steps) : Math.round(steps);
  return Number((rounded * STEP_KG).toFixed(2));
}

/**
 * Decide what to suggest, or nothing.
 *
 * Returns null rather than a neutral verdict whenever there is no basis — an exercise that is
 * not loaded in kilograms, a first session with no history, a lone set with no shape to read.
 * A suggestion the data does not support is worse than silence, because the user cannot tell
 * the two apart once it is on screen.
 */
export function suggestProgression(input: ProgressionInput): ProgressionAdvice | null {
  const { lastSets, repsMin, repsMax, movementPattern, loadType = 'weight_reps', isStalling } =
    input;

  // Bodyweight, timed and distance work all progress, but not by adding kilograms — and the
  // number this returns would be written straight into a weight field.
  if (loadType !== 'weight_reps') return null;

  // Only sets that actually recorded both halves can be reasoned about. A set with a weight and
  // no reps is a row someone started and left.
  const done = lastSets.filter(
    (set): set is { weightKg: number; reps: number } =>
      typeof set.weightKg === 'number' &&
      set.weightKg > 0 &&
      typeof set.reps === 'number' &&
      set.reps > 0,
  );
  if (done.length === 0) return null;

  // The heaviest set is the one the suggestion is about. Sets below it are back-offs or the
  // tail of a drop set, and progressing off the lightest of them would suggest going backwards.
  const topKg = Math.max(...done.map((set) => set.weightKg));
  const atTop = done.filter((set) => set.weightKg === topKg);

  const step = LOWER_BODY.has(movementPattern) ? STEP_KG * 2 : STEP_KG;

  if (isStalling) {
    // Snapped down, and never a no-op: 10% of a light lift can round to nothing, and a deload
    // that changes no number is advice the user cannot act on.
    const target = Math.min(snap(topKg * (1 - DELOAD_FRACTION), 'down'), topKg - step);
    // Below one step there is nothing left to back off to.
    if (target < STEP_KG) return null;
    return {
      kind: 'deload',
      weightKg: target,
      reps: repsMin ?? Math.max(...atTop.map((set) => set.reps)),
      fromKg: topKg,
    };
  }

  const ceiling = repsMax ?? null;

  if (ceiling !== null) {
    const full = atTop.every((set) => set.reps >= ceiling);
    if (!full) {
      const lowest = Math.min(...atTop.map((set) => set.reps));
      return { kind: 'add_reps', weightKg: topKg, reps: ceiling, fromReps: lowest };
    }
    return {
      kind: 'add_weight',
      weightKg: snap(topKg + step, 'nearest'),
      reps: repsMin ?? ceiling,
      fromKg: topKg,
    };
  }

  // No prescribed range: read the shape of last session instead. One set has no shape.
  if (atTop.length < 2) return null;

  const best = Math.max(...atTop.map((set) => set.reps));
  const held = atTop.every((set) => set.reps === best);
  if (!held) {
    const lowest = Math.min(...atTop.map((set) => set.reps));
    return { kind: 'add_reps', weightKg: topKg, reps: best, fromReps: lowest };
  }

  return {
    kind: 'add_weight',
    weightKg: snap(topKg + step, 'nearest'),
    reps: repsMin ?? best,
    fromKg: topKg,
  };
}
