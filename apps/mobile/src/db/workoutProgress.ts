/**
 * Reading the training log as lines of same-named workouts.
 *
 * The database half of `progress/workoutProgress.ts`, which says what the numbers mean. This
 * only fetches them: every finished workout that has a name, with what it came to, and the
 * working sets of each exercise in any of them.
 */

import type { ExerciseSets } from '../progress/setBySet.js';
import type { SessionPoint } from '../progress/workoutProgress.js';
import type { SqlExecutor } from './executor.js';

/**
 * Every finished, named workout of this account, oldest first, with its totals.
 *
 * The name is the workout's own; failing that, the name of the plan day it was started from —
 * a workout begun from "Legs" in the plan is a leg day whether or not anyone typed the word
 * again. A workout with neither is left out: it belongs to no line.
 *
 * Only sets that were ticked off and are not warm-ups count, the same line the history and the
 * weekly sets draw, so a workout's number here is the number shown for it everywhere else.
 */
export async function listWorkoutPoints(db: SqlExecutor, userId: string): Promise<SessionPoint[]> {
  const rows = await db.all<{
    id: string;
    name: string;
    started_at: string;
    ended_at: string | null;
    sets: number | null;
    reps: number | null;
    distance_m: number | null;
  }>(
    `SELECT ws.id,
            COALESCE(NULLIF(TRIM(ws.name), ''), NULLIF(TRIM(pd.name), '')) AS name,
            ws.started_at,
            ws.ended_at,
            (SELECT COUNT(*)
               FROM sets s JOIN session_exercises se ON se.id = s.session_exercise_id
              WHERE se.session_id = ws.id AND se.deleted_at IS NULL AND s.deleted_at IS NULL
                AND s.done_at IS NOT NULL AND s.is_warmup = 0) AS sets,
            (SELECT SUM(s.reps)
               FROM sets s JOIN session_exercises se ON se.id = s.session_exercise_id
              WHERE se.session_id = ws.id AND se.deleted_at IS NULL AND s.deleted_at IS NULL
                AND s.done_at IS NOT NULL AND s.is_warmup = 0) AS reps,
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
    sets: row.sets ?? 0,
    reps: row.reps ?? 0,
    distanceM: row.distance_m ?? 0,
  }));
}

/** How many ids go into one `IN (…)`: well under SQLite's limit on bound values. */
const CHUNK = 400;

/**
 * The working sets of each exercise in each of the given workouts of this account.
 *
 * By workout id; each workout's exercises in the order they were done, each exercise's sets in
 * the order they were done. Only sets that were ticked off and are not warm-ups — the sets that
 * are compared set by set (see `progress/setBySet.ts`). An exercise done twice in one workout
 * is one exercise with the sets of both, in order: the second time is more sets of it, not
 * another lift. A workout with no such set is not in the map.
 */
export async function listSessionSets(
  db: SqlExecutor,
  userId: string,
  sessionIds: readonly string[],
): Promise<Map<string, ExerciseSets[]>> {
  const bySession = new Map<string, Map<string, ExerciseSets>>();
  const unique = [...new Set(sessionIds)];
  for (let start = 0; start < unique.length; start += CHUNK) {
    const ids = unique.slice(start, start + CHUNK);
    const rows = await db.all<{
      session_id: string;
      exercise_key: string;
      weight_kg: number | null;
      reps: number | null;
      duration_seconds: number | null;
      distance_m: number | null;
    }>(
      `SELECT se.session_id, se.exercise_key, s.weight_kg, s.reps, s.duration_seconds, s.distance_m
         FROM session_exercises se
         JOIN workout_sessions ws ON ws.id = se.session_id
         JOIN sets s ON s.session_exercise_id = se.id
        WHERE se.session_id IN (${ids.map(() => '?').join(', ')}) AND ws.user_id = ?
          AND ws.deleted_at IS NULL AND se.deleted_at IS NULL AND s.deleted_at IS NULL
          AND s.done_at IS NOT NULL AND s.is_warmup = 0
        ORDER BY se.session_id, se.order_index, se.id, s.set_index, s.id`,
      [...ids, userId],
    );
    for (const row of rows) {
      const exercises = bySession.get(row.session_id) ?? new Map<string, ExerciseSets>();
      bySession.set(row.session_id, exercises);
      // A Map keeps the order its keys were first set in, which is the order of the workout.
      const exercise = exercises.get(row.exercise_key) ?? {
        exerciseKey: row.exercise_key,
        sets: [],
      };
      exercises.set(row.exercise_key, exercise);
      exercise.sets.push({
        weightKg: row.weight_kg,
        reps: row.reps,
        durationSeconds: row.duration_seconds,
        distanceM: row.distance_m,
      });
    }
  }
  return new Map([...bySession].map(([id, exercises]) => [id, [...exercises.values()]]));
}
