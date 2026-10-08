/**
 * Removing one person's data from this device.
 *
 * Deleting an account has two halves. The server half is one call, and the database there
 * cascades from the account to everything it owns. This is the other half: the copy on the
 * phone, which the server cannot reach and which would otherwise sit there — every workout and
 * every weigh-in — after the person had been told it was gone.
 *
 * It removes *this user's* rows, not the database. The local database is keyed by user id
 * precisely because more than one account can have been signed in on a phone, and "delete my
 * account" is not a request to destroy somebody else's training log on the same device.
 * `resetDb()` exists and would be simpler; it is a development helper and it is the wrong tool.
 *
 * Children are deleted explicitly, parents last, rather than left to `ON DELETE CASCADE`. The
 * cascades are declared, but `PRAGMA foreign_keys` is per connection in SQLite and off by
 * default — a deletion that silently depends on a pragma having been set is one that leaves
 * orphaned sets behind on the day it was not, and nothing would say so.
 */

import type { SqlExecutor } from './executor.js';

/**
 * Tables that carry a `user_id` of their own, in an order that is safe to delete in.
 *
 * A new user-scoped table has to be added here, or deleting an account leaves its rows behind.
 * The test for this file fails when a table with a `user_id` column is missing from the purge,
 * so the omission is caught by a red test rather than by a privacy complaint.
 */
const USER_TABLES = [
  'sync_state',
  'coach_briefs',
  'scheduled_days',
  'nutrition_targets',
  'body_metrics',
  'locations',
  'profile',
] as const;

/**
 * Every table with a `user_id` column that the purge deals with — the list the test compares
 * against the schema.
 */
export const PURGED_TABLES: readonly string[] = [...USER_TABLES, 'workout_sessions', 'plans', 'outbox'];

/** Delete everything on this device that belongs to `userId`. Other users' rows are untouched. */
export async function purgeUserData(db: SqlExecutor, userId: string): Promise<void> {
  // Workouts: sets, then the exercises they hang off, then the sessions.
  await db.run(
    `DELETE FROM sets WHERE session_exercise_id IN (
       SELECT se.id FROM session_exercises se
         JOIN workout_sessions ws ON ws.id = se.session_id
        WHERE ws.user_id = ?)`,
    [userId],
  );
  await db.run(
    `DELETE FROM session_exercises WHERE session_id IN (
       SELECT id FROM workout_sessions WHERE user_id = ?)`,
    [userId],
  );
  await db.run(`DELETE FROM workout_sessions WHERE user_id = ?`, [userId]);

  // Plans: the same shape, one level deeper.
  await db.run(
    `DELETE FROM plan_day_exercises WHERE plan_day_id IN (
       SELECT pd.id FROM plan_days pd
         JOIN plans p ON p.id = pd.plan_id
        WHERE p.user_id = ?)`,
    [userId],
  );
  await db.run(
    `DELETE FROM plan_days WHERE plan_id IN (SELECT id FROM plans WHERE user_id = ?)`,
    [userId],
  );
  await db.run(`DELETE FROM plans WHERE user_id = ?`, [userId]);

  for (const table of USER_TABLES) {
    await db.run(`DELETE FROM ${table} WHERE user_id = ?`, [userId]);
  }

  // The queue, and the one place this reaches beyond the user's own rows. Workout writes are
  // queued with no user on them (see the note in workouts.ts), so the rows that describe this
  // person's sessions cannot be told from anyone else's. Nothing in the app reads the queue, so
  // clearing the unattributed rows costs nobody anything — and leaving them would keep a log,
  // with payloads, of exactly what was just deleted.
  await db.run(`DELETE FROM outbox WHERE user_id = ? OR user_id = 'local'`, [userId]);
}
