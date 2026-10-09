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

export const SCHEMA_VERSION = 19;

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

  // Supersets. See the column comment in CREATE_SCHEMA_SQL for why this is a link rather than a
  // group id. SQLite cannot add a NOT NULL column without a default, and 0 is the right one:
  // every exercise ever logged so far stood on its own.
  13: `
    ALTER TABLE session_exercises ADD COLUMN superset_with_next INTEGER NOT NULL DEFAULT 0;
  `,

  // Drop sets. Same reasoning as 13: a flag rather than a group id, and 0 is the right default
  // because every set logged until now stood on its own.
  14: `
    ALTER TABLE sets ADD COLUMN is_drop INTEGER NOT NULL DEFAULT 0;
  `,

  // Timed workouts. Nullable on purpose, with no default: NULL is the answer "this is an ordinary
  // workout", and every plan day written before today is one. A default of 50 would have
  // turned every existing leg day into a countdown.
  15: `
    ALTER TABLE plan_days ADD COLUMN work_seconds INTEGER;
    ALTER TABLE plan_days ADD COLUMN rest_seconds INTEGER;
  `,

  // Several workouts on one date. The calendar held one decision per date, enforced by
  // UNIQUE (user_id, scheduled_on) - and SQLite cannot drop a constraint, so the table is rebuilt
  // without it and with a position to order the workouts within a day.
  //
  // This is the first migration that replaces a table holding data, so it is written to survive
  // being interrupted. The runner executes statement by statement with no transaction of its
  // own, and an app closed between the DROP and the RENAME would otherwise leave the calendar
  // in a table nothing reads. Hence the explicit transaction, and every statement safe to repeat:
  // IF NOT EXISTS on the create and INSERT OR IGNORE on the copy, so a retry after a crash that
  // happened before COMMIT, or after COMMIT but before the version was recorded, lands in the
  // same place. Only plain columns are selected, so the copy reads the old shape and the new one
  // alike. (No semicolons in this comment: the runner splits on them.)
  16: `
    BEGIN;
    CREATE TABLE IF NOT EXISTS scheduled_days_v16 (
      id            TEXT PRIMARY KEY NOT NULL,
      user_id       TEXT NOT NULL,
      scheduled_on  TEXT NOT NULL,
      plan_day_id   TEXT,
      position      INTEGER NOT NULL DEFAULT 0,
      updated_at    TEXT,
      deleted_at    TEXT
    );
    INSERT OR IGNORE INTO scheduled_days_v16 (id, user_id, scheduled_on, plan_day_id, updated_at, deleted_at)
      SELECT id, user_id, scheduled_on, plan_day_id, updated_at, deleted_at FROM scheduled_days;
    DROP TABLE scheduled_days;
    ALTER TABLE scheduled_days_v16 RENAME TO scheduled_days;
    CREATE INDEX IF NOT EXISTS scheduled_days_user_date_idx
      ON scheduled_days (user_id, scheduled_on);
    COMMIT;
  `,

  // How many times a timed workout runs its list. NULL means once, which is what every timed
  // day written before today does — the same reasoning as the timing columns above.
  17: `
    ALTER TABLE plan_days ADD COLUMN rounds INTEGER;
  `,

  // Not a change of shape. A repair, run once, for a phone whose cloud copy had fallen behind
  // without anyone being told.
  //
  // Two faults had let the server and the phone disagree about where rows sit. Removing an
  // exercise or a set renumbered the ones after it and never marked them as changed, so the
  // server kept the old positions. And a deletion was only sent if a pull had already confirmed
  // the row, so a row pushed by a run that then failed stayed alive on the server after it was
  // deleted here. Either one ends with the server refusing a row for a position it believes is
  // taken, and until this version one refused row stopped every table from syncing.
  //
  // Both faults are fixed where they were made. That stops new damage and repairs none of the
  // old: the rows already out of step are not marked as changed, so nothing would ever send
  // them again. Hence the last statement. With no push cursor, the next sync offers the server
  // everything this device holds, which is the one way to make the two agree that does not
  // depend on knowing which rows went wrong.
  //
  // The four before it are for the same run. A deleted row gives up its position by parking at
  // -rowid, but a pull writes the position the server holds back over that, and for a while the
  // server kept a deleted row on its real one. Re-parking them here is what lets the next sync
  // see that the server still has such a row on a live slot, and move it. (No semicolons in
  // this comment, for the runner's sake.)
  //
  // OR IGNORE, because this runs at startup and a migration that throws leaves the app unable
  // to open its own database. A row that cannot take the sentinel stays exactly where it is,
  // which is no worse than before. Safe to run twice, and it does nothing on a new install,
  // where the tables are empty.
  18: `
    UPDATE OR IGNORE plan_days          SET day_index   = -rowid WHERE deleted_at IS NOT NULL AND day_index   >= 0;
    UPDATE OR IGNORE plan_day_exercises SET order_index = -rowid WHERE deleted_at IS NOT NULL AND order_index >= 0;
    UPDATE OR IGNORE session_exercises  SET order_index = -rowid WHERE deleted_at IS NOT NULL AND order_index >= 0;
    UPDATE OR IGNORE sets               SET set_index   = -rowid WHERE deleted_at IS NOT NULL AND set_index   >= 0;
    UPDATE sync_state SET last_synced_at = NULL;
  `,

  // The calendar joins sync. Two things it needs that it did not have.
  //
  // The column is what every synced table carries: the server's own timestamp for the row, as
  // of the last time it crossed the wire, which is what an incoming copy is compared against.
  //
  // The UPDATE marks every date already planned as changed. Sync sends what is newer than its
  // cursor, and a calendar planned last week is older than that - so without it, the plan
  // already on the phone would be the one thing that never reached the server, and a coach
  // opening this person's calendar would see an empty month. The stamp is written in the same
  // format the app writes (toISOString), because these values are compared as text.
  //
  // Safe to run twice: the ALTER is tolerated as a duplicate column, and marking rows as
  // changed a second time only sends them a second time.
  19: `
    ALTER TABLE scheduled_days ADD COLUMN remote_updated_at TEXT;
    UPDATE scheduled_days SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now');
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
  -- Linked to the exercise after it: a superset is a run of consecutive exercises where every
  -- one but the last carries this. Deliberately not a group id — reordering would leave ids
  -- pointing at exercises no longer adjacent, and something would have to go and tidy up.
  -- Position is the truth, and this only says "and the next one too".
  superset_with_next INTEGER NOT NULL DEFAULT 0,
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
  -- A drop set: this set was taken straight from the one before it, lighter, with no rest. The
  -- same positional idea as superset_with_next on session_exercises, one level down — the flag
  -- says "I continue the set above me", so renumbering after an insert or delete re-forms the
  -- chains on its own instead of leaving group ids pointing at rows that moved.
  -- (No backticks in this comment: the whole schema is one template literal.)
  is_drop              INTEGER NOT NULL DEFAULT 0,
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
  -- A timed workout: every exercise done for work_seconds, with rest_seconds between. NULL
  -- work_seconds means an ordinary sets-and-reps day. Local only — not in the sync column list,
  -- the same way workout_sessions.location_id is not, so no server migration is needed for it.
  work_seconds INTEGER,
  rest_seconds INTEGER,
  -- How many times through the list. NULL or 1 is once; a circuit trained three times through
  -- is 3, and it logs three sets of each exercise rather than three copies of the day.
  rounds INTEGER,
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
--
-- A date may carry several rows: one per workout, in position order - a morning session and an
-- evening one. A rest day is a single row with a NULL plan_day_id and never shares its date
-- with a workout. No unique key on the date for that reason (see migration 16).
CREATE TABLE IF NOT EXISTS scheduled_days (
  id            TEXT PRIMARY KEY NOT NULL,
  user_id       TEXT NOT NULL,
  scheduled_on  TEXT NOT NULL,
  plan_day_id   TEXT,
  position      INTEGER NOT NULL DEFAULT 0,
  updated_at    TEXT,
  deleted_at    TEXT,
  remote_updated_at TEXT
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
