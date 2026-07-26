/**
 * Local SQLite schema — the offline-first store.
 *
 * Mirrors the Postgres design in apps/api deliberately, most importantly the three-level
 * session → session_exercise → set chain with ONE ROW PER SET. That is what makes per-exercise
 * set counts independent: 4 sets of chest press and 2 of face pulls in one session are simply
 * different numbers of child rows, not different column shapes.
 *
 * Differences from the server schema, and why:
 *  - No user_id anywhere. This database belongs to one device and one signed-in user; server
 *    RLS is what enforces ownership once rows sync.
 *  - Exercises are referenced by `exercise_key` (the catalogue's stable `nameEn`) rather than
 *    a uuid, because the catalogue ships in the app bundle and has no local uuids until the
 *    server assigns them.
 *  - An `outbox` table records every mutation for later replay to Supabase.
 *
 * SQLite has no native boolean or timestamp: booleans are INTEGER 0/1, timestamps are ISO 8601
 * TEXT (lexicographically sortable, which is what the history queries rely on).
 */

export const SCHEMA_VERSION = 4;

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
};

export const CREATE_SCHEMA_SQL = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- Single-row table (id is always 1). The profile is device-local until auth lands; keeping it
-- in SQLite rather than component state is what lets the weight tracker recompute TDEE
-- across app launches.
CREATE TABLE IF NOT EXISTS profile (
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

CREATE TABLE IF NOT EXISTS body_metrics (
  id              TEXT PRIMARY KEY NOT NULL,
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
  raw_payload     TEXT
);

CREATE INDEX IF NOT EXISTS body_metrics_measured_idx
  ON body_metrics (measured_at DESC);

-- Dated snapshots rather than values recomputed on read, so the weekly update has somewhere
-- to record each revision and history stays auditable.
CREATE TABLE IF NOT EXISTS nutrition_targets (
  id                  TEXT PRIMARY KEY NOT NULL,
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

CREATE TABLE IF NOT EXISTS workout_sessions (
  id             TEXT PRIMARY KEY NOT NULL,
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
  created_at     TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS workout_sessions_started_idx
  ON workout_sessions (started_at DESC);

CREATE TABLE IF NOT EXISTS session_exercises (
  id            TEXT PRIMARY KEY NOT NULL,
  session_id    TEXT NOT NULL REFERENCES workout_sessions(id) ON DELETE CASCADE,
  exercise_key  TEXT NOT NULL,
  order_index   INTEGER NOT NULL,
  notes         TEXT,
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
  name        TEXT NOT NULL,
  -- Exactly one plan drives the week. Enforced in the repository rather than by a constraint,
  -- since SQLite cannot express "at most one row with is_active = 1".
  is_active   INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS plan_days (
  id         TEXT PRIMARY KEY NOT NULL,
  plan_id    TEXT NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
  -- Position in the training week (1..N), not a weekday. A 4-day split does not map onto
  -- Sunday-Saturday, and pinning days to dates makes a missed session cascade into the rest.
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

CREATE TABLE IF NOT EXISTS outbox (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  entity      TEXT NOT NULL,
  entity_id   TEXT NOT NULL,
  op          TEXT NOT NULL,
  payload     TEXT,
  created_at  TEXT NOT NULL,
  attempts    INTEGER NOT NULL DEFAULT 0,
  last_error  TEXT
);

CREATE INDEX IF NOT EXISTS outbox_created_idx ON outbox (created_at);
`;
