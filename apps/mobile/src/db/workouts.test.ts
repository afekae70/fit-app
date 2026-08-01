/**
 * Repository tests running the REAL SQL against a real SQLite engine (`node:sqlite`), not a
 * mock. expo-sqlite is a native module and cannot load here, which is exactly why the
 * repository is written against the `SqlExecutor` seam.
 *
 * The dynamic-set behaviour is the reason this file exists: it is the one invariant the whole
 * app is designed around, and it is far easier to get wrong in SQL than it looks.
 */

import { beforeEach, describe, expect, it } from 'vitest';

import type { SqlExecutor } from './executor.js';
import { createTestExecutor } from './testUtils.js';
import {
  addExerciseToSession,
  addSet,
  addSetCopyingPrevious,
  finishSession,
  getActiveSession,
  getPreviousBest,
  getSessionDetail,
  getWorkoutStreak,
  listRecentExerciseKeys,
  listSets,
  removeExerciseFromSession,
  removeSet,
  startSession,
  updateSet,
} from './workouts.js';

/** Noon N days before today, in local time — matches the day boundary `getWorkoutStreak` itself
 * uses, so the test stays correct regardless of the machine's timezone. */
function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(12, 0, 0, 0);
  return d.toISOString();
}

/** Deterministic ids and clock so assertions never depend on randomness or wall time. */
function createFixtures() {
  let idCounter = 0;
  let tick = 0;
  return {
    newId: () => `id-${String(++idCounter).padStart(3, '0')}`,
    clock: () => new Date(Date.UTC(2026, 6, 25, 10, 0, tick++)).toISOString(),
  };
}

const USER = 'user-1';

let db: SqlExecutor & { close: () => void };
let newId: () => string;
let clock: () => string;

beforeEach(() => {
  db = createTestExecutor();
  const f = createFixtures();
  newId = f.newId;
  clock = f.clock;
});

describe('sessions', () => {
  it('starts a session and reports it as active until finished', async () => {
    const sessionId = await startSession(db, USER, newId, {}, clock);

    let active = await getActiveSession(db, USER);
    expect(active?.id).toBe(sessionId);
    expect(active?.ended_at).toBeNull();

    await finishSession(db, USER, sessionId, { sessionRpe: 8 }, clock);

    active = await getActiveSession(db, USER);
    expect(active).toBeNull();
  });

  it('cascades deletes from session down to sets', async () => {
    const sessionId = await startSession(db, USER, newId, {}, clock);
    const exId = await addExerciseToSession(db, newId, sessionId, 'Barbell Bench Press', clock);
    await addSet(db, newId, exId, { weightKg: 100, reps: 5 }, clock);

    await db.run('DELETE FROM workout_sessions WHERE id = ?', [sessionId]);

    // Relies on PRAGMA foreign_keys being ON — without it the children would be orphaned
    // rather than removed, and the app would show sets belonging to no session.
    expect(await db.all('SELECT * FROM session_exercises')).toHaveLength(0);
    expect(await db.all('SELECT * FROM sets')).toHaveLength(0);
  });
});

