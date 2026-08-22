/**
 * Local SQLite schema — the offline-first store.
 *
 * Mirrors the Postgres design in apps/api deliberately, most importantly the three-level
 * session → session_exercise → set chain with ONE ROW PER SET. That is what makes per-exercise
 * set counts independent: 4 sets of chest press and 2 of face pulls in one session are simply
 * different numbers of child rows, not different column shapes.
 *
 * Differences from the server schema, and why:
 *  - `user_id` on every top-level owned table (`profile`, `body_metrics`, `nutrition_targets`,
 *    `workout_sessions`, `plans`, `outbox`) is a plain TEXT column filtered by the app layer,
 *    not a Postgres RLS policy — this device has no RLS, so ownership has to be enforced in
 *    the repository functions themselves. Child tables (`session_exercises`, `sets`,
 *    `plan_days`, `plan_day_exercises`) carry no `user_id` of their own; ownership flows
 *    through their existing foreign key to an already-scoped parent row, the same shape the
 *    server schema uses (ownership lives on the top-level row, not repeated on every child).
 *    Before multi-user existed this was a single implicit user with no column at all; `'local'`
 *    is the pseudo user id used both before any real sign-in and for the lifetime of a device
 *    where Supabase has never been configured (see `AuthProvider`'s `isConfigured` fallback).
 *  - Exercises are referenced by `exercise_key` (the catalogue's stable `nameEn`) rather than
 *    a uuid, because the catalogue ships in the app bundle and has no local uuids until the
 *    server assigns them.
 *  - An `outbox` table records every mutation for later replay to Supabase.
 *
 * SQLite has no native boolean or timestamp: booleans are INTEGER 0/1, timestamps are ISO 8601
 * TEXT (lexicographically sortable, which is what the history queries rely on).
 */

export const SCHEMA_VERSION = 12;

/**
 * Incremental migrations, keyed by the version they upgrade TO.
 *
 * `CREATE TABLE IF NOT EXISTS` covers new tables, but not new columns on tables that already
 * exist on a user's device — and by now there is real workout data on real phones, so
 * rebuilding the schema is not an option. Each entry runs exactly once, in order, guarded by
 * SQLite's `user_version`.
 */
