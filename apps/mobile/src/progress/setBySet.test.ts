/**
 * Set against set: the rules that say whether the second set got better than the second set
 * last time, and what a workout's sets come to.
 */

import { describe, expect, it } from 'vitest';

import {
  compareSet,
  exerciseSetChanges,
  liveSetChanges,
  NO_TALLY,
  pairSets,
  tallyOf,
  topSet,
  totalReps,
  verdictOf,
  workoutTally,
  type WorkingSet,
} from './setBySet.js';

const lift = (weightKg: number | null, reps: number | null): WorkingSet => ({
  weightKg,
  reps,
  durationSeconds: null,
  distanceM: null,
});
const held = (durationSeconds: number, distanceM: number | null = null): WorkingSet => ({
  weightKg: null,
  reps: null,
  durationSeconds,
  distanceM,
});

describe('whether one set is better than another', () => {
  it('is heavier, or the same weight for more reps', () => {
    expect(compareSet(lift(82.5, 6), lift(80, 8))).toBe('up');
    expect(compareSet(lift(80, 9), lift(80, 8))).toBe('up');
  });

  it('is worse when lighter, even with more reps, and at the same weight with fewer', () => {
    expect(compareSet(lift(77.5, 12), lift(80, 8))).toBe('down');
    expect(compareSet(lift(80, 7), lift(80, 8))).toBe('down');
  });

  it('is the same for the same, a pound converted twice included', () => {
    expect(compareSet(lift(80, 8), lift(80, 8))).toBe('same');
    expect(compareSet(lift(20.411656, 10), lift(20.4116566, 10))).toBe('same');
  });

  it('reads a set without weight by its reps, and a weight added as up', () => {
    expect(compareSet(lift(null, 12), lift(null, 10))).toBe('up');
    expect(compareSet(lift(null, 9), lift(null, 10))).toBe('down');
    expect(compareSet(lift(5, 6), lift(null, 10))).toBe('up');
  });

  it('reads a held set by ground covered, then pace, or by time when no ground at all', () => {
    expect(compareSet(held(600, 2000), held(600, 1800))).toBe('up');
    expect(compareSet(held(580, 2000), held(600, 2000))).toBe('up');
    expect(compareSet(held(620, 2000), held(600, 2000))).toBe('down');
    expect(compareSet(held(75), held(60))).toBe('up');
    expect(compareSet(held(60), held(60))).toBe('same');
  });
});

describe('lining two workouts up set by set', () => {
  it('puts the second set against the second set', () => {
    const pairs = pairSets(
      [lift(80, 8), lift(80, 8), lift(80, 6)],
      [lift(80, 8), lift(77.5, 8), lift(80, 7)],
    );
    expect(pairs.map((pair) => [pair.position, pair.change])).toEqual([
      [1, 'same'],
      [2, 'up'],
      [3, 'down'],
    ]);
  });

  it('calls a set more than last time added, and one fewer dropped', () => {
    expect(pairSets([lift(80, 8), lift(80, 8)], [lift(80, 8)]).map((pair) => pair.change)).toEqual([
      'same',
      'added',
    ]);
    const fewer = pairSets([lift(80, 8)], [lift(80, 8), lift(80, 8)]);
    expect(fewer[1]).toEqual({ position: 2, now: null, then: lift(80, 8), change: 'dropped' });
  });

  it('counts what happened to each place', () => {
    const tally = tallyOf(
      pairSets(
        [lift(85, 8), lift(80, 8), lift(80, 6), lift(80, 6)],
        [lift(80, 8), lift(80, 8), lift(80, 7)],
      ),
    );
    expect(tally).toEqual({ up: 1, same: 1, down: 1, added: 1, dropped: 0 });
  });
});

describe('the reading of an exercise', () => {
  it('is up when something got better and nothing worse, and mixed when both', () => {
    expect(verdictOf({ ...NO_TALLY, up: 1, same: 2 })).toBe('up');
    expect(verdictOf({ ...NO_TALLY, added: 1 })).toBe('up');
    expect(verdictOf({ ...NO_TALLY, dropped: 1, same: 2 })).toBe('down');
    expect(verdictOf({ ...NO_TALLY, up: 1, down: 1 })).toBe('mixed');
    expect(verdictOf({ ...NO_TALLY, same: 3 })).toBe('same');
  });
});

describe('a workout set by set against the one before', () => {
  const previous = [
    { exerciseKey: 'Back Squat', sets: [lift(100, 8), lift(100, 8)] },
    { exerciseKey: 'Leg Curl', sets: [lift(40, 12)] },
  ];

  it('keeps the latest workout’s order, marks a new exercise and does not list a dropped one', () => {
    const changes = exerciseSetChanges(
      [
        { exerciseKey: 'Leg Press', sets: [lift(200, 10)] },
        { exerciseKey: 'Back Squat', sets: [lift(102.5, 8), lift(100, 7)] },
      ],
      previous,
    );
    expect(changes.map((change) => [change.exerciseKey, change.verdict])).toEqual([
      ['Leg Press', 'new'],
      ['Back Squat', 'mixed'],
    ]);
    // A new exercise lists its sets and counts nothing: there is no last time to beat.
    expect(changes[0]!.pairs.map((pair) => pair.now)).toEqual([lift(200, 10)]);
    expect(changes[0]!.tally).toEqual(NO_TALLY);
  });

  it('adds up every exercise that was in both, and leaves new ones out', () => {
    const changes = exerciseSetChanges(
      [
        { exerciseKey: 'Back Squat', sets: [lift(102.5, 8), lift(100, 8), lift(100, 6)] },
        { exerciseKey: 'Leg Curl', sets: [lift(40, 10)] },
        { exerciseKey: 'Leg Press', sets: [lift(200, 10)] },
      ],
      previous,
    );
    expect(workoutTally(changes)).toEqual({ up: 1, same: 1, down: 1, added: 1, dropped: 0 });
  });

  it('counts the reps of a workout and finds the heaviest set of a list', () => {
    expect(totalReps(previous)).toBe(28);
    expect(topSet([lift(100, 8), lift(105, 5), lift(105, 6), lift(null, 20)])).toEqual(
      lift(105, 6),
    );
    expect(topSet([lift(null, 20)])).toBeNull();
  });
});

describe('the line under an exercise during a workout', () => {
  const ghost = (weightKg: number | null, reps: number | null) => ({ weightKg, reps });
  const row = (weightKg: number | null, reps: number | null, done = true, isWarmup = false) => ({
    weightKg,
    reps,
    done,
    isWarmup,
  });

  it('numbers working sets as the card does, past a warm-up, and judges only ticked ones', () => {
    const live = liveSetChanges(
      [row(60, 5, true, true), row(80, 8), row(82.5, 8), row(80, 6, false)],
      [ghost(60, 5), ghost(80, 8), ghost(80, 8), ghost(80, 8)],
    );
    expect(live).toEqual([
      { position: 1, change: 'same' },
      { position: 2, change: 'up' },
    ]);
  });

  it('says nothing for a set with no counterpart last time, or with no last time at all', () => {
    expect(liveSetChanges([row(80, 8), row(80, 8)], [ghost(80, 8), null])).toEqual([
      { position: 1, change: 'same' },
    ]);
    expect(liveSetChanges([row(80, 8)], undefined)).toEqual([]);
  });
});
