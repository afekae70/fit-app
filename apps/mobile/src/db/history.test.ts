/**
 * History, naming and template-repeat tests. Real SQL against real SQLite, as elsewhere.
 */

import { beforeEach, describe, expect, it } from 'vitest';

import type { SqlExecutor } from './executor.js';
import { createTestExecutor } from './testUtils.js';
import {
  addExerciseToSession,
  addSet,
  finishSession,
  getActiveSession,
  getPreviousSessionSets,
  getSessionDetail,
  listSessionSummaries,
  renameSession,
  repeatSession,
  startSession,
} from './workouts.js';

const USER = 'user-1';

let db: SqlExecutor;
let counter = 0;
const newId = () => `id-${String(++counter).padStart(3, '0')}`;
const clock = () => '2026-07-25T10:00:00.000Z';

/** A clock that advances a day per call, for ordering assertions. */
function tickingClock() {
  let day = 0;
  return () => new Date(Date.UTC(2026, 6, 1 + day++, 10)).toISOString();
}

beforeEach(() => {
  db = createTestExecutor();
  counter = 0;
});

describe('naming a session', () => {
  it('stores a trimmed name', async () => {
    const sessionId = await startSession(db, USER, newId, {}, clock);
    await renameSession(db, USER, sessionId, '  Push A  ', clock);

    const { session } = await getSessionDetail(db, sessionId);
    expect(session?.name).toBe('Push A');
  });

  it('treats a blank name as no name rather than an empty string', async () => {
    const sessionId = await startSession(db, USER, newId, {}, clock);
    await renameSession(db, USER, sessionId, 'Push A', clock);
    await renameSession(db, USER, sessionId, '   ', clock);

    const { session } = await getSessionDetail(db, sessionId);
    // NULL, not '' — the template query filters on `name IS NOT NULL`, so an empty string
    // would surface as a nameless entry in the template list.
    expect(session?.name).toBeNull();
  });
});

describe('history summaries', () => {
  it('aggregates exercise count, set count and volume per session', async () => {
    const sessionId = await startSession(db, USER, newId, {}, clock);
    const press = await addExerciseToSession(db, newId, sessionId, 'Barbell Bench Press', clock);
    const facePull = await addExerciseToSession(db, newId, sessionId, 'Face Pull', clock);

    for (let i = 0; i < 4; i++) await addSet(db, newId, press, { weightKg: 80, reps: 8 }, clock);
    for (let i = 0; i < 2; i++) await addSet(db, newId, facePull, { weightKg: 25, reps: 15 }, clock);

    const [summary] = await listSessionSummaries(db, USER);
    expect(summary?.exercise_count).toBe(2);
    expect(summary?.set_count).toBe(6);
    // 4 x (80x8) + 2 x (25x15) = 2560 + 750 = 3310
    expect(summary?.volume_load).toBe(3310);
  });

  it('excludes warmups, matching the figures shown during the workout', async () => {
    const sessionId = await startSession(db, USER, newId, {}, clock);
    const press = await addExerciseToSession(db, newId, sessionId, 'Barbell Bench Press', clock);
    await addSet(db, newId, press, { weightKg: 200, reps: 5, isWarmup: true }, clock);
    await addSet(db, newId, press, { weightKg: 80, reps: 8 }, clock);

    const [summary] = await listSessionSummaries(db, USER);
    expect(summary?.set_count).toBe(1);
    expect(summary?.volume_load).toBe(640);
  });

  it('keeps a session that has no exercises rather than dropping it', async () => {
    await startSession(db, USER, newId, {}, clock);
    const summaries = await listSessionSummaries(db, USER);
    // The LEFT JOIN exists for this: a workout you started and abandoned should still appear
    // in history instead of vanishing with no explanation.
    expect(summaries).toHaveLength(1);
    expect(summaries[0]?.exercise_count).toBe(0);
    expect(summaries[0]?.volume_load).toBe(0);
  });

  it('orders newest first', async () => {
    const tick = tickingClock();
    const first = await startSession(db, USER, newId, {}, tick);
    const second = await startSession(db, USER, newId, {}, tick);

    const summaries = await listSessionSummaries(db, USER);
    expect(summaries[0]?.id).toBe(second);
    expect(summaries[1]?.id).toBe(first);
  });

  it('never includes another user\'s sessions in this user\'s history', async () => {
    await startSession(db, USER, newId, {}, clock);
    await startSession(db, 'user-2', newId, {}, clock);
    await startSession(db, 'user-2', newId, {}, clock);

    expect(await listSessionSummaries(db, USER)).toHaveLength(1);
    expect(await listSessionSummaries(db, 'user-2')).toHaveLength(2);
  });
});

