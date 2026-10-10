/**
 * Progress per workout: the arithmetic over a line of same-named workouts, and the query that
 * fetches the line from a real SQLite database.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { SqlExecutor } from '../db/executor.js';
import { addPlanDay, createPlan, startSessionFromPlanDay } from '../db/plans.js';
import { createTestExecutor } from '../db/testUtils.js';
import {
  addExerciseToSession,
  addSet,
  finishSession,
  markSetDone,
  renameSession,
  startSession,
} from '../db/workouts.js';
import { listExerciseBests, listWorkoutPoints } from '../db/workoutProgress.js';
import {
  byMonth,
  changeFrom,
  exerciseChanges,
  groupByWorkout,
  latestComparison,
  localMonth,
  metricOf,
  minutesOf,
  sessionsWithChange,
  valueOf,
  workoutKey,
  type SessionPoint,
} from './workoutProgress.js';

/** A workout on a local day, an hour long. Local, because months are counted where the phone is. */
const point = (
  id: string,
  name: string,
  year: number,
  month: number,
  day: number,
  over: Partial<SessionPoint> = {},
): SessionPoint => ({
  id,
  name,
  startedAt: new Date(year, month - 1, day, 18, 0).toISOString(),
  endedAt: new Date(year, month - 1, day, 19, 0).toISOString(),
  volumeKg: 0,
  sets: 0,
  distanceM: 0,
  ...over,
});

describe('which workouts are the same workout', () => {
  it('is the name, whatever the capitals or the spaces around it', () => {
    expect(workoutKey('  Legs  ')).toBe(workoutKey('legs'));
    expect(workoutKey('Push   A')).toBe(workoutKey('push a'));
    expect(workoutKey('רגליים כפר סבא')).toBe(workoutKey(' רגליים  כפר סבא '));
    expect(workoutKey('Legs')).not.toBe(workoutKey('Legs B'));
  });

  it('makes one line per name, each oldest first, the most recently done workout first', () => {
    const lines = groupByWorkout([
      point('l2', 'Legs', 2026, 10, 8),
      point('p1', 'Push', 2026, 10, 9),
      point('l1', 'legs', 2026, 10, 1),
    ]);
    expect(lines.map((line) => line.name)).toEqual(['Push', 'Legs']);
    expect(lines[1]!.sessions.map((session) => session.id)).toEqual(['l1', 'l2']);
  });

  it('shows a line under the newest spelling of its name', () => {
    const [line] = groupByWorkout([
      point('a', 'legs', 2026, 9, 1),
      point('b', 'Legs Day', 2026, 9, 8),
      point('c', 'legs', 2026, 9, 15),
      point('d', 'LEGS', 2026, 9, 22),
    ]).filter((entry) => entry.key === 'legs');
    expect(line!.name).toBe('LEGS');
    expect(line!.sessions).toHaveLength(3);
  });

  it('leaves out a workout with no name: it is the same as nothing', () => {
    expect(groupByWorkout([point('x', '   ', 2026, 10, 1)])).toEqual([]);
  });
});

describe('what a workout is measured by', () => {
  it('is the weight moved, for a workout that ever moved any', () => {
    const [line] = groupByWorkout([
      point('a', 'Legs', 2026, 10, 1, { volumeKg: 0 }),
      point('b', 'Legs', 2026, 10, 8, { volumeKg: 8000, distanceM: 400 }),
    ]);
    expect(metricOf(line!)).toBe('volume');
  });

  it('is the distance, for one that moved no weight and covered some ground', () => {
    const [line] = groupByWorkout([point('a', 'Run', 2026, 10, 1, { distanceM: 5000 })]);
    expect(metricOf(line!)).toBe('distance');
  });

  it('is the time it took, for one that did neither', () => {
    const [line] = groupByWorkout([point('a', 'Circuit', 2026, 10, 1)]);
    expect(metricOf(line!)).toBe('time');
    expect(valueOf(line!.sessions[0]!, 'time')).toBe(60);
  });

  it('has no length for a workout with no end, or one that ends before it starts', () => {
    expect(minutesOf({ startedAt: '2026-10-01T10:00:00.000Z', endedAt: null })).toBe(0);
    expect(
      minutesOf({ startedAt: '2026-10-01T10:00:00.000Z', endedAt: '2026-10-01T09:00:00.000Z' }),
    ).toBe(0);
  });
});

