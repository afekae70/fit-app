/**
 * Plan repository tests, running the real SQL against a real SQLite engine (`node:sqlite`).
 *
 * The ordering invariants get the most attention here for the same reason they do in
 * workouts.test.ts: `(plan_day_id, order_index)` is UNIQUE, so every reorder and delete has to
 * pass through an intermediate state that must not collide — and a collision surfaces as a
 * constraint error the user sees, not as a silently wrong number.
 */

import { createRequire } from 'node:module';
import { beforeEach, describe, expect, it } from 'vitest';

// See the note in workouts.test.ts: Vite's import analysis rewrites a static `node:sqlite`
// import to a bare "sqlite" specifier, so the require goes straight to Node instead.
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

import type { SqlExecutor } from './executor.js';
import {
  addExerciseToPlanDay,
  addPlanDay,
  createPlan,
  deletePlan,
  getActivePlan,
  getActivePlanDetail,
  getPlanDetail,
  lastLoggedSet,
  lastTrainedByPlanDay,
  movePlanDayExercise,
  removePlanDay,
  removePlanDayExercise,
  renamePlanDay,
  resolveRestSeconds,
  restSecondsByExerciseKey,
  setActivePlan,
  startSessionFromPlanDay,
  updatePlan,
  updatePlanTargets,
} from './plans.js';
import { CREATE_SCHEMA_SQL } from './schema.js';
import {
  addExerciseToSession,
  addSet,
  finishSession,
  getSessionDetail,
  startSession,
} from './workouts.js';

function createTestExecutor(): SqlExecutor & { close: () => void } {
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
    close: () => db.close(),
  };
}

function createFixtures() {
  let idCounter = 0;
  let tick = 0;
  return {
    newId: () => `id-${String(++idCounter).padStart(3, '0')}`,
    clock: () => new Date(Date.UTC(2026, 6, 25, 10, 0, tick++)).toISOString(),
  };
}

let db: SqlExecutor & { close: () => void };
let newId: () => string;
let clock: () => string;

beforeEach(() => {
  db = createTestExecutor();
  const f = createFixtures();
  newId = f.newId;
  clock = f.clock;
});

describe('plans', () => {
  it('activates a new plan and deactivates the previous one', async () => {
    const first = await createPlan(db, newId, { name: 'PPL' }, clock);
    expect((await getActivePlan(db))?.id).toBe(first);

    const second = await createPlan(db, newId, { name: 'Upper/Lower' }, clock);

    expect((await getActivePlan(db))?.id).toBe(second);
    // Exactly one active row, not two — the rule the schema cannot express as a constraint.
    expect(await db.all('SELECT id FROM plans WHERE is_active = 1')).toHaveLength(1);

    await setActivePlan(db, first, clock);
    expect((await getActivePlan(db))?.id).toBe(first);
    expect(await db.all('SELECT id FROM plans WHERE is_active = 1')).toHaveLength(1);
  });

  it('updates only the supplied fields', async () => {
    const planId = await createPlan(db, newId, { name: 'PPL', goal: 'bulk', lengthWeeks: 8 }, clock);

    await updatePlan(db, planId, { name: 'PPL v2' }, clock);

    const { plan } = await getPlanDetail(db, planId);
    expect(plan?.name).toBe('PPL v2');
    // A rename must not blank the goal that was already set.
    expect(plan?.goal).toBe('bulk');
    expect(plan?.length_weeks).toBe(8);
  });

  it('cascades a delete from plan down to plan day exercises', async () => {
    const planId = await createPlan(db, newId, { name: 'PPL' }, clock);
    const dayId = await addPlanDay(db, newId, planId, 'Push', clock);
    await addExerciseToPlanDay(db, newId, dayId, 'Barbell Bench Press', undefined, clock);

    await deletePlan(db, planId, clock);

    expect(await db.all('SELECT * FROM plan_days')).toHaveLength(0);
    expect(await db.all('SELECT * FROM plan_day_exercises')).toHaveLength(0);
  });
});