export const MIGRATIONS: Record<number, string> = {
  3: `ALTER TABLE workout_sessions ADD COLUMN name TEXT;`,
  // The plan tables are also in CREATE_SCHEMA_SQL for fresh installs. Repeating them here is
  // what upgrades a device that already has data: CREATE_SCHEMA_SQL only runs on a new
  // database, so without this migration an existing user would never get these tables.
  4: `
    CREATE TABLE IF NOT EXISTS plans (
      id          TEXT PRIMARY KEY NOT NULL,
      name        TEXT NOT NULL,
      is_active   INTEGER NOT NULL DEFAULT 0,
      created_at  TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS plan_days (
      id         TEXT PRIMARY KEY NOT NULL,
      plan_id    TEXT NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
      day_index  INTEGER NOT NULL,
      name       TEXT,
      UNIQUE (plan_id, day_index)
    );

    CREATE TABLE IF NOT EXISTS plan_day_exercises (
      id               TEXT PRIMARY KEY NOT NULL,
      plan_day_id      TEXT NOT NULL REFERENCES plan_days(id) ON DELETE CASCADE,
      exercise_key     TEXT NOT NULL,
      order_index      INTEGER NOT NULL,
      target_sets      INTEGER,
      target_reps_min  INTEGER,
      target_reps_max  INTEGER,
      notes            TEXT,
      UNIQUE (plan_day_id, order_index)
    );

    CREATE INDEX IF NOT EXISTS plan_days_plan_idx ON plan_days (plan_id, day_index);
    CREATE INDEX IF NOT EXISTS plan_day_exercises_day_idx
      ON plan_day_exercises (plan_day_id, order_index);
  `,
  // Per-user local data isolation. `profile`'s old PK was `id INTEGER PRIMARY KEY CHECK (id = 1)`
  // — SQLite cannot ALTER a PRIMARY KEY/CHECK in place, so this is rename-recreate-copy-drop
  // rather than an ALTER. The explicit column list in the INSERT (never SELECT *) is what makes
  // the copy correct regardless of whether `profile_v4` is a real device's `id`-keyed row or
  // already the fresh-install `user_id`-keyed shape from CREATE_SCHEMA_SQL — a brand-new
  // database runs every pending migration in one pass (see the version-4 entry above for the
  // same convention with the plan tables), so this must be safe to run against an
  // already-correct, already-empty `profile` too. That safety rests on one invariant: nothing
  // can write to `profile` before `initialise()` in db/index.ts resolves, since `getExecutor()`
  // is unreachable earlier — a future change to the init sequence must preserve that.
  5: `
    ALTER TABLE profile RENAME TO profile_v4;

    CREATE TABLE profile (
      user_id          TEXT PRIMARY KEY NOT NULL,
      display_name     TEXT,
      birth_date       TEXT,
      sex              TEXT,
      bmr_formula_sex  TEXT,
      height_cm        REAL,
      activity_level   TEXT,
      goal             TEXT,
      updated_at       TEXT NOT NULL
    );

    INSERT INTO profile (user_id, display_name, birth_date, sex, bmr_formula_sex, height_cm,
                          activity_level, goal, updated_at)
    SELECT 'local', display_name, birth_date, sex, bmr_formula_sex, height_cm,
           activity_level, goal, updated_at
    FROM profile_v4;

    DROP TABLE profile_v4;

    ALTER TABLE body_metrics ADD COLUMN user_id TEXT NOT NULL DEFAULT 'local';
    CREATE INDEX IF NOT EXISTS body_metrics_user_idx ON body_metrics (user_id, measured_at DESC);

    ALTER TABLE nutrition_targets ADD COLUMN user_id TEXT NOT NULL DEFAULT 'local';
    CREATE INDEX IF NOT EXISTS nutrition_targets_user_idx
      ON nutrition_targets (user_id, effective_from DESC);

    ALTER TABLE workout_sessions ADD COLUMN user_id TEXT NOT NULL DEFAULT 'local';
    CREATE INDEX IF NOT EXISTS workout_sessions_user_idx
      ON workout_sessions (user_id, started_at DESC);

    ALTER TABLE plans ADD COLUMN user_id TEXT NOT NULL DEFAULT 'local';
    CREATE INDEX IF NOT EXISTS plans_user_idx ON plans (user_id, is_active DESC, created_at DESC);

    ALTER TABLE outbox ADD COLUMN user_id TEXT NOT NULL DEFAULT 'local';
  `,
  // One cached coach reply per user per calendar day, so the Today screen's brief costs one
  // model call a day rather than one per screen visit.
  6: `
    CREATE TABLE IF NOT EXISTS coach_briefs (
      id          TEXT PRIMARY KEY NOT NULL,
      user_id     TEXT NOT NULL,
      brief_date  TEXT NOT NULL,
      text        TEXT NOT NULL,
      created_at  TEXT NOT NULL,
      UNIQUE (user_id, brief_date)
    );
  `,
  /**
   * Cloud sync bookkeeping.
   *
   * `updated_at` is the conflict-resolution clock: the sync engine compares it against the
   * server's column of the same name and the newer write wins, per row. `deleted_at` makes
   * deletion a value rather than an absence — a hard DELETE is invisible to the next pull, so
   * the row would simply come back from the server. Both are nullable rather than NOT NULL
   * because SQLite cannot add a NOT NULL column without a constant default, and "now" is not
   * one.
   *
   * Existing rows are backfilled with the current time on purpose, not with their creation
   * date: nothing on this device has ever been uploaded, so every row must look "changed"
   * to the first sync and go up.
   */
  7: `
    ALTER TABLE workout_sessions   ADD COLUMN updated_at TEXT;
    ALTER TABLE workout_sessions   ADD COLUMN deleted_at TEXT;
    ALTER TABLE session_exercises  ADD COLUMN updated_at TEXT;
    ALTER TABLE session_exercises  ADD COLUMN deleted_at TEXT;
    ALTER TABLE sets               ADD COLUMN updated_at TEXT;
    ALTER TABLE sets               ADD COLUMN deleted_at TEXT;
    ALTER TABLE body_metrics       ADD COLUMN updated_at TEXT;
    ALTER TABLE body_metrics       ADD COLUMN deleted_at TEXT;
    ALTER TABLE plans              ADD COLUMN updated_at TEXT;
    ALTER TABLE plans              ADD COLUMN deleted_at TEXT;
    ALTER TABLE plan_days          ADD COLUMN updated_at TEXT;
    ALTER TABLE plan_days          ADD COLUMN deleted_at TEXT;
    ALTER TABLE plan_day_exercises ADD COLUMN updated_at TEXT;
    ALTER TABLE plan_day_exercises ADD COLUMN deleted_at TEXT;

    UPDATE workout_sessions   SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE updated_at IS NULL;
    UPDATE session_exercises  SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE updated_at IS NULL;
    UPDATE sets               SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE updated_at IS NULL;
    UPDATE body_metrics       SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE updated_at IS NULL;
    UPDATE plans              SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE updated_at IS NULL;
    UPDATE plan_days          SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE updated_at IS NULL;
    UPDATE plan_day_exercises SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE updated_at IS NULL;

    CREATE INDEX IF NOT EXISTS workout_sessions_updated_idx ON workout_sessions (updated_at);
    CREATE INDEX IF NOT EXISTS session_exercises_updated_idx ON session_exercises (updated_at);
    CREATE INDEX IF NOT EXISTS sets_updated_idx ON sets (updated_at);
    CREATE INDEX IF NOT EXISTS body_metrics_updated_idx ON body_metrics (updated_at);
    CREATE INDEX IF NOT EXISTS plans_updated_idx ON plans (updated_at);

    CREATE TABLE IF NOT EXISTS sync_state (
      user_id        TEXT PRIMARY KEY NOT NULL,
      last_pulled_at TEXT,
      last_synced_at TEXT
    );
  `,
  /**
   * Marking a set as performed.
   *
   * Distinct from `completed_at`, which despite its name is stamped when the row is *created* —
   * a set exists from the moment it is added, long before it is lifted. `done_at` is the moment
   * the user ticked it off, and it is what drives the progress rail and starts the rest timer.
   *
   * No index: this column is only ever read for sets already loaded by session, never searched
   * across the table. Declaring one in CREATE_SCHEMA_SQL is also how three screens were bricked
   * once — that file runs before the migrations, so it cannot reference a column added here.
   */
  8: `
    ALTER TABLE sets ADD COLUMN done_at TEXT;
  `,
  /**
   * Separating the two clocks that `updated_at` was being asked to be at once.
   *
   * `updated_at` is written by this device from this device's clock. A row's server `updated_at`
   * is written by Postgres from Postgres's clock. They are not comparable, and storing both in
   * one column meant a pulled row came back stamped with server time — which, on a phone whose
   * clock runs behind, reads as "edited in the future" and therefore as unsynced. The sync then
   * pushed it again, the server restamped it, and the same rows shuttled back and forth on every
   * single run, forever.
   *
   * So the two now live apart, and each is only ever compared against a timestamp from the same
   * clock:
   *
   *   - `updated_at`        local clock. Newer than `sync_state.last_synced_at` means this device
   *                         has changes to send.
   *   - `remote_updated_at` server clock, as of the last time this row crossed the wire. An
   *                         incoming row newer than this is a genuine change from elsewhere;
   *                         equal means the server is handing back what we already have.
   *
   * No index on `remote_updated_at`: it is only ever read for one row at a time, by id, during a
   * merge. And per the note on migration 8 — a column added here can never be indexed from
   * CREATE_SCHEMA_SQL, which runs first.
   */
  9: `
    ALTER TABLE workout_sessions   ADD COLUMN remote_updated_at TEXT;
    ALTER TABLE session_exercises  ADD COLUMN remote_updated_at TEXT;
    ALTER TABLE sets               ADD COLUMN remote_updated_at TEXT;
    ALTER TABLE body_metrics       ADD COLUMN remote_updated_at TEXT;
    ALTER TABLE plans              ADD COLUMN remote_updated_at TEXT;
    ALTER TABLE plan_days          ADD COLUMN remote_updated_at TEXT;
    ALTER TABLE plan_day_exercises ADD COLUMN remote_updated_at TEXT;
  `,
  10: `
    ALTER TABLE profile ADD COLUMN unit_preference TEXT;
  `,
  // The weekly calendar. A new table, so CREATE_SCHEMA_SQL covers fresh installs; repeated here
  // for devices that already hold data, which is the only path that would otherwise miss it.
  11: `
    CREATE TABLE IF NOT EXISTS scheduled_days (
      id            TEXT PRIMARY KEY NOT NULL,
      user_id       TEXT NOT NULL,
      scheduled_on  TEXT NOT NULL,
      plan_day_id   TEXT,
      updated_at    TEXT,
      deleted_at    TEXT,
      UNIQUE (user_id, scheduled_on)
    );

    CREATE INDEX IF NOT EXISTS scheduled_days_user_date_idx
      ON scheduled_days (user_id, scheduled_on);
  `,

  // Where a workout happened. The same lift on another gym's machine is a different number, so
  // this is what lets a comparison stay inside one room — see `sessionType.ts`.
  //
  // `workout_sessions.location_id` has existed since the first schema and nothing has ever
  // written it; this is the table it was always pointing at.
  12: `
CREATE TABLE IF NOT EXISTS locations (
  id          TEXT PRIMARY KEY NOT NULL,
  user_id     TEXT NOT NULL,
  name        TEXT NOT NULL,
  updated_at  TEXT,
  deleted_at  TEXT
);

CREATE INDEX IF NOT EXISTS locations_user_idx ON locations (user_id);
  `,
};

