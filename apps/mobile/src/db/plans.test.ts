/**
 * Weekly plan tests. Real SQL against real SQLite, as elsewhere.
 *
 * The load-bearing assertions here are the ones proving a plan is a *prescription*: a session
 * started from a day can diverge from its targets freely, and the plan is never rewritten to
 * match what was actually lifted.
 */

import { beforeEach, describe, expect, it } from 'vitest';

import type { SqlExecutor } from './executor.js';
import {
  activatePlan,
  addPlanDay,
  addPlanDayExercise,
  createPlan,
  deletePlan,
  duplicatePlanWeek,
  getActivePlan,
  getNextPlanDay,
  getPlanDay,
  getPlanDetail,
  getSessionAdherence,
  listPlanDayExercises,
  listPlanDayStatus,
  listPlanDays,
  listPlans,
  removePlanDay,
  removePlanDayExercise,
  reorderPlanDay,
  reorderPlanDayExercise,
  setPlanDayTiming,
  startSessionFromPlanDay,
  timingOf,
  updatePlanDayExercise,
} from './plans.js';
import { createTestExecutor } from './testUtils.js';
import { addSet, finishSession, getSessionDetail, removeSet } from './workouts.js';

const USER = 'user-1';

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
    const id = await createPlan(db, USER, newId, 'Hypertrophy Block 1', clock);
    const active = await getActivePlan(db, USER);
    expect(active?.id).toBe(id);
    expect(active?.name).toBe('Hypertrophy Block 1');
  });

  it('does not steal activation from an existing plan', async () => {
    const first = await createPlan(db, USER, newId, 'Block 1', clock);
    await createPlan(db, USER, newId, 'Block 2', clock);

    // Creating a second plan must not silently switch the programme mid-week.
    expect((await getActivePlan(db, USER))?.id).toBe(first);
  });

  it('keeps exactly one plan active when switching', async () => {
    await createPlan(db, USER, newId, 'Block 1', clock);
    const second = await createPlan(db, USER, newId, 'Block 2', clock);
    await activatePlan(db, USER, second);

    const plans = await listPlans(db, USER);
    expect(plans.filter((p) => p.is_active === 1)).toHaveLength(1);
    expect((await getActivePlan(db, USER))?.id).toBe(second);
  });

  it('promotes another plan when the active one is deleted', async () => {
    const first = await createPlan(db, USER, newId, 'Block 1', clock);
    const second = await createPlan(db, USER, newId, 'Block 2', clock);
    await activatePlan(db, USER, second);
    await deletePlan(db, USER, second);

    // Leaving the user with plans but no active one would make the plan tab look empty.
    expect((await getActivePlan(db, USER))?.id).toBe(first);
  });

  it('auto-activates a second user\'s first plan even though the first user already has one', async () => {
    // Unscoped, this would see USER's existing plan and conclude it isn't the first plan for
    // 'user-2' either, leaving 'user-2' with a plan tab that looks empty.
    await createPlan(db, USER, newId, 'Block 1', clock);
    const secondUsersPlan = await createPlan(db, 'user-2', newId, 'Their First Plan', clock);

    expect((await getActivePlan(db, 'user-2'))?.id).toBe(secondUsersPlan);
  });

  it('never lets activating one user\'s plan deactivate another user\'s active plan', async () => {
    const usersPlan = await createPlan(db, USER, newId, 'Block 1', clock);
    const otherUsersPlan = await createPlan(db, 'user-2', newId, 'Their Plan', clock);

    await activatePlan(db, 'user-2', otherUsersPlan);

    expect((await getActivePlan(db, USER))?.id).toBe(usersPlan);
    expect((await getActivePlan(db, 'user-2'))?.id).toBe(otherUsersPlan);
  });

  it('promotes only this user\'s own plan, never another user\'s, when the active one is deleted', async () => {
    const first = await createPlan(db, USER, newId, 'Block 1', clock);
    const second = await createPlan(db, USER, newId, 'Block 2', clock);
    await activatePlan(db, USER, second);
    await createPlan(db, 'user-2', newId, 'Their Only Plan', clock);

    await deletePlan(db, USER, second);

    expect((await getActivePlan(db, USER))?.id).toBe(first);
  });

  it('trims the name', async () => {
    await createPlan(db, USER, newId, '   Push Pull Legs   ', clock);
    expect((await getActivePlan(db, USER))?.name).toBe('Push Pull Legs');
  });
});

