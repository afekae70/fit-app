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
  user_id: string;
  name: string;
  is_active: number;
  created_at: string;
}

export interface PlanDayRow {
  id: string;
  plan_id: string;
  day_index: number;
  name: string | null;
  /** Set only for a timed workout; null for an ordinary sets-and-reps day. */
  work_seconds?: number | null;
  rest_seconds?: number | null;
  /** How many times through the list. Null means once. */
  rounds?: number | null;
}

/** How a timed workout runs. Null on the day means it is not one. */
export interface PlanDayTiming {
  workSeconds: number;
  restSeconds: number;
  /** Times through the whole list of exercises, at least 1. */
  rounds: number;
}

/** A day's timing, or null when it is an ordinary workout. */
export function timingOf(
  day: Pick<PlanDayRow, 'work_seconds' | 'rest_seconds' | 'rounds'>,
): PlanDayTiming | null {
  if (day.work_seconds === null || day.work_seconds === undefined || day.work_seconds <= 0) return null;
  return {
    workSeconds: day.work_seconds,
    restSeconds: Math.max(0, day.rest_seconds ?? 0),
    rounds: Math.max(1, day.rounds ?? 1),
  };
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
  userId: string,
  newId: IdFactory,
  name: string,
  clock: Clock = defaultClock,
): Promise<string> {
  const id = newId();
  // Scoped by user_id: without it, a second person's first plan would see the first person's
  // plans already in the table and never auto-activate.
  const existing = await db.get<{ count: number }>(
    `SELECT COUNT(*) AS count FROM plans WHERE user_id = ? AND deleted_at IS NULL`,
    [userId],
  );
  const isFirst = (existing?.count ?? 0) === 0;

  const now = clock();
  await db.run(
    `INSERT INTO plans (id, user_id, name, is_active, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [id, userId, name.trim(), isFirst ? 1 : 0, now, now],
  );
  return id;
}

/**
 * Make one plan the active one, clearing the flag from every other.
 *
 * Both statements are needed and their order matters: clearing first and setting second means a
 * failure between them leaves no active plan (recoverable — the user picks one again) rather
 * than two (ambiguous, and every "today's workout" query would have to guess).
 */
export async function activatePlan(
  db: SqlExecutor,
  userId: string,
  planId: string,
  clock: Clock = defaultClock,
): Promise<void> {
  // Both steps scoped by user_id: without it, activating user B's plan would deactivate
  // user A's active plan too — a real cross-user bug, not just a missing filter.
  const now = clock();
  await db.run(
    `UPDATE plans SET is_active = 0, updated_at = ? WHERE is_active = 1 AND user_id = ?`,
    [now, userId],
  );
  await db.run(`UPDATE plans SET is_active = 1, updated_at = ? WHERE id = ? AND user_id = ?`, [
    now,
    planId,
    userId,
  ]);
}

export async function getActivePlan(db: SqlExecutor, userId: string): Promise<PlanRow | null> {
  return db.get<PlanRow>(
    `SELECT * FROM plans WHERE user_id = ? AND is_active = 1 AND deleted_at IS NULL LIMIT 1`,
    [userId],
  );
}

export async function listPlans(db: SqlExecutor, userId: string): Promise<PlanRow[]> {
  return db.all<PlanRow>(
    `SELECT * FROM plans WHERE user_id = ? AND deleted_at IS NULL
      ORDER BY is_active DESC, created_at DESC`,
    [userId],
  );
}

export async function renamePlan(
  db: SqlExecutor,
  userId: string,
  planId: string,
  name: string,
  clock: Clock = defaultClock,
): Promise<void> {
  await db.run(`UPDATE plans SET name = ?, updated_at = ? WHERE id = ? AND user_id = ?`, [
    name.trim(),
    clock(),
    planId,
    userId,
  ]);
}

/**
 * Delete a plan and everything under it.
 *
 * Sessions started from its days survive: they are history, and deleting a programme must not
 * erase the training you did while following it. `workout_sessions.plan_day_id` is deliberately
 * not a foreign key for exactly this reason — it becomes a dangling reference, which is the
 * correct outcome.
 */
export async function deletePlan(
  db: SqlExecutor,
  userId: string,
  planId: string,
  clock: Clock = defaultClock,
): Promise<void> {
  // Manual cascade — ON DELETE CASCADE fires only for a real DELETE, so soft-deleting the plan
  // alone would leave its days and prescriptions live and syncing as orphans. Indexes move to
  // -rowid so the freed slots cannot collide with the surviving rows' renumbering.
  const at = clock();
  await db.run(
    `UPDATE plan_day_exercises SET deleted_at = ?, updated_at = ?, order_index = -rowid
      WHERE deleted_at IS NULL AND plan_day_id IN (SELECT id FROM plan_days WHERE plan_id = ?)`,
    [at, at, planId],
  );
  await db.run(
    `UPDATE plan_days SET deleted_at = ?, updated_at = ?, day_index = -rowid
      WHERE deleted_at IS NULL AND plan_id = ?`,
    [at, at, planId],
  );
  await db.run(
    `UPDATE plans SET deleted_at = ?, updated_at = ?, is_active = 0 WHERE id = ? AND user_id = ?`,
    [at, at, planId, userId],
  );

  // Promote another plan so the user is never left with plans but no active one. Scoped by
  // user_id: unscoped, this user could get no promotion at all (or, without activatePlan's own
  // scoping, activate a different user's plan).
  const active = await getActivePlan(db, userId);
  if (!active) {
    const next = await db.get<{ id: string }>(
      `SELECT id FROM plans WHERE user_id = ? AND deleted_at IS NULL
        ORDER BY created_at DESC LIMIT 1`,
      [userId],
    );
    if (next) await activatePlan(db, userId, next.id, clock);
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
  clock: Clock = defaultClock,
): Promise<string> {
  const row = await db.get<{ next: number }>(
    `SELECT COALESCE(MAX(day_index), 0) + 1 AS next FROM plan_days
      WHERE plan_id = ? AND deleted_at IS NULL`,
    [planId],
  );
  const id = newId();
  await db.run(
    `INSERT INTO plan_days (id, plan_id, day_index, name, updated_at) VALUES (?, ?, ?, ?, ?)`,
    [id, planId, row?.next ?? 1, name?.trim() || null, clock()],
  );
  return id;
}

export async function renamePlanDay(
  db: SqlExecutor,
  planDayId: string,
  name: string,
  clock: Clock = defaultClock,
): Promise<void> {
  await db.run(`UPDATE plan_days SET name = ?, updated_at = ? WHERE id = ?`, [
    name.trim() || null,
    clock(),
    planDayId,
  ]);
}

/**
 * Make a day a timed workout, change its timing, or turn it back into an ordinary one.
 *
 * Both columns are written together, and cleared together. A day with work time but no rest
 * would still run; a day with rest time but no work would be a timed workout of nothing, and
 * writing them as a pair means that state cannot exist.
 */
export async function setPlanDayTiming(
  db: SqlExecutor,
  planDayId: string,
  timing: PlanDayTiming | null,
  clock: Clock = defaultClock,
): Promise<void> {
  await db.run(
    `UPDATE plan_days SET work_seconds = ?, rest_seconds = ?, rounds = ?, updated_at = ? WHERE id = ?`,
    [
      timing?.workSeconds ?? null,
      timing ? Math.max(0, timing.restSeconds) : null,
      timing ? Math.max(1, Math.floor(timing.rounds)) : null,
      clock(),
      planDayId,
    ],
  );
}

/**
 * Remove a day and close the gap in `day_index`.
 *
 * Renumbering runs in two passes for the same reason set deletion does: `UNIQUE (plan_id,
 * day_index)` is checked per row, so shifting 3→2 while a 2 still exists fails. Parking the
 * survivors at a high offset first sidesteps the collision, since SQLite has no deferrable
 * constraints.
 */
export async function removePlanDay(
  db: SqlExecutor,
  planDayId: string,
  clock: Clock = defaultClock,
): Promise<void> {
  const day = await db.get<PlanDayRow>(
    `SELECT * FROM plan_days WHERE id = ? AND deleted_at IS NULL`,
    [planDayId],
  );
  if (!day) return;

  const at = clock();
  // Prescriptions first, for the same reason sets go before their exercise: they must not stay
  // live under a deleted parent and sync as orphans.
  await db.run(
    `UPDATE plan_day_exercises SET deleted_at = ?, updated_at = ?, order_index = -rowid
      WHERE deleted_at IS NULL AND plan_day_id = ?`,
    [at, at, planDayId],
  );
  await db.run(
    `UPDATE plan_days SET deleted_at = ?, updated_at = ?, day_index = -rowid WHERE id = ?`,
    [at, at, planDayId],
  );

  await closeDayGaps(db, day.plan_id);
}

/** Renumber a plan's live days 1..N in their current order, in two passes — see removePlanDay. */
async function closeDayGaps(db: SqlExecutor, planId: string): Promise<void> {
  const remaining = await db.all<{ id: string }>(
    `SELECT id FROM plan_days WHERE plan_id = ? AND deleted_at IS NULL ORDER BY day_index`,
    [planId],
  );

  const PARK = 100000;
  for (const [offset, row] of remaining.entries()) {
    await db.run(`UPDATE plan_days SET day_index = ? WHERE id = ?`, [PARK + offset, row.id]);
  }
  for (const [offset, row] of remaining.entries()) {
    await db.run(`UPDATE plan_days SET day_index = ? WHERE id = ?`, [offset + 1, row.id]);
  }
}

/**
 * Move a workout into another plan, at the end of it.
 *
 * The same row moves rather than a copy being made, so everything pointing at it comes along:
 * the calendar days it is scheduled on, and the sessions trained from it.
 */
export async function movePlanDayToPlan(
  db: SqlExecutor,
  planDayId: string,
  targetPlanId: string,
  clock: Clock = defaultClock,
): Promise<void> {
  const day = await db.get<PlanDayRow>(
    `SELECT * FROM plan_days WHERE id = ? AND deleted_at IS NULL`,
    [planDayId],
  );
  if (!day || day.plan_id === targetPlanId) return;
  const row = await db.get<{ next: number }>(
    `SELECT COALESCE(MAX(day_index), 0) + 1 AS next FROM plan_days
      WHERE plan_id = ? AND deleted_at IS NULL`,
    [targetPlanId],
  );
  await db.run(`UPDATE plan_days SET plan_id = ?, day_index = ?, updated_at = ? WHERE id = ?`, [
    targetPlanId,
    row?.next ?? 1,
    clock(),
    planDayId,
  ]);
  await closeDayGaps(db, day.plan_id);
}

/**
 * Copy a workout — its name, timing and every exercise with its targets — to the end of a plan.
 * The copy is its own workout from then on: editing one leaves the other alone.
 */
export async function copyPlanDayToPlan(
  db: SqlExecutor,
  newId: IdFactory,
  planDayId: string,
  targetPlanId: string,
  clock: Clock = defaultClock,
): Promise<string | null> {
  const day = await db.get<PlanDayRow>(
    `SELECT * FROM plan_days WHERE id = ? AND deleted_at IS NULL`,
    [planDayId],
  );
  if (!day) return null;
  const at = clock();
  const copyId = await addPlanDay(db, newId, targetPlanId, day.name, () => at);
  await setPlanDayTiming(
    db,
    copyId,
    timingOf(day),
    () => at,
  );
  const prescriptions = await db.all<PlanDayExerciseRow>(
    `SELECT * FROM plan_day_exercises WHERE plan_day_id = ? AND deleted_at IS NULL
      ORDER BY order_index`,
    [planDayId],
  );
  for (const p of prescriptions) {
    await db.run(
      `INSERT INTO plan_day_exercises
         (id, plan_day_id, exercise_key, order_index, target_sets, target_reps_min,
          target_reps_max, notes, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [newId(), copyId, p.exercise_key, p.order_index, p.target_sets, p.target_reps_min,
        p.target_reps_max, p.notes, at],
    );
  }
  return copyId;
}

