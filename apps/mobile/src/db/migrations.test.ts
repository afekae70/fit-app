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
  for (const statement of sql
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean)) {
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
  for (const version of Object.keys(MIGRATIONS)
    .map(Number)
    .sort((a, b) => a - b)) {
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
        { id: string } | undefined;
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

    db.exec(
      `INSERT INTO sync_state (user_id, last_pulled_at) VALUES ('u1', '2026-01-01T00:00:00Z')`,
    );
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
    db.exec(`INSERT INTO profile (user_id, updated_at) VALUES ('u1', '2026-01-01T09:00:00.000Z');`);

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

describe('migration 12 — gyms', () => {
  it('is on the app upgrade path', () => {
    // The device in use holds a year of data and will never run CREATE_SCHEMA_SQL again, so a
    // table that exists only there is a table that exists only for new installs.
    expect(SCHEMA_VERSION).toBeGreaterThanOrEqual(12);
    expect(MIGRATIONS[12]).toBeDefined();
  });

  it('creates the table on a database that already holds workouts', () => {
    // The real sequence, not a hand-rolled loop over the migrations: CREATE_SCHEMA_SQL runs
    // first on every launch, and skipping it here tests a path the app never takes.
    const db = seededV6Database();
    startUpLikeTheApp(db);

    db.exec(`INSERT INTO locations (id, user_id, name) VALUES ('g1', 'u1', 'Gold Gym')`);
    const row = db.prepare(`SELECT name FROM locations WHERE id = 'g1'`).get() as { name: string };
    expect(row.name).toBe('Gold Gym');

    // And the workouts that were already there are still there.
    const session = db.prepare(`SELECT id FROM workout_sessions WHERE id = 's1'`).get() as {
      id: string;
    };
    expect(session.id).toBe('s1');
    db.close();
  });

  it('can be applied twice without complaining', () => {
    // Migrations run from whatever version a device is on; one that cannot survive being seen
    // again turns a re-entrant upgrade into a crash on launch.
    const db = new DatabaseSync(':memory:');
    startUpLikeTheApp(db);
    expect(() => applyMigration(db, MIGRATIONS[12] ?? '')).not.toThrow();
    db.close();
  });

  it('gives a session somewhere to point', () => {
    const db = new DatabaseSync(':memory:');
    startUpLikeTheApp(db);
    db.exec(`INSERT INTO locations (id, user_id, name) VALUES ('g1', 'u1', 'Gym')`);
    db.exec(
      `INSERT INTO workout_sessions (id, user_id, location_id, started_at, created_at)
       VALUES ('s9', 'u1', 'g1', '2026-06-01T10:00:00Z', '2026-06-01T10:00:00Z')`,
    );
    const row = db.prepare(`SELECT location_id FROM workout_sessions WHERE id = 's9'`).get() as {
      location_id: string;
    };
    expect(row.location_id).toBe('g1');
    db.close();
  });
});

describe('migration 14 — drop sets', () => {
  it('is on the app upgrade path', () => {
    expect(SCHEMA_VERSION).toBeGreaterThanOrEqual(14);
    expect(MIGRATIONS[14]).toBeDefined();
  });

  it('adds the column to a database that already holds sets', () => {
    const db = seededV6Database();
    startUpLikeTheApp(db);

    db.exec(`UPDATE sets SET is_drop = 1 WHERE id = 't1'`);
    const row = db.prepare(`SELECT is_drop FROM sets WHERE id = 't1'`).get() as { is_drop: number };
    expect(row.is_drop).toBe(1);
    db.close();
  });

  it('defaults every existing set to standing on its own', () => {
    // The column is NOT NULL, so the default is what every row logged before today gets. A
    // default of 1 would retroactively turn a year of sets into one enormous drop set.
    const db = seededV6Database();
    startUpLikeTheApp(db);
    const row = db.prepare(`SELECT is_drop FROM sets WHERE id = 't1'`).get() as { is_drop: number };
    expect(row.is_drop).toBe(0);
    db.close();
  });
});

describe('migration 15 — timed workouts', () => {
  it('is on the app upgrade path', () => {
    expect(SCHEMA_VERSION).toBeGreaterThanOrEqual(15);
    expect(MIGRATIONS[15]).toBeDefined();
  });

  it('adds both columns to a database that already holds a plan', () => {
    const db = seededV6Database();
    startUpLikeTheApp(db);

    db.exec(`UPDATE plan_days SET work_seconds = 50, rest_seconds = 10 WHERE id = 'd1'`);
    const row = db
      .prepare(`SELECT work_seconds, rest_seconds FROM plan_days WHERE id = 'd1'`)
      .get() as {
      work_seconds: number;
      rest_seconds: number;
    };
    expect(row).toEqual({ work_seconds: 50, rest_seconds: 10 });
    db.close();
  });

  it('leaves every existing day an ordinary workout', () => {
    // A default here would have turned the whole plan into countdowns on the first launch after
    // the update. NULL is the only honest value for a day that was never timed.
    const db = seededV6Database();
    startUpLikeTheApp(db);
    const row = db
      .prepare(`SELECT work_seconds, rest_seconds, name FROM plan_days WHERE id = 'd1'`)
      .get() as {
      work_seconds: number | null;
      rest_seconds: number | null;
      name: string;
    };
    expect(row).toEqual({ work_seconds: null, rest_seconds: null, name: 'Push' });
    db.close();
  });
});

describe('migration 16 — several workouts per day', () => {
  /** The calendar as every device before this build has it: one row per date, enforced. */
  const OLD_SCHEDULE = `
    CREATE TABLE scheduled_days (
      id TEXT PRIMARY KEY NOT NULL, user_id TEXT NOT NULL, scheduled_on TEXT NOT NULL,
      plan_day_id TEXT, updated_at TEXT, deleted_at TEXT,
      UNIQUE (user_id, scheduled_on)
    );
    INSERT INTO scheduled_days (id, user_id, scheduled_on, plan_day_id, updated_at)
      VALUES ('r1', 'u1', '2026-09-20', 'push', '2026-09-01T00:00:00Z'),
             ('r2', 'u1', '2026-09-21', NULL, '2026-09-01T00:00:00Z');
  `;

  function oldCalendar() {
    const db = new DatabaseSync(':memory:');
    db.exec(OLD_SCHEDULE);
    return db;
  }

  type Row = { id: string; scheduled_on: string; plan_day_id: string | null; position: number };
  const rows = (db: ReturnType<typeof oldCalendar>): Row[] =>
    db
      .prepare(`SELECT id, scheduled_on, plan_day_id, position FROM scheduled_days ORDER BY id`)
      .all() as Row[];

  it('is on the app upgrade path', () => {
    expect(SCHEMA_VERSION).toBeGreaterThanOrEqual(16);
    expect(MIGRATIONS[16]).toBeDefined();
  });

  it('keeps every planned day, workout and rest alike', () => {
    const db = oldCalendar();
    applyMigration(db, MIGRATIONS[16] ?? '');
    expect(rows(db)).toEqual([
      { id: 'r1', scheduled_on: '2026-09-20', plan_day_id: 'push', position: 0 },
      { id: 'r2', scheduled_on: '2026-09-21', plan_day_id: null, position: 0 },
    ]);
    db.close();
  });

  it('lets a second workout share a date afterwards', () => {
    const db = oldCalendar();
    applyMigration(db, MIGRATIONS[16] ?? '');
    expect(() =>
      db.exec(`INSERT INTO scheduled_days (id, user_id, scheduled_on, plan_day_id, position)
               VALUES ('r3', 'u1', '2026-09-20', 'abs', 1)`),
    ).not.toThrow();
    db.close();
  });

  it('is safe to run twice', () => {
    const db = oldCalendar();
    applyMigration(db, MIGRATIONS[16] ?? '');
    applyMigration(db, MIGRATIONS[16] ?? '');
    expect(rows(db).map((row) => row.id)).toEqual(['r1', 'r2']);
    db.close();
  });

  it('loses nothing when the app died after the copy was committed but before the version was saved', () => {
    // On the next launch CREATE_SCHEMA_SQL runs first and then the migration again, from the top.
    const db = oldCalendar();
    applyMigration(db, MIGRATIONS[16] ?? '');
    db.exec(CREATE_SCHEMA_SQL.replace(/PRAGMA journal_mode = WAL;/, ''));
    applyMigration(db, MIGRATIONS[16] ?? '');
    expect(rows(db).map((row) => row.plan_day_id)).toEqual(['push', null]);
    db.close();
  });

  it('leaves the old calendar whole when it fails part way through', () => {
    // A statement that fails after the old table is dropped but before the new one takes its
    // name. Inside the transaction that must all come undone, rather than leaving the calendar
    // in a table nothing reads.
    const db = oldCalendar();
    const broken = (MIGRATIONS[16] ?? '').replace(
      'DROP TABLE scheduled_days;',
      'DROP TABLE scheduled_days; SELECT * FROM a_table_that_does_not_exist;',
    );
    expect(() => applyMigration(db, broken)).toThrow();
    // What the app does on its next launch: a fresh connection, where the unfinished
    // transaction is gone. Rolled back here explicitly, as the same connection is reused.
    db.exec('ROLLBACK;');
    const survivors = db.prepare(`SELECT id FROM scheduled_days ORDER BY id`).all() as {
      id: string;
    }[];
    expect(survivors.map((row) => row.id)).toEqual(['r1', 'r2']);
    db.close();
  });

  it('upgrades a whole device, calendar included, in the order the app runs things', () => {
    const db = seededV6Database();
    db.exec(OLD_SCHEDULE);
    startUpLikeTheApp(db);
    expect(rows(db).map((row) => row.id)).toEqual(['r1', 'r2']);
    db.close();
  });
});

describe('migration 18 — sending everything again, once', () => {
  /*
   * A repair rather than a change of shape. The phone it was written for had rows the server
   * placed differently, and deletions the server had never been sent; none of them were marked
   * as changed, so no later sync would have offered them again.
   */
  function syncedDevice() {
    const db = new DatabaseSync(':memory:');
    db.exec(CREATE_SCHEMA_SQL.replace(/PRAGMA journal_mode = WAL;/, ''));
    db.exec(`
      INSERT INTO workout_sessions (id, user_id, started_at, created_at, updated_at)
        VALUES ('s1', 'u1', '2026-09-01T10:00:00.000Z', '2026-09-01T10:00:00.000Z', '2026-09-01T10:00:00.000Z');
      INSERT INTO session_exercises (id, session_id, exercise_key, order_index, updated_at)
        VALUES ('live', 's1', 'Squat', 1, '2026-09-01T10:00:00.000Z');
      INSERT INTO session_exercises (id, session_id, exercise_key, order_index, updated_at, deleted_at)
        VALUES ('unparked', 's1', 'Bench Press', 2, '2026-09-01T10:00:00.000Z', '2026-09-01T11:00:00.000Z');
      INSERT INTO session_exercises (id, session_id, exercise_key, order_index, updated_at, deleted_at)
        VALUES ('banded', 's1', 'Barbell Row', 1000007, '2026-09-01T10:00:00.000Z', '2026-09-01T11:00:00.000Z');
      INSERT INTO session_exercises (id, session_id, exercise_key, order_index, updated_at, deleted_at)
        VALUES ('parked', 's1', 'Deadlift', -99, '2026-09-01T10:00:00.000Z', '2026-09-01T11:00:00.000Z');
      INSERT INTO sync_state (user_id, last_pulled_at, last_synced_at)
        VALUES ('u1', '2026-09-30T08:00:00.000Z', '2026-09-30T08:00:01.000Z'),
               ('u2', '2026-09-29T08:00:00.000Z', '2026-09-29T08:00:01.000Z');
    `);
    return db;
  }

  type Position = { id: string; order_index: number };
  const positions = (db: ReturnType<typeof syncedDevice>): Position[] =>
    db.prepare(`SELECT id, order_index FROM session_exercises ORDER BY id`).all() as Position[];

  it('is on the app upgrade path', () => {
    expect(SCHEMA_VERSION).toBeGreaterThanOrEqual(18);
    expect(MIGRATIONS[18]).toBeDefined();
  });

  it('clears the push cursor for every account on the device, and leaves the pull cursor', () => {
    const db = syncedDevice();
    applyMigration(db, MIGRATIONS[18] ?? '');
    expect(
      db
        .prepare(`SELECT user_id, last_pulled_at, last_synced_at FROM sync_state ORDER BY user_id`)
        .all(),
    ).toEqual([
      { user_id: 'u1', last_pulled_at: '2026-09-30T08:00:00.000Z', last_synced_at: null },
      { user_id: 'u2', last_pulled_at: '2026-09-29T08:00:00.000Z', last_synced_at: null },
    ]);
    db.close();
  });

  it('parks every deleted row that had been put back on a real position', () => {
    const db = syncedDevice();
    applyMigration(db, MIGRATIONS[18] ?? '');
    const after = new Map(positions(db).map((row) => [row.id, row.order_index]));
    // A live row keeps its place, and one already parked is not moved again.
    expect(after.get('live')).toBe(1);
    expect(after.get('parked')).toBe(-99);
    // Whatever a pull wrote over the sentinel — a real slot, or the server's tombstone band —
    // goes back to the sentinel, so the next sync compares like with like.
    expect(after.get('unparked')).toBeLessThan(0);
    expect(after.get('banded')).toBeLessThan(0);
    db.close();
  });

  it('touches no workout data', () => {
    const db = syncedDevice();
    const before = db
      .prepare(`SELECT id, exercise_key, deleted_at, updated_at FROM session_exercises ORDER BY id`)
      .all();
    applyMigration(db, MIGRATIONS[18] ?? '');
    expect(
      db
        .prepare(
          `SELECT id, exercise_key, deleted_at, updated_at FROM session_exercises ORDER BY id`,
        )
        .all(),
    ).toEqual(before);
    db.close();
  });

  it('leaves a row where it is rather than fail when the sentinel is taken', () => {
    // This runs at startup. A migration that throws leaves the app unable to open its own
    // database, and no tidying of deleted rows is worth that.
    const db = syncedDevice();
    const rowid = (
      db.prepare(`SELECT rowid AS n FROM session_exercises WHERE id = 'unparked'`).get() as {
        n: number;
      }
    ).n;
    db.exec(`
      INSERT INTO session_exercises (id, session_id, exercise_key, order_index, updated_at, deleted_at)
        VALUES ('squatter', 's1', 'Curl', ${-rowid}, '2026-09-01T10:00:00.000Z', '2026-09-01T11:00:00.000Z');
    `);

    expect(() => applyMigration(db, MIGRATIONS[18] ?? '')).not.toThrow();

    const after = new Map(positions(db).map((row) => [row.id, row.order_index]));
    expect(after.get('unparked')).toBe(2);
    // And the rest of the repair still happened.
    expect(after.get('banded')).toBeLessThan(0);
    expect(
      (
        db
          .prepare(`SELECT COUNT(*) AS n FROM sync_state WHERE last_synced_at IS NOT NULL`)
          .get() as { n: number }
      ).n,
    ).toBe(0);
    db.close();
  });

  it('is safe to run twice, and on a device with nothing on it', () => {
    const db = syncedDevice();
    applyMigration(db, MIGRATIONS[18] ?? '');
    const once = positions(db);
    applyMigration(db, MIGRATIONS[18] ?? '');
    expect(positions(db)).toEqual(once);
    db.close();

    const empty = new DatabaseSync(':memory:');
    empty.exec(CREATE_SCHEMA_SQL.replace(/PRAGMA journal_mode = WAL;/, ''));
    expect(() => applyMigration(empty, MIGRATIONS[18] ?? '')).not.toThrow();
    empty.close();
  });
});

describe('migration 19 — the calendar joins sync', () => {
  /** The calendar as it was at version 18: no column for the server's timestamp. */
  function plannedDevice() {
    const db = new DatabaseSync(':memory:');
    db.exec(`
      CREATE TABLE scheduled_days (
        id TEXT PRIMARY KEY NOT NULL, user_id TEXT NOT NULL, scheduled_on TEXT NOT NULL,
        plan_day_id TEXT, position INTEGER NOT NULL DEFAULT 0, updated_at TEXT, deleted_at TEXT
      );
      INSERT INTO scheduled_days (id, user_id, scheduled_on, plan_day_id, position, updated_at)
        VALUES ('r1', 'u1', '2026-09-20', 'push', 0, '2026-09-01T00:00:00.000Z'),
               ('r2', 'u1', '2026-09-21', NULL, 0, NULL);
    `);
    return db;
  }

  type Stamp = { id: string; updated_at: string | null; remote_updated_at: string | null };
  const stamps = (db: ReturnType<typeof plannedDevice>): Stamp[] =>
    db
      .prepare(`SELECT id, updated_at, remote_updated_at FROM scheduled_days ORDER BY id`)
      .all() as Stamp[];

  it('is on the app upgrade path', () => {
    expect(SCHEMA_VERSION).toBeGreaterThanOrEqual(19);
    expect(MIGRATIONS[19]).toBeDefined();
  });

  it('adds the column every synced table carries', () => {
    const db = plannedDevice();
    applyMigration(db, MIGRATIONS[19] ?? '');
    expect(stamps(db).every((row) => row.remote_updated_at === null)).toBe(true);
    db.close();
  });

  it('marks every planned date as changed, so that the plan already made is sent', () => {
    // Sync sends what is newer than its cursor. A week planned before the upgrade is older
    // than that, and would be the one thing on the phone the server never received.
    const db = plannedDevice();
    applyMigration(db, MIGRATIONS[19] ?? '');
    for (const row of stamps(db)) {
      // The format the app itself writes, because these are compared as text.
      expect(row.updated_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
      expect(Date.parse(row.updated_at!)).toBeGreaterThan(Date.parse('2026-09-01T00:00:00.000Z'));
    }
    db.close();
  });

  it('keeps every date and what it holds', () => {
    const db = plannedDevice();
    applyMigration(db, MIGRATIONS[19] ?? '');
    expect(
      db.prepare(`SELECT id, scheduled_on, plan_day_id FROM scheduled_days ORDER BY id`).all(),
    ).toEqual([
      { id: 'r1', scheduled_on: '2026-09-20', plan_day_id: 'push' },
      { id: 'r2', scheduled_on: '2026-09-21', plan_day_id: null },
    ]);
    db.close();
  });

  it('is safe to run twice, and on a new install where the column is already there', () => {
    const db = plannedDevice();
    applyMigration(db, MIGRATIONS[19] ?? '');
    expect(() => applyMigration(db, MIGRATIONS[19] ?? '')).not.toThrow();
    db.close();

    const fresh = new DatabaseSync(':memory:');
    fresh.exec(CREATE_SCHEMA_SQL.replace(/PRAGMA journal_mode = WAL;/, ''));
    expect(() => applyMigration(fresh, MIGRATIONS[19] ?? '')).not.toThrow();
    fresh.close();
  });
});

describe('migration 21 — the profile joins the cloud copy', () => {
  /** The profile as it was at version 20, with someone's answers in it. */
  function answeredDevice() {
    const db = new DatabaseSync(':memory:');
    db.exec(`
      CREATE TABLE profile (
        user_id TEXT PRIMARY KEY NOT NULL, display_name TEXT, birth_date TEXT, sex TEXT,
        bmr_formula_sex TEXT, height_cm REAL, activity_level TEXT, goal TEXT,
        unit_preference TEXT, updated_at TEXT NOT NULL
      );
      INSERT INTO profile (user_id, display_name, birth_date, sex, height_cm, activity_level,
                           goal, unit_preference, updated_at)
        VALUES ('u1', 'אפק', '1998-04-12', 'male', 178, 'active', 'bulk', 'metric',
                '2026-09-01T00:00:00.000Z');
    `);
    return db;
  }

  it('is on the app upgrade path', () => {
    expect(SCHEMA_VERSION).toBeGreaterThanOrEqual(21);
    expect(MIGRATIONS[21]).toBeDefined();
  });

  it('starts every phone as one that has never compared notes with the server', () => {
    // NULL, not an empty agreement. An empty one would say "we agreed there was nothing", and
    // the first sync would then read a full profile as a set of edits — harmless here, but the
    // same mistake on a new phone is the one that blanks the server.
    const db = answeredDevice();
    applyMigration(db, MIGRATIONS[21] ?? '');
    expect(db.prepare(`SELECT avatar_version, synced_json FROM profile`).all()).toEqual([
      { avatar_version: null, synced_json: null },
    ]);
    db.close();
  });

  it('keeps every answer exactly as it was', () => {
    const db = answeredDevice();
    applyMigration(db, MIGRATIONS[21] ?? '');
    expect(
      db
        .prepare(
          `SELECT user_id, display_name, birth_date, sex, height_cm, activity_level, goal,
                  unit_preference, updated_at FROM profile`,
        )
        .all(),
    ).toEqual([
      {
        user_id: 'u1',
        display_name: 'אפק',
        birth_date: '1998-04-12',
        sex: 'male',
        height_cm: 178,
        activity_level: 'active',
        goal: 'bulk',
        unit_preference: 'metric',
        updated_at: '2026-09-01T00:00:00.000Z',
      },
    ]);
    db.close();
  });

  it('is safe to run twice, and on a new install where the columns are already there', () => {
    const db = answeredDevice();
    applyMigration(db, MIGRATIONS[21] ?? '');
    expect(() => applyMigration(db, MIGRATIONS[21] ?? '')).not.toThrow();
    db.close();

    const fresh = new DatabaseSync(':memory:');
    fresh.exec(CREATE_SCHEMA_SQL.replace(/PRAGMA journal_mode = WAL;/, ''));
    expect(() => applyMigration(fresh, MIGRATIONS[21] ?? '')).not.toThrow();
    fresh.close();
  });
});

describe('migration 22 — a food log', () => {
  /** A phone at version 21: everything it has, and no food table. */
  function trainedDevice() {
    const db = new DatabaseSync(':memory:');
    db.exec(`
      CREATE TABLE workout_sessions (id TEXT PRIMARY KEY NOT NULL, user_id TEXT NOT NULL, started_at TEXT NOT NULL);
      INSERT INTO workout_sessions VALUES ('s1', 'u1', '2026-10-01T10:00:00.000Z');
    `);
    return db;
  }

  it('is on the app upgrade path', () => {
    expect(SCHEMA_VERSION).toBeGreaterThanOrEqual(22);
    expect(MIGRATIONS[22]).toBeDefined();
  });

  it('makes the same table a fresh install gets', () => {
    // An upgraded phone and a new one must end up with one schema, or a query that works on
    // the developer's fresh database fails on every phone that was already in use.
    const upgraded = trainedDevice();
    applyMigration(upgraded, MIGRATIONS[22] ?? '');
    const fresh = new DatabaseSync(':memory:');
    fresh.exec(CREATE_SCHEMA_SQL.replace(/PRAGMA journal_mode = WAL;/, ''));

    const columns = (db: typeof upgraded) =>
      db
        .prepare(
          `SELECT name, type, "notnull", pk FROM pragma_table_info('food_entries') ORDER BY cid`,
        )
        .all();
    expect(columns(upgraded)).toEqual(columns(fresh));
    expect(columns(upgraded).length).toBeGreaterThan(10);
    upgraded.close();
    fresh.close();
  });

  it('carries the column sync keeps its bookkeeping in', () => {
    const db = trainedDevice();
    applyMigration(db, MIGRATIONS[22] ?? '');
    const names = (
      db.prepare(`SELECT name FROM pragma_table_info('food_entries')`).all() as { name: string }[]
    ).map((column) => column.name);
    expect(names).toEqual(
      expect.arrayContaining(['updated_at', 'deleted_at', 'remote_updated_at']),
    );
    db.close();
  });

  it('touches nothing that was already there', () => {
    const db = trainedDevice();
    applyMigration(db, MIGRATIONS[22] ?? '');
    expect(db.prepare(`SELECT * FROM workout_sessions`).all()).toEqual([
      { id: 's1', user_id: 'u1', started_at: '2026-10-01T10:00:00.000Z' },
    ]);
    db.close();
  });

  it('is safe to run twice, and on a new install where the table is already there', () => {
    const db = trainedDevice();
    applyMigration(db, MIGRATIONS[22] ?? '');
    expect(() => applyMigration(db, MIGRATIONS[22] ?? '')).not.toThrow();
    db.close();

    const fresh = new DatabaseSync(':memory:');
    fresh.exec(CREATE_SCHEMA_SQL.replace(/PRAGMA journal_mode = WAL;/, ''));
    expect(() => applyMigration(fresh, MIGRATIONS[22] ?? '')).not.toThrow();
    fresh.close();
  });
});

describe('migration 20 — supersets, drop sets and timed workouts join sync', () => {
  const OLD = '2026-09-01T10:00:00.000Z';

  function loggedDevice() {
    const db = new DatabaseSync(':memory:');
    db.exec(CREATE_SCHEMA_SQL.replace(/PRAGMA journal_mode = WAL;/, ''));
    db.exec(`
      INSERT INTO plans (id, user_id, name, is_active, created_at, updated_at)
        VALUES ('p1', 'u1', 'Gym', 1, '${OLD}', '${OLD}');
      INSERT INTO plan_days (id, plan_id, day_index, name, work_seconds, rest_seconds, rounds, updated_at)
        VALUES ('timed', 'p1', 1, 'Intervals', 40, 20, 3, '${OLD}'),
               ('plain', 'p1', 2, 'Push', NULL, NULL, NULL, '${OLD}');
      INSERT INTO workout_sessions (id, user_id, started_at, created_at, updated_at)
        VALUES ('s1', 'u1', '${OLD}', '${OLD}', '${OLD}');
      INSERT INTO session_exercises (id, session_id, exercise_key, order_index, superset_with_next, updated_at)
        VALUES ('linked', 's1', 'Bench Press', 1, 1, '${OLD}'),
               ('alone', 's1', 'Barbell Row', 2, 0, '${OLD}');
      INSERT INTO sets (id, session_exercise_id, set_index, weight_kg, reps, is_drop, completed_at, updated_at)
        VALUES ('drop', 'linked', 2, 40, 8, 1, '${OLD}', '${OLD}'),
               ('top', 'linked', 1, 60, 8, 0, '${OLD}', '${OLD}');
    `);
    return db;
  }

  const changed = (db: ReturnType<typeof loggedDevice>, tableName: string): string[] =>
    (
      db.prepare(`SELECT id FROM ${tableName} WHERE updated_at <> '${OLD}' ORDER BY id`).all() as {
        id: string;
      }[]
    ).map((row) => row.id);

  it('is on the app upgrade path', () => {
    expect(SCHEMA_VERSION).toBeGreaterThanOrEqual(20);
    expect(MIGRATIONS[20]).toBeDefined();
  });

  it('marks as changed the rows that have something new to send, and no others', () => {
    // Sync sends what is newer than its cursor. These were logged before the columns were
    // synced, so without a new stamp they would never be offered again.
    const db = loggedDevice();
    applyMigration(db, MIGRATIONS[20] ?? '');
    expect(changed(db, 'plan_days')).toEqual(['timed']);
    expect(changed(db, 'session_exercises')).toEqual(['linked']);
    expect(changed(db, 'sets')).toEqual(['drop']);
    db.close();
  });

  it('changes nothing about the rows but the stamp', () => {
    const db = loggedDevice();
    applyMigration(db, MIGRATIONS[20] ?? '');
    expect(
      db.prepare(`SELECT id, work_seconds, rest_seconds, rounds FROM plan_days ORDER BY id`).all(),
    ).toEqual([
      { id: 'plain', work_seconds: null, rest_seconds: null, rounds: null },
      { id: 'timed', work_seconds: 40, rest_seconds: 20, rounds: 3 },
    ]);
    expect(db.prepare(`SELECT id, is_drop FROM sets ORDER BY id`).all()).toEqual([
      { id: 'drop', is_drop: 1 },
      { id: 'top', is_drop: 0 },
    ]);
    db.close();
  });

  it('is safe to run twice, and on a device with nothing on it', () => {
    const db = loggedDevice();
    applyMigration(db, MIGRATIONS[20] ?? '');
    expect(() => applyMigration(db, MIGRATIONS[20] ?? '')).not.toThrow();
    db.close();

    const empty = new DatabaseSync(':memory:');
    empty.exec(CREATE_SCHEMA_SQL.replace(/PRAGMA journal_mode = WAL;/, ''));
    expect(() => applyMigration(empty, MIGRATIONS[20] ?? '')).not.toThrow();
    empty.close();
  });
});
