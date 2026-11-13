/**
 * The share card's two reads: satisfaction kept on a workout, and a workout against the previous
 * one of the same name — real SQL against real SQLite.
 */

import { beforeEach, describe, expect, it } from 'vitest';

import type { SqlExecutor } from './executor.js';
import { createTestExecutor } from './testUtils.js';
import { compareWithPreviousSameWorkout } from './workoutProgress.js';
import {
  addExerciseToSession,
  addSet,
  finishSession,
  getSessionDetail,
  markSetDone,
  setSessionSatisfaction,
  startSession,
} from './workouts.js';

const USER = 'user-1';
let db: SqlExecutor;
let counter = 0;
const newId = () => `id-${String(++counter).padStart(3, '0')}`;

/** A finished, named workout on a local day of 2026 (month 1-based). */
async function workout(
  name: string | null,
  month: number,
  day: number,
  exercises: Record<string, { weightKg: number; reps: number }[]>,
) {
  const clock = () => new Date(2026, month - 1, day, 18).toISOString();
  const id = await startSession(db, USER, newId, {}, clock);
  for (const [key, sets] of Object.entries(exercises)) {
    const exerciseId = await addExerciseToSession(db, newId, id, key, clock);
    for (const set of sets) {
      const setId = await addSet(db, newId, exerciseId, set, clock);
      await markSetDone(db, setId, true, clock);
    }
  }
  await finishSession(db, USER, id, {}, clock);
  await db.run(`UPDATE workout_sessions SET name = ? WHERE id = ?`, [name, id]);
  return id;
}

beforeEach(() => {
  db = createTestExecutor();
  counter = 0;
});

describe('satisfaction with a workout', () => {
  it('keeps a whole number from 1 to 10, and takes it back with null', async () => {
    const id = await workout('Legs', 10, 1, { Squat: [{ weightKg: 100, reps: 5 }] });
    expect(await setSessionSatisfaction(db, USER, id, 8)).toBe(8);
    expect((await getSessionDetail(db, id)).session?.satisfaction).toBe(8);
    expect(await setSessionSatisfaction(db, USER, id, null)).toBeNull();
    expect((await getSessionDetail(db, id)).session?.satisfaction).toBeNull();
  });

  it('refuses a number off the scale and writes nothing', async () => {
    const id = await workout('Legs', 10, 1, { Squat: [{ weightKg: 100, reps: 5 }] });
    await setSessionSatisfaction(db, USER, id, 7);
    for (const bad of [0, 11, 7.5, Number.NaN]) {
      expect(await setSessionSatisfaction(db, USER, id, bad)).toBeNull();
    }
    expect((await getSessionDetail(db, id)).session?.satisfaction).toBe(7);
  });

  it('does not reach another person’s workout', async () => {
    const id = await workout('Legs', 10, 1, { Squat: [{ weightKg: 100, reps: 5 }] });
    await setSessionSatisfaction(db, 'someone-else', id, 9);
    expect((await getSessionDetail(db, id)).session?.satisfaction ?? null).toBeNull();
  });
});

describe('a workout against the previous one of the same name', () => {
  it('skips a workout of another name in between, and compares set by set', async () => {
    const before = await workout('Legs', 10, 1, {
      Squat: [{ weightKg: 100, reps: 5 }],
      'Leg Press': [{ weightKg: 180, reps: 10 }],
    });
    await setSessionSatisfaction(db, USER, before, 6);
    // The same squat at another gym, under another name: not the comparison.
    await workout('Legs gym', 10, 4, { Squat: [{ weightKg: 60, reps: 5 }] });
    const now = await workout('legs', 10, 8, {
      Squat: [{ weightKg: 102.5, reps: 5 }],
      'Leg Press': [{ weightKg: 180, reps: 8 }],
      Lunge: [{ weightKg: 20, reps: 10 }],
    });

    const result = await compareWithPreviousSameWorkout(db, USER, now);
    expect(result?.previous).toMatchObject({ id: before, satisfaction: 6 });
    expect(Object.fromEntries(result!.changes.map((c) => [c.exerciseKey, c.verdict]))).toEqual({
      Squat: 'up',
      'Leg Press': 'down',
      Lunge: 'new',
    });
  });

  it('is null for the first of its kind, and for a workout with no name', async () => {
    const first = await workout('Push', 10, 1, { Bench: [{ weightKg: 80, reps: 8 }] });
    expect(await compareWithPreviousSameWorkout(db, USER, first)).toBeNull();
    await workout(null, 10, 2, { Bench: [{ weightKg: 80, reps: 8 }] });
    const unnamed = await workout(null, 10, 3, { Bench: [{ weightKg: 82.5, reps: 8 }] });
    expect(await compareWithPreviousSameWorkout(db, USER, unnamed)).toBeNull();
  });
});