export async function listPlanDays(db: SqlExecutor, planId: string): Promise<PlanDayRow[]> {
  return db.all<PlanDayRow>(
    `SELECT * FROM plan_days WHERE plan_id = ? AND deleted_at IS NULL ORDER BY day_index`,
    [planId],
  );
}

/**
 * Every workout the user has, across all of their plans, each with its plan's name.
 *
 * The plan screen shows every plan as a titled group, and the calendar schedules workouts from
 * any of them — so "today's workout" has to find a scheduled day wherever it lives, not only in
 * the active plan. Plans in creation order, days in their order within each.
 */
export async function listUserPlanDays(
  db: SqlExecutor,
  userId: string,
): Promise<(PlanDayRow & { plan_name: string })[]> {
  return db.all<PlanDayRow & { plan_name: string }>(
    `SELECT pd.*, p.name AS plan_name
       FROM plan_days pd
       JOIN plans p ON p.id = pd.plan_id
      WHERE p.user_id = ? AND p.deleted_at IS NULL AND pd.deleted_at IS NULL
      ORDER BY p.created_at, p.id, pd.day_index`,
    [userId],
  );
}

/** A whole plan in one call — days in order, each with its prescribed exercises. */
export async function getPlanDetail(
  db: SqlExecutor,
  planId: string,
): Promise<{ plan: PlanRow | null; days: PlanDayWithExercises[] }> {
  const plan = await db.get<PlanRow>(
    `SELECT * FROM plans WHERE id = ? AND deleted_at IS NULL`,
    [planId],
  );
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
  const day = await db.get<PlanDayRow>(
    `SELECT * FROM plan_days WHERE id = ? AND deleted_at IS NULL`,
    [planDayId],
  );
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
  clock: Clock = defaultClock,
): Promise<string> {
  const row = await db.get<{ next: number }>(
    `SELECT COALESCE(MAX(order_index), 0) + 1 AS next FROM plan_day_exercises
      WHERE plan_day_id = ? AND deleted_at IS NULL`,
    [planDayId],
  );
  const id = newId();
  await db.run(
    `INSERT INTO plan_day_exercises
       (id, plan_day_id, exercise_key, order_index, target_sets, target_reps_min,
        target_reps_max, notes, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      clock(),
    ],
  );
  return id;
}

export async function updatePlanDayExercise(
  db: SqlExecutor,
  id: string,
  input: PrescriptionInput,
  clock: Clock = defaultClock,
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

  assign('updated_at', clock());

  params.push(id);
  await db.run(`UPDATE plan_day_exercises SET ${sets.join(', ')} WHERE id = ?`, params);
}

/** Remove a prescribed exercise, closing the gap in `order_index` (see removePlanDay). */
export async function removePlanDayExercise(
  db: SqlExecutor,
  id: string,
  clock: Clock = defaultClock,
): Promise<void> {
  const row = await db.get<PlanDayExerciseRow>(
    `SELECT * FROM plan_day_exercises WHERE id = ? AND deleted_at IS NULL`,
    [id],
  );
  if (!row) return;

  const at = clock();
  await db.run(
    `UPDATE plan_day_exercises SET deleted_at = ?, updated_at = ?, order_index = -rowid
      WHERE id = ?`,
    [at, at, id],
  );

  const remaining = await db.all<{ id: string }>(
    `SELECT id FROM plan_day_exercises WHERE plan_day_id = ? AND deleted_at IS NULL
      ORDER BY order_index`,
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
    `SELECT * FROM plan_day_exercises WHERE plan_day_id = ? AND deleted_at IS NULL
      ORDER BY order_index`,
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
  userId: string,
  newId: IdFactory,
  planDayId: string,
  clock: Clock = defaultClock,
): Promise<string | null> {
  const day = await getPlanDay(db, planDayId);
  if (!day) return null;

  const sessionId = await startSession(db, userId, newId, { planDayId }, clock);
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
  userId: string,
  planId: string,
): Promise<(PlanDayRow & { last_trained_at: string | null }) | null> {
  return db.get<PlanDayRow & { last_trained_at: string | null }>(
    `SELECT pd.id, pd.plan_id, pd.day_index, pd.name,
            (SELECT MAX(ws.started_at) FROM workout_sessions ws
              WHERE ws.plan_day_id = pd.id AND ws.user_id = ? AND ws.deleted_at IS NULL)
              AS last_trained_at
       FROM plan_days pd
      WHERE pd.plan_id = ? AND pd.deleted_at IS NULL
      ORDER BY last_trained_at IS NOT NULL, last_trained_at ASC, pd.day_index ASC
      LIMIT 1`,
    [userId, planId],
  );
}

/** Every day of a plan with when it was last trained — the weekly overview. */
export async function listPlanDayStatus(
  db: SqlExecutor,
  userId: string,
  planId: string,
): Promise<
  {
    id: string;
    day_index: number;
    name: string | null;
    exercise_count: number;
    /** The day's exercises in order, joined by the unit separator — see the query. */
    exercise_keys: string | null;
    work_seconds: number | null;
    rest_seconds: number | null;
    last_trained_at: string | null;
    session_count: number;
  }[]
> {
  return db.all(
    `SELECT pd.id, pd.day_index, pd.name, pd.work_seconds, pd.rest_seconds,
            (SELECT COUNT(*) FROM plan_day_exercises pde
              WHERE pde.plan_day_id = pd.id AND pde.deleted_at IS NULL) AS exercise_count,
            -- The exercises themselves, so the plan can show what a day is rather than only how
            -- many things are in it. Joined on the unit separator rather than a comma, which
            -- appears in exercise names.
            (SELECT GROUP_CONCAT(ordered.exercise_key, char(31)) FROM (
               SELECT exercise_key FROM plan_day_exercises
                WHERE plan_day_id = pd.id AND deleted_at IS NULL
                ORDER BY order_index
             ) AS ordered) AS exercise_keys,
            (SELECT MAX(ws.started_at) FROM workout_sessions ws
              WHERE ws.plan_day_id = pd.id AND ws.user_id = ? AND ws.deleted_at IS NULL)
              AS last_trained_at,
            (SELECT COUNT(*) FROM workout_sessions ws
              WHERE ws.plan_day_id = pd.id AND ws.user_id = ? AND ws.ended_at IS NOT NULL
                AND ws.deleted_at IS NULL) AS session_count
       FROM plan_days pd
      WHERE pd.plan_id = ? AND pd.deleted_at IS NULL
      ORDER BY pd.day_index`,
    [userId, userId, planId],
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
  userId: string,
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
       JOIN workout_sessions ws ON ws.id = se.session_id AND ws.deleted_at IS NULL
       LEFT JOIN sets s ON s.session_exercise_id = se.id AND s.deleted_at IS NULL
       LEFT JOIN plan_day_exercises pde
              ON pde.plan_day_id = ws.plan_day_id
             AND pde.exercise_key = se.exercise_key
             AND pde.deleted_at IS NULL
      WHERE se.session_id = ? AND ws.user_id = ? AND se.deleted_at IS NULL
      GROUP BY se.id, se.exercise_key, pde.target_sets, pde.target_reps_min, pde.target_reps_max
      ORDER BY se.order_index`,
    [sessionId, userId],
  );
}