describe('repeating a session as a template', () => {
  async function buildSource() {
    const sessionId = await startSession(db, USER, newId, {}, clock);
    await renameSession(db, USER, sessionId, 'Push A', clock);
    const press = await addExerciseToSession(db, newId, sessionId, 'Barbell Bench Press', clock);
    const facePull = await addExerciseToSession(db, newId, sessionId, 'Face Pull', clock);

    await addSet(db, newId, press, { weightKg: 60, reps: 10, isWarmup: true }, clock);
    await addSet(db, newId, press, { weightKg: 80, reps: 8, rpe: 8, toFailure: true }, clock);
    await addSet(db, newId, press, { weightKg: 80, reps: 7 }, clock);
    await addSet(db, newId, facePull, { weightKg: 25, reps: 15 }, clock);

    await finishSession(db, USER, sessionId, {}, clock);
    return sessionId;
  }

  it('copies exercises, their order and their set structure', async () => {
    const sourceId = await buildSource();
    const newSessionId = await repeatSession(db, USER, newId, sourceId, clock);
    expect(newSessionId).not.toBeNull();

    const { exercises } = await getSessionDetail(db, newSessionId as string);
    expect(exercises.map((e) => e.exercise_key)).toEqual(['Barbell Bench Press', 'Face Pull']);
    // Same shape as last time: 3 sets on press (including the warmup), 1 on face pulls.
    expect(exercises.map((e) => e.sets.length)).toEqual([3, 1]);
  });

  it('leaves every value blank rather than pre-filling last time', async () => {
    const sourceId = await buildSource();
    const newSessionId = await repeatSession(db, USER, newId, sourceId, clock);

    const { exercises } = await getSessionDetail(db, newSessionId as string);
    const pressSets = exercises[0]?.sets ?? [];

    // The source had 60×10, 80×8, 80×7. Carrying those over would mean a set the user never
    // touched still records itself as performed at that weight — the log would contain lifts
    // that never happened, and e1RM/volume/stall detection would all inherit the fiction.
    expect(pressSets.map((s) => s.weight_kg)).toEqual([null, null, null]);
    expect(pressSets.map((s) => s.reps)).toEqual([null, null, null]);
    expect(exercises[1]?.sets.map((s) => s.weight_kg)).toEqual([null]);
  });

  it('carries warmup flags forward', async () => {
    const sourceId = await buildSource();
    const newSessionId = await repeatSession(db, USER, newId, sourceId, clock);

    const { exercises } = await getSessionDetail(db, newSessionId as string);
    expect(exercises[0]?.sets.map((s) => s.is_warmup)).toEqual([1, 0, 0]);
  });

  it('does NOT carry RPE or to-failure forward', async () => {
    const sourceId = await buildSource();
    const newSessionId = await repeatSession(db, USER, newId, sourceId, clock);

    const { exercises } = await getSessionDetail(db, newSessionId as string);
    const workingSet = exercises[0]?.sets[1];
    // Those describe how the earlier performance felt. Copying them would fabricate data the
    // user never entered for the new session.
    expect(workingSet?.rpe).toBeNull();
    expect(workingSet?.to_failure).toBe(0);
  });

  it('inherits the name so the template stays identifiable', async () => {
    const sourceId = await buildSource();
    const newSessionId = await repeatSession(db, USER, newId, sourceId, clock);

    const { session } = await getSessionDetail(db, newSessionId as string);
    expect(session?.name).toBe('Push A');
  });

  it('creates an open session and leaves the source untouched', async () => {
    const sourceId = await buildSource();
    const newSessionId = await repeatSession(db, USER, newId, sourceId, clock);

    const active = await getActiveSession(db, USER);
    expect(active?.id).toBe(newSessionId);

    // Repeating must never mutate history.
    const source = await getSessionDetail(db, sourceId);
    expect(source.session?.ended_at).not.toBeNull();
    expect(source.exercises).toHaveLength(2);
    expect(source.exercises[0]?.sets).toHaveLength(3);
  });

  it('returns null for an unknown source instead of creating an empty session', async () => {
    expect(await repeatSession(db, USER, newId, 'no-such-session', clock)).toBeNull();
    expect(await listSessionSummaries(db, USER)).toHaveLength(0);
  });

  it('numbers copied sets from 1 within each exercise', async () => {
    const sourceId = await buildSource();
    const newSessionId = await repeatSession(db, USER, newId, sourceId, clock);

    const { exercises } = await getSessionDetail(db, newSessionId as string);
    expect(exercises[0]?.sets.map((s) => s.set_index)).toEqual([1, 2, 3]);
    expect(exercises[1]?.sets.map((s) => s.set_index)).toEqual([1]);
  });
});

