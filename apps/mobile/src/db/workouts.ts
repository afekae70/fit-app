/**
 * Workout logging repository — the dynamic-sets core.
 *
 * Everything here works against `SqlExecutor` rather than expo-sqlite directly, so the same
 * code runs on device and under test against a real SQLite engine (see executor.ts).
 */

import type { SqlExecutor } from './executor.js';

export interface WorkoutSessionRow {
  id: string;
  location_id: string | null;
  plan_day_id: string | null;
  name: string | null;
  started_at: string;
  ended_at: string | null;
  bodyweight_kg: number | null;
  session_rpe: number | null;
  notes: string | null;
  created_at: string;
}

export interface SessionExerciseRow {
  id: string;
  session_id: string;
  exercise_key: string;
  order_index: number;
  notes: string | null;
}

export interface SetRow {
  id: string;
  session_exercise_id: string;
  set_index: number;
  weight_kg: number | null;
  reps: number | null;
  duration_seconds: number | null;
  distance_m: number | null;
  rpe: number | null;
  is_warmup: number;
  to_failure: number;
  completed_at: string;
}

/** Values a set can carry. Which ones are meaningful depends on the exercise's load type. */
export interface SetInput {
  weightKg?: number | null;
  reps?: number | null;
  durationSeconds?: number | null;
  distanceM?: number | null;
  rpe?: number | null;
  isWarmup?: boolean;
  toFailure?: boolean;
}

export type IdFactory = () => string;
export type Clock = () => string;

const defaultClock: Clock = () => new Date().toISOString();

/* -------------------------------------------------------------------------- */
/* Outbox                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Record a mutation for later replay to Supabase.
 *
 * Written in the same transaction as the mutation itself, so a crash between the two cannot
 * leave a local row that never syncs — the classic offline-sync failure.
 */
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
/* Sessions                                                                    */
/* -------------------------------------------------------------------------- */

