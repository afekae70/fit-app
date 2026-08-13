/**
 * Training-plan repository — the intended programme, as opposed to the logged one.
 *
 * The split matters. `workouts.ts` records what happened; this module records what was supposed
 * to happen, and neither rewrites the other. That is what lets the plan screen say "you're
 * short a set on rows" instead of quietly redefining the target to match the miss.
 *
 * Written against `SqlExecutor` for the same reason as workouts.ts: the ordering logic runs
 * under vitest against a real SQLite engine rather than a mock.
 */

import type { SqlExecutor } from './executor.js';
import { addExerciseToSession, addSet, startSession, type Clock, type IdFactory } from './workouts.js';

export interface PlanRow {
  id: string;
  name: string;
  goal: string | null;
  days_per_week: number | null;
  length_weeks: number | null;
  is_active: number;
  created_at: string;
}

export interface PlanDayRow {
  id: string;
  plan_id: string;
  day_index: number;
  name: string | null;
}

export interface PlanDayExerciseRow {
  id: string;
  plan_day_id: string;
  exercise_key: string;
  order_index: number;
  target_sets: number | null;
  target_reps_min: number | null;
  target_reps_max: number | null;
  target_rpe: number | null;
  target_load_kg: number | null;
  rest_seconds: number | null;
  notes: string | null;
}

/** The prescription for one exercise. Every field optional — see the schema comment. */
export interface PlanTargets {
  targetSets?: number | null;
  targetRepsMin?: number | null;
  targetRepsMax?: number | null;
  targetRpe?: number | null;
  targetLoadKg?: number | null;
  restSeconds?: number | null;
  notes?: string | null;
}

const defaultClock: Clock = () => new Date().toISOString();

/**
 * What a new exercise gets when the user adds it without opening the target editor.
 *
 * 3 × 8–12 is the default because it is the range most hypertrophy programmes sit in, and
 * because a blank prescription makes the plan screen look broken on first use. The user
 * overrides it in two taps; nobody has to fill in a form to get a usable plan.
 *
 * Rest is deliberately absent here — it comes from the profile's `default_rest_seconds`, which
 * the caller passes in. Baking a number in would mean the setting silently failed to apply to
 * anything added afterwards.
 */
export const DEFAULT_PLAN_TARGETS: PlanTargets = {
  targetSets: 3,
  targetRepsMin: 8,
  targetRepsMax: 12,
};

/** Mirrors the enqueue helper in workouts.ts — every mutation is replayable to Supabase later. */
async function enqueue(
  db: SqlExecutor,
  entity: string,
  entityId: string,
  op: 'insert' | 'update' | 'delete',
  payload: unknown,
  clock: Clock,
): Promise<void> {
  await db.run(
    `INSERT INTO outbox (entity, entity_id, op, payload, created_at) VALUES (?, ?, ?, ?, ?)`,
    [entity, entityId, op, payload === undefined ? null : JSON.stringify(payload), clock()],
  );
}

/* -------------------------------------------------------------------------- */
/* Plans                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Create a plan and make it the active one.
 *
 * Activating on create is deliberate: a plan you just built and cannot see on the plan screen
 * reads as a bug, and there is no sensible reason to author a plan you do not intend to run.
 */
export async function createPlan(
  db: SqlExecutor,
  newId: IdFactory,
  input: {
    name: string;
    goal?: string | null;
    daysPerWeek?: number | null;
    lengthWeeks?: number | null;
  },
  clock: Clock = defaultClock,
): Promise<string> {
  const id = newId();
  const now = clock();
  await db.run(`UPDATE plans SET is_active = 0 WHERE is_active = 1`);
  await db.run(
    `INSERT INTO plans (id, name, goal, days_per_week, length_weeks, is_active, created_at)
     VALUES (?, ?, ?, ?, ?, 1, ?)`,
    [id, input.name, input.goal ?? null, input.daysPerWeek ?? null, input.lengthWeeks ?? null, now],
  );
  await enqueue(db, 'plan', id, 'insert', { ...input, isActive: true }, clock);
  return id;
}

