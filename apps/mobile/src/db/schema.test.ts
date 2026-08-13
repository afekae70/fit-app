/**
 * Migration tests.
 *
 * This is the one part of the schema that only ever runs on devices already holding real
 * training data — a fresh install gets every column from CREATE_SCHEMA_SQL and never exercises
 * an ALTER TABLE meaningfully. So the upgrade path is tested against a database deliberately
 * built the way an older install actually looks, not against the current schema.
 */

import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

// See workouts.test.ts: Vite rewrites a static `node:sqlite` import to a bare "sqlite".
const nodeRequire = createRequire(import.meta.url);
const { DatabaseSync } = nodeRequire('node:sqlite') as {
  DatabaseSync: new (path: string) => {
    exec(sql: string): void;
    prepare(sql: string): { all(...params: never[]): unknown[] };
    close(): void;
  };
};

import {
  CREATE_SCHEMA_SQL,
  isDuplicateColumnError,
  MIGRATIONS,
  pendingMigrations,
  SCHEMA_VERSION,
} from './schema.js';

/**
 * The profile table as it stood at schema version 4 — before unit_system and
 * default_rest_seconds existed. Written out literally rather than derived from the current
 * CREATE_SCHEMA_SQL, because deriving it would make the test agree with whatever the schema
 * says today and stop testing the upgrade at all.
 */
const PROFILE_V4 = `
CREATE TABLE profile (
  id               INTEGER PRIMARY KEY CHECK (id = 1),
  display_name     TEXT,
  birth_date       TEXT,
  sex              TEXT,
  bmr_formula_sex  TEXT,
  height_cm        REAL,
  activity_level   TEXT,
  goal             TEXT,
  updated_at       TEXT NOT NULL
);
`;

function columnsOf(db: { prepare(sql: string): { all(...p: never[]): unknown[] } }, table: string) {
  return (db.prepare(`PRAGMA table_info(${table});`).all() as { name: string }[]).map(
    (c) => c.name,
  );
}

/** The same loop db/index.ts runs, against node:sqlite instead of expo-sqlite. */
function applyMigrations(db: { exec(sql: string): void }, fromVersion: number): void {
  for (const { sql } of pendingMigrations(fromVersion)) {
    try {
      db.exec(sql);
    } catch (error) {
      if (!isDuplicateColumnError(error)) throw error;
    }
  }
}

describe('pendingMigrations', () => {
  it('returns nothing once the database is current', () => {
    expect(pendingMigrations(SCHEMA_VERSION)).toEqual([]);
    expect(pendingMigrations(SCHEMA_VERSION + 1)).toEqual([]);
  });

  it('returns only the versions newer than the database, in ascending order', () => {
    const versions = pendingMigrations(0).map((s) => s.version);
    expect(versions).toEqual([...versions].sort((a, b) => a - b));
    expect(new Set(versions)).toEqual(new Set(Object.keys(MIGRATIONS).map(Number)));

    expect(pendingMigrations(4).every((s) => s.version > 4)).toBe(true);
  });

  it('flattens every statement of a version, not just the first', () => {
    // The regression this whole file exists for: version 5 adds two columns, and an
    // implementation that stopped at one statement per version would return a single entry.
    expect(pendingMigrations(4)).toHaveLength(MIGRATIONS[5]?.length ?? 0);
    expect(pendingMigrations(4).length).toBeGreaterThan(1);
  });
});

describe('isDuplicateColumnError', () => {
  it('recognises the SQLite duplicate-column message and nothing else', () => {
    const db = new DatabaseSync(':memory:');
    db.exec(PROFILE_V4);
    db.exec('ALTER TABLE profile ADD COLUMN unit_system TEXT;');

    let duplicate: unknown;
    try {
      db.exec('ALTER TABLE profile ADD COLUMN unit_system TEXT;');
    } catch (error) {
      duplicate = error;
    }
    expect(duplicate).toBeDefined();
    expect(isDuplicateColumnError(duplicate)).toBe(true);

    let other: unknown;
    try {
      db.exec('ALTER TABLE profile ADD COLUMN bad_type NOT_A_TYPE CHECK (nope());');
    } catch (error) {
      other = error;
    }
    expect(other).toBeDefined();
    // A real failure must not be mistaken for the harmless one and swallowed.
    expect(isDuplicateColumnError(other)).toBe(false);

    db.close();
  });
});

describe('upgrading a version 4 database', () => {
  it('adds every new column, not just the first', () => {
    const db = new DatabaseSync(':memory:');
    db.exec(PROFILE_V4);

    applyMigrations(db, 4);

    const columns = columnsOf(db, 'profile');
    expect(columns).toContain('unit_system');
    expect(columns).toContain('default_rest_seconds');
    db.close();
  });

  it('preserves the rows already on the device', () => {
    const db = new DatabaseSync(':memory:');
    db.exec(PROFILE_V4);
    db.exec(
      `INSERT INTO profile (id, height_cm, goal, updated_at)
       VALUES (1, 180, 'cut', '2026-07-25T10:00:00.000Z');`,
    );

    applyMigrations(db, 4);

    const rows = db.prepare('SELECT * FROM profile;').all() as {
      height_cm: number;
      goal: string;
      unit_system: string | null;
      default_rest_seconds: number | null;
    }[];
    expect(rows).toHaveLength(1);
    expect(rows[0]?.height_cm).toBe(180);
    expect(rows[0]?.goal).toBe('cut');
    // New columns arrive null, which both mean "not chosen yet" — see the schema comments.
    expect(rows[0]?.unit_system).toBeNull();
    expect(rows[0]?.default_rest_seconds).toBeNull();
    db.close();
  });

  it('is idempotent when the migration runs again', () => {
    const db = new DatabaseSync(':memory:');
    db.exec(PROFILE_V4);

    applyMigrations(db, 4);
    // Simulates a device whose user_version failed to persist: every statement re-runs and
    // every one of them hits duplicate-column. Nothing may be lost or thrown.
    applyMigrations(db, 4);

    const columns = columnsOf(db, 'profile');
    expect(columns).toContain('unit_system');
    expect(columns).toContain('default_rest_seconds');
    db.close();
  });
});

describe('a fresh install', () => {
  it('already has the columns, and running the migrations changes nothing', () => {
    const db = new DatabaseSync(':memory:');
    db.exec(CREATE_SCHEMA_SQL.replace(/PRAGMA journal_mode = WAL;/, ''));

    const before = columnsOf(db, 'profile');
    expect(before).toContain('unit_system');
    expect(before).toContain('default_rest_seconds');

    // A fresh install still runs every migration from version 0 — each ALTER hits a column
    // that CREATE_SCHEMA_SQL already made, and every one of those errors must be swallowed.
    expect(() => applyMigrations(db, 0)).not.toThrow();
    expect(columnsOf(db, 'profile')).toEqual(before);
    db.close();
  });
});