export async function startSession(
  db: SqlExecutor,
  newId: IdFactory,
  options: { locationId?: string | null; planDayId?: string | null; bodyweightKg?: number | null } = {},
  clock: Clock = defaultClock,
): Promise<string> {
  const id = newId();
  const now = clock();
  await db.run(
    `INSERT INTO workout_sessions
       (id, location_id, plan_day_id, started_at, bodyweight_kg, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [id, options.locationId ?? null, options.planDayId ?? null, now, options.bodyweightKg ?? null, now],
  );
  await enqueue(db, 'workout_session', id, 'insert', { id, startedAt: now }, clock);
  return id;
}

export async function finishSession(
  db: SqlExecutor,
  sessionId: string,
  options: { sessionRpe?: number | null; notes?: string | null } = {},
  clock: Clock = defaultClock,
): Promise<void> {
  const endedAt = clock();
  await db.run(
    `UPDATE workout_sessions SET ended_at = ?, session_rpe = ?, notes = ? WHERE id = ?`,
    [endedAt, options.sessionRpe ?? null, options.notes ?? null, sessionId],
  );
  await enqueue(db, 'workout_session', sessionId, 'update', { endedAt }, clock);
}

/** The session that has been started but not finished, if any. */
export async function getActiveSession(db: SqlExecutor): Promise<WorkoutSessionRow | null> {
  return db.get<WorkoutSessionRow>(
    `SELECT * FROM workout_sessions WHERE ended_at IS NULL ORDER BY started_at DESC LIMIT 1`,
  );
}

export async function listSessions(db: SqlExecutor, limit = 50): Promise<WorkoutSessionRow[]> {
  return db.all<WorkoutSessionRow>(
    `SELECT * FROM workout_sessions ORDER BY started_at DESC LIMIT ?`,
    [limit],
  );
}

/** Label a session. The name is what makes it findable — and reusable — later. */
export async function renameSession(
  db: SqlExecutor,
  sessionId: string,
  name: string | null,
  clock: Clock = defaultClock,
): Promise<void> {
  const trimmed = name?.trim() ?? '';
  const value = trimmed === '' ? null : trimmed;
  await db.run(`UPDATE workout_sessions SET name = ? WHERE id = ?`, [value, sessionId]);
  await enqueue(db, 'workout_session', sessionId, 'update', { name: value }, clock);
}

export async function deleteSession(
  db: SqlExecutor,
  sessionId: string,
  clock: Clock = defaultClock,
): Promise<void> {
  // Children go via ON DELETE CASCADE — which only fires if PRAGMA foreign_keys is ON for
  // this connection (see db/index.ts).
  await db.run(`DELETE FROM workout_sessions WHERE id = ?`, [sessionId]);
  await enqueue(db, 'workout_session', sessionId, 'delete', undefined, clock);
}

/* -------------------------------------------------------------------------- */
/* Exercises within a session                                                  */
/* -------------------------------------------------------------------------- */

export async function addExerciseToSession(
  db: SqlExecutor,
  newId: IdFactory,
  sessionId: string,
  exerciseKey: string,
  clock: Clock = defaultClock,
): Promise<string> {
  const row = await db.get<{ next: number }>(
    `SELECT COALESCE(MAX(order_index), 0) + 1 AS next FROM session_exercises WHERE session_id = ?`,
    [sessionId],
  );
  const orderIndex = row?.next ?? 1;

  const id = newId();
  await db.run(
    `INSERT INTO session_exercises (id, session_id, exercise_key, order_index)
     VALUES (?, ?, ?, ?)`,
    [id, sessionId, exerciseKey, orderIndex],
  );
  await enqueue(db, 'session_exercise', id, 'insert', { sessionId, exerciseKey, orderIndex }, clock);
  return id;
}

export async function listSessionExercises(
  db: SqlExecutor,
  sessionId: string,
): Promise<SessionExerciseRow[]> {
  return db.all<SessionExerciseRow>(
    `SELECT * FROM session_exercises WHERE session_id = ? ORDER BY order_index`,
    [sessionId],
  );
}

export async function removeExerciseFromSession(
  db: SqlExecutor,
  sessionExerciseId: string,
  clock: Clock = defaultClock,
): Promise<void> {
  const row = await db.get<{ session_id: string }>(
    `SELECT session_id FROM session_exercises WHERE id = ?`,
    [sessionExerciseId],
  );
  await db.run(`DELETE FROM session_exercises WHERE id = ?`, [sessionExerciseId]);
  if (row) await renumberExercises(db, row.session_id);
  await enqueue(db, 'session_exercise', sessionExerciseId, 'delete', undefined, clock);
}

/* -------------------------------------------------------------------------- */
/* Sets — one row per set                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Append a set to one exercise.
 *
 * The new index is derived from that exercise's own rows only, which is precisely why set
 * counts are independent per exercise: appending a 5th set to chest press has no bearing on
 * face pulls sitting at 2.
 */
export async function addSet(
  db: SqlExecutor,
  newId: IdFactory,
  sessionExerciseId: string,
  input: SetInput = {},
  clock: Clock = defaultClock,
): Promise<string> {
  const row = await db.get<{ next: number }>(
    `SELECT COALESCE(MAX(set_index), 0) + 1 AS next FROM sets WHERE session_exercise_id = ?`,
    [sessionExerciseId],
  );
  const setIndex = row?.next ?? 1;

  const id = newId();
  const now = clock();
  await db.run(
    `INSERT INTO sets
       (id, session_exercise_id, set_index, weight_kg, reps, duration_seconds, distance_m,
        rpe, is_warmup, to_failure, completed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      sessionExerciseId,
      setIndex,
      input.weightKg ?? null,
      input.reps ?? null,
      input.durationSeconds ?? null,
      input.distanceM ?? null,
      input.rpe ?? null,
      input.isWarmup ? 1 : 0,
      input.toFailure ? 1 : 0,
      now,
    ],
  );
  await enqueue(db, 'set', id, 'insert', { sessionExerciseId, setIndex, ...input }, clock);
  return id;
}

/**
 * Append a set pre-filled from the previous one.
 *
 * Mid-workout, the overwhelmingly common case is repeating the same weight and reps. Copying
 * forward turns logging a straight-sets exercise into one tap per set instead of two numeric
 * entries — and warmup status is deliberately NOT copied, since the set after a warmup is
 * almost never another warmup.
 */
export async function addSetCopyingPrevious(
  db: SqlExecutor,
  newId: IdFactory,
  sessionExerciseId: string,
  clock: Clock = defaultClock,
): Promise<string> {
  const previous = await db.get<SetRow>(
    `SELECT * FROM sets WHERE session_exercise_id = ? ORDER BY set_index DESC LIMIT 1`,
    [sessionExerciseId],
  );

  return addSet(
    db,
    newId,
    sessionExerciseId,
    previous
      ? {
          weightKg: previous.weight_kg,
          reps: previous.reps,
          durationSeconds: previous.duration_seconds,
          distanceM: previous.distance_m,
        }
      : {},
    clock,
  );
}

