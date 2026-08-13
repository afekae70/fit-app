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

export const SCHEMA_VERSION = 5;

/**
 * Incremental migrations, keyed by the version they upgrade TO.
 *
 * `CREATE TABLE IF NOT EXISTS` covers new tables, but not new columns on tables that already
 * exist on a user's device — and by now there is real workout data on real phones, so
 * rebuilding the schema is not an option. Each entry runs exactly once, in order, guarded by
 * SQLite's `user_version`.
 *
 * Each version is a LIST of statements, not one string, and the runner executes them one at a
 * time. That is load-bearing, not tidiness: the runner swallows "duplicate column" errors
 * (see db/index.ts for why), and a multi-statement batch aborts at the first such error — so
 * statement two of a two-column migration would be skipped on any device where statement one
 * had already been applied, leaving the schema half-upgraded and the version stamped as done.
 * One statement per entry means each is guarded on its own.
 *
 * Version 4 (the plan tables) has no entry on purpose: they are entirely new tables, so the
 * `CREATE TABLE IF NOT EXISTS` block below already creates them on every device, new or old.
 * The version still moves so the stored `user_version` keeps describing the schema shape.
 */
export const MIGRATIONS: Record<number, string[]> = {
  3: [`ALTER TABLE workout_sessions ADD COLUMN name TEXT;`],
  5: [
    `ALTER TABLE profile ADD COLUMN unit_system TEXT;`,
    `ALTER TABLE profile ADD COLUMN default_rest_seconds INTEGER;`,
  ],
};

export interface PendingStatement {
  version: number;
  sql: string;
}

/**
 * The statements needed to bring a database at `currentVersion` up to `SCHEMA_VERSION`,
 * flattened in the order they must run.
 *
 * Split out from the runner in db/index.ts so it can be tested: that module imports
 * expo-sqlite, which cannot load under vitest, and the upgrade path is the one piece of this
 * app that only ever executes on devices that already hold real training data.
 */
export function pendingMigrations(currentVersion: number): PendingStatement[] {
  if (currentVersion >= SCHEMA_VERSION) return [];

  return Object.keys(MIGRATIONS)
    .map(Number)
    .filter((version) => version > currentVersion)
    .sort((a, b) => a - b)
    .flatMap((version) => (MIGRATIONS[version] ?? []).map((sql) => ({ version, sql })));
}

/**
 * True for the one migration failure that is expected rather than broken.
 *
 * A fresh install builds every column from CREATE_SCHEMA_SQL and then still runs the
 * migrations, so each ALTER TABLE re-adds a column that is already there. Every other error is
 * a real one and must not be swallowed.
 */
export function isDuplicateColumnError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /duplicate column/i.test(message);
}

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
  -- 'metric' | 'imperial'. A DISPLAY preference only: every measurement in this database is
  -- stored metric (kg, cm, m) no matter what this says, and conversion happens at the edge of
  -- the UI. Storing whatever the user last typed would make the unit a property of each row,
  -- and a history mixing kg and lb rows is unaggregatable — the volume totals and the weight
  -- trend would both silently become nonsense.
  unit_system      TEXT,
  -- Fallback rest between sets, in seconds. NULL means no timer at all, so absence is the
  -- off switch and no separate enabled flag can contradict it.
  default_rest_seconds INTEGER,
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

-- The training plan: what you INTEND to do, as opposed to workout_sessions, which record what
-- you actually did. Keeping the two apart is the point — a plan that silently rewrote itself
-- from your logged sets could never tell you that you missed a target.
--
-- The server has a plans → plan_variants → plan_days → plan_day_exercises chain, where the
-- variant level swaps exercises per gym (home vs. base vs. commercial). That level is dropped
-- here: the local database has no locations table yet, so a variant would be a table with one
-- row per plan and nothing to key it by. When locations land, plan_days gains a
-- plan_variant_id and this comment goes with it.
CREATE TABLE IF NOT EXISTS plans (
  id             TEXT PRIMARY KEY NOT NULL,
  name           TEXT NOT NULL,
  goal           TEXT,
  days_per_week  INTEGER,
  length_weeks   INTEGER,
  -- At most one plan is active. Enforced in the repository rather than by a constraint, since
  -- SQLite cannot express "at most one row where is_active = 1" without a partial unique index
  -- that would then reject the intermediate state of switching plans.
  is_active      INTEGER NOT NULL DEFAULT 0,
  server_id      TEXT,
  created_at     TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS plan_days (
  id         TEXT PRIMARY KEY NOT NULL,
  plan_id    TEXT NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
  -- Position in the rotation, 1..n — NOT a weekday. A 3-day split run every other day never
  -- lands on the same weekdays twice, so pinning days to Sunday/Tuesday/Thursday would be
  -- wrong for most real programmes.
  day_index  INTEGER NOT NULL,
  name       TEXT,
  UNIQUE (plan_id, day_index)
);

CREATE INDEX IF NOT EXISTS plan_days_plan_idx ON plan_days (plan_id, day_index);

CREATE TABLE IF NOT EXISTS plan_day_exercises (
  id               TEXT PRIMARY KEY NOT NULL,
  plan_day_id      TEXT NOT NULL REFERENCES plan_days(id) ON DELETE CASCADE,
  exercise_key     TEXT NOT NULL,
  order_index      INTEGER NOT NULL,
  -- Every target is nullable: a plan that demands sets, a rep range, an RPE and a rest time for
  -- every movement is more bookkeeping than most people will maintain, and a half-filled plan
  -- is still a useful plan.
  target_sets      INTEGER,
  target_reps_min  INTEGER,
  target_reps_max  INTEGER,
  target_rpe       REAL,
  target_load_kg   REAL,
  rest_seconds     INTEGER,
  notes            TEXT,
  UNIQUE (plan_day_id, order_index)
);

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
