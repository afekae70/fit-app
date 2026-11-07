/**
 * The sets the monthly review reads (`progress/monthlyReview.ts`), straight from the phone's
 * database. Working sets that were ticked off only: warm-ups and untouched rows are not work.
 */

import {
  LOOKBACK_DAYS,
  monthBounds,
  shiftMonth,
  type SessionSets,
} from '../progress/monthlyReview.js';
import type { SqlExecutor } from './executor.js';

/**
 * Every exercise's sessions between two instants, oldest first, each with its working sets in
 * the order they were done. An exercise entered twice in one workout reads as one session.
 */
export async function listSessionsBetween(
  db: SqlExecutor,
  userId: string,
  fromIso: string,
  toIso: string,
): Promise<Map<string, SessionSets[]>> {
  const rows = await db.all<{
    exercise_key: string;
    session_id: string;
    started_at: string;
    weight_kg: number | null;
    reps: number | null;
    duration_seconds: number | null;
    distance_m: number | null;
  }>(
    `SELECT se.exercise_key, ws.id AS session_id, ws.started_at,
            s.weight_kg, s.reps, s.duration_seconds, s.distance_m
       FROM sets s
       JOIN session_exercises se ON se.id = s.session_exercise_id AND se.deleted_at IS NULL
       JOIN workout_sessions ws  ON ws.id = se.session_id AND ws.deleted_at IS NULL
      WHERE ws.user_id = ? AND ws.started_at >= ? AND ws.started_at < ?
        AND s.deleted_at IS NULL AND s.done_at IS NOT NULL AND s.is_warmup = 0
      ORDER BY ws.started_at, ws.id, se.order_index, se.id, s.set_index, s.id`,
    [userId, fromIso, toIso],
  );

  const byExercise = new Map<string, SessionSets[]>();
  for (const row of rows) {
    const line = byExercise.get(row.exercise_key) ?? [];
    if (line.length === 0) byExercise.set(row.exercise_key, line);
    let session = line.at(-1);
    if (session?.sessionId !== row.session_id) {
      session = { sessionId: row.session_id, startedAt: row.started_at, sets: [] };
      line.push(session);
    }
    session.sets.push({
      weightKg: row.weight_kg,
      reps: row.reps,
      durationSeconds: row.duration_seconds,
      distanceM: row.distance_m,
    });
  }
  return byExercise;
}

/**
 * What one month's review needs: the month itself, and far enough back to judge the month
 * before it too — whose verdict decides one of the tips — with the session that month is set
 * against.
 */
export async function loadMonthHistory(
  db: SqlExecutor,
  userId: string,
  month: string,
): Promise<Map<string, SessionSets[]>> {
  const { end } = monthBounds(month);
  const { start: previous } = monthBounds(shiftMonth(month, -1));
  const from = new Date(previous.getTime() - LOOKBACK_DAYS * 86_400_000);
  return listSessionsBetween(db, userId, from.toISOString(), end.toISOString());
}

/** Every month, `YYYY-MM` in local time, with at least one working set ticked off. */
export async function listTrainingMonths(db: SqlExecutor, userId: string): Promise<string[]> {
  const rows = await db.all<{ month: string }>(
    `SELECT DISTINCT strftime('%Y-%m', ws.started_at, 'localtime') AS month
       FROM sets s
       JOIN session_exercises se ON se.id = s.session_exercise_id AND se.deleted_at IS NULL
       JOIN workout_sessions ws  ON ws.id = se.session_id AND ws.deleted_at IS NULL
      WHERE ws.user_id = ? AND s.deleted_at IS NULL AND s.done_at IS NOT NULL
        AND s.is_warmup = 0
      ORDER BY month`,
    [userId],
  );
  return rows.map((row) => row.month);
}
