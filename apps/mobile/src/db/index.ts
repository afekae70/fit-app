/**
 * SQLite connection and migration.
 *
 * A single shared connection is opened lazily and reused. `openDatabaseAsync` is safe to call
 * repeatedly, but holding one handle keeps WAL mode and the `foreign_keys` pragma applied
 * consistently — `PRAGMA foreign_keys` is per-connection, not per-database, so a second
 * connection that skipped it would silently ignore the ON DELETE CASCADE rules.
 */

import * as SQLite from 'expo-sqlite';

import {
  CREATE_SCHEMA_SQL,
  isDuplicateColumnError,
  pendingMigrations,
  SCHEMA_VERSION,
} from './schema.js';

const DATABASE_NAME = 'fit.db';

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

/**
 * Bring an existing database up to the current schema version.
 *
 * Runs only the migrations newer than the stored `user_version`, in ascending order. This is
 * what lets a column be added without destroying the workouts already logged on a device —
 * `CREATE TABLE IF NOT EXISTS` silently does nothing for a table that already exists, so a new
 * column would otherwise never appear.
 */
async function migrate(db: SQLite.SQLiteDatabase): Promise<void> {
  const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version;');
  const current = row?.user_version ?? 0;

  // One statement at a time, each with its own guard. Running a version as a single batch
  // would mean a swallowed "duplicate column" on the first statement silently skipping the
  // rest of it — the schema left half-upgraded while user_version claims it is finished.
  for (const { sql } of pendingMigrations(current)) {
    try {
      await db.execAsync(sql);
    } catch (error) {
      if (!isDuplicateColumnError(error)) throw error;
    }
  }

  // PRAGMA does not accept bound parameters, hence the interpolation. SCHEMA_VERSION is a
  // module constant, never user input.
  await db.execAsync(`PRAGMA user_version = ${SCHEMA_VERSION};`);
}

async function initialise(): Promise<SQLite.SQLiteDatabase> {
  const db = await SQLite.openDatabaseAsync(DATABASE_NAME);
  await db.execAsync(CREATE_SCHEMA_SQL);
  await migrate(db);
  return db;
}

export function getDb(): Promise<SQLite.SQLiteDatabase> {
  dbPromise ??= initialise();
  return dbPromise;
}

/**
 * Drop every table and rebuild. Development helper — the app database persists across reloads
 * on device, so tests and manual debugging need a way back to a clean slate.
 */
export async function resetDb(): Promise<void> {
  const db = await getDb();
  await db.execAsync(`
    PRAGMA foreign_keys = OFF;
    DROP TABLE IF EXISTS outbox;
    DROP TABLE IF EXISTS sets;
    DROP TABLE IF EXISTS session_exercises;
    DROP TABLE IF EXISTS workout_sessions;
    DROP TABLE IF EXISTS plan_day_exercises;
    DROP TABLE IF EXISTS plan_days;
    DROP TABLE IF EXISTS plans;
    DROP TABLE IF EXISTS nutrition_targets;
    DROP TABLE IF EXISTS body_metrics;
    DROP TABLE IF EXISTS profile;
    PRAGMA foreign_keys = ON;
  `);
  await db.execAsync(CREATE_SCHEMA_SQL);
  await db.execAsync(`PRAGMA user_version = ${SCHEMA_VERSION};`);
}

export { DATABASE_NAME };
