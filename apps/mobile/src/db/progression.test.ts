/**
 * Progression analysis tests — real SQL against real SQLite.
 *
 * The SQL here reimplements Epley in SQLite so the aggregate can run in the database. These
 * tests exist largely to prove that reimplementation agrees with `epley1RM` in @fit/shared:
 * if the two ever diverge, the screen and the AI coach would show different numbers for the
 * same lift.
 */

import { epley1RM } from '@fit/shared/calculations';
import { createRequire } from 'node:module';
import { beforeEach, describe, expect, it } from 'vitest';

import type { SqlExecutor } from './executor.js';
import {
  getExerciseProgression,
  listTrainedExercises,
  summariseAllProgress,
  summariseExerciseProgress,
  toCoachDigest,
} from './progression.js';
import { CREATE_SCHEMA_SQL } from './schema.js';
import { addExerciseToSession, addSet, finishSession, startSession } from './workouts.js';

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

/** Log one finished session containing a single exercise with the given sets. */
async function logSession(
  dayOffset: number,
  exerciseKey: string,
  sets: { weightKg: number; reps: number; isWarmup?: boolean }[],
) {
  const clock = () => new Date(Date.UTC(2026, 5, 1 + dayOffset, 10)).toISOString();
  const sessionId = await startSession(db, newId, {}, clock);
  const exerciseId = await addExerciseToSession(db, newId, sessionId, exerciseKey, clock);
  for (const set of sets) await addSet(db, newId, exerciseId, set, clock);
  await finishSession(db, sessionId, {}, clock);
  return sessionId;
}

beforeEach(() => {
  db = createTestExecutor();
  counter = 0;
});

describe('getExerciseProgression', () => {
  it('computes best e1RM per session, matching the shared formula exactly', async () => {
    await logSession(0, 'Barbell Curl', [
      { weightKg: 30, reps: 10 },
      { weightKg: 35, reps: 6 },
    ]);

    const [session] = await getExerciseProgression(db, 'Barbell Curl');

    // 35 x 6 -> 35 * (1 + 6/30) = 42; 30 x 10 -> 40. The heavier-for-fewer set wins.
    expect(session?.best_e1rm_kg).toBeCloseTo(epley1RM(35, 6), 6);
    expect(session?.best_e1rm_kg).toBeCloseTo(42, 6);
  });

  it('agrees with epley1RM across a range of rep counts', async () => {
    // Guards the SQLite reimplementation against drifting from the TypeScript one.
    for (const [i, [w, r]] of [
      [100, 1],
      [90, 3],
      [80, 5],
      [70, 8],
      [60, 12],
    ].entries()) {
      await logSession(i, `Ex ${i}`, [{ weightKg: w as number, reps: r as number }]);
      const [s] = await getExerciseProgression(db, `Ex ${i}`);
      expect(s?.best_e1rm_kg).toBeCloseTo(epley1RM(w as number, r as number), 6);
    }
  });

  it('returns sessions oldest first', async () => {
    await logSession(0, 'Barbell Curl', [{ weightKg: 30, reps: 10 }]);
    await logSession(7, 'Barbell Curl', [{ weightKg: 32.5, reps: 10 }]);

    const sessions = await getExerciseProgression(db, 'Barbell Curl');
    expect(sessions.map((s) => s.top_weight_kg)).toEqual([30, 32.5]);
  });

  it('keeps the most RECENT sessions when the limit bites', async () => {
    for (let i = 0; i < 5; i++) {
      await logSession(i, 'Barbell Curl', [{ weightKg: 30 + i, reps: 8 }]);
    }

    const sessions = await getExerciseProgression(db, 'Barbell Curl', 3);
    // The limit must drop the OLDEST sessions, not the newest — otherwise the trend would
    // freeze in the past as history grows.
    expect(sessions.map((s) => s.top_weight_kg)).toEqual([32, 33, 34]);
  });

  it('excludes warmups', async () => {
    await logSession(0, 'Barbell Curl', [
      { weightKg: 100, reps: 5, isWarmup: true },
      { weightKg: 30, reps: 10 },
    ]);

    const [session] = await getExerciseProgression(db, 'Barbell Curl');
    expect(session?.working_sets).toBe(1);
    expect(session?.top_weight_kg).toBe(30);
  });

  it('excludes sets above 12 reps, where Epley is unreliable', async () => {
    await logSession(0, 'Barbell Curl', [
      { weightKg: 20, reps: 25 },
      { weightKg: 30, reps: 8 },
    ]);

    const [session] = await getExerciseProgression(db, 'Barbell Curl');
    expect(session?.working_sets).toBe(1);
    expect(session?.best_e1rm_kg).toBeCloseTo(epley1RM(30, 8), 6);
  });

  it('returns nothing for an exercise never performed', async () => {
    expect(await getExerciseProgression(db, 'Preacher Curl')).toEqual([]);
  });
});

