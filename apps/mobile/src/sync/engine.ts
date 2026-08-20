/**
 * The sync engine: push what changed here, pull what changed there, last write wins.
 *
 * Written against the `SyncTransport` seam rather than the Supabase client directly, for the same
 * reason the repository is written against `SqlExecutor` — so the interesting logic (which rows
 * are dirty, which version of a row survives, how far the cursor may advance) can be tested
 * against a real SQLite database and a fake server, with no network and no native module.
 *
 * ## Two clocks, two cursors
 *
 * The single hardest thing here is that the phone's clock and Postgres's clock are not the same
 * clock, and neither can be trusted relative to the other. A phone that is five minutes fast
 * would, under one shared cursor, win every conflict forever and skip rows on every pull.
 *
 * So there are two cursors and each is only ever compared against timestamps from its own clock:
 *
 *   - `last_synced_at` is a *local* timestamp, compared against local `updated_at` values, and
 *     answers "what have I changed since I last pushed?"
 *   - `last_pulled_at` is a *server* timestamp, compared against server `updated_at` values, and
 *     answers "what has anyone changed since I last pulled?"
 *
 * The two never meet. The server stamps its own `updated_at` on every write (a trigger, added in
 * migration 0002 — it ignores whatever the client sends), so server timestamps are consistent
 * with each other no matter how many devices with bad clocks are writing.
 *
 * ## Push before pull
 *
 * Deliberate, and the order matters. Pushing first means the server has this device's newest work
 * before we ask what is new; the pull then hands our own rows straight back, which is a harmless
 * no-op merge. The other order has a window where a pull overwrites a local edit that was never
 * sent, and the edit is gone with nothing to recover it from.
 */

import type { SqlExecutor } from '../db/executor.js';
import { earlierOf, fromRemote, isNewer, laterOf, toRemote, type Row } from './rows.js';
import { SYNC_TABLES, SYNC_TABLE_BY_NAME, type SyncTable } from './tables.js';

/** How many rows travel in one request. Keeps a first sync off a long history from timing out. */
const BATCH = 200;

export interface SyncTransport {
  /** Upsert rows into `table`, keyed on the primary key. Rejects if the server refuses any row. */
  upsert(table: string, rows: Row[]): Promise<void>;
  /**
   * Patch rows that the server already has, by primary key. A row it does not have is not an
   * error — the patch simply matches nothing.
   *
   * Separate from `upsert` because a tombstone must never be written as one. See `push`.
   */
  patch(table: string, rows: Row[]): Promise<void>;
  /**
   * Rows in `table` whose server `updated_at` is strictly after `since`, oldest first, at most
   * `limit`. `since` null means everything.
   */
  changedSince(table: string, since: string | null, limit: number): Promise<Row[]>;
  /**
   * One row by primary key, or null if the server does not have it (or will not show it).
   *
   * Used only to repair a missing parent — see `ensureParent`.
   */
  fetchById(table: string, id: string): Promise<Row | null>;
  /**
   * Make sure the signed-in user has a `profiles` row.
   *
   * Everything user-scoped is a foreign key to `profiles`, so without one the very first push
   * fails on a constraint violation that says nothing about the actual cause. A trigger on
   * `auth.users` creates this row at sign-up, but an account created before that trigger existed
   * has no profile and would be permanently unable to sync.
   */
  ensureProfile(userId: string): Promise<void>;
}

export interface SyncResult {
  readonly pushed: number;
  readonly pulled: number;
  /**
   * Rows that arrived before their parent did and were held back for the next run. Non-zero is
   * not an error; it is the engine declining to write an orphan.
   */
  readonly deferred: number;
  readonly syncedAt: string;
}

type Clock = () => string;
const defaultClock: Clock = () => new Date().toISOString();

/* -------------------------------------------------------------------------- */
/* Cursors                                                                     */
/* -------------------------------------------------------------------------- */

interface Cursors {
  lastPulledAt: string | null;
  lastSyncedAt: string | null;
}

async function readCursors(db: SqlExecutor, userId: string): Promise<Cursors> {
  const row = await db.get<{ last_pulled_at: string | null; last_synced_at: string | null }>(
    `SELECT last_pulled_at, last_synced_at FROM sync_state WHERE user_id = ?`,
    [userId],
  );
  return { lastPulledAt: row?.last_pulled_at ?? null, lastSyncedAt: row?.last_synced_at ?? null };
}

