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

import { CREATE_SCHEMA_SQL, MIGRATIONS, SCHEMA_VERSION } from './schema.js';

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

/**
 * The real startup sequence from `db/index.ts`: CREATE_SCHEMA_SQL as a single batch, then the
 * migrations. Both halves matter, and the order is the whole point.
 *
 * `execAsync` stops a batch at the first failing statement, so anything in CREATE_SCHEMA_SQL
 * that assumes a migration has already run takes the entire startup down with it — and because
 * `getDb()` caches the rejected promise, every screen that touches the database then fails to
 * load. That is not hypothetical: an index declared there on a column that only migration 7
 * adds shipped once and bricked three tabs on an upgraded device.
 */
function startUpLikeTheApp(db: { exec(sql: string): void }): void {
  db.exec(CREATE_SCHEMA_SQL.replace(/PRAGMA journal_mode = WAL;/, ''));
  for (const version of Object.keys(MIGRATIONS).map(Number).sort((a, b) => a - b)) {
    applyMigration(db, MIGRATIONS[version] ?? '');
  }
}

describe('startup on an already-populated device', () => {
  it('survives CREATE_SCHEMA_SQL running before the migrations', () => {
    const db = seededV6Database();

    // The regression: this threw "no such column: updated_at" and aborted the whole batch.
    expect(() => startUpLikeTheApp(db)).not.toThrow();

    const set = db.prepare(`SELECT weight_kg FROM sets WHERE id = 't1'`).get() as {
      weight_kg: number;
    };
    expect(set.weight_kg).toBe(100);
    db.close();
  });

  it('leaves every table the screens read from queryable with the new columns', () => {
    const db = seededV6Database();
    startUpLikeTheApp(db);

    // Each of these is what a tab actually runs. Before the fix these threw, which is why the
    // plan, workouts and metrics screens showed nothing at all.
    const queries = [
      `SELECT * FROM workout_sessions WHERE deleted_at IS NULL`,
      `SELECT * FROM session_exercises WHERE deleted_at IS NULL`,
      `SELECT * FROM sets WHERE deleted_at IS NULL`,
      `SELECT * FROM body_metrics WHERE deleted_at IS NULL`,
      `SELECT * FROM plans WHERE deleted_at IS NULL`,
      `SELECT * FROM plan_days WHERE deleted_at IS NULL`,
      `SELECT * FROM plan_day_exercises WHERE deleted_at IS NULL`,
      `SELECT * FROM sync_state`,
      `SELECT * FROM coach_briefs`,
    ];
    for (const sql of queries) {
      expect(() => db.prepare(sql).all(), sql).not.toThrow();
    }
    db.close();
  });

  it('works the same on a fresh install', () => {
    const db = new DatabaseSync(':memory:');
    expect(() => startUpLikeTheApp(db)).not.toThrow();

    db.exec(`INSERT INTO sync_state (user_id) VALUES ('u1')`);
    expect(db.prepare(`SELECT * FROM sync_state`).all()).toHaveLength(1);
    db.close();
  });
});

