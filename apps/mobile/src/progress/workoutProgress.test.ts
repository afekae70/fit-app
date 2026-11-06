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
import { listSessionSets, listWorkoutPoints } from '../db/workoutProgress.js';
import { NO_TALLY, type Tally } from './setBySet.js';
import {
  byMonth,
  changeFrom,
  groupByWorkout,
  latestComparison,
  localMonth,
  metricOf,
  minutesOf,
  monthTallies,
  sessionsWithChange,
  talliesAlongLine,
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
  sets: 0,
  reps: 0,
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
  it('is the sets, for a workout that ever had a set with reps — never weight x reps', () => {
    const [line] = groupByWorkout([
      point('a', 'Legs', 2026, 10, 1),
      point('b', 'Legs', 2026, 10, 8, { sets: 12, reps: 96, distanceM: 400 }),
    ]);
    expect(metricOf(line!)).toBe('strength');
    expect(valueOf(line!.sessions[1]!, 'strength')).toBe(12);
  });

  it('counts a bodyweight workout as strength: reps without a weight are still sets', () => {
    const [line] = groupByWorkout([point('a', 'Calisthenics', 2026, 10, 1, { sets: 6, reps: 60 })]);
    expect(metricOf(line!)).toBe('strength');
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
      point('a', 'Legs', 2026, 10, 1, { distanceM: 7000 }),
      point('b', 'Legs', 2026, 10, 8, { distanceM: 8000 }),
      point('c', 'Legs', 2026, 10, 15, { distanceM: 8400 }),
      point('p', 'Push', 2026, 10, 16, { distanceM: 99999 }),
    ]).filter((entry) => entry.key === 'legs');

    const comparison = latestComparison(line!);
    expect(comparison.latest.id).toBe('c');
    expect(comparison.previous?.id).toBe('b');
    expect(comparison.latestValue).toBe(8400);
    expect(comparison.previousValue).toBe(8000);
    expect(comparison.change).toBeCloseTo(0.05);
  });

  it('has nothing to compare the first time a workout is done', () => {
    const [line] = groupByWorkout([point('a', 'Legs', 2026, 10, 1, { distanceM: 7000 })]);
    const comparison = latestComparison(line!);
    expect(comparison.previous).toBeNull();
    expect(comparison.previousValue).toBeNull();
    expect(comparison.change).toBeNull();
  });
});

describe('month against month', () => {
  const legs = groupByWorkout([
    point('a', 'Legs', 2026, 8, 5, { distanceM: 6000 }),
    point('b', 'Legs', 2026, 8, 19, { distanceM: 7000 }),
    // September: none. A month off.
    point('c', 'Legs', 2026, 10, 1, { distanceM: 7000 }),
    point('d', 'Legs', 2026, 10, 8, { distanceM: 8000 }),
    point('e', 'Legs', 2026, 10, 15, { distanceM: 9000 }),
  ])[0]!;

  it('counts the workouts of each month, and their typical and best numbers', () => {
    expect(byMonth(legs, 'distance')).toEqual([
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
      point('a', 'Legs', 2026, 9, 5, { distanceM: 8000 }),
      point('b', 'Legs', 2026, 9, 19, { distanceM: 8000 }),
      point('c', 'Legs', 2026, 10, 1, { distanceM: 8000 }),
      point('d', 'Legs', 2026, 10, 8, { distanceM: 8000 }),
      point('e', 'Legs', 2026, 10, 15, { distanceM: 8000 }),
    ])[0]!;
    expect(byMonth(flat, 'distance').at(-1)).toMatchObject({ sessions: 3, change: 0 });
  });

  it('leaves out a month the workout was not done in, and compares across the gap', () => {
    const months = byMonth(legs, 'distance');
    expect(months.map((entry) => entry.month)).toEqual(['2026-08', '2026-10']);
    expect(months[1]!.change).not.toBeNull();
  });

  it('keeps only the most recent months asked for', () => {
    const long = groupByWorkout(
      Array.from({ length: 9 }, (_unused, index) =>
        point(`s${index}`, 'Legs', 2026, index + 1, 10, { distanceM: 5000 + index * 100 }),
      ),
    )[0]!;
    const months = byMonth(long, 'distance', 6);
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
      point('a', 'Legs', 2026, 10, 1, { distanceM: 8000 }),
      point('b', 'Legs', 2026, 10, 8, { distanceM: 8800 }),
      point('c', 'Legs', 2026, 10, 15, { distanceM: 7920 }),
    ]);
    const rows = sessionsWithChange(line!, 'distance');
    expect(rows.map((row) => row.session.id)).toEqual(['c', 'b', 'a']);
    expect(rows[0]!.change).toBeCloseTo(-0.1);
    expect(rows[1]!.change).toBeCloseTo(0.1);
    expect(rows[2]!.change).toBeNull();
  });
});

