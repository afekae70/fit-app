/**
 * Set against set: each working set of an exercise beside the same set the time before.
 *
 * Progress is read the way a lifter reads it — by the weight on the bar, the reps it went up
 * for, and how many sets there were — and never by weight x reps added up. A total hides the
 * thing that matters: 100 kg x 5 and 50 kg x 10 are the same "volume" and not the same lift.
 *
 * ## Which set is "the same set"
 *
 * The one in the same place among the working sets: the second working set now against the
 * second working set then, however many warm-ups came before either (warm-ups are not here at
 * all). The workout screen's watermark lines rows up the same way (`workout/ghost.ts`), so the
 * number someone was shown as "last time" is the number they are judged against.
 *
 * ## What "better" means
 *
 * Heavier is better. At the same weight, more reps is better. A lighter set is worse even with
 * more reps — the same rule the lift-by-lift reading always used. A set with neither a weight
 * nor reps (a plank, a run) is judged on what it does hold: more ground covered, then over the
 * same ground less time, or with no ground at all more time.
 *
 * One set more than last time is progress (`added`); one fewer is not (`dropped`). The number
 * of sets is the third of the three things measured.
 *
 * Pure. The sets are fetched by `db/workoutProgress.ts`.
 */

/** One working set as it was done. */
export interface WorkingSet {
  weightKg: number | null;
  reps: number | null;
  durationSeconds: number | null;
  distanceM: number | null;
}

/** The working sets of one exercise in one workout, in the order they were done. */
export interface ExerciseSets {
  exerciseKey: string;
  sets: WorkingSet[];
}

export type SetDirection = 'up' | 'down' | 'same';

/** What happened to one place in the line of sets. */
export type SetChange = SetDirection | 'added' | 'dropped';

export interface SetPair {
  /** Which working set, counting from 1. */
  position: number;
  /** Null for a set that was done last time and not this time. */
  now: WorkingSet | null;
  /** Null for a set there was no counterpart to last time. */
  then: WorkingSet | null;
  change: SetChange;
}

export interface Tally {
  up: number;
  same: number;
  down: number;
  added: number;
  dropped: number;
}

export const NO_TALLY: Tally = Object.freeze({ up: 0, same: 0, down: 0, added: 0, dropped: 0 });

/** The overall reading of one exercise, or of a whole workout. */
export type Verdict = 'up' | 'down' | 'mixed' | 'same' | 'new';

export interface ExerciseSetChange {
  exerciseKey: string;
  /** One per place in the line, the sets done now first, then any that were dropped. */
  pairs: SetPair[];
  tally: Tally;
  /** `new` for an exercise that was not in the previous workout: it has nothing to be against. */
  verdict: Verdict;
}

/** Weights are stored in kilograms, and a pound converted twice is not always the same float. */
export const WEIGHT_EPSILON = 0.01;

const lifted = (set: WorkingSet) => set.weightKg !== null || set.reps !== null;

/** Whether one set is better than another. See the top of the file. */
export function compareSet(now: WorkingSet, then: WorkingSet): SetDirection {
  if (lifted(now) || lifted(then)) {
    const weightNow = now.weightKg ?? 0;
    const weightThen = then.weightKg ?? 0;
    if (Math.abs(weightNow - weightThen) > WEIGHT_EPSILON) {
      return weightNow > weightThen ? 'up' : 'down';
    }
    const repsNow = now.reps ?? 0;
    const repsThen = then.reps ?? 0;
    if (repsNow === repsThen) return 'same';
    return repsNow > repsThen ? 'up' : 'down';
  }

  const groundNow = now.distanceM ?? 0;
  const groundThen = then.distanceM ?? 0;
  if (groundNow !== groundThen) return groundNow > groundThen ? 'up' : 'down';
  const timeNow = now.durationSeconds ?? 0;
  const timeThen = then.durationSeconds ?? 0;
  if (timeNow === timeThen) return 'same';
  // Over the same ground, less time is faster. With no ground at all — a plank — more is more.
  if (groundNow > 0) return timeNow < timeThen ? 'up' : 'down';
  return timeNow > timeThen ? 'up' : 'down';
}

/** Two workouts' sets of one exercise, place by place. */
export function pairSets(now: readonly WorkingSet[], then: readonly WorkingSet[]): SetPair[] {
  const pairs: SetPair[] = [];
  const length = Math.max(now.length, then.length);
  for (let index = 0; index < length; index++) {
    const current = now[index] ?? null;
    const before = then[index] ?? null;
    const change: SetChange =
      current && before ? compareSet(current, before) : current ? 'added' : 'dropped';
    pairs.push({ position: index + 1, now: current, then: before, change });
  }
  return pairs;
}

export function tallyOf(pairs: readonly SetPair[]): Tally {
  const tally = { ...NO_TALLY };
  for (const pair of pairs) tally[pair.change] += 1;
  return tally;
}