describe('how much better', () => {
  it('is a fraction of the one before', () => {
    expect(changeFrom(8400, 8000)).toBeCloseTo(0.05);
    expect(changeFrom(7600, 8000)).toBeCloseTo(-0.05);
    expect(changeFrom(8000, 8000)).toBe(0);
  });

  it('is not a number when there is nothing to be a fraction of', () => {
    expect(changeFrom(8000, 0)).toBeNull();
    expect(changeFrom(8000, null)).toBeNull();
    expect(changeFrom(8000, undefined)).toBeNull();
  });
});

describe('the latest workout against the one before it', () => {
  it('compares the last two of the same name', () => {
    const [line] = groupByWorkout([
      point('a', 'Legs', 2026, 10, 1, { volumeKg: 7000 }),
      point('b', 'Legs', 2026, 10, 8, { volumeKg: 8000 }),
      point('c', 'Legs', 2026, 10, 15, { volumeKg: 8400 }),
      point('p', 'Push', 2026, 10, 16, { volumeKg: 99999 }),
    ]).filter((entry) => entry.key === 'legs');

    const comparison = latestComparison(line!);
    expect(comparison.latest.id).toBe('c');
    expect(comparison.previous?.id).toBe('b');
    expect(comparison.latestValue).toBe(8400);
    expect(comparison.previousValue).toBe(8000);
    expect(comparison.change).toBeCloseTo(0.05);
  });

  it('has nothing to compare the first time a workout is done', () => {
    const [line] = groupByWorkout([point('a', 'Legs', 2026, 10, 1, { volumeKg: 7000 })]);
    const comparison = latestComparison(line!);
    expect(comparison.previous).toBeNull();
    expect(comparison.previousValue).toBeNull();
    expect(comparison.change).toBeNull();
  });
});

describe('month against month', () => {
  const legs = groupByWorkout([
    point('a', 'Legs', 2026, 8, 5, { volumeKg: 6000 }),
    point('b', 'Legs', 2026, 8, 19, { volumeKg: 7000 }),
    // September: none. A month off.
    point('c', 'Legs', 2026, 10, 1, { volumeKg: 7000 }),
    point('d', 'Legs', 2026, 10, 8, { volumeKg: 8000 }),
    point('e', 'Legs', 2026, 10, 15, { volumeKg: 9000 }),
  ])[0]!;

  it('counts the workouts of each month, and their typical and best numbers', () => {
    expect(byMonth(legs, 'volume')).toEqual([
      { month: '2026-08', sessions: 2, average: 6500, best: 7000, change: null },
      {
        month: '2026-10',
        sessions: 3,
        average: 8000,
        best: 9000,
        change: expect.closeTo(8000 / 6500 - 1, 5),
      },
    ]);
  });

  it('judges a month by its typical workout, not by how many there were', () => {
    // Three workouts at the same weight as last month's two is not progress.
    const flat = groupByWorkout([
      point('a', 'Legs', 2026, 9, 5, { volumeKg: 8000 }),
      point('b', 'Legs', 2026, 9, 19, { volumeKg: 8000 }),
      point('c', 'Legs', 2026, 10, 1, { volumeKg: 8000 }),
      point('d', 'Legs', 2026, 10, 8, { volumeKg: 8000 }),
      point('e', 'Legs', 2026, 10, 15, { volumeKg: 8000 }),
    ])[0]!;
    expect(byMonth(flat, 'volume').at(-1)).toMatchObject({ sessions: 3, change: 0 });
  });

  it('leaves out a month the workout was not done in, and compares across the gap', () => {
    const months = byMonth(legs, 'volume');
    expect(months.map((entry) => entry.month)).toEqual(['2026-08', '2026-10']);
    expect(months[1]!.change).not.toBeNull();
  });

  it('keeps only the most recent months asked for', () => {
    const long = groupByWorkout(
      Array.from({ length: 9 }, (_unused, index) =>
        point(`s${index}`, 'Legs', 2026, index + 1, 10, { volumeKg: 5000 + index * 100 }),
      ),
    )[0]!;
    const months = byMonth(long, 'volume', 6);
    expect(months.map((entry) => entry.month)).toEqual([
      '2026-04',
      '2026-05',
      '2026-06',
      '2026-07',
      '2026-08',
      '2026-09',
    ]);
    // The oldest one shown is still compared with the month before it, which is not shown.
    expect(months[0]!.change).not.toBeNull();
  });

  it('files a workout under the month it started in on this phone', () => {
    expect(localMonth(new Date(2026, 9, 31, 23, 30).toISOString())).toBe('2026-10');
    expect(localMonth(new Date(2026, 10, 1, 0, 30).toISOString())).toBe('2026-11');
  });
});