describe('dynamic set counts — the core requirement', () => {
  it('records 4 / 2 / 2 sets across three exercises in ONE session', async () => {
    const sessionId = await startSession(db, USER, newId, {}, clock);

    const press = await addExerciseToSession(db, newId, sessionId, 'Barbell Bench Press', clock);
    const facePull = await addExerciseToSession(db, newId, sessionId, 'Face Pull', clock);
    const curl = await addExerciseToSession(db, newId, sessionId, 'Machine Bicep Curl', clock);

    for (let i = 0; i < 4; i++) await addSet(db, newId, press, { weightKg: 80, reps: 8 }, clock);
    for (let i = 0; i < 2; i++) await addSet(db, newId, facePull, { weightKg: 25, reps: 15 }, clock);
    for (let i = 0; i < 2; i++) await addSet(db, newId, curl, { weightKg: 30, reps: 12 }, clock);

    expect(await listSets(db, press)).toHaveLength(4);
    expect(await listSets(db, facePull)).toHaveLength(2);
    expect(await listSets(db, curl)).toHaveLength(2);

    // Each exercise numbers its own sets from 1 — they are independent sequences, not a
    // single running count across the session.
    expect((await listSets(db, press)).map((s) => s.set_index)).toEqual([1, 2, 3, 4]);
    expect((await listSets(db, facePull)).map((s) => s.set_index)).toEqual([1, 2]);
  });

  it('adding a set to one exercise does not disturb another', async () => {
    const sessionId = await startSession(db, USER, newId, {}, clock);
    const press = await addExerciseToSession(db, newId, sessionId, 'Barbell Bench Press', clock);
    const facePull = await addExerciseToSession(db, newId, sessionId, 'Face Pull', clock);

    await addSet(db, newId, press, { weightKg: 80, reps: 8 }, clock);
    await addSet(db, newId, facePull, { weightKg: 25, reps: 15 }, clock);
    await addSet(db, newId, press, { weightKg: 80, reps: 7 }, clock);

    expect(await listSets(db, press)).toHaveLength(2);
    expect(await listSets(db, facePull)).toHaveLength(1);
    expect((await listSets(db, facePull))[0]?.set_index).toBe(1);
  });

  it('renumbers 3->2 and 4->3 when set 2 of 4 is deleted', async () => {
    const sessionId = await startSession(db, USER, newId, {}, clock);
    const press = await addExerciseToSession(db, newId, sessionId, 'Barbell Bench Press', clock);

    const ids: string[] = [];
    for (let reps = 8; reps >= 5; reps--) {
      ids.push(await addSet(db, newId, press, { weightKg: 80, reps }, clock));
    }

    await removeSet(db, ids[1] as string, clock);

    const remaining = await listSets(db, press);
    expect(remaining).toHaveLength(3);
    // Contiguous, no gap where index 2 used to be.
    expect(remaining.map((s) => s.set_index)).toEqual([1, 2, 3]);
    // Order preserved: the 8-rep set stays first, then 6 then 5 (the 7 was deleted).
    expect(remaining.map((s) => s.reps)).toEqual([8, 6, 5]);
  });

  it('renumbers correctly when the FIRST set is deleted', async () => {
    const sessionId = await startSession(db, USER, newId, {}, clock);
    const press = await addExerciseToSession(db, newId, sessionId, 'Barbell Bench Press', clock);

    const ids: string[] = [];
    for (let reps = 10; reps >= 8; reps--) {
      ids.push(await addSet(db, newId, press, { weightKg: 60, reps }, clock));
    }

    await removeSet(db, ids[0] as string, clock);

    const remaining = await listSets(db, press);
    expect(remaining.map((s) => s.set_index)).toEqual([1, 2]);
    expect(remaining.map((s) => s.reps)).toEqual([9, 8]);
  });

  it('lets the next added set reuse the freed index after a delete', async () => {
    const sessionId = await startSession(db, USER, newId, {}, clock);
    const press = await addExerciseToSession(db, newId, sessionId, 'Barbell Bench Press', clock);

    const a = await addSet(db, newId, press, { reps: 10 }, clock);
    await addSet(db, newId, press, { reps: 9 }, clock);
    await removeSet(db, a, clock);
    await addSet(db, newId, press, { reps: 8 }, clock);

    // After renumbering, MAX(set_index) is 1, so the new set becomes 2 — no UNIQUE collision.
    expect((await listSets(db, press)).map((s) => s.set_index)).toEqual([1, 2]);
    expect((await listSets(db, press)).map((s) => s.reps)).toEqual([9, 8]);
  });

  it('handles deleting every set, then adding again', async () => {
    const sessionId = await startSession(db, USER, newId, {}, clock);
    const press = await addExerciseToSession(db, newId, sessionId, 'Barbell Bench Press', clock);

    const a = await addSet(db, newId, press, { reps: 10 }, clock);
    const b = await addSet(db, newId, press, { reps: 9 }, clock);
    await removeSet(db, a, clock);
    await removeSet(db, b, clock);

    expect(await listSets(db, press)).toHaveLength(0);

    await addSet(db, newId, press, { reps: 8 }, clock);
    expect((await listSets(db, press))[0]?.set_index).toBe(1);
  });

  it('removing a set is a no-op when the id does not exist', async () => {
    await expect(removeSet(db, 'no-such-set', clock)).resolves.toBeUndefined();
  });
});

