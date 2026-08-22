/**
 * Reading the whole history back out, flat.
 *
 * Two queries, both deliberately denormalised: the joins that identify a set — its session, its
 * gym — are resolved here rather than left for the caller, because the destination is a
 * spreadsheet and a spreadsheet has no joins.
 *
 * Deleted rows are excluded at every level. A set whose session was deleted is gone as far as
 * the app is concerned, and an export that quietly resurrected it would disagree with every
 * screen the user has ever looked at.
 */

import type { SqlExecutor } from './executor.js';
import type { ExportedMetric, ExportedSet } from '../export/csv.js';

/**
 * Every set ever logged, oldest first.
 *
 * Chronological because that is the order a training history is read in, and because a
 * spreadsheet's default is to keep the order it was given.
 */
export async function exportSets(
  db: SqlExecutor,
  userId: string,
): Promise<ExportedSet[]> {
  return db.all<ExportedSet>(
    `SELECT ws.started_at        AS startedAt,
            ws.name              AS workout,
            loc.name             AS gym,
            se.exercise_key      AS exercise,
            s.set_index          AS setIndex,
            s.is_warmup          AS isWarmup,
            s.weight_kg          AS weightKg,
            s.reps               AS reps,
            s.rpe                AS rpe,
            s.to_failure         AS toFailure,
            s.done_at            AS doneAt
       FROM sets s
       JOIN session_exercises se ON se.id = s.session_exercise_id AND se.deleted_at IS NULL
       JOIN workout_sessions ws  ON ws.id = se.session_id AND ws.deleted_at IS NULL
       -- LEFT, because a gym is optional and an inner join here would silently drop every
       -- workout logged before gyms existed, which is all of them.
       LEFT JOIN locations loc   ON loc.id = ws.location_id
      WHERE ws.user_id = ?
        AND s.deleted_at IS NULL
      ORDER BY ws.started_at, se.order_index, s.set_index`,
    [userId],
  );
}

/** Every weigh-in, oldest first. */
export async function exportMetrics(
  db: SqlExecutor,
  userId: string,
): Promise<ExportedMetric[]> {
  return db.all<ExportedMetric>(
    `SELECT measured_at   AS measuredAt,
            weight_kg     AS weightKg,
            body_fat_pct  AS bodyFatPct,
            source        AS source
       FROM body_metrics
      WHERE user_id = ? AND deleted_at IS NULL
      ORDER BY measured_at`,
    [userId],
  );
}