describe('previous session reference', () => {
  /** Log one press session at a given weight/reps, on its own day. */
  async function logPress(
    tick: () => string,
    sets: { weightKg: number; reps: number; isWarmup?: boolean }[],
  ): Promise<string> {
    const sessionId = await startSession(db, USER, newId, {}, tick);
    const press = await addExerciseToSession(db, newId, sessionId, 'Barbell Bench Press', tick);
    for (const set of sets) await addSet(db, newId, press, set, tick);
    await finishSession(db, USER, sessionId, {}, tick);
    return sessionId;
  }

  it('returns the sets of the most recent session, in set order', async () => {
    const tick = tickingClock();
    await logPress(tick, [{ weightKg: 70, reps: 10 }]);
    await logPress(tick, [
      { weightKg: 80, reps: 8 },
      { weightKg: 80, reps: 7 },
      { weightKg: 75, reps: 6 },
    ]);

    const previous = await getPreviousSessionSets(db, USER, 'Barbell Bench Press');
    expect(previous.map((s) => s.set_index)).toEqual([1, 2, 3]);
    expect(previous.map((s) => s.weight_kg)).toEqual([80, 80, 75]);
    expect(previous.map((s) => s.reps)).toEqual([8, 7, 6]);
  });

  it('never mixes sets from two different sessions', async () => {
    const tick = tickingClock();
    // An older session with MORE sets than the newer one. Taking "the newest sets" per index
    // rather than the newest session would leak set 3 from July in beside July's successor.
    await logPress(tick, [
      { weightKg: 70, reps: 10 },
      { weightKg: 70, reps: 10 },
      { weightKg: 70, reps: 9 },
    ]);
    await logPress(tick, [{ weightKg: 85, reps: 5 }]);

    const previous = await getPreviousSessionSets(db, USER, 'Barbell Bench Press');
    expect(previous).toHaveLength(1);
    expect(previous[0]?.weight_kg).toBe(85);
  });

  it('excludes the session being logged right now', async () => {
    const tick = tickingClock();
    await logPress(tick, [{ weightKg: 80, reps: 8 }]);

    // The session currently open must not become its own reference the moment a set is saved.
    const currentId = await startSession(db, USER, newId, {}, tick);
    const press = await addExerciseToSession(db, newId, currentId, 'Barbell Bench Press', tick);
    await addSet(db, newId, press, { weightKg: 100, reps: 1 }, tick);

    const previous = await getPreviousSessionSets(db, USER, 'Barbell Bench Press', currentId);
    expect(previous.map((s) => s.weight_kg)).toEqual([80]);
  });

  it('skips sessions where the exercise was added but never logged', async () => {
    const tick = tickingClock();
    await logPress(tick, [{ weightKg: 80, reps: 8 }]);

    // Exactly what repeatSession now produces: structure with no numbers. An abandoned repeat
    // must not blank out the reference for the next real session.
    const emptyId = await startSession(db, USER, newId, {}, tick);
    const press = await addExerciseToSession(db, newId, emptyId, 'Barbell Bench Press', tick);
    await addSet(db, newId, press, {}, tick);
    await finishSession(db, USER, emptyId, {}, tick);

    const previous = await getPreviousSessionSets(db, USER, 'Barbell Bench Press');
    expect(previous.map((s) => s.weight_kg)).toEqual([80]);
  });

  it('returns warmup flags so rows line up with the same structure', async () => {
    const tick = tickingClock();
    await logPress(tick, [
      { weightKg: 40, reps: 12, isWarmup: true },
      { weightKg: 80, reps: 8 },
    ]);

    const previous = await getPreviousSessionSets(db, USER, 'Barbell Bench Press');
    expect(previous.map((s) => s.is_warmup)).toEqual([1, 0]);
  });

  it('returns an empty list for an exercise with no history', async () => {
    expect(await getPreviousSessionSets(db, USER, 'Nordic Hamstring Curl')).toEqual([]);
  });

  it('never surfaces another user\'s sets as this user\'s reference', async () => {
    const tick = tickingClock();
    const otherSession = await startSession(db, 'user-2', newId, {}, tick);
    const otherPress = await addExerciseToSession(
      db,
      newId,
      otherSession,
      'Barbell Bench Press',
      tick,
    );
    await addSet(db, newId, otherPress, { weightKg: 140, reps: 5 }, tick);
    await finishSession(db, 'user-2', otherSession, {}, tick);

    // USER has no bench history at all — user-2's 140kg set must not leak in as a reference.
    expect(await getPreviousSessionSets(db, USER, 'Barbell Bench Press')).toEqual([]);
  });

  it('pairs with repeatSession: blank sets, previous numbers still available', async () => {
    const tick = tickingClock();
    const sourceId = await logPress(tick, [
      { weightKg: 80, reps: 8 },
      { weightKg: 80, reps: 7 },
    ]);

    const repeatedId = (await repeatSession(db, USER, newId, sourceId, tick)) as string;
    const { exercises } = await getSessionDetail(db, repeatedId);

    // Same structure, nothing filled in...
    expect(exercises[0]?.sets.map((s) => s.weight_kg)).toEqual([null, null]);
    // ...and last time's numbers are still there to aim at.
    const previous = await getPreviousSessionSets(db, USER, 'Barbell Bench Press', repeatedId);
    expect(previous.map((s) => s.weight_kg)).toEqual([80, 80]);
    expect(previous.map((s) => s.reps)).toEqual([8, 7]);
  });
});

