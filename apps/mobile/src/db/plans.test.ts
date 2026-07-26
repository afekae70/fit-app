/**
 * Weekly plan tests. Real SQL against real SQLite, as elsewhere.
 *
 * The load-bearing assertions here are the ones proving a plan is a *prescription*: a session
 * started from a day can diverge from its targets freely, and the plan is never rewritten to
 * match what was actually lifted.
 */

import { createRequire } from 'node:module';
import { beforeEach, describe, expect, it } from 'vitest';

import type { SqlExecutor } from './executor.js';
import {
  activatePlan,
  addPlanDay,
  addPlanDayExercise,
  createPlan,
  deletePlan,
  getActivePlan,
  getNextPlanDay,
  getPlanDay,
  getPlanDetail,
  getSessionAdherence,
  listPlanDayStatus,
  listPlanDays,
  listPlans,
  removePlanDay,
  removePlanDayExercise,
  startSessionFromPlanDay,
  updatePlanDayExercise,
} from './plans.js';
import { CREATE_SCHEMA_SQL } from './schema.js';
import { addSet, finishSession, getSessionDetail, removeSet } from './workouts.js';

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
const clock = () => '2026-07-26T10:00:00.000Z';

function tickingClock() {
  let day = 0;
  return () => new Date(Date.UTC(2026, 6, 1 + day++, 10)).toISOString();
}

beforeEach(() => {
  db = createTestExecutor();
  counter = 0;
});

describe('plans', () => {
  it('activates the first plan automatically', async () => {
    const id = await createPlan(db, newId, 'Hypertrophy Block 1', clock);
    const active = await getActivePlan(db);
    expect(active?.id).toBe(id);
    expect(active?.name).toBe('Hypertrophy Block 1');
  });

  it('does not steal activation from an existing plan', async () => {
    const first = await createPlan(db, newId, 'Block 1', clock);
    await createPlan(db, newId, 'Block 2', clock);

    // Creating a second plan must not silently switch the programme mid-week.
    expect((await getActivePlan(db))?.id).toBe(first);
  });

  it('keeps exactly one plan active when switching', async () => {
    await createPlan(db, newId, 'Block 1', clock);
    const second = await createPlan(db, newId, 'Block 2', clock);
    await activatePlan(db, second);

    const plans = await listPlans(db);
    expect(plans.filter((p) => p.is_active === 1)).toHaveLength(1);
    expect((await getActivePlan(db))?.id).toBe(second);
  });

  it('promotes another plan when the active one is deleted', async () => {
    const first = await createPlan(db, newId, 'Block 1', clock);
    const second = await createPlan(db, newId, 'Block 2', clock);
    await activatePlan(db, second);
    await deletePlan(db, second);

    // Leaving the user with plans but no active one would make the plan tab look empty.
    expect((await getActivePlan(db))?.id).toBe(first);
  });

  it('trims the name', async () => {
    await createPlan(db, newId, '   Push Pull Legs   ', clock);
    expect((await getActivePlan(db))?.name).toBe('Push Pull Legs');
  });
});

describe('plan days', () => {
  it('numbers days from 1 in creation order', async () => {
    const plan = await createPlan(db, newId, 'PPL', clock);
    await addPlanDay(db, newId, plan, 'Push');
    await addPlanDay(db, newId, plan, 'Pull');
    await addPlanDay(db, newId, plan, 'Legs');

    const days = await listPlanDays(db, plan);
    expect(days.map((d) => d.day_index)).toEqual([1, 2, 3]);
    expect(days.map((d) => d.name)).toEqual(['Push', 'Pull', 'Legs']);
  });

  it('closes the gap in day_index when a middle day is removed', async () => {
    const plan = await createPlan(db, newId, 'PPL', clock);
    await addPlanDay(db, newId, plan, 'Push');
    const pull = await addPlanDay(db, newId, plan, 'Pull');
    await addPlanDay(db, newId, plan, 'Legs');

    await removePlanDay(db, pull);

    // Renumbering must not trip UNIQUE (plan_id, day_index) while shifting 3 into 2.
    const days = await listPlanDays(db, plan);
    expect(days.map((d) => d.day_index)).toEqual([1, 2]);
    expect(days.map((d) => d.name)).toEqual(['Push', 'Legs']);
  });

  it('cascades day and prescription deletion when the plan goes', async () => {
    const plan = await createPlan(db, newId, 'PPL', clock);
    const day = await addPlanDay(db, newId, plan, 'Push');
    await addPlanDayExercise(db, newId, day, 'Barbell Bench Press');

    await deletePlan(db, plan);

    expect(await getPlanDay(db, day)).toBeNull();
    const orphans = await db.all(`SELECT * FROM plan_day_exercises`);
    expect(orphans).toHaveLength(0);
  });
});