describe('plan days', () => {
  it('numbers days from 1 in creation order', async () => {
    const plan = await createPlan(db, USER, newId, 'PPL', clock);
    await addPlanDay(db, newId, plan, 'Push');
    await addPlanDay(db, newId, plan, 'Pull');
    await addPlanDay(db, newId, plan, 'Legs');

    const days = await listPlanDays(db, plan);
    expect(days.map((d) => d.day_index)).toEqual([1, 2, 3]);
    expect(days.map((d) => d.name)).toEqual(['Push', 'Pull', 'Legs']);
  });

  it('closes the gap in day_index when a middle day is removed', async () => {
    const plan = await createPlan(db, USER, newId, 'PPL', clock);
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
    const plan = await createPlan(db, USER, newId, 'PPL', clock);
    const day = await addPlanDay(db, newId, plan, 'Push');
    await addPlanDayExercise(db, newId, day, 'Barbell Bench Press');

    await deletePlan(db, USER, plan);

    // Gone from every read path: the cascade is manual now, because ON DELETE CASCADE only
    // fires for a real DELETE and a soft-deleted plan would otherwise strand its children.
    expect(await getPlanDay(db, day)).toBeNull();
    expect(await getPlanDetail(db, plan)).toEqual({ plan: null, days: [] });
    expect(await listPlanDays(db, plan)).toHaveLength(0);
    expect(await listPlanDayExercises(db, day)).toHaveLength(0);
    expect(await listPlans(db, USER)).toHaveLength(0);
  });

  it('leaves tombstones so the deletion can reach another device', async () => {
    const plan = await createPlan(db, USER, newId, 'PPL', clock);
    const day = await addPlanDay(db, newId, plan, 'Push');
    await addPlanDayExercise(db, newId, day, 'Barbell Bench Press');

    await deletePlan(db, USER, plan);

    // Still on disk and marked. A row that simply vanished would be invisible to the next sync,
    // and the server would hand it back on the following pull.
    for (const table of ['plans', 'plan_days', 'plan_day_exercises']) {
      const rows = await db.all<{ deleted_at: string | null }>(
        `SELECT deleted_at FROM ${table}`,
      );
      expect(rows, table).toHaveLength(1);
      expect(rows[0]?.deleted_at, table).not.toBeNull();
    }
  });

  it('does not resurrect a deleted plan as the promoted active one', async () => {
    const first = await createPlan(db, USER, newId, 'PPL', clock);
    const second = await createPlan(db, USER, newId, 'Upper/Lower', clock);

    await deletePlan(db, USER, second);
    await deletePlan(db, USER, first);

    // Both are gone, so there is nothing left to promote — the deleted rows must not be
    // eligible, or deleting every plan would silently reactivate one of them.
    expect(await getActivePlan(db, USER)).toBeNull();
    expect(await listPlans(db, USER)).toHaveLength(0);
  });
});