describe('plan days', () => {
  it('numbers days 1..n and closes the gap when one is removed', async () => {
    const planId = await createPlan(db, newId, { name: 'PPL' }, clock);
    const push = await addPlanDay(db, newId, planId, 'Push', clock);
    const pull = await addPlanDay(db, newId, planId, 'Pull', clock);
    const legs = await addPlanDay(db, newId, planId, 'Legs', clock);

    let detail = await getPlanDetail(db, planId);
    expect(detail.days.map((d) => d.day_index)).toEqual([1, 2, 3]);

    await removePlanDay(db, pull, clock);

    detail = await getPlanDetail(db, planId);
    expect(detail.days.map((d) => d.id)).toEqual([push, legs]);
    // Contiguous again — a plan showing "day 1, day 3" would read as a missing day.
    expect(detail.days.map((d) => d.day_index)).toEqual([1, 2]);
  });

  it('treats a blank rename as clearing the name', async () => {
    const planId = await createPlan(db, newId, { name: 'PPL' }, clock);
    const dayId = await addPlanDay(db, newId, planId, 'Push', clock);

    await renamePlanDay(db, dayId, '   ', clock);

    const detail = await getPlanDetail(db, planId);
    expect(detail.days[0]?.name).toBeNull();
  });
});

describe('plan day exercises', () => {
  it('appends in order and renumbers after a removal', async () => {
    const planId = await createPlan(db, newId, { name: 'PPL' }, clock);
    const dayId = await addPlanDay(db, newId, planId, 'Push', clock);
    const bench = await addExerciseToPlanDay(db, newId, dayId, 'Barbell Bench Press', undefined, clock);
    const press = await addExerciseToPlanDay(db, newId, dayId, 'Overhead Press', undefined, clock);
    const fly = await addExerciseToPlanDay(db, newId, dayId, 'Cable Fly', undefined, clock);

    await removePlanDayExercise(db, press, clock);

    const detail = await getPlanDetail(db, planId);
    expect(detail.days[0]?.exercises.map((e) => e.id)).toEqual([bench, fly]);
    expect(detail.days[0]?.exercises.map((e) => e.order_index)).toEqual([1, 2]);
  });

  it('applies the default prescription when none is given', async () => {
    const planId = await createPlan(db, newId, { name: 'PPL' }, clock);
    const dayId = await addPlanDay(db, newId, planId, 'Push', clock);
    await addExerciseToPlanDay(db, newId, dayId, 'Barbell Bench Press', undefined, clock);

    const detail = await getPlanDetail(db, planId);
    const exercise = detail.days[0]?.exercises[0];
    expect(exercise?.target_sets).toBe(3);
    expect(exercise?.target_reps_min).toBe(8);
    expect(exercise?.target_reps_max).toBe(12);
  });

  it('updates only the supplied targets', async () => {
    const planId = await createPlan(db, newId, { name: 'PPL' }, clock);
    const dayId = await addPlanDay(db, newId, planId, 'Push', clock);
    const id = await addExerciseToPlanDay(
      db,
      newId,
      dayId,
      'Barbell Bench Press',
      { targetSets: 4, targetRepsMin: 5, targetRepsMax: 5, restSeconds: 180 },
      clock,
    );

    await updatePlanTargets(db, id, { targetSets: 5 }, clock);

    const detail = await getPlanDetail(db, planId);
    const exercise = detail.days[0]?.exercises[0];
    expect(exercise?.target_sets).toBe(5);
    expect(exercise?.rest_seconds).toBe(180);
    expect(exercise?.target_reps_min).toBe(5);
  });

  it('swaps neighbours when moving up and down, and no-ops at the ends', async () => {
    const planId = await createPlan(db, newId, { name: 'PPL' }, clock);
    const dayId = await addPlanDay(db, newId, planId, 'Push', clock);
    const a = await addExerciseToPlanDay(db, newId, dayId, 'Barbell Bench Press', undefined, clock);
    const b = await addExerciseToPlanDay(db, newId, dayId, 'Overhead Press', undefined, clock);
    const c = await addExerciseToPlanDay(db, newId, dayId, 'Cable Fly', undefined, clock);

    await movePlanDayExercise(db, c, 'up');

    let detail = await getPlanDetail(db, planId);
    expect(detail.days[0]?.exercises.map((e) => e.id)).toEqual([a, c, b]);
    expect(detail.days[0]?.exercises.map((e) => e.order_index)).toEqual([1, 2, 3]);

    // Already first: moving up must leave the order untouched rather than throw.
    await movePlanDayExercise(db, a, 'up');
    detail = await getPlanDetail(db, planId);
    expect(detail.days[0]?.exercises.map((e) => e.id)).toEqual([a, c, b]);

    await movePlanDayExercise(db, a, 'down');
    detail = await getPlanDetail(db, planId);
    expect(detail.days[0]?.exercises.map((e) => e.id)).toEqual([c, a, b]);
  });
});

