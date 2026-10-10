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
import { getSessionType, hasType, sameTypeClause } from './sessionType.js';
import { createTestExecutor } from './testUtils.js';
import {
  addExerciseToSession,
  addSet,
  addSetCopyingPrevious,
  addDropSet,
  addWarmupRowsFromLastTime,
  addWarmupSets,
  countPreviousWarmups,
  finishSession,
  getActiveSession,
  getPreviousBest,
  getPreviousSessionSets,
  getSessionDetail,
  getWorkoutStreak,
  listRecentExerciseKeys,
  listSessionExercises,
  listSessionSummaries,
  listSets,
  markSetDone,
  removeExerciseFromSession,
  removeSet,
  renameSession,
  reorderSessionExercise,
  SESSION_NOTE_LIMIT,
  setSessionNotes,
  setSupersetLink,
  startSession,
  swapSessionExercise,
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
    for (let i = 0; i < 2; i++)
      await addSet(db, newId, facePull, { weightKg: 25, reps: 15 }, clock);
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
    for (let i = 0; i < 2; i++)
      await addSet(db, newId, facePull, { weightKg: 25, reps: 15 }, clock);

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

  it("never surfaces another user's best as this user's reference", async () => {
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

  it("never surfaces another user's exercises", async () => {
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

describe('reordering exercises inside a live session', () => {
  async function seed() {
    const sessionId = await startSession(db, USER, newId, {}, clock);
    const press = await addExerciseToSession(db, newId, sessionId, 'Barbell Bench Press', clock);
    const row = await addExerciseToSession(db, newId, sessionId, 'Barbell Row', clock);
    const curl = await addExerciseToSession(db, newId, sessionId, 'Machine Bicep Curl', clock);
    return { sessionId, press, row, curl };
  }

  const order = async (sessionId: string) =>
    (await listSessionExercises(db, sessionId)).map((e) => e.exercise_key);

  it('sends the first exercise to the end', async () => {
    // The reported case: a lift is written first and the rack is busy, so it moves to last.
    const { sessionId, press } = await seed();
    await reorderSessionExercise(db, sessionId, press, 2, clock);
    expect(await order(sessionId)).toEqual([
      'Barbell Row',
      'Machine Bicep Curl',
      'Barbell Bench Press',
    ]);
  });

  it('brings the last exercise to the front', async () => {
    const { sessionId, curl } = await seed();
    await reorderSessionExercise(db, sessionId, curl, 0, clock);
    expect(await order(sessionId)).toEqual([
      'Machine Bicep Curl',
      'Barbell Bench Press',
      'Barbell Row',
    ]);
  });

  it('leaves order_index contiguous and 1-based afterwards', async () => {
    // UNIQUE (session_id, order_index) is what forces the two-pass PARK rewrite; a gap or a
    // duplicate here means the second pass did not run to completion.
    const { sessionId, press } = await seed();
    await reorderSessionExercise(db, sessionId, press, 2, clock);

    const rows = await listSessionExercises(db, sessionId);
    expect(rows.map((r) => r.order_index)).toEqual([1, 2, 3]);
  });

  it('closes the gap left by a removed exercise', async () => {
    const { sessionId, press, row, curl } = await seed();
    await removeExerciseFromSession(db, row, clock);
    await reorderSessionExercise(db, sessionId, curl, 0, clock);

    const rows = await listSessionExercises(db, sessionId);
    expect(rows.map((r) => r.order_index)).toEqual([1, 2]);
    expect(rows.map((r) => r.id)).toEqual([curl, press]);
  });

  it('does nothing at either end, and nothing for an unknown id', async () => {
    const { sessionId, press, curl } = await seed();
    const before = await order(sessionId);

    await reorderSessionExercise(db, sessionId, press, -1, clock);
    await reorderSessionExercise(db, sessionId, curl, 99, clock);
    await reorderSessionExercise(db, sessionId, 'not-a-real-id', 0, clock);

    expect(await order(sessionId)).toEqual(before);
  });

  it('keeps each exercise’s sets attached to it', async () => {
    // The failure that would matter most: sets following position rather than parent would
    // silently reassign logged work to the wrong lift.
    const { sessionId, press, curl } = await seed();
    await addSet(db, newId, press, { weightKg: 100, reps: 5 }, clock);
    await addSet(db, newId, curl, { weightKg: 20, reps: 12 }, clock);

    await reorderSessionExercise(db, sessionId, press, 2, clock);

    expect((await listSets(db, press)).map((s) => s.weight_kg)).toEqual([100]);
    expect((await listSets(db, curl)).map((s) => s.weight_kg)).toEqual([20]);
  });

  it('does not disturb another session', async () => {
    const { sessionId, press } = await seed();
    const otherSession = await startSession(db, 'user-2', newId, {}, clock);
    const otherFirst = await addExerciseToSession(db, newId, otherSession, 'Deadlift', clock);
    await addExerciseToSession(db, newId, otherSession, 'Pull Up', clock);

    await reorderSessionExercise(db, sessionId, press, 2, clock);

    const rows = await listSessionExercises(db, otherSession);
    expect(rows.map((r) => r.id)).toEqual([otherFirst, rows[1]!.id]);
    expect(rows.map((r) => r.order_index)).toEqual([1, 2]);
  });
});

describe('swapping an exercise mid-workout', () => {
  async function seed() {
    const sessionId = await startSession(db, USER, newId, {}, clock);
    const press = await addExerciseToSession(db, newId, sessionId, 'Barbell Bench Press', clock);
    const row = await addExerciseToSession(db, newId, sessionId, 'Barbell Row', clock);
    return { sessionId, press, row };
  }

  const keys = async (sessionId: string) =>
    (await listSessionExercises(db, sessionId)).map((e) => e.exercise_key);

  it('re-points the slot in place when nothing has been ticked off', async () => {
    const { sessionId, press } = await seed();
    await addSet(db, newId, press, { weightKg: 100, reps: 5 }, clock);

    const result = await swapSessionExercise(db, newId, press, 'Dumbbell Bench Press', clock);

    expect(result).toBe(press);
    expect(await keys(sessionId)).toEqual(['Dumbbell Bench Press', 'Barbell Row']);
  });

  it('blanks the numbers the previous exercise had left behind', async () => {
    // The dangerous case: 100 kg prefilled from a bench press, still sitting there under a
    // lateral raise, ready to be loaded onto a bar by someone who did not reread it.
    const { press } = await seed();
    await addSet(db, newId, press, { weightKg: 100, reps: 5 }, clock);

    await swapSessionExercise(db, newId, press, 'Dumbbell Lateral Raise', clock);

    const sets = await listSets(db, press);
    expect(sets).toHaveLength(1);
    expect(sets[0]?.weight_kg).toBeNull();
    expect(sets[0]?.reps).toBeNull();
  });

  it('leaves completed work attached to the exercise it was performed on', async () => {
    const { sessionId, press } = await seed();
    const first = await addSet(db, newId, press, { weightKg: 100, reps: 5 }, clock);
    await addSet(db, newId, press, { weightKg: 100, reps: 5 }, clock);
    await markSetDone(db, first, true, clock);

    const result = await swapSessionExercise(db, newId, press, 'Dumbbell Bench Press', clock);

    // The original keeps its name and its finished set; the replacement lands right after it.
    expect(result).not.toBe(press);
    expect(await keys(sessionId)).toEqual([
      'Barbell Bench Press',
      'Dumbbell Bench Press',
      'Barbell Row',
    ]);

    const kept = await listSets(db, press);
    expect(kept).toHaveLength(1);
    expect(kept[0]?.id).toBe(first);
    expect(kept[0]?.weight_kg).toBe(100);
  });

  it('carries the untouched sets over as blanks, and only those', async () => {
    const { press } = await seed();
    const first = await addSet(db, newId, press, { weightKg: 100, reps: 5 }, clock);
    await addSet(db, newId, press, { weightKg: 100, reps: 5 }, clock);
    await addSet(db, newId, press, { weightKg: 100, reps: 5 }, clock);
    await markSetDone(db, first, true, clock);

    const replacement = await swapSessionExercise(db, newId, press, 'Dumbbell Bench Press', clock);

    const moved = await listSets(db, replacement);
    expect(moved).toHaveLength(2);
    expect(moved.every((set) => set.weight_kg === null && set.reps === null)).toBe(true);
  });

  it('still gives the replacement a set when every set was already done', async () => {
    const { press } = await seed();
    const only = await addSet(db, newId, press, { weightKg: 100, reps: 5 }, clock);
    await markSetDone(db, only, true, clock);

    const replacement = await swapSessionExercise(db, newId, press, 'Dumbbell Bench Press', clock);

    // An exercise with no sets is never what someone swapping to it wanted.
    expect(await listSets(db, replacement)).toHaveLength(1);
  });

  it('renumbers what is left after the untouched sets are taken away', async () => {
    // Set 1 untouched, set 2 done: removing the first would otherwise leave a lone set_index 2.
    const { press } = await seed();
    await addSet(db, newId, press, { weightKg: 100, reps: 5 }, clock);
    const second = await addSet(db, newId, press, { weightKg: 100, reps: 5 }, clock);
    await markSetDone(db, second, true, clock);

    await swapSessionExercise(db, newId, press, 'Dumbbell Bench Press', clock);

    expect((await listSets(db, press)).map((s) => s.set_index)).toEqual([1]);
  });

  it('leaves the session alone when the exercise is already the one asked for', async () => {
    const { sessionId, press } = await seed();
    await addSet(db, newId, press, { weightKg: 100, reps: 5 }, clock);

    const result = await swapSessionExercise(db, newId, press, 'Barbell Bench Press', clock);

    expect(result).toBe(press);
    expect(await keys(sessionId)).toEqual(['Barbell Bench Press', 'Barbell Row']);
    // Not blanked — nothing was swapped, so nothing should have been thrown away.
    expect((await listSets(db, press))[0]?.weight_kg).toBe(100);
  });

  it('does nothing for an exercise that is not there', async () => {
    const { sessionId } = await seed();
    await swapSessionExercise(db, newId, 'not-a-real-id', 'Deadlift', clock);
    expect(await keys(sessionId)).toEqual(['Barbell Bench Press', 'Barbell Row']);
  });
});

describe('warming up before the work', () => {
  async function seedWorkingSets() {
    const sessionId = await startSession(db, USER, newId, {}, clock);
    const press = await addExerciseToSession(db, newId, sessionId, 'Barbell Bench Press', clock);
    const first = await addSet(db, newId, press, { weightKg: 100, reps: 5 }, clock);
    const second = await addSet(db, newId, press, { weightKg: 100, reps: 5 }, clock);
    return { press, first, second };
  }

  const RAMP = [
    { weightKg: 40, reps: 5 },
    { weightKg: 60, reps: 3 },
    { weightKg: 80, reps: 2 },
  ];

  it('puts the ramp in front of the working sets', async () => {
    const { press } = await seedWorkingSets();

    await addWarmupSets(db, newId, press, RAMP, clock);

    const sets = await listSets(db, press);
    expect(sets.map((s) => s.weight_kg)).toEqual([40, 60, 80, 100, 100]);
    expect(sets.map((s) => s.set_index)).toEqual([1, 2, 3, 4, 5]);
  });

  it('marks them as warm-ups, which is what keeps them out of the numbers', async () => {
    // Volume, personal records and the progression charts all read this flag. A warm-up counted
    // as work would read as a session that got heavier and easier at once.
    const { press } = await seedWorkingSets();

    await addWarmupSets(db, newId, press, RAMP, clock);

    const sets = await listSets(db, press);
    expect(sets.map((s) => s.is_warmup)).toEqual([1, 1, 1, 0, 0]);
  });

  it('keeps the working sets themselves untouched', async () => {
    const { press, first, second } = await seedWorkingSets();

    await addWarmupSets(db, newId, press, RAMP, clock);

    const sets = await listSets(db, press);
    const working = sets.filter((s) => s.is_warmup === 0);
    expect(working.map((s) => s.id)).toEqual([first, second]);
    expect(working.every((s) => s.weight_kg === 100 && s.reps === 5)).toBe(true);
  });

  it('does nothing the second time the button is pressed', async () => {
    // Six ramp sets in front of two working ones is not something anyone meant.
    const { press } = await seedWorkingSets();
    await addWarmupSets(db, newId, press, RAMP, clock);

    const added = await addWarmupSets(db, newId, press, RAMP, clock);

    expect(added).toBe(0);
    expect(await listSets(db, press)).toHaveLength(5);
  });

  it('adds a ramp to an exercise that has no sets yet', async () => {
    const sessionId = await startSession(db, USER, newId, {}, clock);
    const press = await addExerciseToSession(db, newId, sessionId, 'Barbell Bench Press', clock);

    await addWarmupSets(db, newId, press, RAMP, clock);

    expect((await listSets(db, press)).map((s) => s.set_index)).toEqual([1, 2, 3]);
  });

  it('is a no-op for an empty ramp', async () => {
    const { press } = await seedWorkingSets();
    expect(await addWarmupSets(db, newId, press, [], clock)).toBe(0);
    expect(await listSets(db, press)).toHaveLength(2);
  });
});

describe('what counts as the same workout', () => {
  const USER_T = 'user-t';

  async function session(planDayId: string | undefined, kg: number, at: string) {
    const clock = () => at;
    const id = await startSession(db, USER_T, newId, { planDayId }, clock);
    const ex = await addExerciseToSession(db, newId, id, 'Leg Press', clock);
    await addSet(db, newId, ex, { weightKg: kg, reps: 8 }, clock);
    await finishSession(db, USER_T, id, {}, clock);
    return id;
  }

  it('reads a session kind off the row', async () => {
    const id = await session('plan-a', 100, '2026-06-01T10:00:00.000Z');
    expect(await getSessionType(db, id)).toEqual({ planDayId: 'plan-a', name: null });
  });

  it('has no kind for a session that is neither planned nor named', async () => {
    const id = await session(undefined, 100, '2026-06-01T10:00:00.000Z');
    expect(hasType(await getSessionType(db, id))).toBe(false);
  });

  it('returns null for a session that does not exist', async () => {
    expect(await getSessionType(db, 'nope')).toBeNull();
  });

  it('answers "last time" from the same kind of workout, not the most recent one', async () => {
    // The bug in one test: plan A on Monday, plan B on Wednesday, plan A again today. Without
    // scoping, today's card would pre-fill and advise off plan B's lighter day.
    await session('plan-a', 100, '2026-06-01T10:00:00.000Z');
    await session('plan-b', 60, '2026-06-03T10:00:00.000Z');
    const today = await session('plan-a', 0, '2026-06-05T10:00:00.000Z');

    const unscoped = await getPreviousSessionSets(db, USER_T, 'Leg Press', today);
    const scoped = await getPreviousSessionSets(db, USER_T, 'Leg Press', today, {
      planDayId: 'plan-a',
      name: null,
    });

    expect(unscoped[0]?.weight_kg).toBe(60);
    expect(scoped[0]?.weight_kg).toBe(100);
  });

  it('widens to every session when there is no kind to scope to', async () => {
    await session('plan-a', 100, '2026-06-01T10:00:00.000Z');
    await session('plan-b', 60, '2026-06-03T10:00:00.000Z');
    const today = await session(undefined, 0, '2026-06-05T10:00:00.000Z');

    const sets = await getPreviousSessionSets(db, USER_T, 'Leg Press', today, {
      planDayId: null,
      name: null,
    });
    expect(sets[0]?.weight_kg).toBe(60);
  });

  it('no longer splits a workout by the gym it was once recorded at', async () => {
    /*
     * Gyms were a screen for a while, and sessions from then carry a `location_id`. With the
     * screen gone nobody can set or change it, so it must not go on deciding which earlier
     * workout counts as "last time" — for the people who used it, that would freeze their
     * history into the rooms they happened to have picked.
     */
    const one = await session('plan-a', 100, '2026-06-01T10:00:00.000Z');
    const two = await session('plan-a', 60, '2026-06-03T10:00:00.000Z');
    const today = await session('plan-a', 0, '2026-06-05T10:00:00.000Z');
    await db.run(`UPDATE workout_sessions SET location_id = 'gym-a' WHERE id IN (?, ?)`, [
      one,
      today,
    ]);
    await db.run(`UPDATE workout_sessions SET location_id = 'gym-b' WHERE id = ?`, [two]);

    const type = await getSessionType(db, today);
    expect(type).toEqual({ planDayId: 'plan-a', name: null });
    expect(sameTypeClause('ws', type).sql).not.toContain('location_id');

    const sets = await getPreviousSessionSets(db, USER_T, 'Leg Press', today, type);
    // The most recent workout of the same kind, whichever room it was in.
    expect(sets[0]?.weight_kg).toBe(60);
  });

  it('builds a clause that is always safe to concatenate', () => {
    // An `AND` with nothing after it is how a query builder produces a syntax error that only
    // shows up at runtime, on the one code path nobody exercised.
    expect(sameTypeClause('ws', null)).toEqual({ sql: '1 = 1', params: [] });
    expect(sameTypeClause('ws', { planDayId: 'p', name: 'x' }).params).toEqual(['p']);
    expect(sameTypeClause('ws', { planDayId: null, name: 'Push A' }).params).toEqual(['Push A']);
  });

  it('lets a plan day outrank a name', async () => {
    // A planned session belongs to its plan's lineage even if some ad-hoc workout shares its
    // label, which is why the name branch also demands plan_day_id IS NULL.
    const clause = sameTypeClause('ws', { planDayId: null, name: 'Push A' });
    expect(clause.sql).toContain('plan_day_id IS NULL');
  });
});

describe('supersets', () => {
  const USER_S = 'user-s';

  async function threeExercises() {
    const clock = () => '2026-06-01T10:00:00.000Z';
    const sessionId = await startSession(db, USER_S, newId, {}, clock);
    const a = await addExerciseToSession(db, newId, sessionId, 'Barbell Bench Press', clock);
    const bx = await addExerciseToSession(db, newId, sessionId, 'Barbell Row', clock);
    const c = await addExerciseToSession(db, newId, sessionId, 'Barbell Curl', clock);
    return { sessionId, a, b: bx, c };
  }

  const linkOf = async (id: string) =>
    (
      await db.get<{ superset_with_next: number }>(
        `SELECT superset_with_next FROM session_exercises WHERE id = ?`,
        [id],
      )
    )?.superset_with_next;

  it('links an exercise to the one after it', async () => {
    const { a } = await threeExercises();
    expect(await setSupersetLink(db, a, true)).toBe(true);
    expect(await linkOf(a)).toBe(1);
  });

  it('cuts the link again', async () => {
    const { a } = await threeExercises();
    await setSupersetLink(db, a, true);
    await setSupersetLink(db, a, false);
    expect(await linkOf(a)).toBe(0);
  });

  it('refuses to link the last exercise', async () => {
    // There is nothing after it, and a flag left there would swallow the next exercise added.
    const { c } = await threeExercises();
    expect(await setSupersetLink(db, c, true)).toBe(false);
    expect(await linkOf(c)).toBe(0);
  });

  it('every exercise starts unlinked', async () => {
    const { a, b, c } = await threeExercises();
    for (const id of [a, b, c]) expect(await linkOf(id)).toBe(0);
  });

  it('keeps a three-exercise run together when the middle one goes', async () => {
    // A-B-C as one superset. Removing B leaves A-C, still a superset, with no bookkeeping —
    // which is the whole reason the link is positional rather than a group id.
    const { a, b, c } = await threeExercises();
    await setSupersetLink(db, a, true);
    await setSupersetLink(db, b, true);

    await removeExerciseFromSession(db, b);

    expect(await linkOf(a)).toBe(1);
    expect(await linkOf(c)).toBe(0);
  });

  it('does not let a superset swallow a stranger when its last member goes', async () => {
    // The case that makes the positional model dangerous if left alone: the group was A-B, and
    // with B gone A's link would point at C, which was never paired with anything.
    const { a, b, c } = await threeExercises();
    await setSupersetLink(db, a, true);

    await removeExerciseFromSession(db, b);

    expect(await linkOf(a)).toBe(0);
    expect(await linkOf(c)).toBe(0);
  });

  it('clears a dangling link when the final exercise is removed', async () => {
    const { b, c } = await threeExercises();
    await setSupersetLink(db, b, true);

    await removeExerciseFromSession(db, c);

    expect(await linkOf(b)).toBe(0);
  });
});

describe('drop sets', () => {
  const USER_D = 'user-d';

  async function threeSets() {
    const clock = () => '2026-06-01T10:00:00.000Z';
    const sessionId = await startSession(db, USER_D, newId, {}, clock);
    const ex = await addExerciseToSession(db, newId, sessionId, 'Barbell Curl', clock);
    const a = await addSet(db, newId, ex, { weightKg: 40, reps: 10 }, clock);
    const bx = await addSet(db, newId, ex, { weightKg: 40, reps: 10 }, clock);
    const c = await addSet(db, newId, ex, { weightKg: 40, reps: 10 }, clock);
    return { ex, a, b: bx, c };
  }

  it('lands immediately after its parent, not at the end', async () => {
    // A drop set that is not adjacent to the set it drops from is not a drop set.
    const { ex, a } = await threeSets();

    await addDropSet(db, newId, a, { weightKg: 30, reps: 8 });

    const sets = await listSets(db, ex);
    expect(sets.map((s) => s.weight_kg)).toEqual([40, 30, 40, 40]);
    expect(sets.map((s) => s.set_index)).toEqual([1, 2, 3, 4]);
  });

  it('marks only the new set as a drop', async () => {
    const { ex, a } = await threeSets();
    await addDropSet(db, newId, a, { weightKg: 30, reps: 8 });

    expect((await listSets(db, ex)).map((s) => s.is_drop)).toEqual([0, 1, 0, 0]);
  });

  it('can chain, each dropping from the one before', async () => {
    const { ex, a } = await threeSets();
    const first = await addDropSet(db, newId, a, { weightKg: 30, reps: 8 });
    await addDropSet(db, newId, first!, { weightKg: 20, reps: 8 });

    const sets = await listSets(db, ex);
    expect(sets.map((s) => s.weight_kg)).toEqual([40, 30, 20, 40, 40]);
    expect(sets.map((s) => s.is_drop)).toEqual([0, 1, 1, 0, 0]);
  });

  it('appends after the last set without disturbing anything', async () => {
    const { ex, c } = await threeSets();
    await addDropSet(db, newId, c, { weightKg: 30, reps: 8 });

    const sets = await listSets(db, ex);
    expect(sets.map((s) => s.set_index)).toEqual([1, 2, 3, 4]);
    expect(sets[3]?.is_drop).toBe(1);
  });

  it('returns null for a set that does not exist', async () => {
    expect(await addDropSet(db, newId, 'nope', { weightKg: 30, reps: 8 })).toBeNull();
  });

  it('leaves the numbering contiguous, which the unique index demands', async () => {
    // Inserting in the middle shifts everything below, and set_index is unique per exercise —
    // a direct renumber walks straight into that constraint.
    const { ex, a, b: second } = await threeSets();
    await addDropSet(db, newId, a, { weightKg: 30, reps: 8 });
    await addDropSet(db, newId, second, { weightKg: 25, reps: 8 });

    const indexes = (await listSets(db, ex)).map((s) => s.set_index);
    expect(indexes).toEqual([1, 2, 3, 4, 5]);
  });
});

describe('history filtered by period', () => {
  it('keeps only sessions at or after the cut, and all of them without one', async () => {
    const { newId } = createFixtures();
    const at = (iso: string) => () => iso;

    const today = await startSession(db, USER, newId, {}, at(daysAgo(0)));
    const recent = await startSession(db, USER, newId, {}, at(daysAgo(4)));
    await startSession(db, USER, newId, {}, at(daysAgo(40)));

    const week = await listSessionSummaries(db, USER, 100, daysAgo(7));
    expect(week.map((session) => session.id)).toEqual([today, recent]);

    const everything = await listSessionSummaries(db, USER, 100);
    expect(everything).toHaveLength(3);
  });
});

describe('a note on a workout', () => {
  const noteOf = async (sessionId: string) =>
    (await getSessionDetail(db, sessionId)).session?.notes ?? null;

  it('is kept, trimmed', async () => {
    const sessionId = await startSession(db, USER, newId, {}, clock);
    await setSessionNotes(db, USER, sessionId, '  כתף שמאל כאבה בסט האחרון  ', clock);
    expect(await noteOf(sessionId)).toBe('כתף שמאל כאבה בסט האחרון');
  });

  it('is cleared by empty text, not stored as a blank', async () => {
    // A coach reading the workout would otherwise be shown an empty remark.
    const sessionId = await startSession(db, USER, newId, {}, clock);
    await setSessionNotes(db, USER, sessionId, 'something', clock);
    await setSessionNotes(db, USER, sessionId, '   ', clock);
    expect(await noteOf(sessionId)).toBeNull();
    await setSessionNotes(db, USER, sessionId, 'something', clock);
    await setSessionNotes(db, USER, sessionId, null, clock);
    expect(await noteOf(sessionId)).toBeNull();
  });

  it('is cut at the limit rather than refused', async () => {
    const sessionId = await startSession(db, USER, newId, {}, clock);
    await setSessionNotes(db, USER, sessionId, 'א'.repeat(SESSION_NOTE_LIMIT + 50), clock);
    expect((await noteOf(sessionId))?.length).toBe(SESSION_NOTE_LIMIT);
  });

  it('marks the workout as changed, so sync carries it', async () => {
    const sessionId = await startSession(db, USER, newId, {}, clock);
    const before = await db.get<{ updated_at: string }>(
      `SELECT updated_at FROM workout_sessions WHERE id = ?`,
      [sessionId],
    );
    await setSessionNotes(db, USER, sessionId, 'something', clock);
    const after = await db.get<{ updated_at: string }>(
      `SELECT updated_at FROM workout_sessions WHERE id = ?`,
      [sessionId],
    );
    expect(after!.updated_at > before!.updated_at).toBe(true);
  });

  it('cannot be written on someone else’s workout', async () => {
    const sessionId = await startSession(db, USER, newId, {}, clock);
    await setSessionNotes(db, 'someone-else', sessionId, 'not mine to write', clock);
    expect(await noteOf(sessionId)).toBeNull();
  });

  it('survives the workout being finished', async () => {
    // Finishing used to write "no note" every time. With nothing able to write a note that
    // did no harm; with one, it would erase it on the tap that ends the workout.
    const sessionId = await startSession(db, USER, newId, {}, clock);
    await setSessionNotes(db, USER, sessionId, 'written during', clock);
    await finishSession(db, USER, sessionId, { sessionRpe: 7 }, clock);
    expect(await noteOf(sessionId)).toBe('written during');
  });

  it('is still written by finishing when finishing is given one', async () => {
    const sessionId = await startSession(db, USER, newId, {}, clock);
    await finishSession(db, USER, sessionId, { notes: 'given at the end' }, clock);
    expect(await noteOf(sessionId)).toBe('given at the end');
    const other = await startSession(db, USER, newId, {}, clock);
    await setSessionNotes(db, USER, other, 'to be cleared', clock);
    await finishSession(db, USER, other, { notes: null }, clock);
    expect(await noteOf(other)).toBeNull();
  });
});

describe('an exercise opens with the warm-ups it had last time', () => {
  /** A finished workout called `name`, holding one exercise with the sets given. */
  async function trained(
    name: string,
    sets: { weightKg?: number | null; reps?: number | null; isWarmup?: boolean }[],
  ) {
    const sessionId = await startSession(db, USER, newId, {}, clock);
    await renameSession(db, USER, sessionId, name, clock);
    const exerciseId = await addExerciseToSession(db, newId, sessionId, 'Leg Press', clock);
    for (const set of sets) await addSet(db, newId, exerciseId, set, clock);
    await finishSession(db, USER, sessionId, {}, clock);
  }

  /** A new workout called `name` with the exercise just added and nothing under it. */
  async function opened(name: string) {
    const sessionId = await startSession(db, USER, newId, {}, clock);
    await renameSession(db, USER, sessionId, name, clock);
    const exerciseId = await addExerciseToSession(db, newId, sessionId, 'Leg Press', clock);
    return { sessionId, exerciseId, type: await getSessionType(db, sessionId) };
  }

  it('counts the warm-ups that were done, and not the work', async () => {
    await trained('Legs', [
      { weightKg: 40, reps: 10, isWarmup: true },
      { weightKg: 80, reps: 5, isWarmup: true },
      { weightKg: 140, reps: 8 },
    ]);
    const { sessionId, type } = await opened('Legs');
    expect(await countPreviousWarmups(db, USER, 'Leg Press', sessionId, type)).toBe(2);
  });

  it('does not count a warm-up row that was left blank', async () => {
    await trained('Legs', [{ isWarmup: true }, { weightKg: 40, reps: 10, isWarmup: true }]);
    const { sessionId, type } = await opened('Legs');
    expect(await countPreviousWarmups(db, USER, 'Leg Press', sessionId, type)).toBe(1);
  });

  it('adds the rows blank and marked, ahead of the working set that follows', async () => {
    await trained('Legs', [
      { weightKg: 40, reps: 10, isWarmup: true },
      { weightKg: 140, reps: 8 },
    ]);
    const { sessionId, exerciseId, type } = await opened('Legs');

    expect(
      await addWarmupRowsFromLastTime(
        db,
        USER,
        newId,
        sessionId,
        exerciseId,
        'Leg Press',
        type,
        clock,
      ),
    ).toBe(1);
    // What the screen does next: one blank working set under whatever is there.
    await addSetCopyingPrevious(db, newId, exerciseId, clock);

    const sets = await listSets(db, exerciseId);
    expect(sets.map((set) => [set.set_index, set.is_warmup, set.weight_kg, set.reps])).toEqual([
      [1, 1, null, null],
      // Not a second warm-up: copying the row above does not copy what kind of row it is.
      [2, 0, null, null],
    ]);
  });

  it('follows the workout’s name, not the last time the exercise was done anywhere', async () => {
    await trained('Legs', [{ weightKg: 140, reps: 8 }]);
    // More recent, and warmed up — but a different workout.
    await trained('Full body', [
      { weightKg: 40, reps: 10, isWarmup: true },
      { weightKg: 120, reps: 8 },
    ]);

    const { sessionId, exerciseId, type } = await opened('Legs');
    expect(
      await addWarmupRowsFromLastTime(
        db,
        USER,
        newId,
        sessionId,
        exerciseId,
        'Leg Press',
        type,
        clock,
      ),
    ).toBe(0);
    expect(await listSets(db, exerciseId)).toHaveLength(0);
  });

  it('adds nothing to an exercise that already has sets, where they would land underneath', async () => {
    await trained('Legs', [
      { weightKg: 40, reps: 10, isWarmup: true },
      { weightKg: 140, reps: 8 },
    ]);
    const { sessionId, exerciseId, type } = await opened('Legs');
    await addSet(db, newId, exerciseId, {}, clock);

    expect(
      await addWarmupRowsFromLastTime(
        db,
        USER,
        newId,
        sessionId,
        exerciseId,
        'Leg Press',
        type,
        clock,
      ),
    ).toBe(0);
    expect((await listSets(db, exerciseId)).map((set) => set.is_warmup)).toEqual([0]);
  });

  it('adds nothing the first time an exercise is done', async () => {
    const { sessionId, exerciseId, type } = await opened('Legs');
    expect(
      await addWarmupRowsFromLastTime(
        db,
        USER,
        newId,
        sessionId,
        exerciseId,
        'Leg Press',
        type,
        clock,
      ),
    ).toBe(0);
  });
});