export async function updateSet(
  db: SqlExecutor,
  setId: string,
  input: SetInput,
  clock: Clock = defaultClock,
): Promise<void> {
  const assignments: string[] = [];
  const params: unknown[] = [];

  // Only touch the fields actually supplied — a partial edit of reps must not blank the
  // weight that is already recorded.
  if (input.weightKg !== undefined) {
    assignments.push('weight_kg = ?');
    params.push(input.weightKg);
  }
  if (input.reps !== undefined) {
    assignments.push('reps = ?');
    params.push(input.reps);
  }
  if (input.durationSeconds !== undefined) {
    assignments.push('duration_seconds = ?');
    params.push(input.durationSeconds);
  }
  if (input.distanceM !== undefined) {
    assignments.push('distance_m = ?');
    params.push(input.distanceM);
  }
  if (input.rpe !== undefined) {
    assignments.push('rpe = ?');
    params.push(input.rpe);
  }
  if (input.isWarmup !== undefined) {
    assignments.push('is_warmup = ?');
    params.push(input.isWarmup ? 1 : 0);
  }
  if (input.toFailure !== undefined) {
    assignments.push('to_failure = ?');
    params.push(input.toFailure ? 1 : 0);
  }
  if (assignments.length === 0) return;

  params.push(setId);
  await db.run(`UPDATE sets SET ${assignments.join(', ')} WHERE id = ?`, params);
  await enqueue(db, 'set', setId, 'update', input, clock);
}

/**
 * Delete a set and close the gap it leaves.
 *
 * Renumbering runs in two phases because `(session_exercise_id, set_index)` is UNIQUE: writing
 * 3→2 while a row still holds 2 would collide. Every surviving row is first parked at a high
 * offset, then reassigned 1..n in order, so no intermediate state ever duplicates an index.
 * (The server does the same thing with a deferrable constraint; SQLite has no deferrable
 * uniqueness, hence the offset.)
 */
export async function removeSet(
  db: SqlExecutor,
  setId: string,
  clock: Clock = defaultClock,
): Promise<void> {
  const row = await db.get<{ session_exercise_id: string }>(
    `SELECT session_exercise_id FROM sets WHERE id = ?`,
    [setId],
  );
  if (!row) return;

  await db.run(`DELETE FROM sets WHERE id = ?`, [setId]);
  await renumberSets(db, row.session_exercise_id);
  await enqueue(db, 'set', setId, 'delete', undefined, clock);
}

/** Reassign contiguous 1..n set indices for one exercise. Safe to call when already contiguous. */
export async function renumberSets(
  db: SqlExecutor,
  sessionExerciseId: string,
): Promise<void> {
  const remaining = await db.all<{ id: string }>(
    `SELECT id FROM sets WHERE session_exercise_id = ? ORDER BY set_index`,
    [sessionExerciseId],
  );
  if (remaining.length === 0) return;

  const OFFSET = 100000;
  await db.run(
    `UPDATE sets SET set_index = set_index + ? WHERE session_exercise_id = ?`,
    [OFFSET, sessionExerciseId],
  );
  for (const [i, r] of remaining.entries()) {
    await db.run(`UPDATE sets SET set_index = ? WHERE id = ?`, [i + 1, r.id]);
  }
}

/** Same two-phase approach for exercise ordering within a session. */
export async function renumberExercises(db: SqlExecutor, sessionId: string): Promise<void> {
  const remaining = await db.all<{ id: string }>(
    `SELECT id FROM session_exercises WHERE session_id = ? ORDER BY order_index`,
    [sessionId],
  );
  if (remaining.length === 0) return;

  const OFFSET = 100000;
  await db.run(
    `UPDATE session_exercises SET order_index = order_index + ? WHERE session_id = ?`,
    [OFFSET, sessionId],
  );
  for (const [i, r] of remaining.entries()) {
    await db.run(`UPDATE session_exercises SET order_index = ? WHERE id = ?`, [i + 1, r.id]);
  }
}

export async function listSets(
  db: SqlExecutor,
  sessionExerciseId: string,
): Promise<SetRow[]> {
  return db.all<SetRow>(
    `SELECT * FROM sets WHERE session_exercise_id = ? ORDER BY set_index`,
    [sessionExerciseId],
  );
}