describe('set by set along a workout', () => {
  const legs = groupByWorkout([
    point('a', 'Legs', 2026, 9, 24, { sets: 3, reps: 24 }),
    point('b', 'Legs', 2026, 10, 1, { sets: 3, reps: 24 }),
    point('c', 'Legs', 2026, 10, 8, { sets: 4, reps: 30 }),
    point('d', 'Legs', 2026, 11, 5, { sets: 4, reps: 30 }),
  ])[0]!;
  const tally = (over: Partial<Tally>): Tally => ({ ...NO_TALLY, ...over });
  /** What each session's sets came to against the one before, as the caller would read them. */
  const between: Record<string, Tally> = {
    'b<a': tally({ up: 2, same: 1 }),
    'c<b': tally({ up: 1, same: 2, added: 1 }),
    'd<c': tally({ same: 3, down: 1 }),
  };

  it('gives every session but the first its sets against the one before it', () => {
    const along = talliesAlongLine(legs, (latest, previous) => between[`${latest}<${previous}`]!);
    expect(along.map((entry) => [entry.session.id, entry.tally])).toEqual([
      ['a', null],
      ['b', between['b<a']],
      ['c', between['c<b']],
      ['d', between['d<c']],
    ]);
  });

  it('credits each month with the sets that got better and worse in it', () => {
    const along = talliesAlongLine(legs, (latest, previous) => between[`${latest}<${previous}`]!);
    expect(
      monthTallies(along).map(({ month, sessions, improved, worse }) => ({
        month,
        sessions,
        improved,
        worse,
      })),
    ).toEqual([
      // The first leg day ever has nothing to be better than.
      { month: '2026-09', sessions: 1, improved: 0, worse: 0 },
      // An added set is progress, the same as a heavier one.
      { month: '2026-10', sessions: 2, improved: 4, worse: 0 },
      { month: '2026-11', sessions: 1, improved: 0, worse: 1 },
    ]);
  });

  it('keeps only the most recent months asked for', () => {
    const along = talliesAlongLine(legs, () => tally({ up: 1 }));
    expect(monthTallies(along, 2).map((month) => month.month)).toEqual(['2026-10', '2026-11']);
  });
});

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
      expect.objectContaining({ id, name: 'Legs', sets: 2, reps: 15, distanceM: 0 }),
    ]);
  });

  it('counts only sets that were ticked off and were not warm-ups', async () => {
    await workout('Legs', [
      { weightKg: 60, reps: 5, warmup: true },
      { weightKg: 100, reps: 8 },
      { weightKg: 100, reps: 8, done: false },
    ]);
    const [legs] = await listWorkoutPoints(db, USER);
    expect(legs).toMatchObject({ sets: 1, reps: 8 });
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

  it('reads every working set of each exercise, by workout, in the order they were done', async () => {
    const sessionId = await startSession(db, USER, newId, {}, clock);
    const squat = await addExerciseToSession(db, newId, sessionId, 'Back Squat', clock);
    const pushup = await addExerciseToSession(db, newId, sessionId, 'Push-up', clock);
    const skipped = await addExerciseToSession(db, newId, sessionId, 'Leg Extension', clock);
    const squatAgain = await addExerciseToSession(db, newId, sessionId, 'Back Squat', clock);
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
    await add(squat, 60, 5, { warmup: true });
    await add(squat, 100, 8);
    await add(squat, 105, 6);
    await add(squat, 110, 5, { done: false });
    await add(pushup, null, 12);
    await add(skipped, 50, 12, { done: false });
    await add(squatAgain, 90, 10);
    await finishSession(db, USER, sessionId, {}, clock);
    const other = await workout('Legs', [{ weightKg: 80, reps: 8 }]);

    const set = (weightKg: number | null, reps: number) => ({
      weightKg,
      reps,
      durationSeconds: null,
      distanceM: null,
    });
    const bySession = await listSessionSets(db, USER, [sessionId, other, 'not-a-session']);
    expect(bySession.get(sessionId)).toEqual([
      // The squat done again later in the workout is more sets of the squat, in order.
      { exerciseKey: 'Back Squat', sets: [set(100, 8), set(105, 6), set(90, 10)] },
      { exerciseKey: 'Push-up', sets: [set(null, 12)] },
    ]);
    expect(bySession.get(other)).toEqual([{ exerciseKey: 'Back Squat', sets: [set(80, 8)] }]);
    expect(bySession.has('not-a-session')).toBe(false);
    expect((await listSessionSets(db, 'someone-else', [sessionId])).size).toBe(0);
  });
});