/**
 * Move a day to a new position in the week, shifting the others around it.
 *
 * Two-phase like every other renumber here, and for the same reason: `UNIQUE (plan_id,
 * day_index)` is checked per row, so writing the final order directly collides the moment two
 * days momentarily share an index. Parking every day above the range first makes the second
 * pass collision-free by construction.
 */
export async function reorderPlanDay(
  db: SqlExecutor,
  planId: string,
  planDayId: string,
  toIndex: number,
  clock: Clock = defaultClock,
): Promise<void> {
  const days = await db.all<{ id: string }>(
    `SELECT id FROM plan_days WHERE plan_id = ? AND deleted_at IS NULL ORDER BY day_index`,
    [planId],
  );
  const from = days.findIndex((d) => d.id === planDayId);
  if (from < 0) return;

  const target = Math.max(0, Math.min(days.length - 1, toIndex));
  if (target === from) return;

  const ordered = [...days];
  const [moved] = ordered.splice(from, 1);
  if (!moved) return;
  ordered.splice(target, 0, moved);

  const at = clock();
  const PARK = 100000;
  for (const [offset, row] of ordered.entries()) {
    await db.run(`UPDATE plan_days SET day_index = ? WHERE id = ?`, [PARK + offset, row.id]);
  }
  for (const [offset, row] of ordered.entries()) {
    await db.run(`UPDATE plan_days SET day_index = ?, updated_at = ? WHERE id = ?`, [
      offset + 1,
      at,
      row.id,
    ]);
  }
}

