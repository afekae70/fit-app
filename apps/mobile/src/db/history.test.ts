/**
 * History, naming and template-repeat tests. Real SQL against real SQLite, as elsewhere.
 */

import { createRequire } from 'node:module';
import { beforeEach, describe, expect, it } from 'vitest';

import type { SqlExecutor } from './executor.js';
import { CREATE_SCHEMA_SQL } from './schema.js';
import {
  addExerciseToSession,
  addSet,
  finishSession,
  getActiveSession,
  getSessionDetail,
  listNamedTemplates,
  listSessionSummaries,
  renameSession,
  repeatSession,
  startSession,
} from './workouts.js';

const nodeRequire = createRequire(import.meta.url);
const { DatabaseSync } = nodeRequire('node:sqlite') as {
  DatabaseSync: new (path: string) => {
    exec(sql: string): void;
    prepare(sql: string): {
      run(...params: never[]): unknown;
      all(...params: never[]): unknown[];
      get(...params: never[]): unknown;
    };
    close(): void;
  };
};

function createTestExecutor(): SqlExecutor {
  const db = new DatabaseSync(':memory:');
  db.exec(CREATE_SCHEMA_SQL.replace(/PRAGMA journal_mode = WAL;/, ''));
  db.exec('PRAGMA foreign_keys = ON;');
  return {
    // eslint-disable-next-line @typescript-eslint/require-await
    async run(sql, params = []) {
      db.prepare(sql).run(...(params as never[]));
    },
    // eslint-disable-next-line @typescript-eslint/require-await
    async all<T>(sql: string, params: unknown[] = []) {
      return db.prepare(sql).all(...(params as never[])) as T[];
    },
    // eslint-disable-next-line @typescript-eslint/require-await
    async get<T>(sql: string, params: unknown[] = []) {
      return (db.prepare(sql).get(...(params as never[])) ?? null) as T | null;
    },
    // eslint-disable-next-line @typescript-eslint/require-await
    async exec(sql) {
      db.exec(sql);
    },
  };
}

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
    const sessionId = await startSession(db, newId, {}, clock);
    await renameSession(db, sessionId, '  Push A  ', clock);

    const { session } = await getSessionDetail(db, sessionId);
    expect(session?.name).toBe('Push A');
  });

  it('treats a blank name as no name rather than an empty string', async () => {
    const sessionId = await startSession(db, newId, {}, clock);
    await renameSession(db, sessionId, 'Push A', clock);
    await renameSession(db, sessionId, '   ', clock);

    const { session } = await getSessionDetail(db, sessionId);
    // NULL, not '' — the template query filters on `name IS NOT NULL`, so an empty string
    // would surface as a nameless entry in the template list.
    expect(session?.name).toBeNull();
  });
});

describe('history summaries', () => {
  it('aggregates exercise count, set count and volume per session', async () => {
    const sessionId = await startSession(db, newId, {}, clock);
    const press = await addExerciseToSession(db, newId, sessionId, 'Barbell Bench Press', clock);
    const facePull = await addExerciseToSession(db, newId, sessionId, 'Face Pull', clock);

    for (let i = 0; i < 4; i++) await addSet(db, newId, press, { weightKg: 80, reps: 8 }, clock);
    for (let i = 0; i < 2; i++) await addSet(db, newId, facePull, { weightKg: 25, reps: 15 }, clock);

    const [summary] = await listSessionSummaries(db);
    expect(summary?.exercise_count).toBe(2);
    expect(summary?.set_count).toBe(6);
    // 4 x (80x8) + 2 x (25x15) = 2560 + 750 = 3310
    expect(summary?.volume_load).toBe(3310);
  });

  it('excludes warmups, matching the figures shown during the workout', async () => {
    const sessionId = await startSession(db, newId, {}, clock);
    const press = await addExerciseToSession(db, newId, sessionId, 'Barbell Bench Press', clock);
    await addSet(db, newId, press, { weightKg: 200, reps: 5, isWarmup: true }, clock);
    await addSet(db, newId, press, { weightKg: 80, reps: 8 }, clock);

    const [summary] = await listSessionSummaries(db);
    expect(summary?.set_count).toBe(1);
    expect(summary?.volume_load).toBe(640);
  });

  it('keeps a session that has no exercises rather than dropping it', async () => {
    await startSession(db, newId, {}, clock);
    const summaries = await listSessionSummaries(db);
    // The LEFT JOIN exists for this: a workout you started and abandoned should still appear
    // in history instead of vanishing with no explanation.
    expect(summaries).toHaveLength(1);
    expect(summaries[0]?.exercise_count).toBe(0);
    expect(summaries[0]?.volume_load).toBe(0);
  });

  it('orders newest first', async () => {
    const tick = tickingClock();
    const first = await startSession(db, newId, {}, tick);
    const second = await startSession(db, newId, {}, tick);

    const summaries = await listSessionSummaries(db);
    expect(summaries[0]?.id).toBe(second);
    expect(summaries[1]?.id).toBe(first);
  });
});