describe('starting a session from a plan day', () => {
  it('creates the planned sets and links the session back to the day', async () => {
    const planId = await createPlan(db, newId, { name: 'PPL' }, clock);
    const dayId = await addPlanDay(db, newId, planId, 'Push', clock);
    await addExerciseToPlanDay(
      db,
      newId,
      dayId,
      'Barbell Bench Press',
      { targetSets: 4 },
      clock,
    );
    await addExerciseToPlanDay(db, newId, dayId, 'Overhead Press', { targetSets: 2 }, clock);

    const sessionId = await startSessionFromPlanDay(db, newId, dayId, clock);
    expect(sessionId).not.toBeNull();

    const { session, exercises } = await getSessionDetail(db, sessionId as string);
    expect(session?.plan_day_id).toBe(dayId);
    // The day's name carries onto the session, so it lands in history already labelled.
    expect(session?.name).toBe('Push');
    // Per-exercise set counts stay independent — the whole point of the one-row-per-set design.
    expect(exercises.map((e) => e.sets.length)).toEqual([4, 2]);
  });

  it('pre-fills from the last logged set, not from the heaviest one', async () => {
    // A heavy session first, then a lighter one more recently. Pre-filling the record would
    // make every deload start by correcting the weight downwards on every single set.
    const oldSession = await startSession(db, newId, {}, clock);
    const oldExercise = await addExerciseToSession(db, newId, oldSession, 'Barbell Bench Press', clock);
    await addSet(db, newId, oldExercise, { weightKg: 100, reps: 5 }, clock);
    await finishSession(db, oldSession, {}, clock);

    const recentSession = await startSession(db, newId, {}, clock);
    const recentExercise = await addExerciseToSession(db, newId, recentSession, 'Barbell Bench Press', clock);
    await addSet(db, newId, recentExercise, { weightKg: 80, reps: 8 }, clock);
    await finishSession(db, recentSession, {}, clock);

    expect(await lastLoggedSet(db, 'Barbell Bench Press')).toEqual({ weight_kg: 80, reps: 8 });

    const planId = await createPlan(db, newId, { name: 'PPL' }, clock);
    const dayId = await addPlanDay(db, newId, planId, 'Push', clock);
    await addExerciseToPlanDay(db, newId, dayId, 'Barbell Bench Press', { targetSets: 2 }, clock);

    const sessionId = await startSessionFromPlanDay(db, newId, dayId, clock);
    const { exercises } = await getSessionDetail(db, sessionId as string);

    expect(exercises[0]?.sets.map((s) => s.weight_kg)).toEqual([80, 80]);
    expect(exercises[0]?.sets.map((s) => s.reps)).toEqual([8, 8]);
  });

  it('still creates one set when the plan gives no target', async () => {
    const planId = await createPlan(db, newId, { name: 'PPL' }, clock);
    const dayId = await addPlanDay(db, newId, planId, 'Push', clock);
    await addExerciseToPlanDay(db, newId, dayId, 'Barbell Bench Press', { targetSets: null }, clock);

    const sessionId = await startSessionFromPlanDay(db, newId, dayId, clock);
    const { exercises } = await getSessionDetail(db, sessionId as string);

    expect(exercises[0]?.sets).toHaveLength(1);
  });

  it('returns null for a day that does not exist', async () => {
    expect(await startSessionFromPlanDay(db, newId, 'missing', clock)).toBeNull();
  });

  it('reports when each day was last trained', async () => {
    const planId = await createPlan(db, newId, { name: 'PPL' }, clock);
    const push = await addPlanDay(db, newId, planId, 'Push', clock);
    const pull = await addPlanDay(db, newId, planId, 'Pull', clock);
    await addExerciseToPlanDay(db, newId, push, 'Barbell Bench Press', undefined, clock);

    const first = await startSessionFromPlanDay(db, newId, push, clock);
    await finishSession(db, first as string, {}, clock);
    const second = await startSessionFromPlanDay(db, newId, push, clock);
    await finishSession(db, second as string, {}, clock);

    const lastTrained = await lastTrainedByPlanDay(db, planId);
    const { session } = await getSessionDetail(db, second as string);

    // The most recent of the two sessions, not the first.
    expect(lastTrained[push]).toBe(session?.started_at);
    // A day never trained is absent rather than present with a null.
    expect(pull in lastTrained).toBe(false);
  });
});

