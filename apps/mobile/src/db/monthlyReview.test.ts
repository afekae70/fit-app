/**
 * The monthly review's reads — real SQL against real SQLite.
 */

import { beforeEach, describe, expect, it } from 'vitest';

import { reviewMonth } from '../progress/monthlyReview.js';
import type { SqlExecutor } from './executor.js';
import { listSessionsBetween, listTrainingMonths, loadMonthHistory } from './monthlyReview.js';
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
    expect(bench!.status).toBe('progressing');
    expect(bench!.fromBeforeMonth).toBe(true);
    expect(bench!.gain).toEqual({ weightKg: 2.5, reps: 0, sets: 0 });
    // November is past the month's end, and is not part of October's review.
    expect(bench!.to.startedAt).toBe(new Date(2026, 9, 6, 18).toISOString());
    expect(review.previous).toEqual({ sessions: 1, sets: 1 });
  });
});
