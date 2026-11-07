/**
 * The monthly review told by part of the body: chest, back, shoulders, arms, legs, core.
 *
 * Asked for by the owner (2026-11-07): the monthly progress "by areas of the body, so it is
 * easier to see how I progress by area and not by a specific exercise" — and the same on the
 * coach website, "to see where the trainees get stuck and where they progress".
 *
 * ## Which area an exercise belongs to
 *
 * Its primary muscle in the catalogue (`EXERCISE_BY_KEY`), folded into six areas a person names
 * when they talk about their training. A secondary muscle does not count: a bench press is a
 * chest exercise even though it works the triceps, and counting it twice would make every
 * pressing day look like an arm day too. A key the catalogue does not know is `other`.
 *
 * ## An area's verdict
 *
 * From its exercises' own monthly verdicts (`monthlyReview.ts`), each exercise one vote: more
 * improved than declined is improved, more declined than improved is declined, otherwise the
 * same. An exercise new this month has nothing to be measured against and does not vote; an area
 * of nothing but new exercises is new. An area trained the month before and not at all in this
 * one is `skipped` — for a coach, the most telling line of all.
 *
 * Sets are counted alongside, working sets in the month against the month before: not a
 * verdict, but the context for one (fewer sets is the first thing to look at in a declining area).
 *
 * Pure.
 */

import { EXERCISE_BY_KEY, MUSCLE_GROUPS } from '../catalog/index.js';
import {
  monthBounds,
  shiftMonth,
  STATUS_ORDER,
  type ExerciseMonth,
  type MonthReview,
  type MonthStatus,
  type SessionSets,
} from './monthlyReview.js';

/** In the order they are listed: down the body, then what is not a muscle group. */
export const BODY_AREAS = ['chest', 'back', 'shoulders', 'arms', 'legs', 'core', 'cardio', 'other'] as const;
export type BodyArea = (typeof BODY_AREAS)[number];

type MuscleGroup = (typeof MUSCLE_GROUPS)[number];

/** Every muscle group, so a group added to the catalogue without an area fails to compile. */
const AREA_OF_MUSCLE: Record<MuscleGroup, BodyArea> = {
  chest: 'chest',
  lats: 'back',
  mid_back: 'back',
  lower_back: 'back',
  traps: 'back',
  front_delts: 'shoulders',
  side_delts: 'shoulders',
  rear_delts: 'shoulders',
  biceps: 'arms',
  triceps: 'arms',
  forearms: 'arms',
  quads: 'legs',
  hamstrings: 'legs',
  glutes: 'legs',
  calves: 'legs',
  abductors: 'legs',
  adductors: 'legs',
  core: 'core',
  obliques: 'core',
  cardio: 'cardio',
};

export function areaOfMuscle(muscle: string | null | undefined): BodyArea {
  return (muscle && AREA_OF_MUSCLE[muscle as MuscleGroup]) || 'other';
}

export function areaOfExercise(exerciseKey: string): BodyArea {
  return areaOfMuscle(EXERCISE_BY_KEY.get(exerciseKey)?.primaryMuscle);
}

export type AreaStatus = MonthStatus | 'skipped';

/** The shortcut and list order for areas, attention first after the good news. */
export const AREA_STATUS_ORDER: readonly AreaStatus[] = [...STATUS_ORDER, 'skipped'];

export interface AreaMonth {
  area: BodyArea;
  status: AreaStatus;
  /** Its exercises by verdict. */
  counts: Record<MonthStatus, number>;
  /** Its exercises, in the review's own order. Empty for a skipped area. */
  exercises: ExerciseMonth[];
  /** Working sets in the month. */
  sets: number;
  /** Working sets in the month before. */
  previousSets: number;
}

const emptyCounts = (): Record<MonthStatus, number> =>
  Object.fromEntries(STATUS_ORDER.map((status) => [status, 0])) as Record<MonthStatus, number>;

/** An area's verdict from its exercises' verdicts (see the file comment). */
export function areaStatus(counts: Readonly<Record<MonthStatus, number>>): MonthStatus {
  const net = counts.improved - counts.declined;
  if (net > 0) return 'improved';
  if (net < 0) return 'declined';
  if (counts.same > 0 || counts.improved > 0) return 'same';
  return 'new';
}

function setsBetween(sessions: readonly SessionSets[], start: Date, end: Date): number {
  let sets = 0;
  for (const session of sessions) {
    const time = new Date(session.startedAt).getTime();
    if (time >= start.getTime() && time < end.getTime()) sets += session.sets.length;
  }
  return sets;
}

/**
 * The month by area: every area trained in the month or in the month before, in BODY_AREAS
 * order. `history` is what the review was made from — it holds the month before as well.
 */
export function reviewByArea(
  review: MonthReview,
  history: ReadonlyMap<string, readonly SessionSets[]>,
  areaOf: (exerciseKey: string) => BodyArea = areaOfExercise,
): AreaMonth[] {
  const areas = new Map<BodyArea, AreaMonth>();
  const areaFor = (area: BodyArea): AreaMonth => {
    let entry = areas.get(area);
    if (!entry) {
      entry = { area, status: 'new', counts: emptyCounts(), exercises: [], sets: 0, previousSets: 0 };
      areas.set(area, entry);
    }
    return entry;
  };

  for (const exercise of review.exercises) {
    const entry = areaFor(areaOf(exercise.exerciseKey));
    entry.exercises.push(exercise);
    entry.counts[exercise.status] += 1;
  }

  const month = monthBounds(review.month);
  const before = monthBounds(shiftMonth(review.month, -1));
  for (const [key, sessions] of history) {
    const sets = setsBetween(sessions, month.start, month.end);
    const previousSets = setsBetween(sessions, before.start, before.end);
    if (sets === 0 && previousSets === 0) continue;
    const entry = areaFor(areaOf(key));
    entry.sets += sets;
    entry.previousSets += previousSets;
  }

  for (const entry of areas.values()) {
    entry.status = entry.exercises.length === 0 ? 'skipped' : areaStatus(entry.counts);
  }
  return BODY_AREAS.flatMap((area) => {
    const entry = areas.get(area);
    return entry ? [entry] : [];
  });
}

/** How many areas landed on each verdict: the line a coach reads across trainees. */
export function areaCounts(areas: readonly AreaMonth[]): Record<AreaStatus, number> {
  const counts = Object.fromEntries(AREA_STATUS_ORDER.map((status) => [status, 0])) as Record<
    AreaStatus,
    number
  >;
  for (const area of areas) counts[area.status] += 1;
  return counts;
}