export const CREATE_SCHEMA_SQL = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- Keyed by user_id (a Supabase user id, or the pseudo id 'local' before any real sign-in / on
-- a device where Supabase is never configured — see AuthProvider.isConfigured), one row per
-- person. Keeping it in SQLite rather than component state is what lets the weight tracker
-- recompute TDEE across app launches.
CREATE TABLE IF NOT EXISTS profile (
  user_id          TEXT PRIMARY KEY NOT NULL,
  display_name     TEXT,
  birth_date       TEXT,
  sex              TEXT,
  bmr_formula_sex  TEXT,
  height_cm        REAL,
  activity_level   TEXT,
  goal             TEXT,
  -- 'metric' | 'imperial'. Display only: every measurement in this database stays metric no
  -- matter what this says. Named to match profiles.unit_preference on the server, so the
  -- column lines up if profile ever joins SYNC_TABLES. NULL means never chosen -- see
  -- parseUnitPreference in @fit/shared.
  unit_preference  TEXT,
  updated_at       TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS body_metrics (
  id              TEXT PRIMARY KEY NOT NULL,
  user_id         TEXT NOT NULL DEFAULT 'local',
  measured_at     TEXT NOT NULL,
  weight_kg       REAL,
  body_fat_pct    REAL,
  muscle_mass_kg  REAL,
  water_pct       REAL,
  bone_mass_kg    REAL,
  visceral_fat    REAL,
  source          TEXT NOT NULL,
  device_id       TEXT,
  -- The raw Bluetooth frame, kept deliberately: consumer scale protocols are
  -- reverse-engineered and body-composition fields are sometimes decoded wrongly. Keeping the
  -- bytes means a parser fix can reprocess history instead of discarding it.
  raw_payload     TEXT,
  updated_at      TEXT,
  deleted_at      TEXT,
  remote_updated_at TEXT
);

CREATE INDEX IF NOT EXISTS body_metrics_measured_idx
  ON body_metrics (measured_at DESC);
-- The updated_at index lives only in migration 7, for the same reason the user_id one lives
-- only in migration 5 — see the note below.
-- The user_id index is NOT declared here. On a device upgrading from an older schema, this
-- whole block runs via CREATE_SCHEMA_SQL BEFORE migrate() has added the user_id column to the
-- pre-existing table — an index on a not-yet-existing column would fail immediately with
-- "no such column: user_id" and abort startup. Migration 5 (schema.ts) adds this index only
-- after its own ALTER TABLE has actually added the column.

-- Dated snapshots rather than values recomputed on read, so the weekly update has somewhere
-- to record each revision and history stays auditable.
CREATE TABLE IF NOT EXISTS nutrition_targets (
  id                  TEXT PRIMARY KEY NOT NULL,
  user_id             TEXT NOT NULL DEFAULT 'local',
  effective_from      TEXT NOT NULL,
  effective_to        TEXT,
  weight_kg_snapshot  REAL NOT NULL,
  bmi                 REAL,
  bmr_kcal            INTEGER,
  tdee_kcal           INTEGER,
  goal                TEXT NOT NULL,
  calorie_target      INTEGER,
  protein_g           INTEGER,
  carbs_g             INTEGER,
  fat_g               INTEGER,
  computed_by         TEXT NOT NULL,
  created_at          TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS nutrition_targets_from_idx
  ON nutrition_targets (effective_from DESC);
-- See the comment on body_metrics above — the user_id index lives only in migration 5.

CREATE TABLE IF NOT EXISTS locations (
  id          TEXT PRIMARY KEY NOT NULL,
  user_id     TEXT NOT NULL,
  name        TEXT NOT NULL,
  updated_at  TEXT,
  deleted_at  TEXT
);

CREATE INDEX IF NOT EXISTS locations_user_idx ON locations (user_id);

CREATE TABLE IF NOT EXISTS workout_sessions (
  id             TEXT PRIMARY KEY NOT NULL,
  user_id        TEXT NOT NULL DEFAULT 'local',
  location_id    TEXT,
  plan_day_id    TEXT,
  -- User-given label, e.g. "Push A". Doubles as the template name when a past session is
  -- repeated, so naming a workout is what makes it findable later.
  name           TEXT,
  started_at     TEXT NOT NULL,
  ended_at       TEXT,
  bodyweight_kg  REAL,
  session_rpe    REAL,
  notes          TEXT,
  server_id      TEXT,
  created_at     TEXT NOT NULL,
  -- Sync bookkeeping. See migration 7 for why deletion is a value rather than an absence.
  updated_at     TEXT,
  deleted_at     TEXT,
  remote_updated_at TEXT
);

CREATE INDEX IF NOT EXISTS workout_sessions_started_idx
  ON workout_sessions (started_at DESC);
-- See the comment on body_metrics above — the user_id and updated_at indexes live only in
-- migrations 5 and 7.

CREATE TABLE IF NOT EXISTS session_exercises (
  id            TEXT PRIMARY KEY NOT NULL,
  session_id    TEXT NOT NULL REFERENCES workout_sessions(id) ON DELETE CASCADE,
  exercise_key  TEXT NOT NULL,
  order_index   INTEGER NOT NULL,
  notes         TEXT,
  updated_at    TEXT,
  deleted_at    TEXT,
  remote_updated_at TEXT,
  UNIQUE (session_id, order_index)
);

CREATE INDEX IF NOT EXISTS session_exercises_session_idx
  ON session_exercises (session_id);
CREATE INDEX IF NOT EXISTS session_exercises_key_idx
  ON session_exercises (exercise_key);

CREATE TABLE IF NOT EXISTS sets (
  id                   TEXT PRIMARY KEY NOT NULL,
  session_exercise_id  TEXT NOT NULL REFERENCES session_exercises(id) ON DELETE CASCADE,
  set_index            INTEGER NOT NULL,
  weight_kg            REAL,
  reps                 INTEGER,
  duration_seconds     INTEGER,
  distance_m           REAL,
  rpe                  REAL,
  is_warmup            INTEGER NOT NULL DEFAULT 0,
  to_failure           INTEGER NOT NULL DEFAULT 0,
  completed_at         TEXT NOT NULL,
  -- When the user ticked the set off, as opposed to when the row appeared. See migration 8.
  done_at              TEXT,
  updated_at           TEXT,
  deleted_at           TEXT,
  remote_updated_at TEXT,
  UNIQUE (session_exercise_id, set_index)
);

CREATE INDEX IF NOT EXISTS sets_exercise_idx
  ON sets (session_exercise_id, set_index);

-- The weekly programme: plan → day → prescribed exercise.
--
-- Targets live here and ONLY here. A plan day saying "3 sets of 8-10" is a prescription, never
-- a constraint on the log: the session it starts can end up with 2 sets or 5, and the sets
-- table neither knows nor cares. That separation is what lets the app show "prescribed vs
-- actual" instead of quietly rewriting one to match the other.
--
-- No plan_variants table yet. The server schema has one, for the same plan adapted to a
-- different location (commercial gym vs. military base). Adding it later means a new table and
-- a foreign key on plan_days, not a reshape of these rows.
CREATE TABLE IF NOT EXISTS plans (
  id          TEXT PRIMARY KEY NOT NULL,
  user_id     TEXT NOT NULL DEFAULT 'local',
  name        TEXT NOT NULL,
  -- Exactly one ACTIVE PLAN PER USER drives the week. Enforced in the repository rather than
  -- by a constraint, since SQLite cannot express "at most one row per user_id with
  -- is_active = 1" — every query/update against is_active must be scoped by user_id or it
  -- reaches across people sharing this device.
  is_active   INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL,
  updated_at  TEXT,
  deleted_at  TEXT,
  remote_updated_at TEXT
);

-- The user_id and updated_at indexes live only in migrations 5 and 7 — see the comment on
-- body_metrics above.

CREATE TABLE IF NOT EXISTS plan_days (
  id         TEXT PRIMARY KEY NOT NULL,
  plan_id    TEXT NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
  -- Position in the training week (1..N), not a weekday. A 4-day split does not map onto
  -- Sunday-Saturday, and pinning days to dates makes a missed session cascade into the rest.
  day_index  INTEGER NOT NULL,
  name       TEXT,
  updated_at TEXT,
  deleted_at TEXT,
  remote_updated_at TEXT,
  UNIQUE (plan_id, day_index)
);

CREATE TABLE IF NOT EXISTS plan_day_exercises (
  id               TEXT PRIMARY KEY NOT NULL,
  plan_day_id      TEXT NOT NULL REFERENCES plan_days(id) ON DELETE CASCADE,
  exercise_key     TEXT NOT NULL,
  order_index      INTEGER NOT NULL,
  target_sets      INTEGER,
  target_reps_min  INTEGER,
  target_reps_max  INTEGER,
  notes            TEXT,
  updated_at       TEXT,
  deleted_at       TEXT,
  remote_updated_at TEXT,
  UNIQUE (plan_day_id, order_index)
);

CREATE INDEX IF NOT EXISTS plan_days_plan_idx ON plan_days (plan_id, day_index);
CREATE INDEX IF NOT EXISTS plan_day_exercises_day_idx
  ON plan_day_exercises (plan_day_id, order_index);

-- The weekly calendar: which workout is intended on a given date.
--
-- A deliberate departure from plan_days.day_index, which is a position in a rotation and
-- carries a comment saying it is explicitly NOT a weekday. Both now exist and answer different
-- questions: the rotation is what comes next if you simply train, the calendar is what you sat
-- down and committed to for a particular week. The calendar wins when a row exists for today;
-- absent one, the rotation still decides, so a user who never opens the week editor sees no
-- change at all.
--
-- Keyed by date rather than by weekday, because the whole point is planning a SPECIFIC coming
-- week — a weekday-keyed table could not tell "this Sunday" from "every Sunday", and the ritual
-- the feature exists for is the former.
--
-- A NULL plan_day_id is meaningful: it is a rest day the user chose, which is not the same fact
-- as having no row (nothing decided). No foreign key, matching workout_sessions.plan_day_id —
-- plan days are soft-deleted, so a constraint would either block the delete or take the history
-- with it.
CREATE TABLE IF NOT EXISTS scheduled_days (
  id            TEXT PRIMARY KEY NOT NULL,
  user_id       TEXT NOT NULL,
  scheduled_on  TEXT NOT NULL,
  plan_day_id   TEXT,
  updated_at    TEXT,
  deleted_at    TEXT,
  UNIQUE (user_id, scheduled_on)
);

CREATE INDEX IF NOT EXISTS scheduled_days_user_date_idx
  ON scheduled_days (user_id, scheduled_on);

CREATE TABLE IF NOT EXISTS outbox (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     TEXT NOT NULL DEFAULT 'local',
  entity      TEXT NOT NULL,
  entity_id   TEXT NOT NULL,
  op          TEXT NOT NULL,
  payload     TEXT,
  created_at  TEXT NOT NULL,
  attempts    INTEGER NOT NULL DEFAULT 0,
  last_error  TEXT
);

CREATE INDEX IF NOT EXISTS outbox_created_idx ON outbox (created_at);

CREATE TABLE IF NOT EXISTS coach_briefs (
  id          TEXT PRIMARY KEY NOT NULL,
  user_id     TEXT NOT NULL,
  brief_date  TEXT NOT NULL,
  text        TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  UNIQUE (user_id, brief_date)
);

-- One row per user, holding how far the last successful pull got. Deliberately not a single
-- global row: two people sharing a device have independent cloud accounts and must not inherit
-- each other's cursor, which would silently skip rows for whoever synced second.
CREATE TABLE IF NOT EXISTS sync_state (
  user_id        TEXT PRIMARY KEY NOT NULL,
  last_pulled_at TEXT,
  last_synced_at TEXT
);
`;