describe('listTrainedExercises', () => {
  it('lists exercises with usable history, most recent first', async () => {
    await logSession(0, 'Barbell Curl', [{ weightKg: 30, reps: 10 }]);
    await logSession(3, 'Preacher Curl', [{ weightKg: 25, reps: 10 }]);

    const trained = await listTrainedExercises(db);
    expect(trained.map((e) => e.exercise_key)).toEqual(['Preacher Curl', 'Barbell Curl']);
  });

  it('counts sessions per exercise', async () => {
    await logSession(0, 'Barbell Curl', [{ weightKg: 30, reps: 10 }]);
    await logSession(7, 'Barbell Curl', [{ weightKg: 32, reps: 10 }]);

    const [entry] = await listTrainedExercises(db);
    expect(entry?.session_count).toBe(2);
  });

  it('ignores an exercise logged with warmups only', async () => {
    await logSession(0, 'Barbell Curl', [{ weightKg: 20, reps: 10, isWarmup: true }]);
    expect(await listTrainedExercises(db)).toEqual([]);
  });
});

describe('summariseExerciseProgress', () => {
  it('reports progress when e1RM is climbing', async () => {
    for (let i = 0; i < 4; i++) {
      await logSession(i * 7, 'Barbell Curl', [{ weightKg: 30 + i * 2.5, reps: 8 }]);
    }

    const summary = await summariseExerciseProgress(db, 'Barbell Curl');
    expect(summary?.assessment.isStalling).toBe(false);
    expect(summary?.assessment.e1rmDeltaKg ?? 0).toBeGreaterThan(0);
    expect(summary?.sessionCount).toBe(4);
  });

  it('flags a stall once enough sessions pass without a new best', async () => {
    await logSession(0, 'Barbell Curl', [{ weightKg: 30, reps: 8 }]);
    await logSession(7, 'Barbell Curl', [{ weightKg: 40, reps: 8 }]); // best
    await logSession(14, 'Barbell Curl', [{ weightKg: 37.5, reps: 8 }]);
    await logSession(21, 'Barbell Curl', [{ weightKg: 37.5, reps: 8 }]);
    await logSession(28, 'Barbell Curl', [{ weightKg: 35, reps: 8 }]);

    const summary = await summariseExerciseProgress(db, 'Barbell Curl');
    expect(summary?.assessment.isStalling).toBe(true);
    expect(summary?.assessment.sessionsSinceBest).toBe(3);
  });

  it('does not call a stall after a single down session', async () => {
    await logSession(0, 'Barbell Curl', [{ weightKg: 30, reps: 8 }]);
    await logSession(7, 'Barbell Curl', [{ weightKg: 40, reps: 8 }]);
    await logSession(14, 'Barbell Curl', [{ weightKg: 37.5, reps: 8 }]);

    // One ordinary session after a personal best is training variance, not a plateau.
    expect((await summariseExerciseProgress(db, 'Barbell Curl'))?.assessment.isStalling).toBe(false);
  });

  it('returns null rather than an empty summary for unknown history', async () => {
    expect(await summariseExerciseProgress(db, 'Zottman Curl')).toBeNull();
  });
});

describe('summariseAllProgress', () => {
  it('skips exercises with too little history to judge', async () => {
    await logSession(0, 'Barbell Curl', [{ weightKg: 30, reps: 8 }]);
    await logSession(7, 'Barbell Curl', [{ weightKg: 32, reps: 8 }]);
    await logSession(0, 'Spider Curl', [{ weightKg: 15, reps: 10 }]); // one session only

    const summaries = await summariseAllProgress(db);
    // Two data points cannot distinguish progress from noise; flagging a stall on one session
    // would be wrong far more often than right.
    expect(summaries.map((s) => s.exerciseKey)).toEqual(['Barbell Curl']);
  });
});

describe('toCoachDigest', () => {
  it('produces a compact record per exercise', async () => {
    for (let i = 0; i < 3; i++) {
      await logSession(i * 7, 'Barbell Curl', [{ weightKg: 30 + i * 2.5, reps: 8 }]);
    }

    const digest = toCoachDigest(await summariseAllProgress(db));
    expect(digest).toHaveLength(1);
    expect(digest[0]).toMatchObject({
      exercise: 'Barbell Curl',
      sessions: 3,
      stalling: false,
    });
    // Rounded so the model is not handed 14 decimal places of float noise to read.
    expect(String(digest[0]?.currentE1rmKg)).toMatch(/^\d+(\.\d)?$/);
    expect(digest[0]?.lastPerformed).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('stays small — the point is to hand the model a digest, not raw rows', async () => {
    for (let i = 0; i < 20; i++) {
      await logSession(i, 'Barbell Curl', [
        { weightKg: 30, reps: 8 },
        { weightKg: 30, reps: 8 },
        { weightKg: 30, reps: 8 },
      ]);
    }

    const digest = toCoachDigest(await summariseAllProgress(db));
    // 60 set rows collapse to one line.
    expect(digest).toHaveLength(1);
    expect(JSON.stringify(digest).length).toBeLessThan(400);
  });
});
