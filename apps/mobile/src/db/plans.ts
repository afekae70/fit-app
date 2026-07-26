/**
 * Weekly training plans: the programme you intend to follow, kept separate from the log of
 * what you actually did.
 *
 * The separation is the whole point. `plan_day_exercises.target_sets` is a prescription; the
 * `sets` rows a session produces are a record. Storing them apart means the app can show both
 * — "3×8-10 prescribed, you did 3×9 at 82.5kg" — instead of one silently overwriting the
 * other, and it keeps the promise made by the session schema: set counts stay dynamic even
 * when a plan suggests a number.
 *
 * Starting a session from a plan day materialises the prescription into blank sets and records
 * `workout_sessions.plan_day_id`, which is what later makes prescribed-vs-actual adherence a
 * query rather than guesswork.
 */

import type { SqlExecutor } from './executor.js';
import { addExerciseToSession, addSet, startSession, type Clock, type IdFactory } from './workouts.js';

const defaultClock: Clock = () => new Date().toISOString();

/* -------------------------------------------------------------------------- */
/* Row types                                                                   */
/* -------------------------------------------------------------------------- */

export interface PlanRow {
  id: string;
  name: string;
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
  notes: string | null;
}

export interface PlanDayWithExercises extends PlanDayRow {
  exercises: PlanDayExerciseRow[];
}

/* -------------------------------------------------------------------------- */
/* Plans                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Create a plan. The first plan created becomes active automatically — a plan nobody activated
 * is invisible everywhere else in the app, which reads as the feature being broken.
 */
export async function createPlan(
  db: SqlExecutor,
  newId: IdFactory,
  name: string,
  clock: Clock = defaultClock,
): Promise<string> {
  const id = newId();
  const existing = await db.get<{ count: number }>(`SELECT COUNT(*) AS count FROM plans`);
  const isFirst = (existing?.count ?? 0) === 0;

  await db.run(`INSERT INTO plans (id, name, is_active, created_at) VALUES (?, ?, ?, ?)`, [
    id,
    name.trim(),
    isFirst ? 1 : 0,
    clock(),
  ]);
  return id;
}

/**
 * Make one plan the active one, clearing the flag from every other.
 *
 * Both statements are needed and their order matters: clearing first and setting second means a
 * failure between them leaves no active plan (recoverable — the user picks one again) rather
 * than two (ambiguous, and every "today's workout" query would have to guess).
 */
export async function activatePlan(db: SqlExecutor, planId: string): Promise<void> {
  await db.run(`UPDATE plans SET is_active = 0 WHERE is_active = 1`);
  await db.run(`UPDATE plans SET is_active = 1 WHERE id = ?`, [planId]);
}

export async function getActivePlan(db: SqlExecutor): Promise<PlanRow | null> {
  return db.get<PlanRow>(`SELECT * FROM plans WHERE is_active = 1 LIMIT 1`);
}

export async function listPlans(db: SqlExecutor): Promise<PlanRow[]> {
  return db.all<PlanRow>(`SELECT * FROM plans ORDER BY is_active DESC, created_at DESC`);
}

export async function renamePlan(db: SqlExecutor, planId: string, name: string): Promise<void> {
  await db.run(`UPDATE plans SET name = ? WHERE id = ?`, [name.trim(), planId]);
}

/**
 * Delete a plan and everything under it.
 *
 * Sessions started from its days survive: they are history, and deleting a programme must not
 * erase the training you did while following it. `workout_sessions.plan_day_id` is deliberately
 * not a foreign key for exactly this reason — it becomes a dangling reference, which is the
 * correct outcome.
 */
export async function deletePlan(db: SqlExecutor, planId: string): Promise<void> {
  await db.run(`DELETE FROM plans WHERE id = ?`, [planId]);

  // Promote another plan so the user is never left with plans but no active one.
  const active = await getActivePlan(db);
  if (!active) {
    const next = await db.get<{ id: string }>(
      `SELECT id FROM plans ORDER BY created_at DESC LIMIT 1`,
    );
    if (next) await activatePlan(db, next.id);
  }
}

/* -------------------------------------------------------------------------- */
/* Days                                                                        */
/* -------------------------------------------------------------------------- */

