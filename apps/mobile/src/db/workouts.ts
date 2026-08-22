/**
 * Workout logging repository — the dynamic-sets core.
 *
 * Everything here works against `SqlExecutor` rather than expo-sqlite directly, so the same
 * code runs on device and under test against a real SQLite engine (see executor.ts).
 */

import type { SqlExecutor } from './executor.js';
import { sameTypeClause, type SessionType } from './sessionType.js';

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
  /** When the user ticked the set off mid-workout; null while it is still ahead of them. */
  done_at: string | null;
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
// `outbox` carries a `user_id` column (default 'local') but has no reader anywhere in the app
// yet — it's scaffolding for a future sync feature that hasn't been built. Not worth threading
// a real userId through every call site of this helper (several of which only have a child id,
// like a set or session-exercise id, with no cheap way to look up the owning user) before that
// feature exists and can inform how outbox rows should actually be attributed.
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
  userId: string,
  newId: IdFactory,
  options: { locationId?: string | null; planDayId?: string | null; bodyweightKg?: number | null } = {},
  clock: Clock = defaultClock,
): Promise<string> {
  const id = newId();
  const now = clock();
  await db.run(
    `INSERT INTO workout_sessions
       (id, user_id, location_id, plan_day_id, started_at, bodyweight_kg, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, userId, options.locationId ?? null, options.planDayId ?? null, now, options.bodyweightKg ?? null, now, now],
  );
  await enqueue(db, 'workout_session', id, 'insert', { id, startedAt: now }, clock);
  return id;
}

export async function finishSession(
  db: SqlExecutor,
  userId: string,
  sessionId: string,
  options: { sessionRpe?: number | null; notes?: string | null } = {},
  clock: Clock = defaultClock,
): Promise<void> {
  const endedAt = clock();
  await db.run(
    `UPDATE workout_sessions SET ended_at = ?, session_rpe = ?, notes = ?, updated_at = ?
      WHERE id = ? AND user_id = ?`,
    [endedAt, options.sessionRpe ?? null, options.notes ?? null, endedAt, sessionId, userId],
  );
  await enqueue(db, 'workout_session', sessionId, 'update', { endedAt }, clock);
}

/** The session that has been started but not finished, if any. */
export async function getActiveSession(
  db: SqlExecutor,
  userId: string,
): Promise<WorkoutSessionRow | null> {
  return db.get<WorkoutSessionRow>(
    `SELECT * FROM workout_sessions
      WHERE user_id = ? AND ended_at IS NULL AND deleted_at IS NULL
      ORDER BY started_at DESC LIMIT 1`,
    [userId],
  );
}

export async function listSessions(
  db: SqlExecutor,
  userId: string,
  limit = 50,
): Promise<WorkoutSessionRow[]> {
  return db.all<WorkoutSessionRow>(
    `SELECT * FROM workout_sessions WHERE user_id = ? AND deleted_at IS NULL
      ORDER BY started_at DESC LIMIT ?`,
    [userId, limit],
  );
}

/** Label a session. The name is what makes it findable — and reusable — later. */
export async function renameSession(
  db: SqlExecutor,
  userId: string,
  sessionId: string,
  name: string | null,
  clock: Clock = defaultClock,
): Promise<void> {
  const trimmed = name?.trim() ?? '';
  const value = trimmed === '' ? null : trimmed;
  await db.run(`UPDATE workout_sessions SET name = ?, updated_at = ? WHERE id = ? AND user_id = ?`, [
    value,
    clock(),
    sessionId,
    userId,
  ]);
  await enqueue(db, 'workout_session', sessionId, 'update', { name: value }, clock);
}

/**
 * Marks a session and everything under it as deleted, rather than removing the rows.
 *
 * Two things are load-bearing here and both are easy to get wrong:
 *
 *  - **The cascade is manual.** `ON DELETE CASCADE` fires only for a real DELETE. A soft-deleted
 *    session would otherwise leave its exercises and sets live, and they would sync to another
 *    device as orphans that never disappear.
 *  - **Indexes move out of the way.** `sets` is UNIQUE on (session_exercise_id, set_index) and
 *    `session_exercises` on (session_id, order_index). A deleted row keeps occupying its slot,
 *    so renumbering the surviving rows would collide with it. `-rowid` is negative (never a
 *    real index) and unique per table, so it frees the slot and can never clash.
 */
export async function deleteSession(
  db: SqlExecutor,
  userId: string,
  sessionId: string,
  clock: Clock = defaultClock,
): Promise<void> {
  const at = clock();
  await db.run(
    `UPDATE sets SET deleted_at = ?, updated_at = ?, set_index = -rowid
      WHERE deleted_at IS NULL
        AND session_exercise_id IN (SELECT id FROM session_exercises WHERE session_id = ?)`,
    [at, at, sessionId],
  );
  await db.run(
    `UPDATE session_exercises SET deleted_at = ?, updated_at = ?, order_index = -rowid
      WHERE deleted_at IS NULL AND session_id = ?`,
    [at, at, sessionId],
  );
  await db.run(
    `UPDATE workout_sessions SET deleted_at = ?, updated_at = ? WHERE id = ? AND user_id = ?`,
    [at, at, sessionId, userId],
  );
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
    `SELECT COALESCE(MAX(order_index), 0) + 1 AS next FROM session_exercises
      WHERE session_id = ? AND deleted_at IS NULL`,
    [sessionId],
  );
  const orderIndex = row?.next ?? 1;

  const id = newId();
  await db.run(
    `INSERT INTO session_exercises (id, session_id, exercise_key, order_index, updated_at)
     VALUES (?, ?, ?, ?, ?)`,
    [id, sessionId, exerciseKey, orderIndex, clock()],
  );
  await enqueue(db, 'session_exercise', id, 'insert', { sessionId, exerciseKey, orderIndex }, clock);
  return id;
}

export async function listSessionExercises(
  db: SqlExecutor,
  sessionId: string,
): Promise<SessionExerciseRow[]> {
  return db.all<SessionExerciseRow>(
    `SELECT * FROM session_exercises WHERE session_id = ? AND deleted_at IS NULL
      ORDER BY order_index`,
    [sessionId],
  );
}

/**
 * Move one exercise to a different position within a live session.
 *
 * The order a workout is written down is the order it gets done, and that decision is often
 * made standing in front of a rack that someone else is using. Reordering the plan is not the
 * same thing: the plan is what you intend to do every week, this is what you are doing now, and
 * editing the plan to work around a busy squat rack would corrupt next week's template.
 *
 * Written through a `PARK` offset in two passes, exactly as `reorderPlanDay` is, because
 * `UNIQUE (session_id, order_index)` rejects the direct swap — the intermediate state of a
 * one-pass rewrite always collides with a row that has not moved yet.
 *
 * `toIndex` is 0-based over the surviving rows, while `order_index` is 1-based and may have
 * gaps where exercises were removed; the rewrite closes those gaps as a side effect.
 */
export async function reorderSessionExercise(
  db: SqlExecutor,
  sessionId: string,
  sessionExerciseId: string,
  toIndex: number,
  clock: Clock = defaultClock,
): Promise<void> {
  const rows = await db.all<{ id: string }>(
    `SELECT id FROM session_exercises
      WHERE session_id = ? AND deleted_at IS NULL
      ORDER BY order_index`,
    [sessionId],
  );
  const from = rows.findIndex((r) => r.id === sessionExerciseId);
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
    await db.run(`UPDATE session_exercises SET order_index = ? WHERE id = ?`, [
      PARK + offset,
      row.id,
    ]);
  }
  for (const [offset, row] of ordered.entries()) {
    await db.run(`UPDATE session_exercises SET order_index = ?, updated_at = ? WHERE id = ?`, [
      offset + 1,
      at,
      row.id,
    ]);
  }

  // Every row's position may have shifted, not just the moved one, so the whole new order goes
  // out. Enqueuing only the moved exercise would leave a syncing peer to infer the rest.
  for (const [offset, row] of ordered.entries()) {
    await enqueue(db, 'session_exercise', row.id, 'update', { orderIndex: offset + 1 }, clock);
  }
}

/**
 * Change which exercise a slot in a live session refers to.
 *
 * The rack is taken, the machine is broken, the shoulder does not feel right today — swapping
 * mid-workout is ordinary, and until now the only route was to remove the exercise and add
 * another, which loses its place in the running order.
 *
 * What happens to the sets is the whole of the design here, because 100 kg for 5 means one
 * thing under a bench press and something else entirely under a lateral raise.
 *
 * **Nothing ticked off yet** — the slot is re-pointed in place, keeping its position. Every set
 * is blanked, because those numbers were prefilled from the *previous* exercise's history and
 * carrying them across would suggest a load nobody chose and, worse, one the user might load
 * onto a bar without rereading.
 *
 * **Something already ticked off** — completed sets stay attached to the exercise they were
 * actually performed on, and the new exercise is inserted directly after with the sets that
 * had not been done. Relabelling finished work would put real training under the wrong lift in
 * the history, in the progression charts, and in what the coach reasons about; there is no
 * version of that which is worth the convenience. The workout ends up reading the way it
 * actually happened: two sets of bench, then the rest on dumbbells.
 *
 * Returns the id of the row that now carries `newExerciseKey`, which differs from the one
 * passed in exactly when the split path was taken.
 */
export async function swapSessionExercise(
  db: SqlExecutor,
  newId: IdFactory,
  sessionExerciseId: string,
  newExerciseKey: string,
  clock: Clock = defaultClock,
): Promise<string> {
  const exercise = await db.get<{ id: string; session_id: string; exercise_key: string }>(
    `SELECT id, session_id, exercise_key FROM session_exercises
      WHERE id = ? AND deleted_at IS NULL`,
    [sessionExerciseId],
  );
  if (!exercise) return sessionExerciseId;
  if (exercise.exercise_key === newExerciseKey) return sessionExerciseId;

  const sets = await db.all<{ id: string; done_at: string | null }>(
    `SELECT id, done_at FROM sets
      WHERE session_exercise_id = ? AND deleted_at IS NULL ORDER BY set_index`,
    [sessionExerciseId],
  );
  const done = sets.filter((set) => set.done_at !== null);
  const pending = sets.filter((set) => set.done_at === null);
  const at = clock();

  if (done.length === 0) {
    await db.run(`UPDATE session_exercises SET exercise_key = ?, updated_at = ? WHERE id = ?`, [
      newExerciseKey,
      at,
      sessionExerciseId,
    ]);
    // Blanked, not deleted: the number of sets is the shape of what was planned, and that is
    // usually still what the user wants from the replacement.
    await db.run(
      `UPDATE sets SET weight_kg = NULL, reps = NULL, updated_at = ?
        WHERE session_exercise_id = ? AND deleted_at IS NULL`,
      [at, sessionExerciseId],
    );
    await enqueue(
      db,
      'session_exercise',
      sessionExerciseId,
      'update',
      { exerciseKey: newExerciseKey },
      clock,
    );
    return sessionExerciseId;
  }

  const order = await db.all<{ id: string }>(
    `SELECT id FROM session_exercises WHERE session_id = ? AND deleted_at IS NULL ORDER BY order_index`,
    [exercise.session_id],
  );
  const position = order.findIndex((row) => row.id === sessionExerciseId);

  const replacementId = await addExerciseToSession(
    db,
    newId,
    exercise.session_id,
    newExerciseKey,
    clock,
  );
  // Appended at the end by `addExerciseToSession`; the swap only makes sense directly beneath
  // the work it continues from.
  if (position >= 0) {
    await reorderSessionExercise(db, exercise.session_id, replacementId, position + 1, clock);
  }

  for (const set of pending) {
    await db.run(
      `UPDATE sets SET deleted_at = ?, updated_at = ?, set_index = -rowid WHERE id = ?`,
      [at, at, set.id],
    );
    await enqueue(db, 'set', set.id, 'delete', undefined, clock);
  }
  await renumberSets(db, sessionExerciseId);

  // At least one, even when every set was already ticked: an exercise with no sets is never
  // what someone swapping to it wanted, and it matches what adding an exercise does.
  for (let i = 0; i < Math.max(1, pending.length); i++) {
    await addSet(db, newId, replacementId, {}, clock);
  }

  return replacementId;
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
  const at = clock();
  // Sets first: once the parent's order_index has moved, this exercise is no longer easy to
  // identify by position, and its sets must not stay live under a deleted parent.
  await db.run(
    `UPDATE sets SET deleted_at = ?, updated_at = ?, set_index = -rowid
      WHERE deleted_at IS NULL AND session_exercise_id = ?`,
    [at, at, sessionExerciseId],
  );
  await db.run(
    `UPDATE session_exercises SET deleted_at = ?, updated_at = ?, order_index = -rowid WHERE id = ?`,
    [at, at, sessionExerciseId],
  );
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
    `SELECT COALESCE(MAX(set_index), 0) + 1 AS next FROM sets
      WHERE session_exercise_id = ? AND deleted_at IS NULL`,
    [sessionExerciseId],
  );
  const setIndex = row?.next ?? 1;

  const id = newId();
  const now = clock();
  await db.run(
    `INSERT INTO sets
       (id, session_exercise_id, set_index, weight_kg, reps, duration_seconds, distance_m,
        rpe, is_warmup, to_failure, completed_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
/**
 * Put a ramp in front of the work.
 *
 * Warm-ups go before the working sets rather than after them, which means every existing set
 * moves down — and `UNIQUE (session_exercise_id, set_index)` refuses the direct renumber, the
 * same way it refuses a reorder. Parked in one pass, written in the next, exactly as
 * `renumberSets` does it.
 *
 * Marked `is_warmup`, which is what keeps them out of the numbers that matter: volume, personal
 * records and the progression charts all read that flag. A warm-up counted as work would show
 * up as a session that got heavier and easier at the same time.
 *
 * Does nothing when the exercise already has warm-ups. Pressing the button twice is a slip, and
 * six ramp sets in front of three working ones is not something anyone meant.
 */
export async function addWarmupSets(
  db: SqlExecutor,
  newId: IdFactory,
  sessionExerciseId: string,
  warmups: readonly { weightKg: number; reps: number }[],
  clock: Clock = defaultClock,
): Promise<number> {
  if (warmups.length === 0) return 0;

  const existing = await db.all<{ id: string; is_warmup: number }>(
    `SELECT id, is_warmup FROM sets
      WHERE session_exercise_id = ? AND deleted_at IS NULL
      ORDER BY set_index`,
    [sessionExerciseId],
  );
  if (existing.some((set) => set.is_warmup === 1)) return 0;

  const at = clock();
  const PARK = 100000;

  // Every existing set moves out of the way first; nothing can be renumbered into a slot its
  // neighbour has not left yet.
  for (const [offset, set] of existing.entries()) {
    await db.run(`UPDATE sets SET set_index = ? WHERE id = ?`, [PARK + offset, set.id]);
  }

  for (const [offset, warmup] of warmups.entries()) {
    const id = newId();
    await db.run(
      `INSERT INTO sets
         (id, session_exercise_id, set_index, weight_kg, reps, is_warmup, to_failure,
          completed_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 1, 0, ?, ?)`,
      [id, sessionExerciseId, offset + 1, warmup.weightKg, warmup.reps, at, at],
    );
    await enqueue(
      db,
      'set',
      id,
      'insert',
      { sessionExerciseId, setIndex: offset + 1, ...warmup, isWarmup: true },
      clock,
    );
  }

  for (const [offset, set] of existing.entries()) {
    const setIndex = warmups.length + offset + 1;
    await db.run(`UPDATE sets SET set_index = ?, updated_at = ? WHERE id = ?`, [
      setIndex,
      at,
      set.id,
    ]);
    await enqueue(db, 'set', set.id, 'update', { setIndex }, clock);
  }

  return warmups.length;
}

export async function addSetCopyingPrevious(
  db: SqlExecutor,
  newId: IdFactory,
  sessionExerciseId: string,
  clock: Clock = defaultClock,
): Promise<string> {
  const previous = await db.get<SetRow>(
    `SELECT * FROM sets WHERE session_exercise_id = ? AND deleted_at IS NULL
      ORDER BY set_index DESC LIMIT 1`,
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

  // Always stamped, never conditional: an edit the sync engine cannot see is an edit that
  // silently loses to whatever the other device wrote.
  assignments.push('updated_at = ?');
  params.push(clock());

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

  const at = clock();
  await db.run(
    `UPDATE sets SET deleted_at = ?, updated_at = ?, set_index = -rowid WHERE id = ?`,
    [at, at, setId],
  );
  await renumberSets(db, row.session_exercise_id);
  await enqueue(db, 'set', setId, 'delete', undefined, clock);
}

/**
 * Reassign contiguous 1..n set indices for one exercise. Safe to call when already contiguous.
 *
 * Only live rows are renumbered. Soft-deleted rows were parked at `-rowid` when they were
 * deleted, so they sit outside the positive range entirely and cannot collide.
 */
export async function renumberSets(
  db: SqlExecutor,
  sessionExerciseId: string,
): Promise<void> {
  const remaining = await db.all<{ id: string }>(
    `SELECT id FROM sets WHERE session_exercise_id = ? AND deleted_at IS NULL ORDER BY set_index`,
    [sessionExerciseId],
  );
  if (remaining.length === 0) return;

  const OFFSET = 100000;
  await db.run(
    `UPDATE sets SET set_index = set_index + ? WHERE session_exercise_id = ? AND deleted_at IS NULL`,
    [OFFSET, sessionExerciseId],
  );
  for (const [i, r] of remaining.entries()) {
    await db.run(`UPDATE sets SET set_index = ? WHERE id = ?`, [i + 1, r.id]);
  }
}

/** Same two-phase approach for exercise ordering within a session, live rows only. */
export async function renumberExercises(db: SqlExecutor, sessionId: string): Promise<void> {
  const remaining = await db.all<{ id: string }>(
    `SELECT id FROM session_exercises WHERE session_id = ? AND deleted_at IS NULL ORDER BY order_index`,
    [sessionId],
  );
  if (remaining.length === 0) return;

  const OFFSET = 100000;
  await db.run(
    `UPDATE session_exercises SET order_index = order_index + ? WHERE session_id = ? AND deleted_at IS NULL`,
    [OFFSET, sessionId],
  );
  for (const [i, r] of remaining.entries()) {
    await db.run(`UPDATE session_exercises SET order_index = ? WHERE id = ?`, [i + 1, r.id]);
  }
}

/**
 * Tick a set off (or untick it) during the workout.
 *
 * Deliberately NOT part of updateSet's patch surface: marking a set done is a tap on a
 * checkmark, not an edit to what was lifted, and the rest timer keys off exactly this
 * transition. Kept idempotent — re-marking a done set refreshes the stamp harmlessly.
 */
export async function markSetDone(
  db: SqlExecutor,
  setId: string,
  done: boolean,
  clock: Clock = defaultClock,
): Promise<void> {
  const at = clock();
  await db.run(`UPDATE sets SET done_at = ?, updated_at = ? WHERE id = ?`, [
    done ? at : null,
    at,
    setId,
  ]);
  await enqueue(db, 'set', setId, 'update', { doneAt: done ? at : null }, clock);
}

export async function listSets(
  db: SqlExecutor,
  sessionExerciseId: string,
): Promise<SetRow[]> {
  return db.all<SetRow>(
    `SELECT * FROM sets WHERE session_exercise_id = ? AND deleted_at IS NULL ORDER BY set_index`,
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
    `SELECT * FROM workout_sessions WHERE id = ? AND deleted_at IS NULL`,
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
  userId: string,
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
     LEFT JOIN session_exercises se ON se.session_id = ws.id AND se.deleted_at IS NULL
     LEFT JOIN sets s               ON s.session_exercise_id = se.id AND s.deleted_at IS NULL
     WHERE ws.user_id = ? AND ws.deleted_at IS NULL
     GROUP BY ws.id
     ORDER BY ws.started_at DESC
     LIMIT ?`,
    [userId, limit],
  );
}

export interface WorkoutStreak {
  /** Consecutive trained days ending today (or yesterday, if today is still open). */
  currentDays: number;
  trainedToday: boolean;
}

/** `YYYY-MM-DD` in the device's own local calendar day — matches SQLite's `date(x, 'localtime')`. */
function localDateString(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * How many consecutive calendar days, ending today, have at least one finished session.
 *
 * Not trained yet today doesn't break the streak — it just means today hasn't been decided
 * one way or the other. The count starts from yesterday in that case; it only actually breaks
 * once a full day passes with nothing logged.
 */
export async function getWorkoutStreak(db: SqlExecutor, userId: string): Promise<WorkoutStreak> {
  const rows = await db.all<{ day: string }>(
    `SELECT DISTINCT date(started_at, 'localtime') AS day
     FROM workout_sessions
     WHERE user_id = ? AND ended_at IS NOT NULL AND deleted_at IS NULL
     ORDER BY day DESC`,
    [userId],
  );
  const trainedDays = new Set(rows.map((r) => r.day));

  const today = new Date();
  const trainedToday = trainedDays.has(localDateString(today));

  const cursor = new Date(today);
  if (!trainedToday) cursor.setDate(cursor.getDate() - 1);

  let currentDays = 0;
  while (trainedDays.has(localDateString(cursor))) {
    currentDays += 1;
    cursor.setDate(cursor.getDate() - 1);
  }

  return { currentDays, trainedToday };
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
  userId: string,
  newId: IdFactory,
  sourceSessionId: string,
  clock: Clock = defaultClock,
): Promise<string | null> {
  const source = await db.get<WorkoutSessionRow>(
    `SELECT * FROM workout_sessions WHERE id = ? AND user_id = ? AND deleted_at IS NULL`,
    [sourceSessionId, userId],
  );
  if (!source) return null;

  const sessionId = await startSession(db, userId, newId, {}, clock);
  if (source.name) await renameSession(db, userId, sessionId, source.name, clock);

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
  userId: string,
  exerciseKey: string,
  excludeSessionId?: string,
  /**
   * Restrict "last time" to sessions of this kind.
   *
   * Without it the last bench press at another gym answers for this one, on a different bar and
   * a different bench. See `sessionType.ts`.
   */
  sameType?: SessionType | null,
): Promise<
  {
    set_index: number;
    weight_kg: number | null;
    reps: number | null;
    duration_seconds: number | null;
    distance_m: number | null;
    is_warmup: number;
    rpe: number | null;
    started_at: string;
  }[]
> {
  const exclude = excludeSessionId ?? null;
  const type = sameTypeClause('prev_ws', sameType);
  return db.all(
    `SELECT s.set_index, s.weight_kg, s.reps, s.duration_seconds, s.distance_m,
            s.is_warmup, s.rpe, ws.started_at
       FROM sets s
       JOIN session_exercises se ON se.id = s.session_exercise_id AND se.deleted_at IS NULL
       JOIN workout_sessions ws  ON ws.id = se.session_id AND ws.deleted_at IS NULL
      WHERE ws.user_id = ?
        AND se.exercise_key = ?
        AND s.deleted_at IS NULL
        AND ws.id = (
          SELECT prev_ws.id
            FROM workout_sessions prev_ws
            JOIN session_exercises prev_se
              ON prev_se.session_id = prev_ws.id AND prev_se.deleted_at IS NULL
           WHERE prev_ws.user_id = ?
             AND prev_se.exercise_key = ?
             AND prev_ws.deleted_at IS NULL
             AND (? IS NULL OR prev_ws.id <> ?)
             AND ${type.sql}
             AND EXISTS (
               SELECT 1 FROM sets prev_s
                WHERE prev_s.session_exercise_id = prev_se.id
                  AND prev_s.deleted_at IS NULL
                  AND (prev_s.weight_kg IS NOT NULL OR prev_s.reps IS NOT NULL
                       OR prev_s.duration_seconds IS NOT NULL OR prev_s.distance_m IS NOT NULL)
             )
           ORDER BY prev_ws.started_at DESC
           LIMIT 1
        )
      ORDER BY s.set_index`,
    [userId, exerciseKey, userId, exerciseKey, exclude, exclude, ...type.params],
  );
}

/**
 * Distinct named workouts, most recently performed first — the template list.
 * Only the latest session per name is offered, since that is the one carrying current weights.
 */
export async function listNamedTemplates(
  db: SqlExecutor,
  userId: string,
  limit = 20,
): Promise<{ id: string; name: string; started_at: string; exercise_count: number }[]> {
  return db.all(
    `SELECT ws.id, ws.name, ws.started_at, COUNT(DISTINCT se.id) AS exercise_count
       FROM workout_sessions ws
       LEFT JOIN session_exercises se ON se.session_id = ws.id AND se.deleted_at IS NULL
      WHERE ws.user_id = ?
        AND ws.name IS NOT NULL
        AND ws.deleted_at IS NULL
        AND ws.id = (
          SELECT inner_ws.id FROM workout_sessions inner_ws
           WHERE inner_ws.user_id = ? AND inner_ws.name = ws.name
             AND inner_ws.deleted_at IS NULL
           ORDER BY inner_ws.started_at DESC LIMIT 1
        )
      GROUP BY ws.id
      HAVING exercise_count > 0
      ORDER BY ws.started_at DESC
      LIMIT ?`,
    [userId, userId, limit],
  );
}

/**
 * The heaviest working set previously recorded for an exercise, excluding the current session.
 * Drives the "last time you did X" hint next to each exercise while logging.
 */
export async function getPreviousBest(
  db: SqlExecutor,
  userId: string,
  exerciseKey: string,
  excludeSessionId?: string,
): Promise<{ weight_kg: number; reps: number; started_at: string } | null> {
  return db.get<{ weight_kg: number; reps: number; started_at: string }>(
    `SELECT s.weight_kg, s.reps, ws.started_at
       FROM sets s
       JOIN session_exercises se ON se.id = s.session_exercise_id AND se.deleted_at IS NULL
       JOIN workout_sessions ws  ON ws.id = se.session_id AND ws.deleted_at IS NULL
      WHERE ws.user_id = ?
        AND se.exercise_key = ?
        AND s.is_warmup = 0
        AND s.deleted_at IS NULL
        AND s.weight_kg IS NOT NULL
        AND s.reps IS NOT NULL
        AND (? IS NULL OR ws.id <> ?)
      ORDER BY s.weight_kg DESC, s.reps DESC
      LIMIT 1`,
    [userId, exerciseKey, excludeSessionId ?? null, excludeSessionId ?? null],
  );
}

/**
 * Exercise keys logged most recently, newest first, deduplicated. Drives the "recently used"
 * shortcut at the top of the exercise picker — the exercises someone actually reaches for are a
 * much smaller set than the full catalogue, and re-adding one from last week is the common case.
 */
export async function listRecentExerciseKeys(
  db: SqlExecutor,
  userId: string,
  limit = 8,
): Promise<string[]> {
  const rows = await db.all<{ exercise_key: string }>(
    `SELECT se.exercise_key, MAX(ws.started_at) AS last_used
       FROM session_exercises se
       JOIN workout_sessions ws ON ws.id = se.session_id AND ws.deleted_at IS NULL
      WHERE ws.user_id = ? AND se.deleted_at IS NULL
      GROUP BY se.exercise_key
      ORDER BY last_used DESC
      LIMIT ?`,
    [userId, limit],
  );
  return rows.map((row) => row.exercise_key);
}
