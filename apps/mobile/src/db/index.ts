/**
 * SQLite connection and migration.
 *
 * A single shared connection is opened lazily and reused. `openDatabaseAsync` is safe to call
 * repeatedly, but holding one handle keeps WAL mode and the `foreign_keys` pragma applied
 * consistently — `PRAGMA foreign_keys` is per-connection, not per-database, so a second
 * connection that skipped it would silently ignore the ON DELETE CASCADE rules.
 */

import * as SQLite from 'expo-sqlite';

import { CREATE_SCHEMA_SQL, MIGRATIONS, SCHEMA_VERSION } from './schema.js';

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

  if (current >= SCHEMA_VERSION) return;

  const pending = Object.keys(MIGRATIONS)
    .map(Number)
    .filter((version) => version > current)
    .sort((a, b) => a - b);

  for (const version of pending) {
    const sql = MIGRATIONS[version];
    if (!sql) continue;
    try {
      await db.execAsync(sql);
    } catch (error) {
      // A fresh install already has the column from CREATE_SCHEMA_SQL, so ALTER TABLE fails
      // with "duplicate column". That is expected and harmless; anything else is not.
      const message = error instanceof Error ? error.message : String(error);
      if (!/duplicate column/i.test(message)) throw error;
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
    DROP TABLE IF EXISTS nutrition_targets;
    DROP TABLE IF EXISTS body_metrics;
    DROP TABLE IF EXISTS profile;
    PRAGMA foreign_keys = ON;
  `);
  await db.execAsync(CREATE_SCHEMA_SQL);
  await db.execAsync(`PRAGMA user_version = ${SCHEMA_VERSION};`);
}

export { DATABASE_NAME };