/** Append a day to the end of the week. */
export async function addPlanDay(
  db: SqlExecutor,
  newId: IdFactory,
  planId: string,
  name: string | null = null,
): Promise<string> {
  const row = await db.get<{ next: number }>(
    `SELECT COALESCE(MAX(day_index), 0) + 1 AS next FROM plan_days WHERE plan_id = ?`,
    [planId],
  );
  const id = newId();
  await db.run(`INSERT INTO plan_days (id, plan_id, day_index, name) VALUES (?, ?, ?, ?)`, [
    id,
    planId,
    row?.next ?? 1,
    name?.trim() || null,
  ]);
  return id;
}

export async function renamePlanDay(
  db: SqlExecutor,
  planDayId: string,
  name: string,
): Promise<void> {
  await db.run(`UPDATE plan_days SET name = ? WHERE id = ?`, [name.trim() || null, planDayId]);
}

/**
 * Remove a day and close the gap in `day_index`.
 *
 * Renumbering runs in two passes for the same reason set deletion does: `UNIQUE (plan_id,
 * day_index)` is checked per row, so shifting 3→2 while a 2 still exists fails. Parking the
 * survivors at a high offset first sidesteps the collision, since SQLite has no deferrable
 * constraints.
 */
export async function removePlanDay(db: SqlExecutor, planDayId: string): Promise<void> {
  const day = await db.get<PlanDayRow>(`SELECT * FROM plan_days WHERE id = ?`, [planDayId]);
  if (!day) return;

  await db.run(`DELETE FROM plan_days WHERE id = ?`, [planDayId]);

  const remaining = await db.all<{ id: string }>(
    `SELECT id FROM plan_days WHERE plan_id = ? ORDER BY day_index`,
    [day.plan_id],
  );

  const PARK = 100000;
  for (const [offset, row] of remaining.entries()) {
    await db.run(`UPDATE plan_days SET day_index = ? WHERE id = ?`, [PARK + offset, row.id]);
  }
  for (const [offset, row] of remaining.entries()) {
    await db.run(`UPDATE plan_days SET day_index = ? WHERE id = ?`, [offset + 1, row.id]);
  }
}

export async function listPlanDays(db: SqlExecutor, planId: string): Promise<PlanDayRow[]> {
  return db.all<PlanDayRow>(`SELECT * FROM plan_days WHERE plan_id = ? ORDER BY day_index`, [
    planId,
  ]);
}

/** A whole plan in one call — days in order, each with its prescribed exercises. */
export async function getPlanDetail(
  db: SqlExecutor,
  planId: string,
): Promise<{ plan: PlanRow | null; days: PlanDayWithExercises[] }> {
  const plan = await db.get<PlanRow>(`SELECT * FROM plans WHERE id = ?`, [planId]);
  if (!plan) return { plan: null, days: [] };

  const days = await listPlanDays(db, planId);
  const withExercises: PlanDayWithExercises[] = [];
  for (const day of days) {
    withExercises.push({ ...day, exercises: await listPlanDayExercises(db, day.id) });
  }
  return { plan, days: withExercises };
}

export async function getPlanDay(
  db: SqlExecutor,
  planDayId: string,
): Promise<PlanDayWithExercises | null> {
  const day = await db.get<PlanDayRow>(`SELECT * FROM plan_days WHERE id = ?`, [planDayId]);
  if (!day) return null;
  return { ...day, exercises: await listPlanDayExercises(db, planDayId) };
}

/* -------------------------------------------------------------------------- */
/* Prescribed exercises                                                        */
/* -------------------------------------------------------------------------- */

export interface PrescriptionInput {
  targetSets?: number | null;
  targetRepsMin?: number | null;
  targetRepsMax?: number | null;
  notes?: string | null;
}