export async function getActivePlan(db: SqlExecutor): Promise<PlanRow | null> {
  return db.get<PlanRow>(
    `SELECT * FROM plans WHERE is_active = 1 ORDER BY created_at DESC LIMIT 1`,
  );
}

export async function listPlans(db: SqlExecutor): Promise<PlanRow[]> {
  return db.all<PlanRow>(`SELECT * FROM plans ORDER BY is_active DESC, created_at DESC`);
}

/** Switch the active plan. Deactivating first keeps the "at most one active" rule true. */
export async function setActivePlan(
  db: SqlExecutor,
  planId: string,
  clock: Clock = defaultClock,
): Promise<void> {
  await db.run(`UPDATE plans SET is_active = 0 WHERE is_active = 1`);
  await db.run(`UPDATE plans SET is_active = 1 WHERE id = ?`, [planId]);
  await enqueue(db, 'plan', planId, 'update', { isActive: true }, clock);
}

export async function updatePlan(
  db: SqlExecutor,
  planId: string,
  input: {
    name?: string;
    goal?: string | null;
    daysPerWeek?: number | null;
    lengthWeeks?: number | null;
  },
  clock: Clock = defaultClock,
): Promise<void> {
  const assignments: string[] = [];
  const params: unknown[] = [];

  // Same partial-update discipline as updateSet: only touch what was supplied, so renaming a
  // plan cannot blank the goal that is already set on it.
  if (input.name !== undefined) {
    assignments.push('name = ?');
    params.push(input.name);
  }
  if (input.goal !== undefined) {
    assignments.push('goal = ?');
    params.push(input.goal);
  }
  if (input.daysPerWeek !== undefined) {
    assignments.push('days_per_week = ?');
    params.push(input.daysPerWeek);
  }
  if (input.lengthWeeks !== undefined) {
    assignments.push('length_weeks = ?');
    params.push(input.lengthWeeks);
  }
  if (assignments.length === 0) return;

  params.push(planId);
  await db.run(`UPDATE plans SET ${assignments.join(', ')} WHERE id = ?`, params);
  await enqueue(db, 'plan', planId, 'update', input, clock);
}

export async function deletePlan(
  db: SqlExecutor,
  planId: string,
  clock: Clock = defaultClock,
): Promise<void> {
  // Days and their exercises go via ON DELETE CASCADE. Sessions already run from this plan keep
  // their plan_day_id pointing at rows that no longer exist — accepted, because the alternative
  // is either deleting training history or blocking the delete, and both are worse than a
  // dangling reference on a column nothing joins against.
  await db.run(`DELETE FROM plans WHERE id = ?`, [planId]);
  await enqueue(db, 'plan', planId, 'delete', undefined, clock);
}

/* -------------------------------------------------------------------------- */
/* Days                                                                        */
/* -------------------------------------------------------------------------- */

export async function addPlanDay(
  db: SqlExecutor,
  newId: IdFactory,
  planId: string,
  name: string | null = null,
  clock: Clock = defaultClock,
): Promise<string> {
  const row = await db.get<{ next: number }>(
    `SELECT COALESCE(MAX(day_index), 0) + 1 AS next FROM plan_days WHERE plan_id = ?`,
    [planId],
  );
  const dayIndex = row?.next ?? 1;

  const id = newId();
  await db.run(`INSERT INTO plan_days (id, plan_id, day_index, name) VALUES (?, ?, ?, ?)`, [
    id,
    planId,
    dayIndex,
    name,
  ]);
  await enqueue(db, 'plan_day', id, 'insert', { planId, dayIndex, name }, clock);
  return id;
}

export async function renamePlanDay(
  db: SqlExecutor,
  planDayId: string,
  name: string | null,
  clock: Clock = defaultClock,
): Promise<void> {
  const trimmed = name?.trim() ?? '';
  const value = trimmed === '' ? null : trimmed;
  await db.run(`UPDATE plan_days SET name = ? WHERE id = ?`, [value, planDayId]);
  await enqueue(db, 'plan_day', planDayId, 'update', { name: value }, clock);
}

