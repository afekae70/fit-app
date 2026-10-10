/**
 * Reading the training log as lines of same-named workouts.
 *
 * The database half of `progress/workoutProgress.ts`, which says what the numbers mean. This
 * only fetches them: every finished workout that has a name, with what it came to, and the
 * best set of each exercise in one workout.
 */

import type { ExerciseBest, SessionPoint } from '../progress/workoutProgress.js';
import type { SqlExecutor } from './executor.js';

/**
 * Every finished, named workout of this account, oldest first, with its totals.
 *
 * The name is the workout's own; failing that, the name of the plan day it was started from —
 * a workout begun from "Legs" in the plan is a leg day whether or not anyone typed the word
 * again. A workout with neither is left out: it belongs to no line.
 *
 * Only sets that were ticked off and are not warm-ups count, the same line the history and the
 * weekly volume draw, so a workout's number here is the number shown for it everywhere else.
 */
export async function listWorkoutPoints(db: SqlExecutor, userId: string): Promise<SessionPoint[]> {
  const rows = await db.all<{
    id: string;
    name: string;
    started_at: string;
    ended_at: string | null;
    volume_kg: number | null;
    sets: number | null;
    distance_m: number | null;
  }>(
    `SELECT ws.id,
            COALESCE(NULLIF(TRIM(ws.name), ''), NULLIF(TRIM(pd.name), '')) AS name,
            ws.started_at,
            ws.ended_at,
            (SELECT SUM(s.weight_kg * s.reps)
               FROM sets s JOIN session_exercises se ON se.id = s.session_exercise_id
              WHERE se.session_id = ws.id AND se.deleted_at IS NULL AND s.deleted_at IS NULL
                AND s.done_at IS NOT NULL AND s.is_warmup = 0) AS volume_kg,
            (SELECT COUNT(*)
               FROM sets s JOIN session_exercises se ON se.id = s.session_exercise_id
              WHERE se.session_id = ws.id AND se.deleted_at IS NULL AND s.deleted_at IS NULL
                AND s.done_at IS NOT NULL AND s.is_warmup = 0) AS sets,
            (SELECT SUM(s.distance_m)
               FROM sets s JOIN session_exercises se ON se.id = s.session_exercise_id
              WHERE se.session_id = ws.id AND se.deleted_at IS NULL AND s.deleted_at IS NULL
                AND s.done_at IS NOT NULL AND s.is_warmup = 0) AS distance_m
       FROM workout_sessions ws
       LEFT JOIN plan_days pd ON pd.id = ws.plan_day_id
      WHERE ws.user_id = ? AND ws.deleted_at IS NULL AND ws.ended_at IS NOT NULL
        AND COALESCE(NULLIF(TRIM(ws.name), ''), NULLIF(TRIM(pd.name), '')) IS NOT NULL
      ORDER BY ws.started_at, ws.id`,
    [userId],
  );
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    volumeKg: row.volume_kg ?? 0,
    sets: row.sets ?? 0,
    distanceM: row.distance_m ?? 0,
  }));
}

/**
 * The best working set of each exercise in one workout, in the order they were done.
 *
 * Heaviest first, and the most reps among the heaviest — the same "best set" the finished
 * workout's own screen marks. An exercise with no weight on any set is told by its most reps.
 * One with no finished working set at all is not in the list: nothing was done to compare.
 */
export async function listExerciseBests(
  db: SqlExecutor,
  userId: string,
  sessionId: string,
): Promise<ExerciseBest[]> {
  const rows = await db.all<{
    exercise_id: string;
    exercise_key: string;
    weight_kg: number | null;
    reps: number | null;
  }>(
    `SELECT se.id AS exercise_id, se.exercise_key, s.weight_kg, s.reps
       FROM session_exercises se
       JOIN workout_sessions ws ON ws.id = se.session_id
       JOIN sets s ON s.session_exercise_id = se.id
      WHERE se.session_id = ? AND ws.user_id = ?
        AND se.deleted_at IS NULL AND s.deleted_at IS NULL
        AND s.done_at IS NOT NULL AND s.is_warmup = 0
      ORDER BY se.order_index, se.id, s.set_index`,
    [sessionId, userId],
  );

  const bests = new Map<string, ExerciseBest>();
  for (const row of rows) {
    const current = bests.get(row.exercise_id);
    const heavier = (row.weight_kg ?? 0) > (current?.weightKg ?? 0);
    const sameWeightMoreReps =
      (row.weight_kg ?? 0) === (current?.weightKg ?? 0) && (row.reps ?? 0) > (current?.reps ?? 0);
    if (!current || heavier || sameWeightMoreReps) {
      bests.set(row.exercise_id, {
        exerciseKey: row.exercise_key,
        weightKg: row.weight_kg,
        reps: row.reps,
      });
    }
  }
  // A Map keeps the order its keys were first set in, which is the order of the workout.
  return [...bests.values()];
}