export async function addPlanDayExercise(
  db: SqlExecutor,
  newId: IdFactory,
  planDayId: string,
  exerciseKey: string,
  input: PrescriptionInput = {},
): Promise<string> {
  const row = await db.get<{ next: number }>(
    `SELECT COALESCE(MAX(order_index), 0) + 1 AS next FROM plan_day_exercises WHERE plan_day_id = ?`,
    [planDayId],
  );
  const id = newId();
  await db.run(
    `INSERT INTO plan_day_exercises
       (id, plan_day_id, exercise_key, order_index, target_sets, target_reps_min,
        target_reps_max, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      planDayId,
      exerciseKey,
      row?.next ?? 1,
      // Three sets of 8-12 is the default, being the most common hypertrophy prescription.
      //
      // `in` rather than `??` because an explicit null means "no target" and must survive: with
      // `??` a caller asking for an untargeted exercise would silently get 3x8-12 instead, and
      // the plan would then prescribe something nobody wrote.
      'targetSets' in input ? input.targetSets : 3,
      'targetRepsMin' in input ? input.targetRepsMin : 8,
      'targetRepsMax' in input ? input.targetRepsMax : 12,
      input.notes ?? null,
    ],
  );
  return id;
}

export async function updatePlanDayExercise(
  db: SqlExecutor,
  id: string,
  input: PrescriptionInput,
): Promise<void> {
  const sets: string[] = [];
  const params: unknown[] = [];

  const assign = (column: string, value: unknown) => {
    sets.push(`${column} = ?`);
    params.push(value);
  };

  // Only columns actually present in the patch are touched, so clearing reps does not also
  // wipe the set count.
  if ('targetSets' in input) assign('target_sets', input.targetSets ?? null);
  if ('targetRepsMin' in input) assign('target_reps_min', input.targetRepsMin ?? null);
  if ('targetRepsMax' in input) assign('target_reps_max', input.targetRepsMax ?? null);
  if ('notes' in input) assign('notes', input.notes ?? null);
  if (sets.length === 0) return;

  params.push(id);
  await db.run(`UPDATE plan_day_exercises SET ${sets.join(', ')} WHERE id = ?`, params);
}

/** Remove a prescribed exercise, closing the gap in `order_index` (see removePlanDay). */
export async function removePlanDayExercise(db: SqlExecutor, id: string): Promise<void> {
  const row = await db.get<PlanDayExerciseRow>(
    `SELECT * FROM plan_day_exercises WHERE id = ?`,
    [id],
  );
  if (!row) return;

  await db.run(`DELETE FROM plan_day_exercises WHERE id = ?`, [id]);

  const remaining = await db.all<{ id: string }>(
    `SELECT id FROM plan_day_exercises WHERE plan_day_id = ? ORDER BY order_index`,
    [row.plan_day_id],
  );

  const PARK = 100000;
  for (const [offset, entry] of remaining.entries()) {
    await db.run(`UPDATE plan_day_exercises SET order_index = ? WHERE id = ?`, [
      PARK + offset,
      entry.id,
    ]);
  }
  for (const [offset, entry] of remaining.entries()) {
    await db.run(`UPDATE plan_day_exercises SET order_index = ? WHERE id = ?`, [
      offset + 1,
      entry.id,
    ]);
  }
}

export async function listPlanDayExercises(
  db: SqlExecutor,
  planDayId: string,
): Promise<PlanDayExerciseRow[]> {
  return db.all<PlanDayExerciseRow>(
    `SELECT * FROM plan_day_exercises WHERE plan_day_id = ? ORDER BY order_index`,
    [planDayId],
  );
}

/* -------------------------------------------------------------------------- */
/* Starting a session from a plan day                                          */
/* -------------------------------------------------------------------------- */

/**
 * Materialise a plan day into a new, open session.
 *
 * Creates the prescribed exercises in order and `target_sets` blank set rows under each, so the
 * session opens ready to type into. The values are blank for the same reason repeating a
 * workout leaves them blank: a target is what you are aiming at, not a record of what you
 * lifted, and pre-filling it would put numbers in the log that never happened.
 *
 * The session records `plan_day_id`, which is what makes adherence — prescribed sets vs. sets
 * actually logged — answerable later.
 */
export async function startSessionFromPlanDay(
  db: SqlExecutor,
  newId: IdFactory,
  planDayId: string,
  clock: Clock = defaultClock,
): Promise<string | null> {
  const day = await getPlanDay(db, planDayId);
  if (!day) return null;

  const sessionId = await startSession(db, newId, { planDayId }, clock);
  if (day.name) {
    await db.run(`UPDATE workout_sessions SET name = ? WHERE id = ?`, [day.name, sessionId]);
  }

  for (const prescription of day.exercises) {
    const exerciseId = await addExerciseToSession(
      db,
      newId,
      sessionId,
      prescription.exercise_key,
      clock,
    );

    // At least one set even when the prescription says none, since an exercise with no rows
    // gives the user nothing to type into and reads as a bug.
    const count = Math.max(1, prescription.target_sets ?? 1);
    for (let i = 0; i < count; i += 1) {
      await addSet(db, newId, exerciseId, {}, clock);
    }
  }

  return sessionId;
}

/**
 * Which plan day to train next: the one least recently trained, ties broken by day order.
 *
 * Deliberately not "today's weekday". A four-day split does not align with a seven-day week,
 * and a missed Tuesday should not mean skipping that day's work — it should mean it is now the
 * one most overdue. `NULL` sorts first here, so a day never trained is always suggested before
 * any day that has been.
 */
export async function getNextPlanDay(
  db: SqlExecutor,
  planId: string,
): Promise<(PlanDayRow & { last_trained_at: string | null }) | null> {
  return db.get<PlanDayRow & { last_trained_at: string | null }>(
    `SELECT pd.id, pd.plan_id, pd.day_index, pd.name,
            (SELECT MAX(ws.started_at) FROM workout_sessions ws
              WHERE ws.plan_day_id = pd.id) AS last_trained_at
       FROM plan_days pd
      WHERE pd.plan_id = ?
      ORDER BY last_trained_at IS NOT NULL, last_trained_at ASC, pd.day_index ASC
      LIMIT 1`,
    [planId],
  );
}

/** Every day of a plan with when it was last trained — the weekly overview. */
export async function listPlanDayStatus(
  db: SqlExecutor,
  planId: string,
): Promise<
  {
    id: string;
    day_index: number;
    name: string | null;
    exercise_count: number;
    last_trained_at: string | null;
    session_count: number;
  }[]
> {
  return db.all(
    `SELECT pd.id, pd.day_index, pd.name,
            (SELECT COUNT(*) FROM plan_day_exercises pde
              WHERE pde.plan_day_id = pd.id) AS exercise_count,
            (SELECT MAX(ws.started_at) FROM workout_sessions ws
              WHERE ws.plan_day_id = pd.id) AS last_trained_at,
            (SELECT COUNT(*) FROM workout_sessions ws
              WHERE ws.plan_day_id = pd.id AND ws.ended_at IS NOT NULL) AS session_count
       FROM plan_days pd
      WHERE pd.plan_id = ?
      ORDER BY pd.day_index`,
    [planId],
  );
}

/* -------------------------------------------------------------------------- */
/* Prescribed vs actual                                                        */
/* -------------------------------------------------------------------------- */

export interface AdherenceRow {
  exercise_key: string;
  target_sets: number | null;
  target_reps_min: number | null;
  target_reps_max: number | null;
  logged_sets: number;
  best_weight_kg: number | null;
  best_reps: number | null;
}

/**
 * How a session compared against the day it was started from.
 *
 * Warmups are excluded from `logged_sets` so a thorough warmup does not read as having exceeded
 * the prescription. Exercises added ad hoc mid-session appear with null targets rather than
 * being dropped — they were part of the workout, and hiding them would misreport the volume.
 */
export async function getSessionAdherence(
  db: SqlExecutor,
  sessionId: string,
): Promise<AdherenceRow[]> {
  return db.all<AdherenceRow>(
    `SELECT se.exercise_key,
            pde.target_sets,
            pde.target_reps_min,
            pde.target_reps_max,
            COUNT(CASE WHEN s.is_warmup = 0 THEN 1 END) AS logged_sets,
            MAX(CASE WHEN s.is_warmup = 0 THEN s.weight_kg END) AS best_weight_kg,
            MAX(CASE WHEN s.is_warmup = 0 THEN s.reps END)      AS best_reps
       FROM session_exercises se
       JOIN workout_sessions ws ON ws.id = se.session_id
       LEFT JOIN sets s ON s.session_exercise_id = se.id
       LEFT JOIN plan_day_exercises pde
              ON pde.plan_day_id = ws.plan_day_id
             AND pde.exercise_key = se.exercise_key
      WHERE se.session_id = ?
      GROUP BY se.id, se.exercise_key, pde.target_sets, pde.target_reps_min, pde.target_reps_max
      ORDER BY se.order_index`,
    [sessionId],
  );
}