describe('history over a period', () => {
  async function sessionOn(startedAt: string) {
    const id = await startSession(db, USER, newId, {}, () => startedAt);
    await addExerciseToSession(db, newId, id, 'Barbell Bench Press', clock);
    return id;
  }

  it('keeps only sessions started on or after the start of the period', async () => {
    const old = await sessionOn('2026-06-01T10:00:00.000Z');
    const boundary = await sessionOn('2026-08-17T00:00:00.000Z');
    const recent = await sessionOn('2026-09-15T10:00:00.000Z');

    const inPeriod = await listSessionSummaries(db, USER, 1000, '2026-08-17T00:00:00.000Z');
    expect(inPeriod.map((s) => s.id)).toEqual([recent, boundary]);
    expect(inPeriod.map((s) => s.id)).not.toContain(old);
  });

  it('returns all of history when no start is given', async () => {
    await sessionOn('2025-01-01T10:00:00.000Z');
    await sessionOn('2026-09-15T10:00:00.000Z');
    expect(await listSessionSummaries(db, USER)).toHaveLength(2);
  });

  it('still keeps two users apart inside a period', async () => {
    await sessionOn('2026-09-15T10:00:00.000Z');
    expect(await listSessionSummaries(db, 'user-2', 1000, '2026-01-01T00:00:00.000Z')).toHaveLength(0);
  });
});