describe('set prefill', () => {
  it('copies weight and reps forward from the previous set', async () => {
    const sessionId = await startSession(db, USER, newId, {}, clock);
    const press = await addExerciseToSession(db, newId, sessionId, 'Barbell Bench Press', clock);
    await addSet(db, newId, press, { weightKg: 82.5, reps: 8 }, clock);

    await addSetCopyingPrevious(db, newId, press, clock);

    const sets = await listSets(db, press);
    expect(sets[1]?.weight_kg).toBe(82.5);
    expect(sets[1]?.reps).toBe(8);
  });

  it('does not carry warmup status forward', async () => {
    const sessionId = await startSession(db, USER, newId, {}, clock);
    const press = await addExerciseToSession(db, newId, sessionId, 'Barbell Bench Press', clock);
    await addSet(db, newId, press, { weightKg: 40, reps: 10, isWarmup: true }, clock);

    await addSetCopyingPrevious(db, newId, press, clock);

    // The set after a warmup is almost never another warmup — copying the flag would make
    // every following set silently excluded from volume and 1RM maths.
    expect((await listSets(db, press))[1]?.is_warmup).toBe(0);
  });

  it('creates an empty set when there is nothing to copy', async () => {
    const sessionId = await startSession(db, USER, newId, {}, clock);
    const press = await addExerciseToSession(db, newId, sessionId, 'Barbell Bench Press', clock);

    await addSetCopyingPrevious(db, newId, press, clock);

    const sets = await listSets(db, press);
    expect(sets).toHaveLength(1);
    expect(sets[0]?.weight_kg).toBeNull();
  });
});

describe('updateSet', () => {
  it('changes only the supplied fields', async () => {
    const sessionId = await startSession(db, USER, newId, {}, clock);
    const press = await addExerciseToSession(db, newId, sessionId, 'Barbell Bench Press', clock);
    const setId = await addSet(db, newId, press, { weightKg: 80, reps: 8 }, clock);

    await updateSet(db, setId, { reps: 9 }, clock);

    const set = (await listSets(db, press))[0];
    expect(set?.reps).toBe(9);
    // Editing reps must not blank the weight already recorded.
    expect(set?.weight_kg).toBe(80);
  });

  it('can explicitly clear a field with null', async () => {
    const sessionId = await startSession(db, USER, newId, {}, clock);
    const press = await addExerciseToSession(db, newId, sessionId, 'Barbell Bench Press', clock);
    const setId = await addSet(db, newId, press, { weightKg: 80, reps: 8 }, clock);

    await updateSet(db, setId, { weightKg: null }, clock);

    expect((await listSets(db, press))[0]?.weight_kg).toBeNull();
  });

  it('is a no-op with an empty patch', async () => {
    const sessionId = await startSession(db, USER, newId, {}, clock);
    const press = await addExerciseToSession(db, newId, sessionId, 'Barbell Bench Press', clock);
    const setId = await addSet(db, newId, press, { weightKg: 80, reps: 8 }, clock);

    await updateSet(db, setId, {}, clock);

    expect((await listSets(db, press))[0]?.weight_kg).toBe(80);
  });

  it('toggles warmup', async () => {
    const sessionId = await startSession(db, USER, newId, {}, clock);
    const press = await addExerciseToSession(db, newId, sessionId, 'Barbell Bench Press', clock);
    const setId = await addSet(db, newId, press, { weightKg: 40, reps: 10 }, clock);

    await updateSet(db, setId, { isWarmup: true }, clock);
    expect((await listSets(db, press))[0]?.is_warmup).toBe(1);
  });
});