/* -------------------------------------------------------------------------- */
/* Aggregate reads                                                             */
/* -------------------------------------------------------------------------- */

export interface SessionExerciseWithSets extends SessionExerciseRow {
  sets: SetRow[];
}

/** A whole session, ready to render: exercises in order, each with its own sets. */
export async function getSessionDetail(
  db: SqlExecutor,
  sessionId: string,
): Promise<{ session: WorkoutSessionRow | null; exercises: SessionExerciseWithSets[] }> {
  const session = await db.get<WorkoutSessionRow>(
    `SELECT * FROM workout_sessions WHERE id = ?`,
    [sessionId],
  );
  if (!session) return { session: null, exercises: [] };

  const exercises = await listSessionExercises(db, sessionId);
  const withSets: SessionExerciseWithSets[] = [];
  for (const exercise of exercises) {
    withSets.push({ ...exercise, sets: await listSets(db, exercise.id) });
  }
  return { session, exercises: withSets };
}

/* -------------------------------------------------------------------------- */
/* History and templates                                                       */
/* -------------------------------------------------------------------------- */

export interface SessionSummaryRow extends WorkoutSessionRow {
  exercise_count: number;
  set_count: number;
  volume_load: number;
}

/**
 * Sessions with headline stats, newest first.
 *
 * Aggregated in SQL rather than by loading every set into JS: a year of training is tens of
 * thousands of set rows, and the history list only needs three numbers per session.
 *
 * Warmups are excluded from both the set count and the volume, so the figures match what the
 * exercise cards show during the workout.
 */
export async function listSessionSummaries(
  db: SqlExecutor,
  limit = 100,
): Promise<SessionSummaryRow[]> {
  return db.all<SessionSummaryRow>(
    `SELECT
       ws.*,
       COUNT(DISTINCT se.id)                                    AS exercise_count,
       COALESCE(SUM(CASE WHEN s.is_warmup = 0 THEN 1 ELSE 0 END), 0) AS set_count,
       COALESCE(SUM(CASE WHEN s.is_warmup = 0
                         THEN COALESCE(s.weight_kg, 0) * COALESCE(s.reps, 0)
                         ELSE 0 END), 0)                        AS volume_load
     FROM workout_sessions ws
     LEFT JOIN session_exercises se ON se.session_id = ws.id
     LEFT JOIN sets s               ON s.session_exercise_id = se.id
     GROUP BY ws.id
     ORDER BY ws.started_at DESC
     LIMIT ?`,
    [limit],
  );
}

/**
 * Start a new session from a previous one, copying its *structure* but none of its numbers.
 *
 * This is what turns any past workout into a reusable template: rather than re-picking eight
 * exercises, the new session opens with the same exercises and the same number of sets, all
 * blank and waiting to be filled in.
 *
 * The numbers are deliberately NOT carried over. Pre-filling last week's weights means a set
 * left untouched silently records itself as performed at that weight — the log then contains
 * numbers the user never actually lifted, and every downstream figure (e1RM, volume, the
 * stalling flag, whatever the AI coach is told) inherits the fiction. A blank field that stays
 * blank records nothing, which is the truth.
 *
 * The previous numbers are not lost, just moved: `getPreviousSessionSets` surfaces them
 * alongside each set as a target to beat or match. Reference, not default.
 *
 * What is copied:
 *  - exercises and their order;
 *  - the number of sets per exercise, and which of them were warmups, since that structure is
 *    what makes the template worth reusing.
 *
 * What is not:
 *  - weight, reps, duration, distance — see above;
 *  - RPE and to-failure flags, which describe how one particular performance felt.
 */
export async function repeatSession(
  db: SqlExecutor,
  newId: IdFactory,
  sourceSessionId: string,
  clock: Clock = defaultClock,
): Promise<string | null> {
  const source = await db.get<WorkoutSessionRow>(
    `SELECT * FROM workout_sessions WHERE id = ?`,
    [sourceSessionId],
  );
  if (!source) return null;

  const sessionId = await startSession(db, newId, {}, clock);
  if (source.name) await renameSession(db, sessionId, source.name, clock);

  const exercises = await listSessionExercises(db, sourceSessionId);
  for (const exercise of exercises) {
    const newExerciseId = await addExerciseToSession(
      db,
      newId,
      sessionId,
      exercise.exercise_key,
      clock,
    );

    const sets = await listSets(db, exercise.id);
    for (const set of sets) {
      await addSet(
        db,
        newId,
        newExerciseId,
        {
          weightKg: null,
          reps: null,
          durationSeconds: null,
          distanceM: null,
          isWarmup: set.is_warmup === 1,
        },
        clock,
      );
    }
  }

  return sessionId;
}