async function writeCursors(db: SqlExecutor, userId: string, cursors: Cursors): Promise<void> {
  await db.run(
    `INSERT INTO sync_state (user_id, last_pulled_at, last_synced_at) VALUES (?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET last_pulled_at = excluded.last_pulled_at,
                                         last_synced_at = excluded.last_synced_at`,
    [userId, cursors.lastPulledAt, cursors.lastSyncedAt],
  );
}

/* -------------------------------------------------------------------------- */
/* Push                                                                        */
/* -------------------------------------------------------------------------- */

/**
 * The SELECT that finds this user's dirty rows in one table.
 *
 * Child tables carry no `user_id`, so ownership is resolved by walking `scope` up to whichever
 * ancestor does have one — `sets` reaches `workout_sessions` through `session_exercises`, two
 * joins up. This mirrors exactly what the server's RLS policy does for the same table, which is
 * the point: if the two disagreed, the client would offer rows the server then refuses.
 *
 * Note what is *not* filtered here: soft-deleted rows are included on purpose. A deletion is a
 * row with `deleted_at` set, and pushing it is the only way the other device ever learns about
 * it. Excluding them — the reflex everywhere else in the repository — would make deletes local
 * forever and let the row come back on the next pull.
 */
export function buildPushQuery(table: SyncTable): string {
  const joins: string[] = [];
  let alias = 't0';
  let current = table;

  while (current.scope.kind === 'parent') {
    const parentAlias = `t${joins.length + 1}`;
    const parent = SYNC_TABLE_BY_NAME.get(current.scope.table);
    if (!parent) throw new Error(`sync: ${current.table} names an unknown parent`);
    joins.push(`JOIN ${parent.table} ${parentAlias} ON ${parentAlias}.id = ${alias}.${current.scope.column}`);
    alias = parentAlias;
    current = parent;
  }

  const columns = table.columns.map((c) => `t0.${c}`).join(', ');
  // A soft-deleted row always travels — that is the only way the other device learns of the
  // delete — so `pushWhere` never applies to one. Without the escape, deleting a blank set would
  // hold its tombstone back and leave that row alive on the server permanently.
  const extra = table.pushWhere ? `AND (${table.pushWhere} OR t0.deleted_at IS NOT NULL)` : '';
  // A row created and deleted between two syncs has never existed on the server, so there is
  // nothing there to delete. Sending it would mean inserting a tombstone for a row nobody has —
  // and for an ordered table that insert has no index to carry, since the parked one cannot go.
  const tombstone = 'AND NOT (t0.deleted_at IS NOT NULL AND t0.remote_updated_at IS NULL)';
  return `SELECT ${columns} FROM ${table.table} t0
    ${joins.join('\n    ')}
    WHERE ${alias}.user_id = ?
      AND (? IS NULL OR t0.updated_at IS NULL OR t0.updated_at > ?)
      ${extra}
      ${tombstone}
    ORDER BY t0.updated_at`;
}

/**
 * How far the first push pass moves an ordering column out of the way.
 *
 * Far above any real position — a plan has days in single figures and a session has exercises
 * in double — so a parked value cannot collide with a live row that is not in this batch. It
 * mirrors the `PARK` the repository already uses for the same problem in SQLite.
 */
const PUSH_PARK = 100_000;

