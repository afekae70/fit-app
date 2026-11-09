/**
 * A finished workout's summary: each exercise against the last time it was done.
 */

import { describe, expect, it } from 'vitest';

import type { SessionSets } from './monthlyReview.js';
import { movesOf, reviewSession } from './sessionReview.js';
import type { WorkingSet } from './setBySet.js';

const lift = (weightKg: number | null, reps: number): WorkingSet => ({
  weightKg,
  reps,
  durationSeconds: null,
  distanceM: null,
});
const three = (weightKg: number | null, reps: number) => [
  lift(weightKg, reps),
  lift(weightKg, reps),
  lift(weightKg, reps),
];
const on = (id: string, day: number, sets: WorkingSet[]): SessionSets => ({
  sessionId: id,
  startedAt: new Date(2026, 10, day, 18).toISOString(),
  sets,
});

describe('a workout against the last time of each exercise', () => {
  const history = new Map<string, SessionSets[]>([
    // Push day on the 2nd, chest day on the 5th, push day again on the 9th.
    [
      'Bench Press',
      [on('w1', 2, three(80, 8)), on('w2', 5, three(80, 9)), on('w3', 9, three(82.5, 8))],
    ],
    ['Overhead Press', [on('w1', 2, three(50, 6)), on('w3', 9, three(50, 6))]],
    ['Dips', [on('w1', 2, three(null, 12)), on('w3', 9, [lift(null, 12), lift(null, 9)])]],
    ['Lateral Raise', [on('w3', 9, three(10, 12))]],
  ]);

  it('says what improved, stayed the same, went down and is new, in the workout’s order', () => {
    const review = reviewSession(history, 'w3', [
      'Lateral Raise',
      'Bench Press',
      'Dips',
      'Overhead Press',
    ]);
    expect(review.exercises.map((e) => [e.exerciseKey, e.status])).toEqual([
      ['Lateral Raise', 'new'],
      ['Bench Press', 'improved'],
      ['Dips', 'declined'],
      ['Overhead Press', 'same'],
    ]);
    expect(review.counts).toEqual({ improved: 1, same: 1, declined: 1, new: 1 });
  });

  it('takes the last time from whichever workout it was in', () => {
    const bench = reviewSession(history, 'w3').exercises.find(
      (e) => e.exerciseKey === 'Bench Press',
    )!;
    // Chest day on the 5th, not push day on the 2nd.
    expect(bench.previous?.sessionId).toBe('w2');
    expect(bench.pairs.map((pair) => pair.change)).toEqual(['up', 'up', 'up']);
  });

  it('compares an old workout with the one before it, not with the latest', () => {
    const review = reviewSession(history, 'w2');
    expect(review.exercises).toHaveLength(1);
    expect(review.exercises[0]!.previous?.sessionId).toBe('w1');
    expect(review.exercises[0]!.status).toBe('improved');
  });

  it('counts a set fewer as worse, and says nothing for a workout with no history here', () => {
    const dips = reviewSession(history, 'w3').exercises.find((e) => e.exerciseKey === 'Dips')!;
    expect(dips.pairs.map((pair) => pair.change)).toEqual(['same', 'down', 'dropped']);
    expect(reviewSession(history, 'nope')).toEqual({
      exercises: [],
      counts: { improved: 0, same: 0, declined: 0, new: 0 },
    });
  });
});

describe('what moved in each exercise, for the line under it', () => {
  /** The moves of `key` in workout `w2`, done after `before` in `w1`. */
  const moves = (before: WorkingSet[], now: WorkingSet[]) => {
    const history = new Map([['Bench Press', [on('w1', 2, before), on('w2', 5, now)]]]);
    return movesOf(reviewSession(history, 'w2').exercises[0]!);
  };

  it('says the weight when the heaviest set moved, and leaves the reps out', () => {
    // Fewer reps after going heavier is what going heavier looks like.
    expect(moves(three(80, 8), three(82.5, 6))).toEqual({ weightKg: 2.5, reps: null, sets: null });
    expect(moves(three(80, 8), three(77.5, 10))).toEqual({
      weightKg: -2.5,
      reps: null,
      sets: null,
    });
  });

  it('says the reps at the same weight, set against set', () => {
    expect(moves(three(80, 8), [lift(80, 10), lift(80, 9), lift(80, 8)])).toEqual({
      weightKg: null,
      reps: 3,
      sets: null,
    });
    expect(moves(three(80, 8), [lift(80, 8), lift(80, 6), lift(80, 6)])?.reps).toBe(-4);
  });

  it('counts a set added once, as a set, and not again as its reps', () => {
    expect(moves(three(80, 8), [...three(80, 8), lift(80, 8)])).toEqual({
      weightKg: null,
      reps: null,
      sets: 1,
    });
    expect(moves(three(80, 8), [lift(80, 8), lift(80, 8)])).toEqual({
      weightKg: null,
      reps: null,
      sets: -1,
    });
  });

  it('reads a bodyweight exercise by its reps', () => {
    expect(moves(three(null, 12), three(null, 14))).toEqual({
      weightKg: null,
      reps: 6,
      sets: null,
    });
  });

  it('says nothing moved when nothing did', () => {
    expect(moves(three(80, 8), three(80, 8))).toEqual({ weightKg: null, reps: null, sets: null });
  });

  it('gives a clean number for weights entered to the quarter', () => {
    expect(moves(three(11.25, 10), three(13.75, 10))?.weightKg).toBe(2.5);
  });

  it('has nothing to say the first time', () => {
    const history = new Map([['Bench Press', [on('w1', 2, three(80, 8))]]]);
    expect(movesOf(reviewSession(history, 'w1').exercises[0]!)).toBeNull();
  });
});