describe('prescriptions', () => {
  it('defaults to 3 sets of 8-12', async () => {
    const plan = await createPlan(db, newId, 'PPL', clock);
    const day = await addPlanDay(db, newId, plan, 'Push');
    await addPlanDayExercise(db, newId, day, 'Barbell Bench Press');

    const detail = await getPlanDay(db, day);
    expect(detail?.exercises[0]?.target_sets).toBe(3);
    expect(detail?.exercises[0]?.target_reps_min).toBe(8);
    expect(detail?.exercises[0]?.target_reps_max).toBe(12);
  });

  it('patches only the fields supplied', async () => {
    const plan = await createPlan(db, newId, 'PPL', clock);
    const day = await addPlanDay(db, newId, plan, 'Push');
    const prescription = await addPlanDayExercise(db, newId, day, 'Barbell Bench Press', {
      targetSets: 5,
      targetRepsMin: 3,
      targetRepsMax: 5,
    });

    await updatePlanDayExercise(db, prescription, { targetSets: 4 });

    // Changing the set count must not blank the rep range.
    const detail = await getPlanDay(db, day);
    expect(detail?.exercises[0]?.target_sets).toBe(4);
    expect(detail?.exercises[0]?.target_reps_min).toBe(3);
    expect(detail?.exercises[0]?.target_reps_max).toBe(5);
  });

  it('closes the gap in order_index when one is removed', async () => {
    const plan = await createPlan(db, newId, 'PPL', clock);
    const day = await addPlanDay(db, newId, plan, 'Push');
    await addPlanDayExercise(db, newId, day, 'Barbell Bench Press');
    const middle = await addPlanDayExercise(db, newId, day, 'Overhead Press');
    await addPlanDayExercise(db, newId, day, 'Face Pull');

    await removePlanDayExercise(db, middle);

    const detail = await getPlanDay(db, day);
    expect(detail?.exercises.map((e) => e.order_index)).toEqual([1, 2]);
    expect(detail?.exercises.map((e) => e.exercise_key)).toEqual([
      'Barbell Bench Press',
      'Face Pull',
    ]);
  });
});

describe('starting a session from a plan day', () => {
  async function buildDay() {
    const plan = await createPlan(db, newId, 'PPL', clock);
    const day = await addPlanDay(db, newId, plan, 'Push');
    await addPlanDayExercise(db, newId, day, 'Barbell Bench Press', { targetSets: 4 });
    await addPlanDayExercise(db, newId, day, 'Face Pull', { targetSets: 2 });
    return { plan, day };
  }

  it('creates the prescribed exercises with the prescribed number of blank sets', async () => {
    const { day } = await buildDay();
    const sessionId = (await startSessionFromPlanDay(db, newId, day, clock)) as string;

    const { exercises } = await getSessionDetail(db, sessionId);
    expect(exercises.map((e) => e.exercise_key)).toEqual(['Barbell Bench Press', 'Face Pull']);
    // 4 and 2 — the dynamic-set requirement, now driven by the plan.
    expect(exercises.map((e) => e.sets.length)).toEqual([4, 2]);
    expect(exercises[0]?.sets.every((s) => s.weight_kg === null && s.reps === null)).toBe(true);
  });

  it('records plan_day_id and inherits the day name', async () => {
    const { day } = await buildDay();
    const sessionId = (await startSessionFromPlanDay(db, newId, day, clock)) as string;

    const { session } = await getSessionDetail(db, sessionId);
    expect(session?.plan_day_id).toBe(day);
    expect(session?.name).toBe('Push');
  });

  it('still creates one set when the prescription says none', async () => {
    const plan = await createPlan(db, newId, 'PPL', clock);
    const day = await addPlanDay(db, newId, plan, 'Push');
    await addPlanDayExercise(db, newId, day, 'Plank', { targetSets: null });

    const sessionId = (await startSessionFromPlanDay(db, newId, day, clock)) as string;
    const { exercises } = await getSessionDetail(db, sessionId);
    // An exercise with zero rows gives the user nothing to type into.
    expect(exercises[0]?.sets).toHaveLength(1);
  });

  it('returns null for an unknown day instead of an empty session', async () => {
    expect(await startSessionFromPlanDay(db, newId, 'no-such-day', clock)).toBeNull();
  });

  it('lets the session diverge from the plan without changing the plan', async () => {
    const { day } = await buildDay();
    const sessionId = (await startSessionFromPlanDay(db, newId, day, clock)) as string;

    const { exercises } = await getSessionDetail(db, sessionId);
    const press = exercises[0]!;
    // Prescription said 4; do 5.
    await addSet(db, newId, press.id, { weightKg: 80, reps: 8 }, clock);
    // And drop one from face pulls: 2 prescribed, 1 done.
    await removeSet(db, exercises[1]!.sets[0]!.id);

    const after = await getSessionDetail(db, sessionId);
    expect(after.exercises.map((e) => e.sets.length)).toEqual([5, 1]);

    // The plan is a prescription, not a mirror of the log — it must be untouched.
    const planDay = await getPlanDay(db, day);
    expect(planDay?.exercises.map((e) => e.target_sets)).toEqual([4, 2]);
  });
});