describe('migration 7 — sync columns', () => {
  it('is on the app upgrade path', () => {
    // A migration that exists but is never reached is the same as no migration at all.
    expect(SCHEMA_VERSION).toBeGreaterThanOrEqual(7);
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

describe('migration 8 — set done flag', () => {
  it('has a migration of its own', () => {
    expect(MIGRATIONS[8]).toBeDefined();
  });

  it('adds done_at as null on existing sets, unlike updated_at', () => {
    // The two backfills are opposite on purpose: updated_at must be non-null so the first sync
    // uploads history, while done_at must stay null — the flag marks a live-workout action, and
    // backfilling it would show every historic set as "ticked" with a fabricated time.
    const db = seededV6Database();
    startUpLikeTheApp(db);

    const row = db.prepare(`SELECT done_at, updated_at FROM sets WHERE id = 't1'`).get() as {
      done_at: string | null;
      updated_at: string | null;
    };
    expect(row.done_at).toBeNull();
    expect(row.updated_at).not.toBeNull();
    db.close();
  });
});

describe('migration 9 — the server clock gets its own column', () => {
  const SYNCED_TABLES = [
    'workout_sessions',
    'session_exercises',
    'sets',
    'body_metrics',
    'plans',
    'plan_days',
    'plan_day_exercises',
  ];

  it('adds remote_updated_at to every table that syncs', () => {
    const db = seededV6Database();
    startUpLikeTheApp(db);

    for (const table of SYNCED_TABLES) {
      const columns = (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map(
        (c) => c.name,
      );
      expect(columns, table).toContain('remote_updated_at');
    }
    db.close();
  });

  it('leaves it null on existing rows, so nothing looks already-synced', () => {
    // The opposite backfill to updated_at, and for the same reason it was chosen there: null here
    // means "the server has never seen this row", so the merge treats anything arriving for it as
    // news. Backfilling a time would claim these rows were already uploaded when they never were.
    const db = seededV6Database();
    startUpLikeTheApp(db);

    const row = db.prepare(`SELECT remote_updated_at FROM sets WHERE id = 't1'`).get() as {
      remote_updated_at: string | null;
    };
    expect(row.remote_updated_at).toBeNull();
    db.close();
  });

  it('reaches a fresh install too', () => {
    // Both startup paths, asserted separately rather than by diffing one against the other.
    // Diffing them looks like the stronger test and is in fact vacuous: migrations run on a fresh
    // database as well, so whatever CREATE_SCHEMA_SQL leaves out, migration 9 puts back, and the
    // two agree no matter what. Only checking each path against the requirement can fail.
    const fresh = new DatabaseSync(':memory:');
    startUpLikeTheApp(fresh);

    for (const table of SYNCED_TABLES) {
      const columns = (
        fresh.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]
      ).map((c) => c.name);
      expect(columns, table).toContain('remote_updated_at');
    }
    fresh.close();
  });
});

describe('migration 10 — unit preference', () => {
  const columnsOfProfile = (db: { prepare(sql: string): { all(): unknown[] } }) =>
    (db.prepare(`PRAGMA table_info(profile)`).all() as { name: string }[]).map((c) => c.name);

  it('adds unit_preference on an upgraded device', () => {
    const db = seededV6Database();
    startUpLikeTheApp(db);

    expect(columnsOfProfile(db)).toContain('unit_preference');
    db.close();
  });

  it('reaches a fresh install too', () => {
    const fresh = new DatabaseSync(':memory:');
    startUpLikeTheApp(fresh);

    expect(columnsOfProfile(fresh)).toContain('unit_preference');
    fresh.close();
  });

  it('leaves it null rather than defaulting to metric in the column', () => {
    // Null means "never chosen", which is not the same fact as "chose metric" — and the
    // distinction is what lets a future default (say, from the device locale) apply only to
    // people who have not expressed a preference. `parseUnitPreference` in @fit/shared is the
    // single place that turns the absence into a usable value.
    const db = seededV6Database();
    startUpLikeTheApp(db);
    db.exec(
      `INSERT INTO profile (user_id, updated_at) VALUES ('u1', '2026-01-01T09:00:00.000Z');`,
    );

    const row = db.prepare(`SELECT unit_preference FROM profile WHERE user_id = 'u1'`).get() as {
      unit_preference: string | null;
    };
    expect(row.unit_preference).toBeNull();
    db.close();
  });

  it('is safe to run twice, as a half-finished upgrade would be', () => {
    const db = seededV6Database();
    startUpLikeTheApp(db);
    // Second pass hits "duplicate column" on every ALTER and must swallow it, not throw.
    expect(() => startUpLikeTheApp(db)).not.toThrow();

    expect(columnsOfProfile(db)).toContain('unit_preference');
    db.close();
  });
});

describe('the schema version', () => {
  it('matches the highest migration', () => {
    // These two are what decide whether a migration ever runs. If a migration is added and the
    // version is not bumped, `user_version` already equals SCHEMA_VERSION on every existing
    // device and the new statements are skipped forever — silently, and only on the devices that
    // already have data.
    const highest = Math.max(...Object.keys(MIGRATIONS).map(Number));
    expect(SCHEMA_VERSION).toBe(highest);
  });
});