export function addTallies(a: Tally, b: Tally): Tally {
  return {
    up: a.up + b.up,
    same: a.same + b.same,
    down: a.down + b.down,
    added: a.added + b.added,
    dropped: a.dropped + b.dropped,
  };
}

/** Sets that got better, counting a set done that was not there last time. */
export const improved = (tally: Tally) => tally.up + tally.added;
/** Sets that got worse, counting a set that was there last time and not now. */
export const worse = (tally: Tally) => tally.down + tally.dropped;

/** Up when something improved and nothing got worse, and so on. */
export function verdictOf(tally: Tally): Exclude<Verdict, 'new'> {
  const better = improved(tally);
  const lesser = worse(tally);
  if (better > 0 && lesser > 0) return 'mixed';
  if (better > 0) return 'up';
  if (lesser > 0) return 'down';
  return 'same';
}

/**
 * Every exercise of the latest workout, set by set against the same exercise the time before.
 *
 * In the latest workout's order. An exercise that was not in the previous one is `new`, with
 * its sets listed and nothing counted. One that was in the previous and not the latest is not
 * listed: this is a reading of today's workout, not a list of what was left out of it.
 */
export function exerciseSetChanges(
  latest: readonly ExerciseSets[],
  previous: readonly ExerciseSets[],
): ExerciseSetChange[] {
  const before = new Map(previous.map((exercise) => [exercise.exerciseKey, exercise.sets]));
  return latest.map(({ exerciseKey, sets }) => {
    const then = before.get(exerciseKey);
    if (!then) {
      return {
        exerciseKey,
        pairs: sets.map((set, index) => ({
          position: index + 1,
          now: set,
          then: null,
          change: 'added' as const,
        })),
        tally: { ...NO_TALLY },
        verdict: 'new' as const,
      };
    }
    const pairs = pairSets(sets, then);
    const tally = tallyOf(pairs);
    return { exerciseKey, pairs, tally, verdict: verdictOf(tally) };
  });
}

/** The whole workout's sets against the one before: every exercise that was in both. */
export function workoutTally(changes: readonly ExerciseSetChange[]): Tally {
  return changes.reduce(
    (sum, change) => (change.verdict === 'new' ? sum : addTallies(sum, change.tally)),
    { ...NO_TALLY },
  );
}

/** How many reps a workout's sets came to. */
export function totalReps(exercises: readonly ExerciseSets[]): number {
  return exercises.reduce(
    (sum, exercise) => sum + exercise.sets.reduce((reps, set) => reps + (set.reps ?? 0), 0),
    0,
  );
}

/**
 * The heaviest set of a list, and the most reps among the heaviest. Null when no set held a
 * weight: an exercise done without one is told by its sets, not by a best.
 */
export function topSet(sets: readonly WorkingSet[]): WorkingSet | null {
  let best: WorkingSet | null = null;
  for (const set of sets) {
    if (set.weightKg === null || set.weightKg <= 0) continue;
    if (
      best === null ||
      set.weightKg > (best.weightKg ?? 0) + WEIGHT_EPSILON ||
      (Math.abs(set.weightKg - (best.weightKg ?? 0)) <= WEIGHT_EPSILON &&
        (set.reps ?? 0) > (best.reps ?? 0))
    ) {
      best = set;
    }
  }
  return best;
}

/** One ticked set mid-workout beside the same set last time. */
export interface LiveSetChange {
  /** Which working set, counting from 1, as the card numbers them. */
  position: number;
  change: SetDirection;
}

/**
 * The line under an exercise during a workout: each working set that has been ticked off,
 * against the same set last time.
 *
 * `ghosts` are last time's sets lined up row for row (`workout/ghost.ts`), so "the same set" is
 * the one the empty row showed before it was done. A ticked set with no counterpart — a fourth
 * set where there were three — has nothing to be against and is left out; so are warm-ups.
 */
export function liveSetChanges(
  rows: readonly {
    weightKg: number | null;
    reps: number | null;
    done: boolean;
    isWarmup: boolean;
  }[],
  ghosts: readonly ({ weightKg: number | null; reps: number | null } | null)[] | undefined,
): LiveSetChange[] {
  const changes: LiveSetChange[] = [];
  let position = 0;
  rows.forEach((row, index) => {
    if (row.isWarmup) return;
    position += 1;
    const ghost = ghosts?.[index] ?? null;
    if (!row.done || !ghost || (row.weightKg === null && row.reps === null)) return;
    const now = { weightKg: row.weightKg, reps: row.reps, durationSeconds: null, distanceM: null };
    const then = {
      weightKg: ghost.weightKg,
      reps: ghost.reps,
      durationSeconds: null,
      distanceM: null,
    };
    changes.push({ position, change: compareSet(now, then) });
  });
  return changes;
}