describe('every workout beside the one before it', () => {
  it('is newest first, each with its change', () => {
    const [line] = groupByWorkout([
      point('a', 'Legs', 2026, 10, 1, { volumeKg: 8000 }),
      point('b', 'Legs', 2026, 10, 8, { volumeKg: 8800 }),
      point('c', 'Legs', 2026, 10, 15, { volumeKg: 7920 }),
    ]);
    const rows = sessionsWithChange(line!, 'volume');
    expect(rows.map((row) => row.session.id)).toEqual(['c', 'b', 'a']);
    expect(rows[0]!.change).toBeCloseTo(-0.1);
    expect(rows[1]!.change).toBeCloseTo(0.1);
    expect(rows[2]!.change).toBeNull();
  });
});

describe('lift by lift', () => {
  const best = (exerciseKey: string, weightKg: number | null, reps: number | null) => ({
    exerciseKey,
    weightKg,
    reps,
  });

  it('is up for a heavier set, or the same weight for more reps', () => {
    const changes = exerciseChanges(
      [best('Back Squat', 102.5, 8), best('Leg Press', 200, 12)],
      [best('Back Squat', 100, 8), best('Leg Press', 200, 10)],
    );
    expect(changes.map((change) => change.direction)).toEqual(['up', 'up']);
  });

  it('is down for a lighter set, even with more reps, and for the same weight with fewer', () => {
    const changes = exerciseChanges(
      [best('Back Squat', 95, 12), best('Leg Press', 200, 8)],
      [best('Back Squat', 100, 8), best('Leg Press', 200, 10)],
    );
    expect(changes.map((change) => change.direction)).toEqual(['down', 'down']);
  });

  it('is the same for the same', () => {
    expect(
      exerciseChanges([best('Back Squat', 100, 8)], [best('Back Squat', 100, 8)])[0]!.direction,
    ).toBe('same');
  });

  it('compares an exercise done without weight on its reps', () => {
    expect(
      exerciseChanges([best('Push-up', null, 15)], [best('Push-up', null, 12)])[0]!.direction,
    ).toBe('up');
  });

  it('marks an exercise that was not done last time as new, and does not list one that was dropped', () => {
    const changes = exerciseChanges(
      [best('Back Squat', 100, 8), best('Hip Thrust', 80, 10)],
      [best('Back Squat', 100, 8), best('Leg Extension', 50, 12)],
    );
    expect(changes.map((change) => [change.exerciseKey, change.direction])).toEqual([
      ['Back Squat', 'same'],
      ['Hip Thrust', 'new'],
    ]);
  });

  it('keeps the latest workout’s order, and tells an exercise done twice once', () => {
    const changes = exerciseChanges(
      [best('Leg Press', 200, 10), best('Back Squat', 100, 8), best('Leg Press', 180, 12)],
      [],
    );
    expect(changes.map((change) => change.exerciseKey)).toEqual(['Leg Press', 'Back Squat']);
    expect(changes[0]!.latest.weightKg).toBe(200);
  });
});

/* -------------------------------------------------------------------------- */
/* The query                                                                   */
/* -------------------------------------------------------------------------- */