describe('next plan day', () => {
  it('suggests a never-trained day before any trained one', async () => {
    const tick = tickingClock();
    const plan = await createPlan(db, newId, 'PPL', tick);
    const push = await addPlanDay(db, newId, plan, 'Push');
    await addPlanDay(db, newId, plan, 'Pull');
    await addPlanDayExercise(db, newId, push, 'Barbell Bench Press');

    const sessionId = (await startSessionFromPlanDay(db, newId, push, tick)) as string;
    await finishSession(db, sessionId, {}, tick);

    const next = await getNextPlanDay(db, plan);
    expect(next?.name).toBe('Pull');
  });

  it('cycles back to the least recently trained day', async () => {
    const tick = tickingClock();
    const plan = await createPlan(db, newId, 'PPL', tick);
    const push = await addPlanDay(db, newId, plan, 'Push');
    const pull = await addPlanDay(db, newId, plan, 'Pull');
    await addPlanDayExercise(db, newId, push, 'Barbell Bench Press');
    await addPlanDayExercise(db, newId, pull, 'Barbell Row');

    const first = (await startSessionFromPlanDay(db, newId, push, tick)) as string;
    await finishSession(db, first, {}, tick);
    const second = (await startSessionFromPlanDay(db, newId, pull, tick)) as string;
    await finishSession(db, second, {}, tick);

    // Both trained; Push was longer ago, so it comes round again.
    expect((await getNextPlanDay(db, plan))?.name).toBe('Push');
  });

  it('returns null for a plan with no days', async () => {
    const plan = await createPlan(db, newId, 'Empty', clock);
    expect(await getNextPlanDay(db, plan)).toBeNull();
  });
});

describe('plan day status', () => {
  it('reports exercise counts and last-trained per day', async () => {
    const tick = tickingClock();
    const plan = await createPlan(db, newId, 'PPL', tick);
    const push = await addPlanDay(db, newId, plan, 'Push');
    await addPlanDay(db, newId, plan, 'Pull');
    await addPlanDayExercise(db, newId, push, 'Barbell Bench Press');
    await addPlanDayExercise(db, newId, push, 'Face Pull');

    const sessionId = (await startSessionFromPlanDay(db, newId, push, tick)) as string;
    await finishSession(db, sessionId, {}, tick);

    const status = await listPlanDayStatus(db, plan);
    expect(status.map((s) => s.name)).toEqual(['Push', 'Pull']);
    expect(status[0]?.exercise_count).toBe(2);
    expect(status[0]?.session_count).toBe(1);
    expect(status[0]?.last_trained_at).not.toBeNull();
    expect(status[1]?.exercise_count).toBe(0);
    expect(status[1]?.last_trained_at).toBeNull();
  });
});