describe('exercise ordering', () => {
  it('closes the gap when a middle exercise is removed', async () => {
    const sessionId = await startSession(db, USER, newId, {}, clock);
    await addExerciseToSession(db, newId, sessionId, 'Barbell Bench Press', clock);
    const middle = await addExerciseToSession(db, newId, sessionId, 'Face Pull', clock);
    await addExerciseToSession(db, newId, sessionId, 'Machine Bicep Curl', clock);

    await removeExerciseFromSession(db, middle, clock);

    const { exercises } = await getSessionDetail(db, sessionId);
    expect(exercises.map((e) => e.order_index)).toEqual([1, 2]);
    expect(exercises.map((e) => e.exercise_key)).toEqual([
      'Barbell Bench Press',
      'Machine Bicep Curl',
    ]);
  });

  it('removes the exercise sets along with it', async () => {
    const sessionId = await startSession(db, USER, newId, {}, clock);
    const press = await addExerciseToSession(db, newId, sessionId, 'Barbell Bench Press', clock);
    await addSet(db, newId, press, { weightKg: 80, reps: 8 }, clock);

    await removeExerciseFromSession(db, press, clock);

    // Gone from every read path...
    expect(await listSets(db, press)).toHaveLength(0);
    const { exercises } = await getSessionDetail(db, sessionId);
    expect(exercises).toHaveLength(0);
  });

  it('keeps deleted rows as tombstones so the deletion can reach another device', async () => {
    const sessionId = await startSession(db, USER, newId, {}, clock);
    const press = await addExerciseToSession(db, newId, sessionId, 'Barbell Bench Press', clock);
    await addSet(db, newId, press, { weightKg: 80, reps: 8 }, clock);

    await removeExerciseFromSession(db, press, clock);

    // ...but still present and marked, because a row that simply vanished would be invisible to
    // the next sync and would come straight back from the server.
    const rows = await db.all<{ deleted_at: string | null }>('SELECT deleted_at FROM sets');
    expect(rows).toHaveLength(1);
    expect(rows[0]?.deleted_at).not.toBeNull();
  });

  it('frees the index slot so a replacement exercise does not collide', async () => {
    const sessionId = await startSession(db, USER, newId, {}, clock);
    const press = await addExerciseToSession(db, newId, sessionId, 'Barbell Bench Press', clock);
    await removeExerciseFromSession(db, press, clock);

    // UNIQUE (session_id, order_index) would reject this if the deleted row still held slot 1.
    const replacement = await addExerciseToSession(db, newId, sessionId, 'Back Squat', clock);
    const { exercises } = await getSessionDetail(db, sessionId);
    expect(exercises.map((e) => e.id)).toEqual([replacement]);
    expect(exercises[0]?.order_index).toBe(1);
  });
});

describe('getSessionDetail', () => {
  it('returns exercises in order, each with its own sets', async () => {
    const sessionId = await startSession(db, USER, newId, {}, clock);
    const press = await addExerciseToSession(db, newId, sessionId, 'Barbell Bench Press', clock);
    const facePull = await addExerciseToSession(db, newId, sessionId, 'Face Pull', clock);

    for (let i = 0; i < 4; i++) await addSet(db, newId, press, { weightKg: 80, reps: 8 }, clock);
    for (let i = 0; i < 2; i++) await addSet(db, newId, facePull, { weightKg: 25, reps: 15 }, clock);

    const { session, exercises } = await getSessionDetail(db, sessionId);

    expect(session?.id).toBe(sessionId);
    expect(exercises.map((e) => e.exercise_key)).toEqual(['Barbell Bench Press', 'Face Pull']);
    expect(exercises.map((e) => e.sets.length)).toEqual([4, 2]);
  });

  it('returns nulls for an unknown session rather than throwing', async () => {
    const { session, exercises } = await getSessionDetail(db, 'nope');
    expect(session).toBeNull();
    expect(exercises).toEqual([]);
  });
});