describe('rest prescriptions', () => {
  it('returns only the exercises that actually prescribe rest', async () => {
    const planId = await createPlan(db, newId, { name: 'PPL' }, clock);
    const dayId = await addPlanDay(db, newId, planId, 'Push', clock);
    await addExerciseToPlanDay(db, newId, dayId, 'Barbell Bench Press', { restSeconds: 180 }, clock);
    // No rest of its own — must be absent, so the caller falls through to the profile default
    // rather than reading a null as "no timer".
    await addExerciseToPlanDay(db, newId, dayId, 'Cable Fly', { restSeconds: null }, clock);

    const rest = await restSecondsByExerciseKey(db, dayId);

    expect(rest['Barbell Bench Press']).toBe(180);
    expect('Cable Fly' in rest).toBe(false);
  });
});

describe('resolveRestSeconds', () => {
  it('lets the plan override the profile default', () => {
    // The promise the settings screen makes in so many words.
    expect(resolveRestSeconds(180, 120)).toBe(180);
  });

  it('falls back to the profile default when the plan says nothing', () => {
    expect(resolveRestSeconds(undefined, 120)).toBe(120);
    expect(resolveRestSeconds(null, 120)).toBe(120);
  });

  it('returns null when neither is set, so no timer runs', () => {
    expect(resolveRestSeconds(undefined, null)).toBeNull();
    expect(resolveRestSeconds(null, null)).toBeNull();
  });

  it('treats zero and negatives as no timer rather than an instant one', () => {
    expect(resolveRestSeconds(0, 120)).toBeNull();
    expect(resolveRestSeconds(-30, 120)).toBeNull();
    expect(resolveRestSeconds(null, 0)).toBeNull();
  });
});

describe('getActivePlanDetail', () => {
  it('returns an empty detail when no plan exists yet', async () => {
    expect(await getActivePlanDetail(db)).toEqual({ plan: null, days: [] });
  });

  it('returns the active plan with its days and exercises', async () => {
    const planId = await createPlan(db, newId, { name: 'PPL' }, clock);
    const dayId = await addPlanDay(db, newId, planId, 'Push', clock);
    await addExerciseToPlanDay(db, newId, dayId, 'Barbell Bench Press', undefined, clock);

    const detail = await getActivePlanDetail(db);

    expect(detail.plan?.id).toBe(planId);
    expect(detail.days[0]?.exercises[0]?.exercise_key).toBe('Barbell Bench Press');
  });
});