async function push(
  db: SqlExecutor,
  transport: SyncTransport,
  userId: string,
  since: string | null,
): Promise<number> {
  let total = 0;
  for (const table of SYNC_TABLES) {
    const rows = await db.all<Row>(buildPushQuery(table), [userId, since, since]);
    if (rows.length === 0) continue;

    /*
     * Tombstones travel as patches, everything else as upserts.
     *
     * `toRemote` omits a deleted row's ordering column, because the local sentinel `-rowid` is
     * something the server rejects and no substitute is safe — every positive value risks
     * colliding with a live row under the same parent. Omitting it was supposed to leave the
     * server's own value alone.
     *
     * It does not. An upsert is `INSERT ... ON CONFLICT DO UPDATE`, and Postgres checks NOT NULL
     * against the proposed insert tuple before it ever looks for the conflict — so omitting a
     * NOT NULL column fails outright even when the row is certainly there. That is what broke
     * syncing entirely: one deleted plan day, and every later sync died on the same row, so
     * nothing at all reached the server.
     *
     * A patch has no insert tuple to check. It also cannot resurrect a row the server has
     * already lost, which is the right behaviour — `buildPushQuery` has already excluded
     * tombstones the server never saw.
     */
    const live = rows.filter((row) => row.deleted_at === null || row.deleted_at === undefined);
    const tombstones = rows.filter((row) => row.deleted_at !== null && row.deleted_at !== undefined);

    /*
     * Tombstones go first, and the order is load-bearing.
     *
     * A deleted row parks its index out of the way; a surviving sibling then renumbers into the
     * slot it left. Sent the other way round, the survivor arrives while the deleted row is
     * still sitting in that position and the server refuses it — which is the same unique
     * violation, just reached from the opposite direction.
     */
    for (let i = 0; i < tombstones.length; i += BATCH) {
      await transport.patch(
        table.table,
        tombstones.slice(i, i + BATCH).map((row) => toRemote(table, row)),
      );
    }

    /*
     * Ordered rows go up in two passes, for the same reason the local reorder does.
     *
     * `UNIQUE (parent, index)` is checked per row, and `onConflict: 'id'` resolves a clash on
     * the primary key and nothing else — so two exercises trading places means one arrives at a
     * slot the other has not left yet, and the server refuses it. Since a rejected row aborts
     * the whole push, one reorder used to stop every table from syncing.
     *
     * The first pass parks the batch's indexes far above anything a real position occupies, the
     * second writes the true ones into slots that are now certainly free. It costs one extra
     * request per ordered table, on a path that runs a few times a day.
     *
     * Skipped for a single row: with nothing to permute against there is no slot to contend
     * for, and the common sync is one row or none.
     */
    const orders = table.indexColumns ?? [];
    if (orders.length > 0 && live.length > 1) {
      for (let i = 0; i < live.length; i += BATCH) {
        await transport.upsert(
          table.table,
          live.slice(i, i + BATCH).map((row) => {
            const parked = toRemote(table, row);
            for (const column of orders) {
              const value = parked[column];
              if (typeof value === 'number') parked[column] = value + PUSH_PARK;
            }
            return parked;
          }),
        );
      }
    }

    for (let i = 0; i < live.length; i += BATCH) {
      await transport.upsert(
        table.table,
        live.slice(i, i + BATCH).map((row) => toRemote(table, row)),
      );
    }

    total += rows.length;
  }
  return total;
}

/* -------------------------------------------------------------------------- */
/* Pull                                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Write one incoming row, unless we already have this exact version of it.
 *
 * The comparison is `incoming.updated_at` against the local row's `remote_updated_at` — server
 * clock against server clock, never against the local `updated_at`, which is a different clock
 * and would make the answer depend on how accurately this phone's time is set.
 *
 * `updated_at` is deliberately *not* taken from the incoming row. It is set to `localStamp`, the
 * timestamp this run records as `last_synced_at`, which marks the row as "in sync as of now"
 * without claiming a local edit happened. Copying the server's value into it instead is what made
 * every synced row look permanently dirty and shuttle back and forth on every run.
 *
 * A local edit made in the window between the push and this write is overwritten. That edit is
 * not lost — its local `updated_at` is later than `localStamp`, so the next run still sends it —
 * but for the moment between, the server's version is what is on screen.
 */
async function upsertLocal(
  db: SqlExecutor,
  table: SyncTable,
  row: Row,
  localStamp: string,
): Promise<boolean> {
  const incoming = typeof row.updated_at === 'string' ? row.updated_at : null;

  const existing = await db.get<{ remote_updated_at: string | null }>(
    `SELECT remote_updated_at FROM ${table.table} WHERE id = ?`,
    [row.id],
  );
  if (existing && !isNewer(incoming, existing.remote_updated_at)) return false;

  // `updated_at` is dropped from the copied set and re-added with the local stamp: the incoming
  // value belongs in `remote_updated_at`, not in the column this device writes from its own clock.
  const columns = [
    ...table.columns.filter((c) => c !== 'updated_at'),
    'remote_updated_at',
    'updated_at',
  ];
  const values = [
    ...table.columns.filter((c) => c !== 'updated_at').map((c) => row[c] ?? null),
    incoming,
    localStamp,
  ];
  const assignments = columns
    .filter((c) => c !== 'id')
    .map((c) => `${c} = excluded.${c}`)
    .join(', ');

  await db.run(
    `INSERT INTO ${table.table} (${columns.join(', ')})
       VALUES (${columns.map(() => '?').join(', ')})
       ON CONFLICT(id) DO UPDATE SET ${assignments}`,
    values,
  );
  return true;
}