describe('getPreviousBest', () => {
  it('finds the heaviest working set from an earlier session', async () => {
    const first = await startSession(db, USER, newId, {}, clock);
    const p1 = await addExerciseToSession(db, newId, first, 'Barbell Bench Press', clock);
    await addSet(db, newId, p1, { weightKg: 80, reps: 8 }, clock);
    await addSet(db, newId, p1, { weightKg: 85, reps: 5 }, clock);
    await finishSession(db, USER, first, {}, clock);

    const second = await startSession(db, USER, newId, {}, clock);

    const best = await getPreviousBest(db, USER, 'Barbell Bench Press', second);
    expect(best?.weight_kg).toBe(85);
  });

  it('ignores warmup sets', async () => {
    const sessionId = await startSession(db, USER, newId, {}, clock);
    const press = await addExerciseToSession(db, newId, sessionId, 'Barbell Bench Press', clock);
    await addSet(db, newId, press, { weightKg: 200, reps: 1, isWarmup: true }, clock);
    await addSet(db, newId, press, { weightKg: 80, reps: 8 }, clock);
    await finishSession(db, USER, sessionId, {}, clock);

    const best = await getPreviousBest(db, USER, 'Barbell Bench Press');
    // A 200 kg "warmup" is data entry noise; counting it would show a fake personal best.
    expect(best?.weight_kg).toBe(80);
  });

  it('excludes the current session so the hint shows LAST time, not this time', async () => {
    const sessionId = await startSession(db, USER, newId, {}, clock);
    const press = await addExerciseToSession(db, newId, sessionId, 'Barbell Bench Press', clock);
    await addSet(db, newId, press, { weightKg: 100, reps: 5 }, clock);

    expect(await getPreviousBest(db, USER, 'Barbell Bench Press', sessionId)).toBeNull();
  });

  it('returns null for an exercise never performed', async () => {
    expect(await getPreviousBest(db, USER, 'Nordic Hamstring Curl')).toBeNull();
  });

  it('never surfaces another user\'s best as this user\'s reference', async () => {
    const otherSession = await startSession(db, 'user-2', newId, {}, clock);
    const otherPress = await addExerciseToSession(
      db,
      newId,
      otherSession,
      'Barbell Bench Press',
      clock,
    );
    await addSet(db, newId, otherPress, { weightKg: 140, reps: 5 }, clock);
    await finishSession(db, 'user-2', otherSession, {}, clock);

    // USER has never performed this exercise — the 140kg set belongs to a different person
    // sharing this device and must not leak in as USER's own "last time" hint.
    expect(await getPreviousBest(db, USER, 'Barbell Bench Press')).toBeNull();
  });
});

describe('listRecentExerciseKeys', () => {
  it('returns the most recently trained exercise first', async () => {
    const first = await startSession(db, USER, newId, {}, clock);
    await addExerciseToSession(db, newId, first, 'Barbell Bench Press', clock);
    await finishSession(db, USER, first, {}, clock);

    const second = await startSession(db, USER, newId, {}, clock);
    await addExerciseToSession(db, newId, second, 'Back Squat', clock);
    await finishSession(db, USER, second, {}, clock);

    expect(await listRecentExerciseKeys(db, USER)).toEqual(['Back Squat', 'Barbell Bench Press']);
  });

  it('deduplicates an exercise trained across several sessions', async () => {
    const first = await startSession(db, USER, newId, {}, clock);
    await addExerciseToSession(db, newId, first, 'Barbell Bench Press', clock);
    await finishSession(db, USER, first, {}, clock);

    const second = await startSession(db, USER, newId, {}, clock);
    await addExerciseToSession(db, newId, second, 'Barbell Bench Press', clock);
    await finishSession(db, USER, second, {}, clock);

    expect(await listRecentExerciseKeys(db, USER)).toEqual(['Barbell Bench Press']);
  });

  it('respects the limit', async () => {
    const sessionId = await startSession(db, USER, newId, {}, clock);
    await addExerciseToSession(db, newId, sessionId, 'Barbell Bench Press', clock);
    await addExerciseToSession(db, newId, sessionId, 'Back Squat', clock);
    await addExerciseToSession(db, newId, sessionId, 'Conventional Deadlift', clock);
    await finishSession(db, USER, sessionId, {}, clock);

    expect(await listRecentExerciseKeys(db, USER, 2)).toHaveLength(2);
  });

  it('returns an empty list when nothing has been logged', async () => {
    expect(await listRecentExerciseKeys(db, USER)).toEqual([]);
  });

  it('never surfaces another user\'s exercises', async () => {
    const otherSession = await startSession(db, 'user-2', newId, {}, clock);
    await addExerciseToSession(db, newId, otherSession, 'Barbell Bench Press', clock);
    await finishSession(db, 'user-2', otherSession, {}, clock);

    expect(await listRecentExerciseKeys(db, USER)).toEqual([]);
  });
});