describe('repeating a session as a template', () => {
  async function buildSource() {
    const sessionId = await startSession(db, newId, {}, clock);
    await renameSession(db, sessionId, 'Push A', clock);
    const press = await addExerciseToSession(db, newId, sessionId, 'Barbell Bench Press', clock);
    const facePull = await addExerciseToSession(db, newId, sessionId, 'Face Pull', clock);

    await addSet(db, newId, press, { weightKg: 60, reps: 10, isWarmup: true }, clock);
    await addSet(db, newId, press, { weightKg: 80, reps: 8, rpe: 8, toFailure: true }, clock);
    await addSet(db, newId, press, { weightKg: 80, reps: 7 }, clock);
    await addSet(db, newId, facePull, { weightKg: 25, reps: 15 }, clock);

    await finishSession(db, sessionId, {}, clock);
    return sessionId;
  }

  it('copies exercises, their order and their set structure', async () => {
    const sourceId = await buildSource();
    const newSessionId = await repeatSession(db, newId, sourceId, clock);
    expect(newSessionId).not.toBeNull();

    const { exercises } = await getSessionDetail(db, newSessionId as string);
    expect(exercises.map((e) => e.exercise_key)).toEqual(['Barbell Bench Press', 'Face Pull']);
    // Same shape as last time: 3 sets on press (including the warmup), 1 on face pulls.
    expect(exercises.map((e) => e.sets.length)).toEqual([3, 1]);
  });

  it('carries weights and reps forward so nothing has to be retyped', async () => {
    const sourceId = await buildSource();
    const newSessionId = await repeatSession(db, newId, sourceId, clock);

    const { exercises } = await getSessionDetail(db, newSessionId as string);
    const pressSets = exercises[0]?.sets ?? [];
    expect(pressSets.map((s) => s.weight_kg)).toEqual([60, 80, 80]);
    expect(pressSets.map((s) => s.reps)).toEqual([10, 8, 7]);
  });

  it('carries warmup flags forward', async () => {
    const sourceId = await buildSource();
    const newSessionId = await repeatSession(db, newId, sourceId, clock);

    const { exercises } = await getSessionDetail(db, newSessionId as string);
    expect(exercises[0]?.sets.map((s) => s.is_warmup)).toEqual([1, 0, 0]);
  });

  it('does NOT carry RPE or to-failure forward', async () => {
    const sourceId = await buildSource();
    const newSessionId = await repeatSession(db, newId, sourceId, clock);

    const { exercises } = await getSessionDetail(db, newSessionId as string);
    const workingSet = exercises[0]?.sets[1];
    // Those describe how the earlier performance felt. Copying them would fabricate data the
    // user never entered for the new session.
    expect(workingSet?.rpe).toBeNull();
    expect(workingSet?.to_failure).toBe(0);
  });

  it('inherits the name so the template stays identifiable', async () => {
    const sourceId = await buildSource();
    const newSessionId = await repeatSession(db, newId, sourceId, clock);

    const { session } = await getSessionDetail(db, newSessionId as string);
    expect(session?.name).toBe('Push A');
  });

  it('creates an open session and leaves the source untouched', async () => {
    const sourceId = await buildSource();
    const newSessionId = await repeatSession(db, newId, sourceId, clock);

    const active = await getActiveSession(db);
    expect(active?.id).toBe(newSessionId);

    // Repeating must never mutate history.
    const source = await getSessionDetail(db, sourceId);
    expect(source.session?.ended_at).not.toBeNull();
    expect(source.exercises).toHaveLength(2);
    expect(source.exercises[0]?.sets).toHaveLength(3);
  });

  it('returns null for an unknown source instead of creating an empty session', async () => {
    expect(await repeatSession(db, newId, 'no-such-session', clock)).toBeNull();
    expect(await listSessionSummaries(db)).toHaveLength(0);
  });

  it('numbers copied sets from 1 within each exercise', async () => {
    const sourceId = await buildSource();
    const newSessionId = await repeatSession(db, newId, sourceId, clock);

    const { exercises } = await getSessionDetail(db, newSessionId as string);
    expect(exercises[0]?.sets.map((s) => s.set_index)).toEqual([1, 2, 3]);
    expect(exercises[1]?.sets.map((s) => s.set_index)).toEqual([1]);
  });
});

describe('template list', () => {
  it('offers only the most recent session for each name', async () => {
    const tick = tickingClock();

    const older = await startSession(db, newId, {}, tick);
    await renameSession(db, older, 'Push A', tick);
    await addExerciseToSession(db, newId, older, 'Barbell Bench Press', tick);

    const newer = await startSession(db, newId, {}, tick);
    await renameSession(db, newer, 'Push A', tick);
    await addExerciseToSession(db, newId, newer, 'Barbell Bench Press', tick);

    const templates = await listNamedTemplates(db);
    // One entry per name, pointing at the latest session — that is the one carrying current
    // weights, which is the entire reason to repeat it.
    expect(templates).toHaveLength(1);
    expect(templates[0]?.id).toBe(newer);
  });

  it('ignores unnamed sessions', async () => {
    const sessionId = await startSession(db, newId, {}, clock);
    await addExerciseToSession(db, newId, sessionId, 'Barbell Bench Press', clock);

    expect(await listNamedTemplates(db)).toHaveLength(0);
  });

  it('ignores a named session with no exercises', async () => {
    const sessionId = await startSession(db, newId, {}, clock);
    await renameSession(db, sessionId, 'Empty', clock);

    // Repeating it would produce nothing, so it is not a usable template.
    expect(await listNamedTemplates(db)).toHaveLength(0);
  });
});
