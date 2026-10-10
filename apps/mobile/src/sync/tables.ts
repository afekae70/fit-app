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
  /**
   * Ordering columns that hold a local-only sentinel once the row is soft-deleted.
   *
   * SQLite enforces UNIQUE on (parent, index), so a deleted row would keep occupying its slot and
   * block the surviving rows from renumbering. The repository parks it at `-rowid` — negative,
   * unique, never a real index. That is a trick for this database, and it does not travel: the
   * server checks `set_index >= 1` and has its own uniqueness. So a tombstone is sent without
   * these columns, leaving whatever the server already had.
   */
  readonly indexColumns?: readonly string[];
  /**
   * The server may not have this table yet, and that is not an error.
   *
   * A table joins sync in two places that are not released together: the app, which ships in a
   * build, and the server, where somebody has to run a migration by hand. Between the two, an
   * app that insists on the table fails every sync on the first request to it — and since a
   * failed run moves no cursor, it fails the same way for every other table too, on every
   * phone, until the migration is run.
   *
   * Marked optional, a table the server does not know is stepped over: nothing is sent to it or
   * read from it, its unsent rows stay queued, and everything else syncs. The run after the
   * migration picks it up with nothing to repair.
   */
  readonly optional?: boolean;
  /**
   * Columns the server may not have yet. A subset of `columns`.
   *
   * The same gap as `optional`, one level down: a column added to a table that already syncs.
   * These tables are the training log itself, so the cost of getting it wrong is higher — an
   * app that sent a column the server had never heard of would have every request for that
   * table refused outright, and sets would stop reaching the cloud until a script was run.
   *
   * So when the server says it does not know one of these, the table is sent again without
   * them. The rows go up as they always did; the ones that actually had something in a newer
   * column stay queued, and go again in full once the server can take it. Coming the other way,
   * a row that arrives without one of these leaves the local value alone — see `fromRemote`.
   */
  readonly optionalColumns?: readonly string[];
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
    // The last three make a workout a timed one: seconds of work, seconds of rest, how many
    // times round. They were phone-only until a coach needed to hand a timed workout over, and
    // until a reinstall needed to bring one back.
    columns: [
      'id',
      'plan_id',
      'day_index',
      'name',
      'work_seconds',
      'rest_seconds',
      'rounds',
      'updated_at',
      'deleted_at',
    ],
    booleans: [],
    json: [],
    scope: { kind: 'parent', table: 'plans', column: 'plan_id' },
    indexColumns: ['day_index'],
    optionalColumns: ['work_seconds', 'rest_seconds', 'rounds'],
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
    indexColumns: ['order_index'],
  },
  {
    /*
     * The calendar: which workout is planned for which date.
     *
     * After the plan tables, since a scheduled row names a plan day. There is no foreign key
     * on either side — the phone never had one — but offering a date before the workout it
     * points at would still show another device a day whose workout it cannot find yet.
     *
     * A date holds several rows (two workouts, in `position` order) and no row at all means
     * "undecided", so replacing a day is tombstones for the old rows and new rows for the new
     * ones; nothing is ever updated in place and there is no unique index to trip.
     */
    table: 'scheduled_days',
    columns: [
      'id',
      'user_id',
      'scheduled_on',
      'plan_day_id',
      'position',
      'updated_at',
      'deleted_at',
    ],
    booleans: [],
    json: [],
    scope: { kind: 'column' },
    optional: true,
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
    // `superset_with_next` links an exercise to the one after it. Without it a superset comes
    // back from the cloud as two unrelated exercises.
    columns: [
      'id',
      'session_id',
      'exercise_key',
      'order_index',
      'notes',
      'superset_with_next',
      'updated_at',
      'deleted_at',
    ],
    booleans: ['superset_with_next'],
    json: [],
    scope: { kind: 'parent', table: 'workout_sessions', column: 'session_id' },
    indexColumns: ['order_index'],
    optionalColumns: ['superset_with_next'],
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
      // A drop set: done straight after the one before it, with less weight and no rest.
      'is_drop',
      'updated_at',
      'deleted_at',
    ],
    booleans: ['is_warmup', 'to_failure', 'is_drop'],
    json: [],
    scope: { kind: 'parent', table: 'session_exercises', column: 'session_exercise_id' },
    // A set with no reps, no duration and no distance records nothing. It is a placeholder the
    // UI put there to be typed into, and sending it is what the server's own check constraint
    // objects to. Holding it back locally is both the smaller change and the more honest one:
    // an empty row is not training data, and the moment anything is entered it syncs normally.
    pushWhere:
      '(t0.reps IS NOT NULL OR t0.duration_seconds IS NOT NULL OR t0.distance_m IS NOT NULL)',
    indexColumns: ['set_index'],
    optionalColumns: ['is_drop'],
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
  {
    /*
     * The food log: what was eaten on which day.
     *
     * Last, and depending on nothing: a row names no other row. Optional, because the table
     * reaches the server by a script somebody runs by hand (0014), and until they do the rest
     * of sync must carry on as if this entry were not here.
     */
    table: 'food_entries',
    columns: [
      'id',
      'user_id',
      'eaten_on',
      'name',
      'food_key',
      'grams',
      'calories',
      'protein_g',
      'carbs_g',
      'fat_g',
      'created_at',
      'updated_at',
      'deleted_at',
    ],
    booleans: [],
    json: [],
    scope: { kind: 'column' },
    optional: true,
  },
] as const;

/** Lookup by name, for the deferral bookkeeping that needs to find a table's parent. */
export const SYNC_TABLE_BY_NAME: ReadonlyMap<string, SyncTable> = new Map(
  SYNC_TABLES.map((t) => [t.table, t]),
);
