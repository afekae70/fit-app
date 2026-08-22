/**
 * How much work each muscle actually got.
 *
 * The app has always answered "how much did I lift this week" with a single number for the whole
 * body. That number cannot tell a week of nothing but pressing from a balanced one, and the
 * question every lifter actually asks — am I doing enough for my back — is invisible in it.
 *
 * ## Sets, not tonnage
 *
 * Weekly *sets* per muscle is the currency training is programmed in, and the one the research
 * is written in: somewhere around 10-20 hard sets per muscle per week for growth. Tonnage cannot
 * be compared across muscles at all — a set of calf raises moves more weight than a set of
 * lateral raises and means far less.
 *
 * ## Half a set for a helper
 *
 * A row trains the lats directly and the biceps on the way. Counting that as a full biceps set
 * overstates the arm work; counting it as nothing understates it, and a lifter who rows heavily
 * would be told to add curls they do not need. Half is the convention, and it is a convention
 * rather than a measurement — which is why the two are kept apart in the result, so a reader can
 * see how much of a total is indirect.
 *
 * ## No grouping
 *
 * The muscles are the catalogue's own, not rolled up into "back" and "shoulders". Any grouping
 * is a judgement about how someone programs — whether rear delts are shoulder work or back work
 * is a real disagreement between real programs — and imposing one here would quietly rewrite the
 * user's training in the summary of it.
 */

import { EXERCISE_BY_KEY } from '../catalog/exercises.js';

/** What a helper muscle earns, against 1 for the muscle an exercise is for. */
const SECONDARY_WEIGHT = 0.5;

export interface ExerciseSetCount {
  /** The catalogue key — `exercise_key` as stored on a session exercise. */
  exerciseKey: string;
  /** Working sets only. Warm-ups are a ramp, not work, and must be filtered out by the caller. */
  sets: number;
}

export interface MuscleWork {
  muscle: string;
  /** Sets from exercises this muscle is the point of. */
  direct: number;
  /** Half-sets from exercises where it assists. */
  indirect: number;
  /** `direct + indirect`, which is the number to compare against a weekly target. */
  total: number;
}

/**
 * Roll a week of exercises up into per-muscle set counts, busiest first.
 *
 * Exercises the catalogue does not know are skipped rather than bucketed under "other": a custom
 * lift has no muscle attached, and inventing a category for it would put a number on screen that
 * no amount of training could change.
 *
 * Cardio is skipped too. It has a `primaryMuscle` of `cardio` in the catalogue, which is a
 * classification rather than a muscle, and letting it into a list of muscles to compare against
 * a hypertrophy target would be nonsense.
 */
export function setsPerMuscle(entries: readonly ExerciseSetCount[]): MuscleWork[] {
  const direct = new Map<string, number>();
  const indirect = new Map<string, number>();

  const add = (map: Map<string, number>, muscle: string, amount: number) => {
    map.set(muscle, (map.get(muscle) ?? 0) + amount);
  };

  for (const entry of entries) {
    if (!Number.isFinite(entry.sets) || entry.sets <= 0) continue;
    const seed = EXERCISE_BY_KEY.get(entry.exerciseKey);
    if (!seed || seed.primaryMuscle === 'cardio') continue;

    add(direct, seed.primaryMuscle, entry.sets);
    for (const secondary of seed.secondaryMuscles ?? []) {
      // A muscle listed as its own helper would be counted twice for one set.
      if (secondary === seed.primaryMuscle || secondary === 'cardio') continue;
      add(indirect, secondary, entry.sets * SECONDARY_WEIGHT);
    }
  }

  const muscles = new Set([...direct.keys(), ...indirect.keys()]);
  return [...muscles]
    .map((muscle) => {
      const d = direct.get(muscle) ?? 0;
      const i = indirect.get(muscle) ?? 0;
      return { muscle, direct: d, indirect: i, total: Number((d + i).toFixed(1)) };
    })
    .sort((a, b) => b.total - a.total || a.muscle.localeCompare(b.muscle));
}

/**
 * Which of the catalogue's muscles got no work at all.
 *
 * The useful half of the summary. A list of what was trained is a description of the week; a
 * list of what was not is the thing that changes the next one.
 */
export function untrainedMuscles(worked: readonly MuscleWork[]): string[] {
  const seen = new Set(worked.map((w) => w.muscle));
  const all = new Set<string>();
  for (const seed of EXERCISE_BY_KEY.values()) {
    if (seed.primaryMuscle !== 'cardio') all.add(seed.primaryMuscle);
  }
  return [...all].filter((muscle) => !seen.has(muscle)).sort();
}

/**
 * Where a muscle's weekly volume sits against the usual range.
 *
 * `low` below 10, `high` above 20, `enough` between. Deliberately coarse: the evidence behind
 * those numbers is a broad band across very different people, and rendering it as a precise
 * target would claim a precision nobody has.
 */
export function volumeVerdict(totalSets: number): 'low' | 'enough' | 'high' {
  if (totalSets < 10) return 'low';
  if (totalSets > 20) return 'high';
  return 'enough';
}
