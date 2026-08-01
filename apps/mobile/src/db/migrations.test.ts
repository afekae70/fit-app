/**
 * Migration tests — the one thing the rest of the suite cannot cover.
 *
 * Every other test builds its database from `CREATE_SCHEMA_SQL`, which is the *fresh install*
 * path. Real devices never take that path: they carry workout data written under an older
 * schema and arrive through `MIGRATIONS`. A migration that only works on an empty database is
 * exactly the bug that destroys someone's training history, and nothing else here would catch
 * it.
 *
 * These tests therefore build a database in the shape a real phone would have, run the
 * migration the same statement-at-a-time way `db/index.ts` does, and check the data survived.
 */

import { createRequire } from 'node:module';

const nodeRequire = createRequire(import.meta.url);
const { DatabaseSync } = nodeRequire('node:sqlite') as {
  DatabaseSync: new (path: string) => {
    exec(sql: string): void;
    prepare(sql: string): { all(...p: never[]): unknown[]; get(...p: never[]): unknown };
    close(): void;
  };
};

import { describe, expect, it } from 'vitest';

import { MIGRATIONS, SCHEMA_VERSION } from './schema.js';

/**
 * The pre-v7 shape, trimmed to the tables migration 7 touches. Written out literally rather
 * than derived from CREATE_SCHEMA_SQL: the point is to reproduce what is actually on a device
 * that never saw the new columns, and deriving it from today's schema would quietly include
 * them and make the test prove nothing.
 */
const V6_SCHEMA = `
CREATE TABLE workout_sessions (
  id TEXT PRIMARY KEY NOT NULL, user_id TEXT NOT NULL DEFAULT 'local',
  location_id TEXT, plan_day_id TEXT, name TEXT,
  started_at TEXT NOT NULL, ended_at TEXT, bodyweight_kg REAL, session_rpe REAL,
  notes TEXT, server_id TEXT, created_at TEXT NOT NULL
);
CREATE TABLE session_exercises (
  id TEXT PRIMARY KEY NOT NULL, session_id TEXT NOT NULL, exercise_key TEXT NOT NULL,
  order_index INTEGER NOT NULL, notes TEXT, UNIQUE (session_id, order_index)
);
CREATE TABLE sets (
  id TEXT PRIMARY KEY NOT NULL, session_exercise_id TEXT NOT NULL, set_index INTEGER NOT NULL,
  weight_kg REAL, reps INTEGER, duration_seconds INTEGER, distance_m REAL, rpe REAL,
  is_warmup INTEGER NOT NULL DEFAULT 0, to_failure INTEGER NOT NULL DEFAULT 0,
  completed_at TEXT NOT NULL, UNIQUE (session_exercise_id, set_index)
);
CREATE TABLE body_metrics (
  id TEXT PRIMARY KEY NOT NULL, user_id TEXT NOT NULL DEFAULT 'local',
  measured_at TEXT NOT NULL, weight_kg REAL, body_fat_pct REAL, muscle_mass_kg REAL,
  water_pct REAL, bone_mass_kg REAL, visceral_fat REAL, source TEXT NOT NULL,
  device_id TEXT, raw_payload TEXT
);
CREATE TABLE plans (
  id TEXT PRIMARY KEY NOT NULL, user_id TEXT NOT NULL DEFAULT 'local', name TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL
);
CREATE TABLE plan_days (
  id TEXT PRIMARY KEY NOT NULL, plan_id TEXT NOT NULL, day_index INTEGER NOT NULL, name TEXT,
  UNIQUE (plan_id, day_index)
);
CREATE TABLE plan_day_exercises (
  id TEXT PRIMARY KEY NOT NULL, plan_day_id TEXT NOT NULL, exercise_key TEXT NOT NULL,
  order_index INTEGER NOT NULL, target_sets INTEGER, target_reps_min INTEGER,
  target_reps_max INTEGER, notes TEXT, UNIQUE (plan_day_id, order_index)
);
`;

/** Mirrors db/index.ts: statement at a time, tolerating "already exists" the same way. */
function applyMigration(db: { exec(sql: string): void }, sql: string): void {
  for (const statement of sql.split(';').map((s) => s.trim()).filter(Boolean)) {
    try {
      db.exec(`${statement};`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!/duplicate column|already exists/i.test(message)) throw error;
    }
  }
}

