/**
 * The monthly review's reads — real SQL against real SQLite.
 */

import { beforeEach, describe, expect, it } from 'vitest';

import { reviewSession } from '@fit/shared/progress';

import { reviewMonth, reviewMonthByWorkout } from '../progress/monthlyReview.js';
import type { SqlExecutor } from './executor.js';
import {
  listSessionsBetween,
  listTrainingMonths,
  loadMonthHistory,
  loadMonthHistoryByWorkout,
  loadSessionHistory,
} from './monthlyReview.js';
import { createTestExecutor } from './testUtils.js';
import {
  addExerciseToSession,
  addSet,
  deleteSession,
  finishSession,
  markSetDone,
  startSession,
} from './workouts.js';

const USER = 'user-1';
let db: SqlExecutor;
let counter = 0;
const newId = () => `id-${String(++counter).padStart(3, '0')}`;

type Lift = { weightKg: number | null; reps: number; isWarmup?: boolean; done?: boolean };

/** One finished workout on a local day of 2026 (month 1-based) with these exercises. */
async function workout(month: number, day: number, exercises: Record<string, Lift[]>) {
  const clock = () => new Date(2026, month - 1, day, 18).toISOString();
  const sessionId = await startSession(db, USER, newId, {}, clock);
  for (const [key, sets] of Object.entries(exercises)) {
    const exerciseId = await addExerciseToSession(db, newId, sessionId, key, clock);
    for (const set of sets) {
      const setId = await addSet(db, newId, exerciseId, set, clock);
      if (set.done !== false) await markSetDone(db, setId, true, clock);
    }
  }
  await finishSession(db, USER, sessionId, {}, clock);
  return sessionId;
}

beforeEach(() => {
  db = createTestExecutor();
  counter = 0;
});

/** A finished workout, as above, given a name — the workout's type for the review. */
async function named(name: string | null, month: number, day: number, exercises: Record<string, Lift[]>) {
  const sessionId = await workout(month, day, exercises);
  await db.run(`UPDATE workout_sessions SET name = ? WHERE id = ?`, [name, sessionId]);
  return sessionId;
}

describe('the monthly review by workout', () => {
  it('keeps the same exercise at two places apart, each judged in its own workout', async () => {
    await named('Legs home', 9, 10, { 'Leg Press': [{ weightKg: 100, reps: 10 }] });
    await named('Legs gym', 9, 25, { 'Leg Press': [{ weightKg: 60, reps: 10 }] });
    await named('Legs home', 10, 8, { 'Leg Press': [{ weightKg: 100, reps: 10 }] });
    await named('Legs gym', 10, 20, { 'Leg Press': [{ weightKg: 65, reps: 10 }] });

    const workouts = await loadMonthHistoryByWorkout(db, USER, '2026-10');
    expect([...workouts.keys()].sort()).toEqual(['legs gym', 'legs home']);

    const { review, workouts: groups } = reviewMonthByWorkout(workouts, '2026-10');
    const verdicts = Object.fromEntries(review.exercises.map((e) => [e.workoutName, e.status]));
    expect(verdicts).toEqual({ 'Legs home': 'same', 'Legs gym': 'improved' });
    expect(groups.map((g) => g.name)).toEqual(['Legs gym', 'Legs home']);
  });

  it('leaves out deleted workouts and sets that were not done, as the flat read does', async () => {
    await named('Push', 10, 3, {
      Row: [
        { weightKg: 40, reps: 10, isWarmup: true },
        { weightKg: 60, reps: 10 },
        { weightKg: 60, reps: 9, done: false },
      ],
    });
    const gone = await named('Push', 10, 9, { Row: [{ weightKg: 90, reps: 10 }] });
    await deleteSession(db, USER, gone);

    const workouts = await loadMonthHistoryByWorkout(db, USER, '2026-10');
    const row = workouts.get('push')!.history.get('Row')!;
    expect(row).toHaveLength(1);
    expect(row[0]!.sets.map((s) => [s.weightKg, s.reps])).toEqual([[60, 10]]);
  });
});

describe('the monthly review’s reads', () => {
  it('reads each exercise’s sessions with only the working sets that were done', async () => {
    await workout(10, 6, {
      'Bench Press': [
        { weightKg: 40, reps: 10, isWarmup: true },
        { weightKg: 80, reps: 8 },
        { weightKg: 80, reps: 7 },
        { weightKg: 80, reps: 6, done: false },
      ],
      Row: [{ weightKg: 60, reps: 10 }],
    });
    const history = await listSessionsBetween(
      db,
      USER,
      new Date(2026, 9, 1).toISOString(),
      new Date(2026, 10, 1).toISOString(),
    );
    expect([...history.keys()].sort()).toEqual(['Bench Press', 'Row']);
    expect(history.get('Bench Press')![0]!.sets.map((s) => [s.weightKg, s.reps])).toEqual([
      [80, 8],
      [80, 7],
    ]);
  });

  it('lists the months with training, leaving out deleted workouts', async () => {
    await workout(8, 20, { Squat: [{ weightKg: 100, reps: 5 }] });
    await workout(10, 3, { Squat: [{ weightKg: 100, reps: 5 }] });
    const gone = await workout(9, 12, { Squat: [{ weightKg: 100, reps: 5 }] });
    await deleteSession(db, USER, gone);
    expect(await listTrainingMonths(db, USER)).toEqual(['2026-08', '2026-10']);
  });

  it('loads far enough back to read a month against the time before it', async () => {
    await workout(9, 29, { 'Bench Press': [{ weightKg: 80, reps: 8 }] });
    await workout(10, 6, { 'Bench Press': [{ weightKg: 82.5, reps: 8 }] });
    await workout(11, 2, { 'Bench Press': [{ weightKg: 85, reps: 8 }] });

    const review = reviewMonth(await loadMonthHistory(db, USER, '2026-10'), '2026-10');
    expect(review.exercises).toHaveLength(1);
    const [bench] = review.exercises;
    expect(bench!.status).toBe('improved');
    expect(bench!.fromBeforeMonth).toBe(true);
    expect(bench!.gain).toEqual({ weightKg: 2.5, reps: 0, sets: 0 });
    // November is past the month's end, and is not part of October's review.
    expect(bench!.best[0]!.startedAt).toBe(new Date(2026, 9, 6, 18).toISOString());
    expect(review.previous).toEqual({ sessions: 1, sets: 1 });
  });
});

describe('a finished workout’s summary', () => {
  it('reads each exercise up to that workout, and compares with the time before it', async () => {
    await workout(10, 2, { 'Bench Press': [{ weightKg: 80, reps: 8 }] });
    const middle = await workout(10, 9, {
      'Bench Press': [{ weightKg: 82.5, reps: 8 }],
      'Leg Press': [{ weightKg: 200, reps: 10 }],
    });
    await workout(10, 16, { 'Bench Press': [{ weightKg: 85, reps: 8 }] });

    const review = reviewSession(await loadSessionHistory(db, USER, middle), middle, [
      'Bench Press',
      'Leg Press',
    ]);
    expect(review.exercises.map((e) => [e.exerciseKey, e.status])).toEqual([
      ['Bench Press', 'improved'],
      ['Leg Press', 'new'],
    ]);
    // Against the 2nd, not the later workout on the 16th.
    expect(review.exercises[0]!.previous?.startedAt).toBe(new Date(2026, 9, 2, 18).toISOString());
  });

  it('is empty for a workout that is not there', async () => {
    expect((await loadSessionHistory(db, USER, 'missing')).size).toBe(0);
  });
});