/**
 * Move an exercise to a new position within its day.
 *
 * Order is not decoration in a training day — squats before leg extensions is the difference
 * between a session that works and one that does not — so an exercise landing last when it
 * belongs third has to be movable without deleting and re-adding it.
 *
 * Same two-phase renumber as `reorderPlanDay` above, for the same reason: `UNIQUE (plan_day_id,
 * order_index)` is checked per row, so writing the final order directly collides the moment two
 * exercises momentarily share an index. Parking the whole list above the range first makes the
 * second pass collision-free by construction.
 */
export async function reorderPlanDayExercise(
  db: SqlExecutor,
  planDayId: string,
  exerciseId: string,
  toIndex: number,
  clock: Clock = defaultClock,
): Promise<void> {
  const rows = await db.all<{ id: string }>(
    `SELECT id FROM plan_day_exercises
      WHERE plan_day_id = ? AND deleted_at IS NULL
      ORDER BY order_index`,
    [planDayId],
  );
  const from = rows.findIndex((r) => r.id === exerciseId);
  if (from < 0) return;

  const target = Math.max(0, Math.min(rows.length - 1, toIndex));
  if (target === from) return;

  const ordered = [...rows];
  const [moved] = ordered.splice(from, 1);
  if (!moved) return;
  ordered.splice(target, 0, moved);

  const at = clock();
  const PARK = 100000;
  for (const [offset, row] of ordered.entries()) {
    await db.run(`UPDATE plan_day_exercises SET order_index = ? WHERE id = ?`, [
      PARK + offset,
      row.id,
    ]);
  }
  for (const [offset, row] of ordered.entries()) {
    await db.run(`UPDATE plan_day_exercises SET order_index = ?, updated_at = ? WHERE id = ?`, [
      offset + 1,
      at,
      row.id,
    ]);
  }
}

