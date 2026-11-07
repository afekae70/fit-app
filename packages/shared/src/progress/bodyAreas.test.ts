/**
 * The monthly review by part of the body. Dates in local time, as the review reads months in
 * the device's own calendar.
 */

import { describe, expect, it } from 'vitest';

import { EXERCISE_SEED, MUSCLE_GROUPS } from '../catalog/index.js';
import {
  areaCounts,
  areaOfExercise,
  areaOfMuscle,
  areaStatus,
  reviewByArea,
} from './bodyAreas.js';
import { reviewMonth, type SessionSets } from './monthlyReview.js';
import type { WorkingSet } from './setBySet.js';

const lift = (weightKg: number, reps: number): WorkingSet => ({
  weightKg,
  reps,
  durationSeconds: null,
  distanceM: null,
});
const three = (weightKg: number, reps: number) => [lift(weightKg, reps), lift(weightKg, reps), lift(weightKg, reps)];

let counter = 0;
function on(month: number, day: number, sets: WorkingSet[]): SessionSets {
  return { sessionId: `s-${++counter}`, startedAt: new Date(2026, month - 1, day, 18).toISOString(), sets };
}

describe('which area an exercise belongs to', () => {
  it('folds every muscle group into an area, none into "other"', () => {
    for (const muscle of MUSCLE_GROUPS) expect(areaOfMuscle(muscle), muscle).not.toBe('other');
  });

  it('places every catalogue exercise, by its primary muscle', () => {
    for (const exercise of EXERCISE_SEED) {
      expect(areaOfExercise(exercise.nameEn), exercise.nameEn).not.toBe('other');
    }
    expect(areaOfExercise('Barbell Bench Press')).toBe('chest');
    expect(areaOfExercise('Diamond Push-up')).toBe('arms');
  });

  it('calls a key the catalogue does not know "other"', () => {
    expect(areaOfExercise('Something I made up')).toBe('other');
    expect(areaOfMuscle(null)).toBe('other');
  });
});

describe('an area verdict', () => {
  const counts = (improved: number, same: number, declined: number, fresh = 0) => ({
    improved,
    same,
    declined,
    new: fresh,
  });

  it('is the balance of its exercises', () => {
    expect(areaStatus(counts(2, 1, 1))).toBe('improved');
    expect(areaStatus(counts(1, 0, 2))).toBe('declined');
    expect(areaStatus(counts(1, 3, 1))).toBe('same');
    expect(areaStatus(counts(0, 2, 0))).toBe('same');
  });

  it('is new when nothing in it can be measured yet', () => {
    expect(areaStatus(counts(0, 0, 0, 2))).toBe('new');
  });
});

describe('reviewByArea', () => {
  // October against September: chest improved on both lifts, legs went down, arms were not
  // trained in October at all.
  const history = new Map<string, SessionSets[]>([
    ['Barbell Bench Press', [on(9, 28, three(80, 8)), on(10, 6, three(80, 9)), on(10, 20, three(82.5, 8))]],
    ['Incline Dumbbell Press', [on(9, 29, three(26, 10)), on(10, 13, three(28, 10))]],
    ['Back Squat', [on(9, 27, three(100, 6)), on(10, 8, three(95, 6)), on(10, 22, three(95, 6))]],
    ['Barbell Curl', [on(9, 15, three(30, 10))]],
  ]);
  const review = reviewMonth(history, '2026-10');
  const areas = reviewByArea(review, history);

  it('lists the areas in body order, including one trained only the month before', () => {
    expect(areas.map((a) => a.area)).toEqual(['chest', 'arms', 'legs']);
  });

  it('judges each area from its exercises', () => {
    const chest = areas.find((a) => a.area === 'chest')!;
    expect(chest.status).toBe('improved');
    expect(chest.counts.improved).toBe(2);
    expect(chest.exercises.map((e) => e.exerciseKey).sort()).toEqual([
      'Barbell Bench Press',
      'Incline Dumbbell Press',
    ]);
    expect(areas.find((a) => a.area === 'legs')!.status).toBe('declined');
  });

  it('marks an area trained last month and not this one as skipped', () => {
    const arms = areas.find((a) => a.area === 'arms')!;
    expect(arms.status).toBe('skipped');
    expect(arms.exercises).toEqual([]);
    expect(arms).toMatchObject({ sets: 0, previousSets: 3 });
  });

  it('counts working sets in the month against the month before', () => {
    expect(areas.find((a) => a.area === 'chest')).toMatchObject({ sets: 9, previousSets: 6 });
    expect(areas.find((a) => a.area === 'legs')).toMatchObject({ sets: 6, previousSets: 3 });
  });

  it('sums the areas by verdict', () => {
    expect(areaCounts(areas)).toEqual({ improved: 1, same: 0, declined: 1, new: 0, skipped: 1 });
  });

  it('can be told areas by another rule', () => {
    const all = reviewByArea(review, history, () => 'other');
    expect(all.map((a) => a.area)).toEqual(['other']);
  });
});