export async function removePlanDay(
  db: SqlExecutor,
  planDayId: string,
  clock: Clock = defaultClock,
): Promise<void> {
  const row = await db.get<{ plan_id: string }>(`SELECT plan_id FROM plan_days WHERE id = ?`, [
    planDayId,
  ]);
  await db.run(`DELETE FROM plan_days WHERE id = ?`, [planDayId]);
  if (row) await renumberPlanDays(db, row.plan_id);
  await enqueue(db, 'plan_day', planDayId, 'delete', undefined, clock);
}

/**
 * Reassign contiguous 1..n day indices.
 *
 * Two-phase for the same reason as the set renumbering in workouts.ts: `(plan_id, day_index)`
 * is UNIQUE, so writing 3→2 while another row still holds 2 collides. Parking every row at a
 * high offset first means no intermediate state ever duplicates an index.
 */
export async function renumberPlanDays(db: SqlExecutor, planId: string): Promise<void> {
  const remaining = await db.all<{ id: string }>(
    `SELECT id FROM plan_days WHERE plan_id = ? ORDER BY day_index`,
    [planId],
  );
  if (remaining.length === 0) return;

  const OFFSET = 100000;
  await db.run(`UPDATE plan_days SET day_index = day_index + ? WHERE plan_id = ?`, [
    OFFSET,
    planId,
  ]);
  for (const [i, r] of remaining.entries()) {
    await db.run(`UPDATE plan_days SET day_index = ? WHERE id = ?`, [i + 1, r.id]);
  }
}

/* -------------------------------------------------------------------------- */
/* Exercises within a day                                                      */
/* -------------------------------------------------------------------------- */

