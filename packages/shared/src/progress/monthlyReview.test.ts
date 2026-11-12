/**
 * The monthly review: one verdict per exercise for the whole month — improved even slightly,
 * the same, or declined — and what to try where it did not improve.
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
  addWorkoutSets,
  reviewableMonths,
  reviewExercise,
  reviewMonth,
  reviewMonthByWorkout,
  shiftMonth,
  workoutLineKey,
  type SessionSets,
  type WorkoutHistories,
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
const day = (month: number, d: number) => new Date(2026, month - 1, d, 18).toISOString();

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

describe('one verdict for the whole month', () => {
  it('counts one better set on any day of the month as improved, even if the month ends badly', () => {
    const review = reviewExercise(
      'Bench Press',
      [
        on(9, 28, three(80, 8)),
        on(10, 6, three(80, 8)),
        on(10, 13, [lift(80, 9), lift(80, 8), lift(80, 8)]),
        on(10, 27, [lift(80, 7), lift(80, 7), lift(80, 6)]),
      ],
      '2026-10',
    )!;
    expect(review.status).toBe('improved');
    expect(review.fromBeforeMonth).toBe(true);
    expect(review.from?.startedAt).toBe(day(9, 28));
    // Set by set, the month's best: the 9 from the 13th, and the 8s it held elsewhere.
    expect(review.best.map((b) => [b.set.reps, b.startedAt])).toEqual([
      [9, day(10, 13)],
      [8, day(10, 6)],
      [8, day(10, 6)],
    ]);
    expect(review.pairs.map((pair) => pair.change)).toEqual(['up', 'same', 'same']);
    expect(review.gain).toEqual({ weightKg: 0, reps: 1, sets: 0 });
    expect(review.tip).toBeNull();
  });

  it('takes the best of each set from whichever session did it', () => {
    const review = reviewExercise(
      'Squat',
      [
        on(9, 30, three(100, 5)),
        on(10, 7, [lift(105, 5), lift(100, 5), lift(100, 4)]),
        on(10, 21, [lift(100, 5), lift(100, 6), lift(100, 5)]),
      ],
      '2026-10',
    )!;
    expect(review.best.map((b) => [b.set.weightKg, b.set.reps])).toEqual([
      [105, 5],
      [100, 6],
      [100, 5],
    ]);
    expect(review.status).toBe('improved');
    expect(review.gain).toEqual({ weightKg: 5, reps: 0, sets: 0 });
  });

  it('calls a month that never beat or fell short of the start the same', () => {
    const review = reviewExercise(
      'Row',
      [on(9, 30, three(60, 10)), on(10, 7, three(60, 10)), on(10, 21, three(60, 10))],
      '2026-10',
    )!;
    expect(review.status).toBe('same');
    expect(review.pairs.map((pair) => pair.change)).toEqual(['same', 'same', 'same']);
  });

  it('calls a month that never reached the start declined, and says why', () => {
    const lighter = reviewExercise(
      'Deadlift',
      [on(9, 30, three(140, 5)), on(10, 14, three(130, 5)), on(10, 28, three(135, 5))],
      '2026-10',
    )!;
    expect(lighter.status).toBe('declined');
    expect(lighter.tip).toEqual({ kind: 'lighter', fromKg: 140, toKg: 135 });

    const fewer = reviewExercise(
      'Deadlift',
      [on(9, 30, three(140, 5)), on(10, 14, [lift(140, 5)]), on(10, 28, [lift(140, 5)])],
      '2026-10',
    )!;
    expect(fewer.status).toBe('declined');
    expect(fewer.tip).toEqual({ kind: 'fewerSets', from: 3, to: 1 });
  });

  it('starts from the month’s first session when there was nothing recent before it', () => {
    const review = reviewExercise(
      'Squat',
      [on(5, 1, three(60, 5)), on(10, 3, three(100, 5)), on(10, 24, three(100, 7))],
      '2026-10',
    )!;
    expect(review.fromBeforeMonth).toBe(false);
    expect(review.from?.startedAt).toBe(day(10, 3));
    // The first session is the start, so only the 24th counts as the month's doing.
    expect(review.best.every((b) => b.startedAt === day(10, 24))).toBe(true);
    expect(review.status).toBe('improved');
  });

  it('marks an exercise done once and never before as new, with nothing counted', () => {
    const review = reviewExercise('Dips', [on(10, 12, three(null, 10))], '2026-10')!;
    expect(review.status).toBe('new');
    expect(review.from).toBeNull();
    expect(review.pairs).toEqual([]);
    expect(review.best).toHaveLength(3);
    expect(review.tip).toBeNull();
  });

  it('leaves out an exercise not done in the month', () => {
    expect(reviewExercise('Curl', [on(9, 10, three(20, 10))], '2026-10')).toBeNull();
  });
});

describe('what to try where the month did not improve', () => {
  it('says the later sets need more rest when the reps fall away', () => {
    const fadingSets = [lift(null, 12), lift(null, 10), lift(null, 7)];
    const review = reviewExercise(
      'Pull Up',
      [9, 30, 8, 15, 22].map((d, i) => on(i === 0 ? 9 : 10, i === 0 ? 30 : d, fadingSets)),
      '2026-10',
    )!;
    expect(review.status).toBe('same');
    expect(review.tip).toEqual({ kind: 'fadingSets', firstReps: 12, lastReps: 7 });
  });

  it('puts how often first when the exercise was done once or twice', () => {
    const review = reviewExercise(
      'Leg Press',
      [on(9, 20, three(200, 10)), on(10, 18, three(200, 10))],
      '2026-10',
    )!;
    expect(review.status).toBe('same');
    expect(review.tip).toEqual({ kind: 'lowFrequency', sessions: 1 });
  });

  it('suggests a lighter week or a variation when the month before did not improve either', () => {
    const review = reviewExercise(
      'Overhead Press',
      [
        on(8, 28, three(50, 6)),
        ...[4, 11, 18].map((d) => on(9, d, three(50, 6))),
        ...[2, 9, 16].map((d) => on(10, d, three(50, 6))),
      ],
      '2026-10',
    )!;
    expect(review.status).toBe('same');
    expect(review.tip).toEqual({ kind: 'twoMonths' });
  });

  it('otherwise asks for a rep more on every set, then the next weight', () => {
    const review = reviewExercise(
      'Bench Press',
      [
        on(9, 1, three(77.5, 8)),
        on(9, 29, three(80, 8)),
        ...[2, 9, 16].map((d) => on(10, d, three(80, 8))),
      ],
      '2026-10',
    )!;
    expect(review.status).toBe('same');
    expect(review.tip).toEqual({ kind: 'addRep', weightKg: 80, targetReps: 10 });
  });

  it('asks a bodyweight exercise for one rep more', () => {
    const review = reviewExercise(
      'Push Up',
      [
        on(9, 1, three(null, 18)),
        on(9, 30, three(null, 20)),
        ...[2, 9, 16].map((d) => on(10, d, three(null, 20))),
      ],
      '2026-10',
    )!;
    expect(review.tip).toEqual({ kind: 'addRepBodyweight', targetReps: 21 });
  });

  it('steps the weight up by what a gym usually has, in either unit', () => {
    expect(nextWeightKg(80, 'metric')).toBe(82.5);
    expect(nextWeightKg(12, 'metric')).toBe(13);
    expect(nextWeightKg(100 * 0.45359237, 'imperial') / 0.45359237).toBeCloseTo(105, 6);
    expect(nextWeightKg(30 * 0.45359237, 'imperial') / 0.45359237).toBeCloseTo(32.5, 6);
  });
});

describe('a whole month', () => {
  it('lists improved, then the same, then declined, counts each, and totals the month', () => {
    const history = new Map<string, SessionSets[]>([
      ['Bench Press', [on(9, 29, three(80, 8), 'w0'), on(10, 6, three(82.5, 8), 'w1')]],
      [
        'Row',
        [
          on(9, 29, three(60, 10), 'w0'),
          on(10, 6, three(60, 10), 'w1'),
          on(10, 20, three(60, 10), 'w3'),
        ],
      ],
      ['Deadlift', [on(9, 29, three(140, 5), 'w0'), on(10, 20, three(130, 5), 'w3')]],
      ['Dips', [on(10, 20, three(null, 12), 'w3')]],
      ['Curl', [on(9, 15, three(15, 12), 'w4')]],
    ]);
    const review = reviewMonth(history, '2026-10');

    expect(review.exercises.map((e) => [e.exerciseKey, e.status])).toEqual([
      ['Bench Press', 'improved'],
      ['Row', 'same'],
      ['Deadlift', 'declined'],
      ['Dips', 'new'],
    ]);
    expect(review.counts).toEqual({ improved: 1, same: 1, declined: 1, new: 1 });
    // w1 holds both the bench and the row: counted as one workout.
    expect(review.totals).toEqual({ sessions: 2, sets: 15 });
    expect(review.previous).toEqual({ sessions: 2, sets: 12 });
  });
});

describe('by workout', () => {
  /** One exercise's sets in one session of a named workout, added the way the readers add them. */
  function add(
    into: WorkoutHistories,
    workout: string | null,
    exercise: string,
    month: number,
    d: number,
    sets: WorkingSet[],
  ) {
    addWorkoutSets(into, workout, exercise, `s-${++counter}`, day(month, d), sets);
  }

  it('compares a workout’s name without spaces or capitals, and has no name as its own key', () => {
    expect(workoutLineKey('  Push   A ')).toBe('push a');
    expect(workoutLineKey('PUSH A')).toBe('push a');
    expect(workoutLineKey(null)).toBe('');
    expect(workoutLineKey('   ')).toBe('');
  });

  it('judges an exercise only against itself in the same workout, not the same lift elsewhere', () => {
    // The owner's case: the same leg press at home and at another gym, on other machines.
    const workouts: WorkoutHistories = new Map();
    add(workouts, 'Legs home', 'Leg Press', 9, 10, three(100, 10));
    add(workouts, 'Legs gym', 'Leg Press', 9, 25, three(60, 10));
    add(workouts, 'Legs home', 'Leg Press', 10, 8, three(100, 10));

    // Read as one line, the month is set against the lighter machine and looks like a gain.
    const flat = new Map<string, SessionSets[]>();
    for (const { history } of workouts.values()) {
      for (const [key, line] of history) flat.set(key, [...(flat.get(key) ?? []), ...line]);
    }
    for (const line of flat.values()) line.sort((a, b) => a.startedAt.localeCompare(b.startedAt));
    expect(reviewMonth(flat, '2026-10').exercises[0]!.status).toBe('improved');

    // Within its own workout it is what it was: the same.
    const { review, workouts: groups } = reviewMonthByWorkout(workouts, '2026-10');
    expect(review.exercises).toHaveLength(1);
    expect(review.exercises[0]).toMatchObject({
      exerciseKey: 'Leg Press',
      workoutKey: 'legs home',
      workoutName: 'Legs home',
      status: 'same',
    });
    expect(groups.map((g) => g.name)).toEqual(['Legs home']);
  });

  it('keeps the same exercise in two workouts as two lines, each with its own verdict', () => {
    const workouts: WorkoutHistories = new Map();
    add(workouts, 'Push A', 'Bench Press', 9, 20, three(80, 8));
    add(workouts, 'Push B', 'Bench Press', 9, 22, three(50, 10));
    add(workouts, 'Push A', 'Bench Press', 10, 5, three(82.5, 8));
    add(workouts, 'Push B', 'Bench Press', 10, 20, three(50, 8));

    const { review, workouts: groups } = reviewMonthByWorkout(workouts, '2026-10');
    const byWorkout = Object.fromEntries(review.exercises.map((e) => [e.workoutName, e.status]));
    expect(byWorkout).toEqual({ 'Push A': 'improved', 'Push B': 'declined' });
    expect(new Set(review.exercises.map((e) => e.lineId)).size).toBe(2);
    expect(review.counts).toMatchObject({ improved: 1, declined: 1 });
    // The most recently trained workout first.
    expect(groups.map((g) => g.name)).toEqual(['Push B', 'Push A']);
    expect(groups[0]!.counts.declined).toBe(1);
    // Totals still count every workout of the month once.
    expect(review.totals).toEqual({ sessions: 2, sets: 6 });
  });

  it('reads a renamed workout as one, by its newest spelling, and keeps unnamed ones together', () => {
    const workouts: WorkoutHistories = new Map();
    add(workouts, 'legs', 'Squat', 9, 20, three(100, 5));
    add(workouts, ' Legs ', 'Squat', 10, 6, three(105, 5));
    add(workouts, null, 'Curl', 10, 7, three(12, 10));

    const { workouts: groups } = reviewMonthByWorkout(workouts, '2026-10');
    expect(groups.map((g) => [g.key, g.name])).toEqual([
      ['', null],
      ['legs', 'Legs'],
    ]);
    expect(groups[1]!.exercises[0]!.status).toBe('improved');
  });
});