/**
 * Make sure this row's parent chain exists locally, fetching any missing link by id.
 *
 * Ordering the pull parents-first already covers the ordinary case: a parent that changed in the
 * same delta is written before its children are considered. What it does not cover is a parent
 * that did *not* change — its `updated_at` is behind the cursor, so no delta will ever offer it
 * again. If that parent is also missing locally, the child can never be written, and because a
 * deferred row holds the cursor back, the pull would stop advancing entirely: sync silently dead,
 * with no error anywhere.
 *
 * That situation should not arise (the cursor only advances past rows actually written) and this
 * exists because "should not arise" is not the standard for something that fails silently and
 * permanently. One request per missing parent, only on a path that is otherwise a dead end.
 *
 * Recurses upward — a missing `session_exercise` may itself be missing its `workout_session` —
 * bounded by the depth of the table graph, which is three.
 */
async function ensureParent(
  db: SqlExecutor,
  transport: SyncTransport,
  table: SyncTable,
  row: Row,
  localStamp: string,
  depth = 0,
): Promise<boolean> {
  if (table.scope.kind !== 'parent') return true;

  const parentId = row[table.scope.column];
  if (parentId === null || parentId === undefined) return true;
  if (typeof parentId !== 'string') return false;

  const parentTable = SYNC_TABLE_BY_NAME.get(table.scope.table);
  if (!parentTable) return false;

  const local = await db.get<{ id: string }>(
    `SELECT id FROM ${parentTable.table} WHERE id = ?`,
    [parentId],
  );
  if (local) return true;

  // Deeper than the table graph means the descriptors describe a cycle. Bail rather than recurse.
  if (depth >= SYNC_TABLES.length) return false;

  const raw = await transport.fetchById(parentTable.table, parentId);
  // Genuinely gone on the server, or hidden by RLS. Nothing to repair; the child stays deferred
  // and the caller decides what that means for the cursor.
  if (!raw) return false;

  const parentRow = fromRemote(parentTable, raw);
  if (!(await ensureParent(db, transport, parentTable, parentRow, localStamp, depth + 1))) {
    return false;
  }

  await upsertLocal(db, parentTable, parentRow, localStamp);
  return true;
}

interface PullOutcome {
  pulled: number;
  deferred: number;
  /** Latest server timestamp actually written. */
  maxSeen: string | null;
  /** Earliest server timestamp we declined to write, if any. */
  earliestDeferred: string | null;
}

/**
 * Does this error mean a row landed on a slot another row still holds?
 *
 * Matched on the message because that is all SQLite offers through expo-sqlite, which wraps the
 * driver error in one of its own. Narrow on purpose: any other failure must keep propagating.
 */
function isUniqueConflict(error: unknown): boolean {
  return /UNIQUE constraint failed/i.test(error instanceof Error ? error.message : String(error));
}

/**
 * Move whatever is sitting in this incoming row's slot out of the way.
 *
 * The mirror of the problem the push solves by parking: a reorder arrives as a permutation, the
 * rows are written one at a time, and the first to land wants a position its neighbour has not
 * given up yet. `UNIQUE (parent, index)` refuses it, and the whole sync run dies on it — which
 * on a real phone showed up as `UNIQUE constraint failed: plan_days.plan_id, plan_days.day_index`.
 *
 * `-rowid` is the same sentinel a soft delete uses: negative, so it cannot collide with any real
 * position, and unique because rowid is.
 *
 * Only ever applied to a row the server is about to overwrite anyway — that is what `batchIds`
 * checks. Parking a row that is not in this batch would strand it at a negative index with
 * nothing coming to correct it.
 */
async function parkClashingRow(
  db: SqlExecutor,
  table: SyncTable,
  row: Row,
  batchIds: ReadonlySet<string>,
): Promise<boolean> {
  if (table.scope.kind !== 'parent') return false;

  const parent = table.scope.column;
  let parked = false;

  for (const column of table.indexColumns ?? []) {
    const clash = await db.get<{ id: string }>(
      `SELECT id FROM ${table.table} WHERE ${parent} = ? AND ${column} = ? AND id <> ?`,
      [row[parent], row[column], row.id],
    );
    if (!clash || !batchIds.has(clash.id)) continue;
    await db.run(`UPDATE ${table.table} SET ${column} = -rowid WHERE id = ?`, [clash.id]);
    parked = true;
  }

  return parked;
}