export async function addExerciseToPlanDay(
  db: SqlExecutor,
  newId: IdFactory,
  planDayId: string,
  exerciseKey: string,
  targets: PlanTargets = DEFAULT_PLAN_TARGETS,
  clock: Clock = defaultClock,
): Promise<string> {
  const row = await db.get<{ next: number }>(
    `SELECT COALESCE(MAX(order_index), 0) + 1 AS next FROM plan_day_exercises WHERE plan_day_id = ?`,
    [planDayId],
  );
  const orderIndex = row?.next ?? 1;

  const id = newId();
  await db.run(
    `INSERT INTO plan_day_exercises
       (id, plan_day_id, exercise_key, order_index, target_sets, target_reps_min,
        target_reps_max, target_rpe, target_load_kg, rest_seconds, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      planDayId,
      exerciseKey,
      orderIndex,
      targets.targetSets ?? null,
      targets.targetRepsMin ?? null,
      targets.targetRepsMax ?? null,
      targets.targetRpe ?? null,
      targets.targetLoadKg ?? null,
      targets.restSeconds ?? null,
      targets.notes ?? null,
    ],
  );
  await enqueue(db, 'plan_day_exercise', id, 'insert', { planDayId, exerciseKey, orderIndex, ...targets }, clock);
  return id;
}

export async function updatePlanTargets(
  db: SqlExecutor,
  planDayExerciseId: string,
  targets: PlanTargets,
  clock: Clock = defaultClock,
): Promise<void> {
  const assignments: string[] = [];
  const params: unknown[] = [];

  if (targets.targetSets !== undefined) {
    assignments.push('target_sets = ?');
    params.push(targets.targetSets);
  }
  if (targets.targetRepsMin !== undefined) {
    assignments.push('target_reps_min = ?');
    params.push(targets.targetRepsMin);
  }
  if (targets.targetRepsMax !== undefined) {
    assignments.push('target_reps_max = ?');
    params.push(targets.targetRepsMax);
  }
  if (targets.targetRpe !== undefined) {
    assignments.push('target_rpe = ?');
    params.push(targets.targetRpe);
  }
  if (targets.targetLoadKg !== undefined) {
    assignments.push('target_load_kg = ?');
    params.push(targets.targetLoadKg);
  }
  if (targets.restSeconds !== undefined) {
    assignments.push('rest_seconds = ?');
    params.push(targets.restSeconds);
  }
  if (targets.notes !== undefined) {
    assignments.push('notes = ?');
    params.push(targets.notes);
  }
  if (assignments.length === 0) return;

  params.push(planDayExerciseId);
  await db.run(
    `UPDATE plan_day_exercises SET ${assignments.join(', ')} WHERE id = ?`,
    params,
  );
  await enqueue(db, 'plan_day_exercise', planDayExerciseId, 'update', targets, clock);
}

export async function removePlanDayExercise(
  db: SqlExecutor,
  planDayExerciseId: string,
  clock: Clock = defaultClock,
): Promise<void> {
  const row = await db.get<{ plan_day_id: string }>(
    `SELECT plan_day_id FROM plan_day_exercises WHERE id = ?`,
    [planDayExerciseId],
  );
  await db.run(`DELETE FROM plan_day_exercises WHERE id = ?`, [planDayExerciseId]);
  if (row) await renumberPlanDayExercises(db, row.plan_day_id);
  await enqueue(db, 'plan_day_exercise', planDayExerciseId, 'delete', undefined, clock);
}

/**
 * Move one exercise up or down within its day.
 *
 * Order is not cosmetic in a training plan — squats before leg extensions is the difference
 * between a session that works and one that does not — so reordering is a first-class edit
 * rather than something the user achieves by deleting and re-adding.
 */
export async function movePlanDayExercise(
  db: SqlExecutor,
  planDayExerciseId: string,
  direction: 'up' | 'down',
  clock: Clock = defaultClock,
): Promise<void> {
  const current = await db.get<{ plan_day_id: string; order_index: number }>(
    `SELECT plan_day_id, order_index FROM plan_day_exercises WHERE id = ?`,
    [planDayExerciseId],
  );
  if (!current) return;

  const neighbour = await db.get<{ id: string; order_index: number }>(
    direction === 'up'
      ? `SELECT id, order_index FROM plan_day_exercises
           WHERE plan_day_id = ? AND order_index < ?
           ORDER BY order_index DESC LIMIT 1`
      : `SELECT id, order_index FROM plan_day_exercises
           WHERE plan_day_id = ? AND order_index > ?
           ORDER BY order_index ASC LIMIT 1`,
    [current.plan_day_id, current.order_index],
  );
  // Already at the end it is being moved towards.
  if (!neighbour) return;

  // Three-step swap: the UNIQUE (plan_day_id, order_index) constraint rejects the direct
  // exchange, so one row parks at a value nothing else can hold first.
  const PARK = -1;
  await db.run(`UPDATE plan_day_exercises SET order_index = ? WHERE id = ?`, [
    PARK,
    planDayExerciseId,
  ]);
  await db.run(`UPDATE plan_day_exercises SET order_index = ? WHERE id = ?`, [
    current.order_index,
    neighbour.id,
  ]);
  await db.run(`UPDATE plan_day_exercises SET order_index = ? WHERE id = ?`, [
    neighbour.order_index,
    planDayExerciseId,
  ]);

  // Both rows moved, so both need replaying — enqueueing only the dragged one would leave the
  // server with two exercises claiming the same position.
  await enqueue(
    db,
    'plan_day_exercise',
    planDayExerciseId,
    'update',
    { orderIndex: neighbour.order_index },
    clock,
  );
  await enqueue(
    db,
    'plan_day_exercise',
    neighbour.id,
    'update',
    { orderIndex: current.order_index },
    clock,
  );
}

/** Same two-phase approach as the day renumbering above. */
export async function renumberPlanDayExercises(
  db: SqlExecutor,
  planDayId: string,
): Promise<void> {
  const remaining = await db.all<{ id: string }>(
    `SELECT id FROM plan_day_exercises WHERE plan_day_id = ? ORDER BY order_index`,
    [planDayId],
  );
  if (remaining.length === 0) return;

  const OFFSET = 100000;
  await db.run(
    `UPDATE plan_day_exercises SET order_index = order_index + ? WHERE plan_day_id = ?`,
    [OFFSET, planDayId],
  );
  for (const [i, r] of remaining.entries()) {
    await db.run(`UPDATE plan_day_exercises SET order_index = ? WHERE id = ?`, [i + 1, r.id]);
  }
}

/* -------------------------------------------------------------------------- */
/* Aggregate reads                                                             */
/* -------------------------------------------------------------------------- */

export interface PlanDayWithExercises extends PlanDayRow {
  exercises: PlanDayExerciseRow[];
}

export interface PlanDetail {
  plan: PlanRow | null;
  days: PlanDayWithExercises[];
}

/** A whole plan, ready to render: days in rotation order, each with its exercises in order. */
export async function getPlanDetail(db: SqlExecutor, planId: string): Promise<PlanDetail> {
  const plan = await db.get<PlanRow>(`SELECT * FROM plans WHERE id = ?`, [planId]);
  if (!plan) return { plan: null, days: [] };

  const days = await db.all<PlanDayRow>(
    `SELECT * FROM plan_days WHERE plan_id = ? ORDER BY day_index`,
    [planId],
  );

  const withExercises: PlanDayWithExercises[] = [];
  for (const day of days) {
    withExercises.push({
      ...day,
      exercises: await db.all<PlanDayExerciseRow>(
        `SELECT * FROM plan_day_exercises WHERE plan_day_id = ? ORDER BY order_index`,
        [day.id],
      ),
    });
  }
  return { plan, days: withExercises };
}

/** The active plan with its days and exercises, or a null plan when none exists yet. */
export async function getActivePlanDetail(db: SqlExecutor): Promise<PlanDetail> {
  const plan = await getActivePlan(db);
  if (!plan) return { plan: null, days: [] };
  return getPlanDetail(db, plan.id);
}

/**
 * When each plan day was last trained, keyed by plan_day_id.
 *
 * Drives the "3 days ago" line on each day card, which is the single most useful thing the
 * screen can tell you: which day comes next is a question about what you did last, not about
 * what the plan says.
 */
export async function lastTrainedByPlanDay(
  db: SqlExecutor,
  planId: string,
): Promise<Record<string, string>> {
  const rows = await db.all<{ plan_day_id: string; last_started: string }>(
    `SELECT pd.id AS plan_day_id, MAX(ws.started_at) AS last_started
       FROM plan_days pd
       JOIN workout_sessions ws ON ws.plan_day_id = pd.id
      WHERE pd.plan_id = ?
      GROUP BY pd.id`,
    [planId],
  );

  const out: Record<string, string> = {};
  for (const row of rows) {
    if (row.last_started) out[row.plan_day_id] = row.last_started;
  }
  return out;
}

/**
 * Prescribed rest for each exercise in a plan day, keyed by exercise_key.
 *
 * Keyed by exercise rather than by plan_day_exercise id because the live session does not
 * carry a link back to the individual planned row — `workout_sessions.plan_day_id` points at
 * the day, and the exercises inside it are matched by catalogue key. That is enough: the same
 * exercise appearing twice in one day with two different rest times is not a thing anyone
 * programmes, and the UNIQUE constraint on order_index does not forbid it only because
 * forbidding it would be more machinery than the case deserves.
 */
export async function restSecondsByExerciseKey(
  db: SqlExecutor,
  planDayId: string,
): Promise<Record<string, number>> {
  const rows = await db.all<{ exercise_key: string; rest_seconds: number | null }>(
    `SELECT exercise_key, rest_seconds FROM plan_day_exercises
      WHERE plan_day_id = ? AND rest_seconds IS NOT NULL
      ORDER BY order_index`,
    [planDayId],
  );

  const out: Record<string, number> = {};
  for (const row of rows) {
    if (row.rest_seconds !== null) out[row.exercise_key] = row.rest_seconds;
  }
  return out;
}

/**
 * How long to rest after a set: the plan's prescription for that exercise, else the profile
 * default, else no timer at all.
 *
 * Pure so the precedence is testable — it is the one place the "a plan exercise overrides the
 * default" promise in settings is actually kept.
 */
export function resolveRestSeconds(
  plannedSeconds: number | null | undefined,
  profileDefaultSeconds: number | null,
): number | null {
  const resolved = plannedSeconds ?? profileDefaultSeconds;
  // Zero or negative is the same as unset — a countdown that ends before it starts would
  // flash on screen and mean nothing.
  return resolved !== null && resolved > 0 ? resolved : null;
}

/**
 * The most recent working set logged for an exercise — what to pre-fill when starting from
 * the plan.
 *
 * Most recent rather than heaviest (which is what `getPreviousBest` in workouts.ts returns):
 * the number you want in the field is the one you last actually lifted, not a personal record
 * from four months ago that you would then have to correct downwards every single set.
 */
export async function lastLoggedSet(
  db: SqlExecutor,
  exerciseKey: string,
): Promise<{ weight_kg: number | null; reps: number | null } | null> {
  return db.get<{ weight_kg: number | null; reps: number | null }>(
    `SELECT s.weight_kg, s.reps
       FROM sets s
       JOIN session_exercises se ON se.id = s.session_exercise_id
       JOIN workout_sessions ws  ON ws.id = se.session_id
      WHERE se.exercise_key = ?
        AND s.is_warmup = 0
      ORDER BY ws.started_at DESC, s.set_index DESC
      LIMIT 1`,
    [exerciseKey],
  );
}

/* -------------------------------------------------------------------------- */
/* Plan → session                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Start a workout from a plan day: the exercises are already there, the weights are already
 * filled in, and the session records which day it came from.
 *
 * `target_sets` blank sets are created up front rather than one at a time, because the plan
 * already says how many there should be — and an exercise showing 0/4 sets is what makes a
 * missed set visible instead of merely absent.
 *
 * Weight and reps are pre-filled from the last time the exercise was actually logged, never
 * from the plan's rep target. Writing the target into a set would mean the app inventing a
 * performance the user has not yet given it, which is the one thing the logging layer is
 * careful never to do.
 */
export async function startSessionFromPlanDay(
  db: SqlExecutor,
  newId: IdFactory,
  planDayId: string,
  clock: Clock = defaultClock,
): Promise<string | null> {
  const day = await db.get<PlanDayRow>(`SELECT * FROM plan_days WHERE id = ?`, [planDayId]);
  if (!day) return null;

  const exercises = await db.all<PlanDayExerciseRow>(
    `SELECT * FROM plan_day_exercises WHERE plan_day_id = ? ORDER BY order_index`,
    [planDayId],
  );

  const sessionId = await startSession(db, newId, { planDayId }, clock);
  if (day.name) {
    await db.run(`UPDATE workout_sessions SET name = ? WHERE id = ?`, [day.name, sessionId]);
  }

  for (const planned of exercises) {
    const sessionExerciseId = await addExerciseToSession(
      db,
      newId,
      sessionId,
      planned.exercise_key,
      clock,
    );

    const previous = await lastLoggedSet(db, planned.exercise_key);
    // At least one set even when the plan gives no count — an exercise with no set rows cannot
    // be logged against without an extra tap, which defeats the point of starting from a plan.
    const setCount = Math.max(1, planned.target_sets ?? 1);
    for (let i = 0; i < setCount; i += 1) {
      await addSet(
        db,
        newId,
        sessionExerciseId,
        {
          weightKg: planned.target_load_kg ?? previous?.weight_kg ?? null,
          reps: previous?.reps ?? null,
        },
        clock,
      );
    }
  }

  return sessionId;
}
