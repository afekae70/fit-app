/**
 * What syncs, in what order, and how each column crosses the SQLite/Postgres line.
 *
 * Pure data with no imports, so both the engine and its tests can read the same description of
 * the wire format instead of each restating it.
 *
 * The order of `SYNC_TABLES` is load-bearing in both directions. Every foreign key points at a
 * table earlier in the list, so pushing top-to-bottom never offers Postgres a child whose parent
 * it has not seen, and pulling top-to-bottom never offers SQLite one either (`PRAGMA
 * foreign_keys` is ON — an orphan is a thrown error, not a tolerated dangling reference).
 *
 * Plans come before sessions for one non-obvious reason: `workout_sessions.plan_day_id` is a
 * foreign key to `plan_days`, so a workout started from a plan depends on that plan already
 * existing. Grouping "plans" after "workouts" would read more naturally and break on the first
 * planned workout anyone syncs.
 */

/** How the push side works out which rows belong to the signed-in user. */
export type SyncScope =
  /** The table carries `user_id` itself. */
  | { readonly kind: 'column' }
  /**
   * Ownership is inherited. Child tables have no `user_id` of their own — on the server RLS
   * proves ownership by joining to the parent, and locally the push query does the same join.
   */
  | { readonly kind: 'parent'; readonly table: string; readonly column: string };

export interface SyncTable {
  /** Identical on both sides — no table is renamed across the line. */
  readonly table: string;
  /**
   * Every column that travels, local name first. Names match on both sides; the columns that
   * exist on only one side (`server_id`, `plan_variant_id`, `exercise_id`) are simply absent.
   */
  readonly columns: readonly string[];
  /** INTEGER 0/1 in SQLite, `boolean` in Postgres. */
  readonly booleans: readonly string[];
  /** A JSON string in SQLite, `jsonb` in Postgres. */
  readonly json: readonly string[];
  readonly scope: SyncScope;
  /**
   * An extra SQL condition a row must satisfy to be pushed, on the alias `t0`.
   *
   * For rows that are real locally but meaningless to the server. Only `sets` uses it, and the
   * reason is specific: the app creates a set the moment an exercise is added, empty, because
   * that row is the thing you type into. Until something is typed it holds nothing — and the
   * server rejects it, which does not merely skip the row but fails its whole batch and stops
   * sync for every table.
   */
  readonly pushWhere?: string;
}

export const SYNC_TABLES: readonly SyncTable[] = [
  {
    table: 'plans',
    columns: ['id', 'user_id', 'name', 'is_active', 'created_at', 'updated_at', 'deleted_at'],
    booleans: ['is_active'],
    json: [],
    scope: { kind: 'column' },
  },
  {
    table: 'plan_days',
    columns: ['id', 'plan_id', 'day_index', 'name', 'updated_at', 'deleted_at'],
    booleans: [],
    json: [],
    scope: { kind: 'parent', table: 'plans', column: 'plan_id' },
  },
  {
    table: 'plan_day_exercises',
    columns: [
      'id',
      'plan_day_id',
      'exercise_key',
      'order_index',
      'target_sets',
      'target_reps_min',
      'target_reps_max',
      'notes',
      'updated_at',
      'deleted_at',
    ],
    booleans: [],
    json: [],
    scope: { kind: 'parent', table: 'plan_days', column: 'plan_day_id' },
  },
  {
    table: 'workout_sessions',
    // `location_id` is omitted on purpose. The column exists on both sides and is a foreign key
    // to a `locations` table the app never writes to, so it is always null here; sending it would
    // only create a way to fail. `server_id` is local bookkeeping and stays local.
    columns: [
      'id',
      'user_id',
      'plan_day_id',
      'name',
      'started_at',
      'ended_at',
      'bodyweight_kg',
      'session_rpe',
      'notes',
      'created_at',
      'updated_at',
      'deleted_at',
    ],
    booleans: [],
    json: [],
    scope: { kind: 'column' },
  },
  {
    table: 'session_exercises',
    columns: ['id', 'session_id', 'exercise_key', 'order_index', 'notes', 'updated_at', 'deleted_at'],
    booleans: [],
    json: [],
    scope: { kind: 'parent', table: 'workout_sessions', column: 'session_id' },
  },
  {
    table: 'sets',
    columns: [
      'id',
      'session_exercise_id',
      'set_index',
      'weight_kg',
      'reps',
      'duration_seconds',
      'distance_m',
      'rpe',
      'is_warmup',
      'to_failure',
      'completed_at',
      'done_at',
      'updated_at',
      'deleted_at',
    ],
    booleans: ['is_warmup', 'to_failure'],
    json: [],
    scope: { kind: 'parent', table: 'session_exercises', column: 'session_exercise_id' },
    // A set with no reps, no duration and no distance records nothing. It is a placeholder the
    // UI put there to be typed into, and sending it is what the server's own check constraint
    // objects to. Holding it back locally is both the smaller change and the more honest one:
    // an empty row is not training data, and the moment anything is entered it syncs normally.
    pushWhere: '(t0.reps IS NOT NULL OR t0.duration_seconds IS NOT NULL OR t0.distance_m IS NOT NULL)',
  },
  {
    table: 'body_metrics',
    columns: [
      'id',
      'user_id',
      'measured_at',
      'weight_kg',
      'body_fat_pct',
      'muscle_mass_kg',
      'water_pct',
      'bone_mass_kg',
      'visceral_fat',
      'source',
      'device_id',
      'raw_payload',
      'updated_at',
      'deleted_at',
    ],
    booleans: [],
    json: ['raw_payload'],
    scope: { kind: 'column' },
  },
] as const;

/** Lookup by name, for the deferral bookkeeping that needs to find a table's parent. */
export const SYNC_TABLE_BY_NAME: ReadonlyMap<string, SyncTable> = new Map(
  SYNC_TABLES.map((t) => [t.table, t]),
);