async function pull(
  db: SqlExecutor,
  transport: SyncTransport,
  since: string | null,
  localStamp: string,
): Promise<PullOutcome> {
  const outcome: PullOutcome = { pulled: 0, deferred: 0, maxSeen: null, earliestDeferred: null };

  for (const table of SYNC_TABLES) {
    // Paginate to exhaustion, walking the cursor forward within the table. Stopping early would
    // leave rows behind that the global cursor then advances past.
    let cursor = since;
    for (;;) {
      const remote = await transport.changedSince(table.table, cursor, BATCH);
      if (remote.length === 0) break;

      // Every id arriving together. Only these may be parked out of the way, since only these
      // are certain to be rewritten before the batch is done.
      const batchIds = new Set(remote.map((raw) => String(raw.id)));

      for (const raw of remote) {
        const row = fromRemote(table, raw);
        const stamp = typeof row.updated_at === 'string' ? row.updated_at : null;

        if (await ensureParent(db, transport, table, row, localStamp)) {
          // Counted only when something was actually written. The cursor is rewound a second on
          // every run, so each run re-reads a few rows it already has; reporting those as pulled
          // would mean the UI never shows a quiet sync as quiet.
          let written: boolean;
          try {
            written = await upsertLocal(db, table, row, localStamp);
          } catch (error) {
            // Retried once, and only after something was actually moved. Retrying a conflict
            // nothing gave way to would just fail again, one row at a time, for ever.
            if (!isUniqueConflict(error) || !(await parkClashingRow(db, table, row, batchIds))) {
              throw error;
            }
            written = await upsertLocal(db, table, row, localStamp);
          }
          if (written) outcome.pulled += 1;
          outcome.maxSeen = laterOf(outcome.maxSeen, stamp);
        } else {
          // The parent could not be found even by id — deleted outright, or hidden by RLS.
          // Writing the child would violate a foreign key; dropping it would lose it. So it is
          // held, and the cursor stays behind it so the next run is offered it again.
          outcome.deferred += 1;
          outcome.earliestDeferred = earlierOf(outcome.earliestDeferred, stamp);
        }
      }

      cursor = remote.reduce<string | null>(
        (max, raw) => laterOf(max, typeof raw.updated_at === 'string' ? raw.updated_at : null),
        cursor,
      );
      if (remote.length < BATCH) break;
    }
  }

  return outcome;
}

/**
 * How far the pull cursor may move.
 *
 * Not simply "the latest row we saw". If anything was deferred, the cursor stops just short of
 * the earliest deferred row, so the next run is offered it again — otherwise a child that arrived
 * a moment before its parent would be stepped over and never seen again, and the workout it
 * belonged to would be missing a set on this device permanently.
 *
 * A second of overlap is subtracted from the plain case too. Postgres stamps `updated_at` from
 * transaction start, so a transaction that began before our pull but committed during it carries
 * a timestamp we would otherwise consider already covered. Re-reading a few rows is free — every
 * write here is an idempotent upsert guarded by the same conflict rule — and missing one is not.
 */
export function nextPullCursor(outcome: PullOutcome, previous: string | null): string | null {
  if (outcome.earliestDeferred) return justBefore(outcome.earliestDeferred);
  if (!outcome.maxSeen) return previous;
  return justBefore(outcome.maxSeen);
}

const OVERLAP_MS = 1000;

function justBefore(timestamp: string): string {
  const parsed = Date.parse(timestamp);
  if (Number.isNaN(parsed)) return timestamp;
  return new Date(parsed - OVERLAP_MS).toISOString();
}

/* -------------------------------------------------------------------------- */
/* Entry point                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * One full sync. Safe to call again at any time — every write on both sides is an idempotent
 * upsert, so a run interrupted halfway leaves no partial state to repair, only work still to do.
 */
export async function runSync(
  db: SqlExecutor,
  transport: SyncTransport,
  userId: string,
  clock: Clock = defaultClock,
): Promise<SyncResult> {
  // Captured before anything is read, not after. A row edited while the push is in flight gets an
  // `updated_at` later than this, so the next run still finds it. Stamping the cursor afterwards
  // would place it past that edit and the edit would never leave the device.
  const startedAt = clock();

  const { lastPulledAt, lastSyncedAt } = await readCursors(db, userId);

  await transport.ensureProfile(userId);

  const pushed = await push(db, transport, userId, lastSyncedAt);
  // Only advanced once the push has fully succeeded. A throw above leaves the cursor where it
  // was, so the next run re-offers the same rows rather than treating them as sent.
  await writeCursors(db, userId, { lastPulledAt, lastSyncedAt: startedAt });

  const outcome = await pull(db, transport, lastPulledAt, startedAt);
  const nextPulled = nextPullCursor(outcome, lastPulledAt);
  await writeCursors(db, userId, { lastPulledAt: nextPulled, lastSyncedAt: startedAt });

  return {
    pushed,
    pulled: outcome.pulled,
    deferred: outcome.deferred,
    syncedAt: startedAt,
  };
}