describe('reading the lines from the training log', () => {
  const USER = 'user-1';
  let db: SqlExecutor & { close: () => void };
  let counter = 0;
  let tick = Date.parse('2026-10-01T08:00:00.000Z');
  const newId = () => `id-${++counter}`;
  const clock = () => new Date((tick += 60_000)).toISOString();

  beforeEach(() => {
    db = createTestExecutor();
    counter = 0;
  });
  afterEach(() => db.close());

  /** A finished workout with one exercise and the given sets, all ticked off unless said. */
  async function workout(
    name: string | null,
    sets: {
      weightKg?: number;
      reps?: number;
      distanceM?: number;
      warmup?: boolean;
      done?: boolean;
    }[],
    userId = USER,
  ) {
    const sessionId = await startSession(db, userId, newId, {}, clock);
    if (name !== null) await renameSession(db, userId, sessionId, name, clock);
    const exerciseId = await addExerciseToSession(db, newId, sessionId, 'Back Squat', clock);
    for (const set of sets) {
      const setId = await addSet(
        db,
        newId,
        exerciseId,
        {
          weightKg: set.weightKg ?? null,
          reps: set.reps ?? null,
          distanceM: set.distanceM ?? null,
          isWarmup: set.warmup ?? false,
        },
        clock,
      );
      if (set.done !== false) await markSetDone(db, setId, true, clock);
    }
    await finishSession(db, userId, sessionId, {}, clock);
    return sessionId;
  }

  it('gives each finished, named workout its totals', async () => {
    const id = await workout('Legs', [
      { weightKg: 100, reps: 8 },
      { weightKg: 100, reps: 7 },
    ]);
    expect(await listWorkoutPoints(db, USER)).toEqual([
      expect.objectContaining({ id, name: 'Legs', volumeKg: 1500, sets: 2, distanceM: 0 }),
    ]);
  });

  it('counts only sets that were ticked off and were not warm-ups', async () => {
    await workout('Legs', [
      { weightKg: 60, reps: 5, warmup: true },
      { weightKg: 100, reps: 8 },
      { weightKg: 100, reps: 8, done: false },
    ]);
    const [legs] = await listWorkoutPoints(db, USER);
    expect(legs).toMatchObject({ volumeKg: 800, sets: 1 });
  });

  it('calls a workout started from the plan by its plan day’s name', async () => {
    const planId = await createPlan(db, USER, newId, 'Plan', clock);
    const dayId = await addPlanDay(db, newId, planId, 'Legs', clock);
    const sessionId = await startSessionFromPlanDay(db, USER, newId, dayId, clock);
    // Even with the workout's own name wiped, it is still the plan's leg day.
    await db.run(`UPDATE workout_sessions SET name = NULL WHERE id = ?`, [sessionId]);
    await finishSession(db, USER, sessionId!, {}, clock);

    expect((await listWorkoutPoints(db, USER)).map((entry) => entry.name)).toEqual(['Legs']);
  });

  it('leaves out a workout with no name, one still in progress, a deleted one, and anyone else’s', async () => {
    await workout(null, [{ weightKg: 100, reps: 8 }]);
    const open = await startSession(db, USER, newId, {}, clock);
    await renameSession(db, USER, open, 'Open', clock);
    const gone = await workout('Gone', [{ weightKg: 100, reps: 8 }]);
    await db.run(`UPDATE workout_sessions SET deleted_at = ? WHERE id = ?`, [clock(), gone]);
    await workout('Theirs', [{ weightKg: 100, reps: 8 }], 'someone-else');
    await workout('Mine', [{ weightKg: 100, reps: 8 }]);

    expect((await listWorkoutPoints(db, USER)).map((entry) => entry.name)).toEqual(['Mine']);
  });

  it('puts planned and unplanned workouts of one name on one line', async () => {
    const planId = await createPlan(db, USER, newId, 'Plan', clock);
    const dayId = await addPlanDay(db, newId, planId, 'Legs', clock);
    const planned = await startSessionFromPlanDay(db, USER, newId, dayId, clock);
    await finishSession(db, USER, planned!, {}, clock);
    await workout('legs', [{ weightKg: 100, reps: 8 }]);

    const lines = groupByWorkout(await listWorkoutPoints(db, USER));
    expect(lines).toHaveLength(1);
    expect(lines[0]!.sessions).toHaveLength(2);
  });

  it('finds the best working set of each exercise, in the workout’s order', async () => {
    const sessionId = await startSession(db, USER, newId, {}, clock);
    const squat = await addExerciseToSession(db, newId, sessionId, 'Back Squat', clock);
    const press = await addExerciseToSession(db, newId, sessionId, 'Leg Press', clock);
    const pushup = await addExerciseToSession(db, newId, sessionId, 'Push-up', clock);
    const skipped = await addExerciseToSession(db, newId, sessionId, 'Leg Extension', clock);
    const add = async (
      exerciseId: string,
      weightKg: number | null,
      reps: number,
      extra: { warmup?: boolean; done?: boolean } = {},
    ) => {
      const id = await addSet(
        db,
        newId,
        exerciseId,
        { weightKg, reps, isWarmup: extra.warmup ?? false },
        clock,
      );
      if (extra.done !== false) await markSetDone(db, id, true, clock);
    };
    await add(squat, 120, 3, { warmup: true });
    await add(squat, 100, 8);
    await add(squat, 105, 6);
    await add(squat, 105, 7);
    await add(squat, 110, 5, { done: false });
    await add(press, 200, 10);
    await add(pushup, null, 12);
    await add(pushup, null, 15);
    await add(skipped, 50, 12, { done: false });
    await finishSession(db, USER, sessionId, {}, clock);

    expect(await listExerciseBests(db, USER, sessionId)).toEqual([
      { exerciseKey: 'Back Squat', weightKg: 105, reps: 7 },
      { exerciseKey: 'Leg Press', weightKg: 200, reps: 10 },
      { exerciseKey: 'Push-up', weightKg: null, reps: 15 },
    ]);
    expect(await listExerciseBests(db, 'someone-else', sessionId)).toEqual([]);
  });
});