/**
 * Every set of an exercise as performed in the most recent *other* session containing it.
 *
 * This is the reference that replaces pre-filled values: set 1 shows what set 1 was last time,
 * so the decision to add weight or hold it is made against the real number rather than from
 * memory. Returned in `set_index` order so callers can line rows up positionally.
 *
 * "Most recent other session" is resolved in a subquery rather than by taking the newest sets
 * directly, because a single session's rows must not be mixed with an older one's — showing
 * set 1 from Monday next to set 3 from the week before would be a meaningless comparison.
 */
export async function getPreviousSessionSets(
  db: SqlExecutor,
  exerciseKey: string,
  excludeSessionId?: string,
): Promise<
  {
    set_index: number;
    weight_kg: number | null;
    reps: number | null;
    duration_seconds: number | null;
    distance_m: number | null;
    is_warmup: number;
    started_at: string;
  }[]
> {
  const exclude = excludeSessionId ?? null;
  return db.all(
    `SELECT s.set_index, s.weight_kg, s.reps, s.duration_seconds, s.distance_m,
            s.is_warmup, ws.started_at
       FROM sets s
       JOIN session_exercises se ON se.id = s.session_exercise_id
       JOIN workout_sessions ws  ON ws.id = se.session_id
      WHERE se.exercise_key = ?
        AND ws.id = (
          SELECT prev_ws.id
            FROM workout_sessions prev_ws
            JOIN session_exercises prev_se ON prev_se.session_id = prev_ws.id
           WHERE prev_se.exercise_key = ?
             AND (? IS NULL OR prev_ws.id <> ?)
             AND EXISTS (
               SELECT 1 FROM sets prev_s
                WHERE prev_s.session_exercise_id = prev_se.id
                  AND (prev_s.weight_kg IS NOT NULL OR prev_s.reps IS NOT NULL
                       OR prev_s.duration_seconds IS NOT NULL OR prev_s.distance_m IS NOT NULL)
             )
           ORDER BY prev_ws.started_at DESC
           LIMIT 1
        )
      ORDER BY s.set_index`,
    [exerciseKey, exerciseKey, exclude, exclude],
  );
}

/**
 * Distinct named workouts, most recently performed first — the template list.
 * Only the latest session per name is offered, since that is the one carrying current weights.
 */
export async function listNamedTemplates(
  db: SqlExecutor,
  limit = 20,
): Promise<{ id: string; name: string; started_at: string; exercise_count: number }[]> {
  return db.all(
    `SELECT ws.id, ws.name, ws.started_at, COUNT(DISTINCT se.id) AS exercise_count
       FROM workout_sessions ws
       LEFT JOIN session_exercises se ON se.session_id = ws.id
      WHERE ws.name IS NOT NULL
        AND ws.id = (
          SELECT inner_ws.id FROM workout_sessions inner_ws
           WHERE inner_ws.name = ws.name
           ORDER BY inner_ws.started_at DESC LIMIT 1
        )
      GROUP BY ws.id
      HAVING exercise_count > 0
      ORDER BY ws.started_at DESC
      LIMIT ?`,
    [limit],
  );
}

/**
 * The heaviest working set previously recorded for an exercise, excluding the current session.
 * Drives the "last time you did X" hint next to each exercise while logging.
 */
export async function getPreviousBest(
  db: SqlExecutor,
  exerciseKey: string,
  excludeSessionId?: string,
): Promise<{ weight_kg: number; reps: number; started_at: string } | null> {
  return db.get<{ weight_kg: number; reps: number; started_at: string }>(
    `SELECT s.weight_kg, s.reps, ws.started_at
       FROM sets s
       JOIN session_exercises se ON se.id = s.session_exercise_id
       JOIN workout_sessions ws  ON ws.id = se.session_id
      WHERE se.exercise_key = ?
        AND s.is_warmup = 0
        AND s.weight_kg IS NOT NULL
        AND s.reps IS NOT NULL
        AND (? IS NULL OR ws.id <> ?)
      ORDER BY s.weight_kg DESC, s.reps DESC
      LIMIT 1`,
    [exerciseKey, excludeSessionId ?? null, excludeSessionId ?? null],
  );
}
