/**
 * The monthly review: which exercises progressed in a month, which are stuck, and what to try.
 *
 * Dates are built in local time (`new Date(y, m, d)`), as the review reads months in the
 * device's own calendar.
 */

import { describe, expect, it } from 'vitest';

import {
  defaultMonth,
  monthBounds,
  monthOf,
  nextWeightKg,
  reviewableMonths,
  reviewExercise,
  reviewMonth,
  shiftMonth,
  type SessionSets,
} from './monthlyReview.js';
import type { WorkingSet } from './setBySet.js';

const lift = (weightKg: number | null, reps: number): WorkingSet => ({
  weightKg,
  reps,
  durationSeconds: null,
  distanceM: null,
});

let counter = 0;
/** A session on a day of 2026 (month 1-based), with these sets. */
function on(month: number, day: number, sets: WorkingSet[], id?: string): SessionSets {
  return {
    sessionId: id ?? `s-${++counter}`,
    startedAt: new Date(2026, month - 1, day, 18).toISOString(),
    sets,
  };
}
const three = (weightKg: number | null, reps: number) => [
  lift(weightKg, reps),
  lift(weightKg, reps),
  lift(weightKg, reps),
];

describe('months', () => {
  it('names, moves and bounds a month in local time', () => {
    expect(monthOf(new Date(2026, 9, 31, 23, 30))).toBe('2026-10');
    expect(shiftMonth('2026-01', -1)).toBe('2025-12');
    expect(shiftMonth('2026-11', 2)).toBe('2027-01');
    const { start, end } = monthBounds('2026-10');
    expect(start).toEqual(new Date(2026, 9, 1));
    expect(end).toEqual(new Date(2026, 10, 1));
  });

  it('opens on last month, then on this one, then on the latest with anything', () => {
    const today = new Date(2026, 10, 7);
    expect(defaultMonth(['2026-09', '2026-10', '2026-11'], today)).toBe('2026-10');
    expect(defaultMonth(['2026-08', '2026-11'], today)).toBe('2026-11');
    expect(defaultMonth(['2026-05', '2026-07'], today)).toBe('2026-07');
    expect(defaultMonth([], today)).toBe('2026-11');
  });

  it('can be moved through every month with training, and this one', () => {
    expect(reviewableMonths(['2026-10', '2026-08'], new Date(2026, 10, 7))).toEqual([
      '2026-08',
      '2026-10',
      '2026-11',
    ]);
  });
});

describe('one exercise over a month', () => {
  it('reads the month against the last time before it, set by set', () => {
    const review = reviewExercise(
      'Bench Press',
      [
        on(9, 28, three(80, 8)),
        on(10, 6, three(80, 8)),
        on(10, 20, [lift(82.5, 8), lift(80, 9), lift(80, 8)]),
      ],
      '2026-10',
    )!;
    expect(review.status).toBe('progressing');
    expect(review.sessions).toBe(2);
    expect(review.fromBeforeMonth).toBe(true);
    expect(review.from?.startedAt).toBe(new Date(2026, 8, 28, 18).toISOString());
    expect(review.pairs.map((pair) => pair.change)).toEqual(['up', 'up', 'same']);
    expect(review.gain).toEqual({ weightKg: 2.5, reps: 0, sets: 0 });
    expect(review.tip).toBeNull();
  });

  it('uses the month’s own first session when there was nothing recent before it', () => {
    const review = reviewExercise(
      'Squat',
      [on(5, 1, three(60, 5)), on(10, 3, three(100, 5)), on(10, 24, three(100, 7))],
      '2026-10',
    )!;
    expect(review.fromBeforeMonth).toBe(false);
    expect(review.from?.startedAt).toBe(new Date(2026, 9, 3, 18).toISOString());
    expect(review.gain).toEqual({ weightKg: 0, reps: 2, sets: 0 });
  });

  it('calls three sessions in a row with nothing better stuck, even after an early jump', () => {
    const review = reviewExercise(
      'Bench Press',
      [
        on(9, 29, three(77.5, 8)),
        on(10, 2, three(80, 8)),
        on(10, 9, three(80, 8)),
        on(10, 16, three(80, 8)),
      ],
      '2026-10',
    )!;
    // Up on where the month started, and still stuck: the jump was a month ago.
    expect(review.flat).toBe(3);
    expect(review.status).toBe('stuck');
    expect(review.tip).toEqual({ kind: 'addRep', sessions: 3, weightKg: 80, targetReps: 10 });
  });

  it('calls one unchanged session holding, and two unchanged since the start stuck', () => {
    expect(
      reviewExercise('Row', [on(9, 30, three(60, 10)), on(10, 7, three(60, 10))], '2026-10')!
        .status,
    ).toBe('holding');
    expect(
      reviewExercise(
        'Row',
        [on(9, 30, three(60, 10)), on(10, 7, three(62.5, 10)), on(10, 21, three(60, 10))],
        '2026-10',
      )!.status,
    ).toBe('stuck');
  });

  it('calls ending below the start declining, and says why', () => {
    const lighter = reviewExercise(
      'Deadlift',
      [on(9, 30, three(140, 5)), on(10, 14, three(130, 5)), on(10, 28, three(135, 5))],
      '2026-10',
    )!;
    expect(lighter.status).toBe('declining');
    expect(lighter.tip).toEqual({ kind: 'lighter', fromKg: 140, toKg: 135 });

    const fewer = reviewExercise(
      'Deadlift',
      [on(9, 30, three(140, 5)), on(10, 14, three(140, 5)), on(10, 28, [lift(140, 5)])],
      '2026-10',
    )!;
    expect(fewer.status).toBe('declining');
    expect(fewer.tip).toEqual({ kind: 'fewerSets', from: 3, to: 1 });
  });

  it('marks an exercise done once and never before as new, with nothing counted', () => {
    const review = reviewExercise('Dips', [on(10, 12, three(null, 10))], '2026-10')!;
    expect(review.status).toBe('new');
    expect(review.from).toBeNull();
    expect(review.pairs).toEqual([]);
    expect(review.tip).toBeNull();
  });

  it('leaves out an exercise not done in the month', () => {
    expect(reviewExercise('Curl', [on(9, 10, three(20, 10))], '2026-10')).toBeNull();
  });
});