describe('prescriptions', () => {
  it('defaults to 3 sets of 8-12', async () => {
    const plan = await createPlan(db, USER, newId, 'PPL', clock);
    const day = await addPlanDay(db, newId, plan, 'Push');
    await addPlanDayExercise(db, newId, day, 'Barbell Bench Press');

    const detail = await getPlanDay(db, day);
    expect(detail?.exercises[0]?.target_sets).toBe(3);
    expect(detail?.exercises[0]?.target_reps_min).toBe(8);
    expect(detail?.exercises[0]?.target_reps_max).toBe(12);
  });

  it('patches only the fields supplied', async () => {
    const plan = await createPlan(db, USER, newId, 'PPL', clock);
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
    const plan = await createPlan(db, USER, newId, 'PPL', clock);
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

describe('reordering exercises within a day', () => {
  async function seedDay() {
    const plan = await createPlan(db, USER, newId, 'PPL', clock);
    const day = await addPlanDay(db, newId, plan, 'Push');
    const a = await addPlanDayExercise(db, newId, day, 'Barbell Bench Press');
    const b = await addPlanDayExercise(db, newId, day, 'Overhead Press');
    const c = await addPlanDayExercise(db, newId, day, 'Cable Fly');
    return { day, a, b, c };
  }

  const order = async (day: string) =>
    (await listPlanDayExercises(db, day)).map((e) => e.exercise_key);

  it('moves an exercise from last to the middle', async () => {
    const { day, c } = await seedDay();
    // The reported case: it landed last and belongs third — here, second of three.
    await reorderPlanDayExercise(db, day, c, 1);

    expect(await order(day)).toEqual(['Barbell Bench Press', 'Cable Fly', 'Overhead Press']);
  });

  it('moves an exercise up to the front', async () => {
    const { day, c } = await seedDay();
    await reorderPlanDayExercise(db, day, c, 0);
    expect(await order(day)).toEqual(['Cable Fly', 'Barbell Bench Press', 'Overhead Press']);
  });

  it('leaves order_index contiguous from 1', async () => {
    // The UNIQUE constraint is what makes the two-phase park necessary; this is the assertion
    // that would fail if a single-pass rewrite were ever substituted.
    const { day, a } = await seedDay();
    await reorderPlanDayExercise(db, day, a, 2);

    const rows = await listPlanDayExercises(db, day);
    expect(rows.map((r) => r.order_index)).toEqual([1, 2, 3]);
  });

  it('no-ops at either end rather than throwing', async () => {
    const { day, a, c } = await seedDay();
    const before = await order(day);

    await reorderPlanDayExercise(db, day, a, -1);
    await reorderPlanDayExercise(db, day, c, 99);

    expect(await order(day)).toEqual(before);
  });

  it('ignores an exercise that is not in the day', async () => {
    const { day } = await seedDay();
    const before = await order(day);
    await reorderPlanDayExercise(db, day, 'not-here', 0);
    expect(await order(day)).toEqual(before);
  });
});

describe('starting a session from a plan day', () => {
  async function buildDay() {
    const plan = await createPlan(db, USER, newId, 'PPL', clock);
    const day = await addPlanDay(db, newId, plan, 'Push');
    await addPlanDayExercise(db, newId, day, 'Barbell Bench Press', { targetSets: 4 });
    await addPlanDayExercise(db, newId, day, 'Face Pull', { targetSets: 2 });
    return { plan, day };
  }

  it('creates the prescribed exercises with the prescribed number of blank sets', async () => {
    const { day } = await buildDay();
    const sessionId = (await startSessionFromPlanDay(db, USER, newId, day, clock)) as string;

    const { exercises } = await getSessionDetail(db, sessionId);
    expect(exercises.map((e) => e.exercise_key)).toEqual(['Barbell Bench Press', 'Face Pull']);
    // 4 and 2 — the dynamic-set requirement, now driven by the plan.
    expect(exercises.map((e) => e.sets.length)).toEqual([4, 2]);
    expect(exercises[0]?.sets.every((s) => s.weight_kg === null && s.reps === null)).toBe(true);
  });

  it('records plan_day_id and inherits the day name', async () => {
    const { day } = await buildDay();
    const sessionId = (await startSessionFromPlanDay(db, USER, newId, day, clock)) as string;

    const { session } = await getSessionDetail(db, sessionId);
    expect(session?.plan_day_id).toBe(day);
    expect(session?.name).toBe('Push');
  });

  it('still creates one set when the prescription says none', async () => {
    const plan = await createPlan(db, USER, newId, 'PPL', clock);
    const day = await addPlanDay(db, newId, plan, 'Push');
    await addPlanDayExercise(db, newId, day, 'Plank', { targetSets: null });

    const sessionId = (await startSessionFromPlanDay(db, USER, newId, day, clock)) as string;
    const { exercises } = await getSessionDetail(db, sessionId);
    // An exercise with zero rows gives the user nothing to type into.
    expect(exercises[0]?.sets).toHaveLength(1);
  });

  it('returns null for an unknown day instead of an empty session', async () => {
    expect(await startSessionFromPlanDay(db, USER, newId, 'no-such-day', clock)).toBeNull();
  });

  it('lets the session diverge from the plan without changing the plan', async () => {
    const { day } = await buildDay();
    const sessionId = (await startSessionFromPlanDay(db, USER, newId, day, clock)) as string;

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
    const plan = await createPlan(db, USER, newId, 'PPL', tick);
    const push = await addPlanDay(db, newId, plan, 'Push');
    await addPlanDay(db, newId, plan, 'Pull');
    await addPlanDayExercise(db, newId, push, 'Barbell Bench Press');

    const sessionId = (await startSessionFromPlanDay(db, USER, newId, push, tick)) as string;
    await finishSession(db, USER, sessionId, {}, tick);

    const next = await getNextPlanDay(db, USER, plan);
    expect(next?.name).toBe('Pull');
  });

  it('cycles back to the least recently trained day', async () => {
    const tick = tickingClock();
    const plan = await createPlan(db, USER, newId, 'PPL', tick);
    const push = await addPlanDay(db, newId, plan, 'Push');
    const pull = await addPlanDay(db, newId, plan, 'Pull');
    await addPlanDayExercise(db, newId, push, 'Barbell Bench Press');
    await addPlanDayExercise(db, newId, pull, 'Barbell Row');

    const first = (await startSessionFromPlanDay(db, USER, newId, push, tick)) as string;
    await finishSession(db, USER, first, {}, tick);
    const second = (await startSessionFromPlanDay(db, USER, newId, pull, tick)) as string;
    await finishSession(db, USER, second, {}, tick);

    // Both trained; Push was longer ago, so it comes round again.
    expect((await getNextPlanDay(db, USER, plan))?.name).toBe('Push');
  });

  it('returns null for a plan with no days', async () => {
    const plan = await createPlan(db, USER, newId, 'Empty', clock);
    expect(await getNextPlanDay(db, USER, plan)).toBeNull();
  });
});

describe('plan day status', () => {
  it('reports exercise counts and last-trained per day', async () => {
    const tick = tickingClock();
    const plan = await createPlan(db, USER, newId, 'PPL', tick);
    const push = await addPlanDay(db, newId, plan, 'Push');
    await addPlanDay(db, newId, plan, 'Pull');
    await addPlanDayExercise(db, newId, push, 'Barbell Bench Press');
    await addPlanDayExercise(db, newId, push, 'Face Pull');

    const sessionId = (await startSessionFromPlanDay(db, USER, newId, push, tick)) as string;
    await finishSession(db, USER, sessionId, {}, tick);

    const status = await listPlanDayStatus(db, USER, plan);
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
    const plan = await createPlan(db, USER, newId, 'PPL', clock);
    const day = await addPlanDay(db, newId, plan, 'Push');
    await addPlanDayExercise(db, newId, day, 'Barbell Bench Press', {
      targetSets: 3,
      targetRepsMin: 8,
      targetRepsMax: 12,
    });

    const sessionId = (await startSessionFromPlanDay(db, USER, newId, day, clock)) as string;
    const { exercises } = await getSessionDetail(db, sessionId);
    const press = exercises[0]!;
    for (const [i, set] of press.sets.entries()) {
      await db.run(`UPDATE sets SET weight_kg = ?, reps = ? WHERE id = ?`, [80, 10 - i, set.id]);
    }

    const adherence = await getSessionAdherence(db, USER, sessionId);
    expect(adherence).toHaveLength(1);
    expect(adherence[0]?.target_sets).toBe(3);
    expect(adherence[0]?.logged_sets).toBe(3);
    expect(adherence[0]?.best_weight_kg).toBe(80);
    expect(adherence[0]?.best_reps).toBe(10);
  });

  it('excludes warmups from the logged count', async () => {
    const plan = await createPlan(db, USER, newId, 'PPL', clock);
    const day = await addPlanDay(db, newId, plan, 'Push');
    await addPlanDayExercise(db, newId, day, 'Barbell Bench Press', { targetSets: 2 });

    const sessionId = (await startSessionFromPlanDay(db, USER, newId, day, clock)) as string;
    const { exercises } = await getSessionDetail(db, sessionId);
    await addSet(db, newId, exercises[0]!.id, { weightKg: 40, reps: 12, isWarmup: true }, clock);

    // Three rows exist, but a thorough warmup must not read as beating the prescription.
    const adherence = await getSessionAdherence(db, USER, sessionId);
    expect(adherence[0]?.logged_sets).toBe(2);
  });

  it('includes ad-hoc exercises with null targets rather than hiding them', async () => {
    const plan = await createPlan(db, USER, newId, 'PPL', clock);
    const day = await addPlanDay(db, newId, plan, 'Push');
    await addPlanDayExercise(db, newId, day, 'Barbell Bench Press', { targetSets: 2 });

    const sessionId = (await startSessionFromPlanDay(db, USER, newId, day, clock)) as string;
    const { addExerciseToSession } = await import('./workouts.js');
    const extra = await addExerciseToSession(db, newId, sessionId, 'Cable Fly', clock);
    await addSet(db, newId, extra, { weightKg: 15, reps: 15 }, clock);

    const adherence = await getSessionAdherence(db, USER, sessionId);
    const fly = adherence.find((a) => a.exercise_key === 'Cable Fly');
    // It was part of the workout; dropping it would misreport the session's volume.
    expect(fly).toBeDefined();
    expect(fly?.target_sets).toBeNull();
    expect(fly?.logged_sets).toBe(1);
  });

  it('is empty for a freestyle session with no plan day', async () => {
    const { startSession } = await import('./workouts.js');
    const sessionId = await startSession(db, USER, newId, {}, clock);
    expect(await getSessionAdherence(db, USER, sessionId)).toEqual([]);
  });
});

describe('plan detail', () => {
  it('returns days in order with their exercises', async () => {
    const plan = await createPlan(db, USER, newId, 'PPL', clock);
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

describe('reorderPlanDay', () => {
  it('moves a day later and closes the gap behind it', async () => {
    const plan = await createPlan(db, USER, newId, 'PPL', clock);
    const push = await addPlanDay(db, newId, plan, 'Push');
    await addPlanDay(db, newId, plan, 'Pull');
    await addPlanDay(db, newId, plan, 'Legs');

    await reorderPlanDay(db, plan, push, 2);

    const days = await listPlanDays(db, plan);
    expect(days.map((d) => d.name)).toEqual(['Pull', 'Legs', 'Push']);
    // UNIQUE (plan_id, day_index) would have rejected any intermediate collision.
    expect(days.map((d) => d.day_index)).toEqual([1, 2, 3]);
  });

  it('moves a day earlier', async () => {
    const plan = await createPlan(db, USER, newId, 'PPL', clock);
    await addPlanDay(db, newId, plan, 'Push');
    await addPlanDay(db, newId, plan, 'Pull');
    const legs = await addPlanDay(db, newId, plan, 'Legs');

    await reorderPlanDay(db, plan, legs, 0);

    expect((await listPlanDays(db, plan)).map((d) => d.name)).toEqual(['Legs', 'Push', 'Pull']);
  });

  it('clamps a target past the end instead of leaving a hole', async () => {
    const plan = await createPlan(db, USER, newId, 'PPL', clock);
    const push = await addPlanDay(db, newId, plan, 'Push');
    await addPlanDay(db, newId, plan, 'Pull');

    await reorderPlanDay(db, plan, push, 99);

    const days = await listPlanDays(db, plan);
    expect(days.map((d) => d.name)).toEqual(['Pull', 'Push']);
    expect(days.map((d) => d.day_index)).toEqual([1, 2]);
  });

  it('is a no-op when the day is already there', async () => {
    const plan = await createPlan(db, USER, newId, 'PPL', clock);
    const push = await addPlanDay(db, newId, plan, 'Push');
    await addPlanDay(db, newId, plan, 'Pull');

    await reorderPlanDay(db, plan, push, 0);

    expect((await listPlanDays(db, plan)).map((d) => d.name)).toEqual(['Push', 'Pull']);
  });

  it('ignores a day that is not in this plan', async () => {
    const plan = await createPlan(db, USER, newId, 'PPL', clock);
    await addPlanDay(db, newId, plan, 'Push');

    await expect(reorderPlanDay(db, plan, 'not-a-day', 0)).resolves.toBeUndefined();
    expect((await listPlanDays(db, plan)).map((d) => d.name)).toEqual(['Push']);
  });
});

describe('duplicatePlanWeek', () => {
  it('appends a copy of every day after the originals', async () => {
    const plan = await createPlan(db, USER, newId, 'PPL', clock);
    await addPlanDay(db, newId, plan, 'Push');
    await addPlanDay(db, newId, plan, 'Pull');

    const copied = await duplicatePlanWeek(db, newId, plan);

    expect(copied).toBe(2);
    const days = await listPlanDays(db, plan);
    expect(days.map((d) => d.name)).toEqual(['Push', 'Pull', 'Push', 'Pull']);
    expect(days.map((d) => d.day_index)).toEqual([1, 2, 3, 4]);
  });

  it('copies each day\'s prescriptions too', async () => {
    const plan = await createPlan(db, USER, newId, 'PPL', clock);
    const push = await addPlanDay(db, newId, plan, 'Push');
    await addPlanDayExercise(db, newId, push, 'Barbell Bench Press', { targetSets: 4 });

    await duplicatePlanWeek(db, newId, plan);

    const days = await listPlanDays(db, plan);
    const copy = days[1];
    const exercises = await listPlanDayExercises(db, copy?.id ?? '');
    expect(exercises.map((e) => e.exercise_key)).toEqual(['Barbell Bench Press']);
    expect(exercises[0]?.target_sets).toBe(4);
  });

  it('gives the copies new ids so editing one does not edit the other', async () => {
    const plan = await createPlan(db, USER, newId, 'PPL', clock);
    const push = await addPlanDay(db, newId, plan, 'Push');
    await addPlanDayExercise(db, newId, push, 'Barbell Bench Press');

    await duplicatePlanWeek(db, newId, plan);

    const days = await listPlanDays(db, plan);
    expect(days[0]?.id).not.toBe(days[1]?.id);

    // Reusing ids would make the copy and the original the same row to the sync engine.
    const original = await listPlanDayExercises(db, days[0]?.id ?? '');
    const copy = await listPlanDayExercises(db, days[1]?.id ?? '');
    expect(original[0]?.id).not.toBe(copy[0]?.id);
  });

  it('does nothing for an empty plan', async () => {
    const plan = await createPlan(db, USER, newId, 'PPL', clock);
    expect(await duplicatePlanWeek(db, newId, plan)).toBe(0);
    expect(await listPlanDays(db, plan)).toHaveLength(0);
  });

  it('does not copy a deleted day', async () => {
    const plan = await createPlan(db, USER, newId, 'PPL', clock);
    await addPlanDay(db, newId, plan, 'Push');
    const gone = await addPlanDay(db, newId, plan, 'Pull');
    await removePlanDay(db, gone);

    await duplicatePlanWeek(db, newId, plan);

    expect((await listPlanDays(db, plan)).map((d) => d.name)).toEqual(['Push', 'Push']);
  });
});

describe('timed workouts', () => {
  it('is an ordinary workout until timing is set', async () => {
    const plan = await createPlan(db, USER, newId, 'Core', clock);
    const abs = await addPlanDay(db, newId, plan, 'Abs');
    const day = await getPlanDay(db, abs);
    expect(timingOf(day!)).toBeNull();
  });

  it('stores work and rest, and reads them back', async () => {
    const plan = await createPlan(db, USER, newId, 'Core', clock);
    const abs = await addPlanDay(db, newId, plan, 'Abs');

    await setPlanDayTiming(db, abs, { workSeconds: 50, restSeconds: 10 }, clock);

    expect(timingOf((await getPlanDay(db, abs))!)).toEqual({ workSeconds: 50, restSeconds: 10 });
  });

  it('turns back into an ordinary workout, clearing both values', async () => {
    const plan = await createPlan(db, USER, newId, 'Core', clock);
    const abs = await addPlanDay(db, newId, plan, 'Abs');
    await setPlanDayTiming(db, abs, { workSeconds: 50, restSeconds: 10 }, clock);

    await setPlanDayTiming(db, abs, null, clock);

    const day = await getPlanDay(db, abs);
    expect(timingOf(day!)).toBeNull();
    expect(day?.rest_seconds).toBeNull();
  });

  it('keeps a rest of zero as zero rather than as no timing', async () => {
    const plan = await createPlan(db, USER, newId, 'Core', clock);
    const abs = await addPlanDay(db, newId, plan, 'Abs');
    await setPlanDayTiming(db, abs, { workSeconds: 30, restSeconds: 0 }, clock);
    expect(timingOf((await getPlanDay(db, abs))!)).toEqual({ workSeconds: 30, restSeconds: 0 });
  });

  it('only touches the day it was given', async () => {
    const plan = await createPlan(db, USER, newId, 'Split', clock);
    const abs = await addPlanDay(db, newId, plan, 'Abs');
    const legs = await addPlanDay(db, newId, plan, 'Legs');
    await setPlanDayTiming(db, abs, { workSeconds: 50, restSeconds: 10 }, clock);
    expect(timingOf((await getPlanDay(db, legs))!)).toBeNull();
  });

  it('survives duplicating the week', async () => {
    const plan = await createPlan(db, USER, newId, 'Core', clock);
    const abs = await addPlanDay(db, newId, plan, 'Abs');
    await setPlanDayTiming(db, abs, { workSeconds: 45, restSeconds: 15 }, clock);

    await duplicatePlanWeek(db, newId, plan);

    const days = await listPlanDays(db, plan);
    expect(days.map((d) => timingOf(d))).toEqual([
      { workSeconds: 45, restSeconds: 15 },
      { workSeconds: 45, restSeconds: 15 },
    ]);
  });
});

describe('what the plan screen shows for each day', () => {
  it('lists the exercises in order, and the timing when the day is timed', async () => {
    const plan = await createPlan(db, USER, newId, 'Split', clock);
    const push = await addPlanDay(db, newId, plan, 'Push');
    await addPlanDayExercise(db, newId, push, 'Barbell Bench Press', { targetSets: 4 });
    await addPlanDayExercise(db, newId, push, 'Overhead Press', { targetSets: 3 });
    const abs = await addPlanDay(db, newId, plan, 'Abs');
    await addPlanDayExercise(db, newId, abs, 'Plank');
    await setPlanDayTiming(db, abs, { workSeconds: 50, restSeconds: 10 }, clock);

    const [pushStatusRow, absStatusRow] = await listPlanDayStatus(db, USER, plan);

    expect(pushStatusRow?.exercise_keys?.split('')).toEqual([
      'Barbell Bench Press',
      'Overhead Press',
    ]);
    expect([pushStatusRow?.work_seconds, pushStatusRow?.rest_seconds]).toEqual([null, null]);
    expect(absStatusRow?.exercise_keys).toBe('Plank');
    expect([absStatusRow?.work_seconds, absStatusRow?.rest_seconds]).toEqual([50, 10]);
  });

  it('leaves the exercises empty for a day with none', async () => {
    const plan = await createPlan(db, USER, newId, 'Split', clock);
    await addPlanDay(db, newId, plan, 'Empty');
    const [row] = await listPlanDayStatus(db, USER, plan);
    expect(row?.exercise_keys).toBeNull();
    expect(row?.exercise_count).toBe(0);
  });

  it('drops an exercise that was removed from the day', async () => {
    const plan = await createPlan(db, USER, newId, 'Split', clock);
    const day = await addPlanDay(db, newId, plan, 'Push');
    const first = await addPlanDayExercise(db, newId, day, 'Barbell Bench Press');
    await addPlanDayExercise(db, newId, day, 'Overhead Press');
    await removePlanDayExercise(db, first);

    const [row] = await listPlanDayStatus(db, USER, plan);
    expect(row?.exercise_keys).toBe('Overhead Press');
  });
});