/**
 * Copy every day of a plan, and its prescriptions, onto the end of the same plan.
 *
 * Appends rather than creating a second plan: the design's "duplicate week" is for building a
 * two-week rotation out of one, so the copies have to live in the same plan to be reachable.
 * New ids throughout — reusing them would make the copy and the original the same row to the
 * sync engine, and editing one would silently edit the other.
 */
export async function duplicatePlanWeek(
  db: SqlExecutor,
  newId: IdFactory,
  planId: string,
  clock: Clock = defaultClock,
): Promise<number> {
  const days = await db.all<PlanDayRow>(
    `SELECT * FROM plan_days WHERE plan_id = ? AND deleted_at IS NULL ORDER BY day_index`,
    [planId],
  );
  if (days.length === 0) return 0;

  const at = clock();
  const offset = days.length;

  for (const [i, day] of days.entries()) {
    const copyId = newId();
    // Timing travels with the day. Duplicating a week of circuits and getting back a week of
    // ordinary workouts would lose the one thing that made those days what they were.
    await db.run(
      `INSERT INTO plan_days (id, plan_id, day_index, name, work_seconds, rest_seconds, rounds, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        copyId,
        planId,
        offset + i + 1,
        day.name,
        day.work_seconds ?? null,
        day.rest_seconds ?? null,
        day.rounds ?? null,
        at,
      ],
    );

    const prescriptions = await db.all<PlanDayExerciseRow>(
      `SELECT * FROM plan_day_exercises WHERE plan_day_id = ? AND deleted_at IS NULL
        ORDER BY order_index`,
      [day.id],
    );
    for (const p of prescriptions) {
      await db.run(
        `INSERT INTO plan_day_exercises
           (id, plan_day_id, exercise_key, order_index, target_sets, target_reps_min,
            target_reps_max, notes, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          newId(),
          copyId,
          p.exercise_key,
          p.order_index,
          p.target_sets,
          p.target_reps_min,
          p.target_reps_max,
          p.notes,
          at,
        ],
      );
    }
  }
  return days.length;
}