function seededV6Database() {
  const db = new DatabaseSync(':memory:');
  db.exec(V6_SCHEMA);
  db.exec(`
    INSERT INTO workout_sessions (id, user_id, name, started_at, created_at)
      VALUES ('s1', 'u1', 'Push A', '2026-01-01T10:00:00.000Z', '2026-01-01T10:00:00.000Z');
    INSERT INTO session_exercises (id, session_id, exercise_key, order_index)
      VALUES ('e1', 's1', 'Barbell Bench Press', 1);
    INSERT INTO sets (id, session_exercise_id, set_index, weight_kg, reps, completed_at)
      VALUES ('t1', 'e1', 1, 100, 5, '2026-01-01T10:05:00.000Z');
    INSERT INTO body_metrics (id, user_id, measured_at, weight_kg, source)
      VALUES ('m1', 'u1', '2026-01-01T07:00:00.000Z', 80.5, 'manual');
    INSERT INTO plans (id, user_id, name, is_active, created_at)
      VALUES ('p1', 'u1', 'PPL', 1, '2026-01-01T09:00:00.000Z');
    INSERT INTO plan_days (id, plan_id, day_index, name) VALUES ('d1', 'p1', 1, 'Push');
    INSERT INTO plan_day_exercises (id, plan_day_id, exercise_key, order_index)
      VALUES ('x1', 'd1', 'Barbell Bench Press', 1);
  `);
  return db;
}

describe('migration 7 — sync columns', () => {
  it('is the version the app actually ships', () => {
    // A migration that exists but is never reached is the same as no migration at all.
    expect(SCHEMA_VERSION).toBe(7);
    expect(MIGRATIONS[7]).toBeDefined();
  });

  it('runs on a populated v6 database without losing a single row', () => {
    const db = seededV6Database();
    applyMigration(db, MIGRATIONS[7] ?? '');

    for (const [table, id] of [
      ['workout_sessions', 's1'],
      ['session_exercises', 'e1'],
      ['sets', 't1'],
      ['body_metrics', 'm1'],
      ['plans', 'p1'],
      ['plan_days', 'd1'],
      ['plan_day_exercises', 'x1'],
    ] as const) {
      const row = db.prepare(`SELECT id FROM ${table} WHERE id = ?`).get(id as never) as
        | { id: string }
        | undefined;
      expect(row?.id, table).toBe(id);
    }

    // The workout's name is what makes it reusable as a template — the column most at risk of
    // being dropped by a careless rebuild-the-table migration.
    const session = db.prepare(`SELECT name FROM workout_sessions WHERE id = 's1'`).get() as {
      name: string;
    };
    expect(session.name).toBe('Push A');
    db.close();
  });

  it('backfills updated_at on existing rows so a first sync uploads the history', () => {
    const db = seededV6Database();
    applyMigration(db, MIGRATIONS[7] ?? '');

    // Null here would mean the row looks unchanged and never gets pushed — the history would
    // sit on the phone forever while appearing to be backed up.
    for (const table of ['workout_sessions', 'sets', 'body_metrics', 'plans']) {
      const row = db.prepare(`SELECT updated_at FROM ${table} LIMIT 1`).get() as {
        updated_at: string | null;
      };
      expect(row.updated_at, table).not.toBeNull();
      expect(row.updated_at, table).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    }

    const set = db.prepare(`SELECT deleted_at FROM sets WHERE id = 't1'`).get() as {
      deleted_at: string | null;
    };
    expect(set.deleted_at).toBeNull();
    db.close();
  });

  it('creates the sync cursor table', () => {
    const db = seededV6Database();
    applyMigration(db, MIGRATIONS[7] ?? '');

    db.exec(`INSERT INTO sync_state (user_id, last_pulled_at) VALUES ('u1', '2026-01-01T00:00:00Z')`);
    const row = db.prepare(`SELECT last_pulled_at FROM sync_state WHERE user_id = 'u1'`).get() as {
      last_pulled_at: string;
    };
    expect(row.last_pulled_at).toBe('2026-01-01T00:00:00Z');
    db.close();
  });

  it('is safe to run twice, as a half-finished upgrade would', () => {
    // db/index.ts swallows duplicate-column errors precisely so a retry is survivable; this
    // pins that behaviour rather than leaving it to chance.
    const db = seededV6Database();
    applyMigration(db, MIGRATIONS[7] ?? '');
    expect(() => applyMigration(db, MIGRATIONS[7] ?? '')).not.toThrow();

    const count = db.prepare(`SELECT COUNT(*) AS n FROM sets`).get() as { n: number };
    expect(count.n).toBe(1);
    db.close();
  });
});