describe('prescribed vs actual', () => {
  it('reports logged sets against the target', async () => {
    const plan = await createPlan(db, newId, 'PPL', clock);
    const day = await addPlanDay(db, newId, plan, 'Push');
    await addPlanDayExercise(db, newId, day, 'Barbell Bench Press', {
      targetSets: 3,
      targetRepsMin: 8,
      targetRepsMax: 12,
    });

    const sessionId = (await startSessionFromPlanDay(db, newId, day, clock)) as string;
    const { exercises } = await getSessionDetail(db, sessionId);
    const press = exercises[0]!;
    for (const [i, set] of press.sets.entries()) {
      await db.run(`UPDATE sets SET weight_kg = ?, reps = ? WHERE id = ?`, [80, 10 - i, set.id]);
    }

    const adherence = await getSessionAdherence(db, sessionId);
    expect(adherence).toHaveLength(1);
    expect(adherence[0]?.target_sets).toBe(3);
    expect(adherence[0]?.logged_sets).toBe(3);
    expect(adherence[0]?.best_weight_kg).toBe(80);
    expect(adherence[0]?.best_reps).toBe(10);
  });

  it('excludes warmups from the logged count', async () => {
    const plan = await createPlan(db, newId, 'PPL', clock);
    const day = await addPlanDay(db, newId, plan, 'Push');
    await addPlanDayExercise(db, newId, day, 'Barbell Bench Press', { targetSets: 2 });

    const sessionId = (await startSessionFromPlanDay(db, newId, day, clock)) as string;
    const { exercises } = await getSessionDetail(db, sessionId);
    await addSet(db, newId, exercises[0]!.id, { weightKg: 40, reps: 12, isWarmup: true }, clock);

    // Three rows exist, but a thorough warmup must not read as beating the prescription.
    const adherence = await getSessionAdherence(db, sessionId);
    expect(adherence[0]?.logged_sets).toBe(2);
  });

  it('includes ad-hoc exercises with null targets rather than hiding them', async () => {
    const plan = await createPlan(db, newId, 'PPL', clock);
    const day = await addPlanDay(db, newId, plan, 'Push');
    await addPlanDayExercise(db, newId, day, 'Barbell Bench Press', { targetSets: 2 });

    const sessionId = (await startSessionFromPlanDay(db, newId, day, clock)) as string;
    const { addExerciseToSession } = await import('./workouts.js');
    const extra = await addExerciseToSession(db, newId, sessionId, 'Cable Fly', clock);
    await addSet(db, newId, extra, { weightKg: 15, reps: 15 }, clock);

    const adherence = await getSessionAdherence(db, sessionId);
    const fly = adherence.find((a) => a.exercise_key === 'Cable Fly');
    // It was part of the workout; dropping it would misreport the session's volume.
    expect(fly).toBeDefined();
    expect(fly?.target_sets).toBeNull();
    expect(fly?.logged_sets).toBe(1);
  });

  it('is empty for a freestyle session with no plan day', async () => {
    const { startSession } = await import('./workouts.js');
    const sessionId = await startSession(db, newId, {}, clock);
    expect(await getSessionAdherence(db, sessionId)).toEqual([]);
  });
});

describe('plan detail', () => {
  it('returns days in order with their exercises', async () => {
    const plan = await createPlan(db, newId, 'PPL', clock);
    const push = await addPlanDay(db, newId, plan, 'Push');
    const pull = await addPlanDay(db, newId, plan, 'Pull');
    await addPlanDayExercise(db, newId, push, 'Barbell Bench Press');
    await addPlanDayExercise(db, newId, pull, 'Barbell Row');
    await addPlanDayExercise(db, newId, pull, 'Face Pull');

    const detail = await getPlanDetail(db, plan);
    expect(detail.plan?.name).toBe('PPL');
    expect(detail.days.map((d) => d.name)).toEqual(['Push', 'Pull']);
    expect(detail.days.map((d) => d.exercises.length)).toEqual([1, 2]);
  });

  it('returns a null plan for an unknown id', async () => {
    const detail = await getPlanDetail(db, 'no-such-plan');
    expect(detail.plan).toBeNull();
    expect(detail.days).toEqual([]);
  });
});