describe('outbox', () => {
  it('records every mutation for later sync', async () => {
    const sessionId = await startSession(db, USER, newId, {}, clock);
    const press = await addExerciseToSession(db, newId, sessionId, 'Barbell Bench Press', clock);
    const setId = await addSet(db, newId, press, { weightKg: 80, reps: 8 }, clock);
    await updateSet(db, setId, { reps: 9 }, clock);
    await removeSet(db, setId, clock);

    const entries = await db.all<{ entity: string; op: string }>(
      'SELECT entity, op FROM outbox ORDER BY id',
    );

    expect(entries).toEqual([
      { entity: 'workout_session', op: 'insert' },
      { entity: 'session_exercise', op: 'insert' },
      { entity: 'set', op: 'insert' },
      { entity: 'set', op: 'update' },
      { entity: 'set', op: 'delete' },
    ]);
  });

  it('stores a replayable payload', async () => {
    const sessionId = await startSession(db, USER, newId, {}, clock);
    const press = await addExerciseToSession(db, newId, sessionId, 'Barbell Bench Press', clock);
    await addSet(db, newId, press, { weightKg: 82.5, reps: 8 }, clock);

    const entry = await db.get<{ payload: string }>(
      "SELECT payload FROM outbox WHERE entity = 'set' ORDER BY id DESC LIMIT 1",
    );
    const payload = JSON.parse(entry?.payload ?? '{}') as { weightKg: number; setIndex: number };
    expect(payload.weightKg).toBe(82.5);
    expect(payload.setIndex).toBe(1);
  });
});

describe('getWorkoutStreak', () => {
  async function finishOn(daysBack: number) {
    const at = daysAgo(daysBack);
    const sessionId = await startSession(db, USER, newId, {}, () => at);
    await finishSession(db, USER, sessionId, {}, () => at);
  }

  it('reports zero when no sessions exist', async () => {
    expect(await getWorkoutStreak(db, USER)).toEqual({ currentDays: 0, trainedToday: false });
  });

  it('ignores sessions that were never finished', async () => {
    await startSession(db, USER, newId, {}, () => daysAgo(0));
    expect(await getWorkoutStreak(db, USER)).toEqual({ currentDays: 0, trainedToday: false });
  });

  it('counts a streak still running through today', async () => {
    await finishOn(2);
    await finishOn(1);
    await finishOn(0);

    expect(await getWorkoutStreak(db, USER)).toEqual({ currentDays: 3, trainedToday: true });
  });

  it('counts a streak that ended yesterday even without training today', async () => {
    await finishOn(2);
    await finishOn(1);

    expect(await getWorkoutStreak(db, USER)).toEqual({ currentDays: 2, trainedToday: false });
  });

  it('stops counting at a gap day', async () => {
    await finishOn(5);
    await finishOn(1);
    await finishOn(0);

    expect(await getWorkoutStreak(db, USER)).toEqual({ currentDays: 2, trainedToday: true });
  });

  it('does not double count multiple sessions on the same day', async () => {
    await finishOn(0);
    await finishOn(0);

    expect(await getWorkoutStreak(db, USER)).toEqual({ currentDays: 1, trainedToday: true });
  });

  it('only counts sessions for the given user', async () => {
    await finishOn(0);
    expect(await getWorkoutStreak(db, 'someone-else')).toEqual({
      currentDays: 0,
      trainedToday: false,
    });
  });
});