describe('what to try when stuck', () => {
  it('says the later sets need more rest when the reps fall away', () => {
    const review = reviewExercise(
      'Pull Up',
      [
        on(10, 1, [lift(null, 12), lift(null, 10), lift(null, 7)]),
        on(10, 8, [lift(null, 12), lift(null, 10), lift(null, 7)]),
        on(10, 15, [lift(null, 12), lift(null, 10), lift(null, 7)]),
      ],
      '2026-10',
    )!;
    expect(review.status).toBe('stuck');
    expect(review.tip).toEqual({ kind: 'fadingSets', firstReps: 12, lastReps: 7 });
  });

  it('puts how often first when the exercise was done once or twice', () => {
    const review = reviewExercise(
      'Leg Press',
      [on(9, 1, three(200, 10)), on(9, 20, three(200, 10)), on(10, 18, three(200, 10))],
      '2026-10',
    )!;
    // Read against the last time before the month only: one repeat is holding, not stuck.
    expect(review.status).toBe('holding');
    expect(review.tip).toEqual({ kind: 'lowFrequency', sessions: 1 });
  });

  it('suggests a lighter week or a variation after five sessions with nothing better', () => {
    const review = reviewExercise(
      'Overhead Press',
      [3, 8, 13, 18, 23].map((day) => on(10, day, three(50, 6))),
      '2026-10',
    )!;
    expect(review.flat).toBe(5);
    expect(review.tip).toEqual({ kind: 'longPlateau', sessions: 5 });
  });

  it('asks a bodyweight exercise for one rep more', () => {
    const review = reviewExercise(
      'Push Up',
      [on(10, 2, three(null, 20)), on(10, 9, three(null, 20)), on(10, 16, three(null, 20))],
      '2026-10',
    )!;
    expect(review.tip).toEqual({ kind: 'addRepBodyweight', sessions: 3, targetReps: 21 });
  });

  it('steps the weight up by what a gym usually has, in either unit', () => {
    expect(nextWeightKg(80, 'metric')).toBe(82.5);
    expect(nextWeightKg(12, 'metric')).toBe(13);
    expect(nextWeightKg(100 * 0.45359237, 'imperial') / 0.45359237).toBeCloseTo(105, 6);
    expect(nextWeightKg(30 * 0.45359237, 'imperial') / 0.45359237).toBeCloseTo(32.5, 6);
  });
});

describe('a whole month', () => {
  it('lists the stuck first, counts each kind and totals the month against the one before', () => {
    const history = new Map<string, SessionSets[]>([
      [
        'Bench Press',
        [on(9, 29, three(80, 8), 'w0'), on(10, 6, three(82.5, 8), 'w1')],
      ],
      [
        'Row',
        [
          on(10, 1, three(60, 10), 'w2'),
          on(10, 6, three(60, 10), 'w1'),
          on(10, 20, three(60, 10), 'w3'),
        ],
      ],
      ['Dips', [on(10, 20, three(null, 12), 'w3')]],
      ['Curl', [on(9, 15, three(15, 12), 'w4')]],
    ]);
    const review = reviewMonth(history, '2026-10');

    expect(review.exercises.map((e) => [e.exerciseKey, e.status])).toEqual([
      ['Row', 'stuck'],
      ['Bench Press', 'progressing'],
      ['Dips', 'new'],
    ]);
    expect(review.counts).toEqual({ stuck: 1, declining: 0, progressing: 1, holding: 0, new: 1 });
    // w1 holds both the bench and the row: counted as one workout.
    expect(review.totals).toEqual({ sessions: 3, sets: 15 });
    expect(review.previous).toEqual({ sessions: 2, sets: 6 });
  });
});
