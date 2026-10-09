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
 *
 * ## One refused row is one refused row
 *
 * The server can decline a single row — a slot it thinks is taken, a parent it does not have —
 * and for a long time that ended the run on the spot. Tables go up in order, so everything
 * queued behind the refusal stayed on the phone too: one exercise the server would not place
 * meant no sets, no weigh-ins and no plans reached the cloud, on every run, indefinitely, while
 * the app looked exactly as it always had.
 *
 * So a refusal is recorded and stepped over. The rest of the run carries on, the row and
 * whatever hangs off it stay queued for next time, and the caller is told what was left behind.
 * Only a failure that is not about any one row — no network, an expired session — still stops
 * the run, because then nothing after it would have worked either.
 */

import type { SqlExecutor } from '../db/executor.js';
import {
  earlierOf,
  fromRemote,
  isNewer,
  isUniqueViolation,
  laterOf,
  toRemote,
  type Row,
} from './rows.js';
import { SYNC_TABLES, SYNC_TABLE_BY_NAME, type SyncTable } from './tables.js';

/** How many rows travel in one request. Keeps a first sync off a long history from timing out. */
const BATCH = 200;

/** One row the server would not take, and the reason it gave. */
export interface RowRejection {
  readonly id: string;
  /** The Postgres error code — `23505` for a unique violation, `42501` for row-level security. */
  readonly code: string | null;
  readonly message: string;
}

/** A rejection, and the table it happened in. */
export interface RefusedRow extends RowRejection {
  readonly table: string;
}

export interface SyncTransport {
  /**
   * Upsert rows into `table`, keyed on the primary key.
   *
   * Resolves with the rows the server refused, which is the empty list when all went in. Every
   * other row in the call has been written. Rejects only for a failure that is not about a
   * particular row — see `isRowRefusal`.
   */
  upsert(table: string, rows: Row[]): Promise<RowRejection[]>;
  /**
   * Patch rows that the server already has, by primary key. A row it does not have is not an
   * error — the patch simply matches nothing.
   *
   * Separate from `upsert` because a tombstone must never be written as one. See `push`.
   * Resolves and rejects as `upsert` does.
   */
  patch(table: string, rows: Row[]): Promise<RowRejection[]>;
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
   * The server's copies of these rows — only the ones it has, in no particular order.
   *
   * Used to find out which deletions have anything to delete. See `tombstonesDue`.
   */
  fetchByIds(table: string, ids: string[]): Promise<Row[]>;
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
  /**
   * Rows the server would not take this run. They are still on the device and still queued; a
   * non-empty list means the cloud copy is incomplete, which the user is entitled to know.
   */
  readonly refused: readonly RefusedRow[];
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
 *
 * That includes a row deleted before this device ever heard back from the server about it.
 * Such rows used to be left out here, on the reasoning that a row created and deleted between
 * two syncs was never on the server. `remote_updated_at IS NULL` was the test, and it does not
 * mean that: it is only filled in by a pull, so a row that was pushed in a run that then died
 * before pulling looks exactly the same. The server had it, the phone deleted it, the deletion
 * was never sent — and the row lived on up there, holding its slot against the sibling that
 * moved into it and waiting to come back on the next pull. Whether there is anything to delete
 * is now asked of the server itself, in `tombstonesDue`.
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
  return `SELECT ${columns} FROM ${table.table} t0
    ${joins.join('\n    ')}
    WHERE ${alias}.user_id = ?
      AND (? IS NULL OR t0.updated_at IS NULL OR t0.updated_at > ?)
      ${extra}
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

/**
 * Which of these deletions the server still needs to hear about.
 *
 * One request for the lot, rather than a patch per row sent on the off chance. That matters
 * for the commonest deletion there is: a workout started from a plan and thrown away before it
 * ever synced is a session, its exercises and every blank set under them, none of which the
 * server has — thirty patches that match nothing, one after another, where this is three reads.
 *
 * A row is due when the server has it and it is not already out of the way there:
 *
 *  - still alive, which is the ordinary case; or
 *  - deleted, but still sitting on a real position. Deletions sent before the tombstone band
 *    existed kept the index they had, and the unique constraint counts a deleted row like any
 *    other — so each of those goes on refusing whichever sibling is moved into its place.
 */
async function tombstonesDue(
  transport: SyncTransport,
  table: SyncTable,
  tombstones: readonly Row[],
): Promise<Row[]> {
  if (tombstones.length === 0) return [];

  const remote = new Map<string, Row>();
  for (const row of await transport.fetchByIds(
    table.table,
    tombstones.map((row) => String(row.id)),
  )) {
    remote.set(String(row.id), row);
  }

  return tombstones
    .map((row) => toRemote(table, row))
    .filter((payload) => {
      const there = remote.get(String(payload.id));
      if (!there) return false;
      if (there.deleted_at === null || there.deleted_at === undefined) return true;
      return (table.indexColumns ?? []).some((column) => there[column] !== payload[column]);
    });
}

interface PushOutcome {
  /** Rows the server took. */
  pushed: number;
  refused: RefusedRow[];
}

async function push(
  db: SqlExecutor,
  transport: SyncTransport,
  userId: string,
  since: string | null,
  startedAt: string,
): Promise<PushOutcome> {
  let pushed = 0;
  const refused: RefusedRow[] = [];
  /**
   * Per table, the rows that did not reach the server this run — refused outright, or held back
   * because their parent was. Everything in here is put back in the queue before the cursor moves.
   */
  const unsent = new Map<string, Set<string>>();

  for (const table of SYNC_TABLES) {
    const dirty = await db.all<Row>(buildPushQuery(table), [userId, since, since]);
    if (dirty.length === 0) continue;

    const waiting = new Set<string>();
    unsent.set(table.table, waiting);
    const refuse = (rejections: readonly RowRejection[]): number => {
      for (const rejection of rejections) {
        waiting.add(rejection.id);
        refused.push({ table: table.table, ...rejection });
      }
      return rejections.length;
    };

    /*
     * A row whose parent did not get through waits with it.
     *
     * The server would refuse it anyway — its ownership is proved through the parent, and a
     * parent it does not have proves nothing. Offering it regardless costs more than the one
     * request: a single refusal fails its whole batch, and the transport then resends that
     * batch a row at a time to find out which one it was.
     */
    const scope = table.scope;
    const stuck = scope.kind === 'parent' ? unsent.get(scope.table) : undefined;
    const rows: Row[] = [];
    for (const row of dirty) {
      if (scope.kind === 'parent' && stuck?.has(String(row[scope.column]))) {
        waiting.add(String(row.id));
      } else {
        rows.push(row);
      }
    }

    /*
     * Tombstones travel as patches, everything else as upserts.
     *
     * An upsert is `INSERT ... ON CONFLICT DO UPDATE`: it would create the row if the server
     * did not have it, and a deletion must never bring a row into being. It also checks NOT
     * NULL against the proposed insert tuple before it ever looks for the conflict, which is
     * how one deleted plan day once stopped every later sync on the same row.
     *
     * A patch has no insert tuple. It cannot resurrect a row the server has already lost, and
     * `tombstonesDue` has already set aside the ones the server never had.
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
    const due = await tombstonesDue(transport, table, tombstones);
    for (let i = 0; i < due.length; i += BATCH) {
      const batch = due.slice(i, i + BATCH);
      pushed += batch.length - refuse(await transport.patch(table.table, batch));
    }

    /*
     * Ordered rows go up in two passes, for the same reason the local reorder does.
     *
     * `UNIQUE (parent, index)` is checked per row, and `onConflict: 'id'` resolves a clash on
     * the primary key and nothing else — so two exercises trading places means one arrives at a
     * slot the other has not left yet, and the server refuses it.
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
      const park = (row: Row): Row => {
        const parked = toRemote(table, row);
        for (const column of orders) {
          const value = parked[column];
          if (typeof value === 'number') parked[column] = value + PUSH_PARK;
        }
        return parked;
      };

      /*
       * A clash *in the parking band* is not a refusal of the row.
       *
       * It means a sibling is already parked on that value — left there by a run that died
       * between the two passes, and holding a position this device has since given to another
       * row. That sibling is in this batch too and is about to move, so the row that clashed
       * is simply offered again once the others have gone. If it still cannot park, it takes
       * its turn below regardless: where a row may wait says nothing about where it may live.
       *
       * Anything else the server objected to, it will object to again, and asking a second
       * time would only fail another batch for nothing.
       */
      const sendParked = async (batch: readonly Row[]): Promise<Row[]> => {
        const rejections = await transport.upsert(table.table, batch.map(park));
        refuse(rejections.filter((rejection) => !isUniqueViolation(rejection.code)));
        const clashed = new Set(
          rejections.filter((rejection) => isUniqueViolation(rejection.code)).map((r) => r.id),
        );
        return batch.filter((row) => clashed.has(String(row.id)));
      };

      const again: Row[] = [];
      for (let i = 0; i < live.length; i += BATCH) {
        again.push(...(await sendParked(live.slice(i, i + BATCH))));
      }
      for (let i = 0; i < again.length; i += BATCH) {
        await sendParked(again.slice(i, i + BATCH));
      }
    }

    const placing = live.filter((row) => !waiting.has(String(row.id)));
    for (let i = 0; i < placing.length; i += BATCH) {
      const batch = placing.slice(i, i + BATCH);
      pushed +=
        batch.length -
        refuse(
          await transport.upsert(
            table.table,
            batch.map((row) => toRemote(table, row)),
          ),
        );
    }
  }

  /*
   * Put back what did not get through, before the cursor moves past it.
   *
   * "Dirty" means `updated_at` later than the cursor, and the cursor is about to become
   * `startedAt`. A row left as it is would drop out of the queue for good, having never been
   * sent. Holding the cursor back instead would keep it — and with it every other row this run
   * *did* send, all of which would then go up again on every sync for as long as one row was
   * stuck.
   *
   * So each one is stamped a millisecond past the cursor. That is all `updated_at` means on
   * this side of the wire — "this device has something the server has not taken" — and it has
   * to happen here, ahead of `writeCursors`: an app killed between the two leaves the rows
   * queued under the old cursor, where the other order would have lost them.
   *
   * A row edited since the run began is already later than that and is left alone.
   */
  const retryAt = justAfter(startedAt);
  for (const [name, ids] of unsent) {
    const list = [...ids];
    for (let i = 0; i < list.length; i += BATCH) {
      const chunk = list.slice(i, i + BATCH);
      await db.run(
        `UPDATE ${name} SET updated_at = ?
          WHERE id IN (${chunk.map(() => '?').join(', ')})
            AND (updated_at IS NULL OR updated_at <= ?)`,
        [retryAt, ...chunk, startedAt],
      );
    }
  }

  return { pushed, refused };
}

function justAfter(timestamp: string): string {
  const parsed = Date.parse(timestamp);
  if (Number.isNaN(parsed)) return timestamp;
  return new Date(parsed + 1).toISOString();
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
 * A row this device changed after the run began is left exactly as it is. The copy coming back
 * is, at best, the version this run pushed a moment ago, and writing it would put the reps as
 * they were before the correction back on screen and mark them as synced — the edit gone, and
 * nothing left to say it had ever been made. Sync runs when the app returns to the foreground,
 * which in the middle of a workout is exactly when someone is about to type. The row is still
 * dirty, so the next run sends it and it wins there in the ordinary way.
 *
 * The same test protects a row the server refused: `push` stamps those just past `localStamp`
 * to keep them queued, so the server's older copy does not replace the one it would not take.
 */
async function upsertLocal(
  db: SqlExecutor,
  table: SyncTable,
  row: Row,
  localStamp: string,
): Promise<boolean> {
  const incoming = typeof row.updated_at === 'string' ? row.updated_at : null;

  const existing = await db.get<{ remote_updated_at: string | null; updated_at: string | null }>(
    `SELECT remote_updated_at, updated_at FROM ${table.table} WHERE id = ?`,
    [row.id],
  );
  if (existing && !isNewer(incoming, existing.remote_updated_at)) return false;
  // Later than the run itself: typed while it was in flight, or refused by the server during
  // it and stamped to be sent again. Either way this device holds something the server has not
  // taken, and what the server is offering is the older copy. See the note above.
  if (existing && isNewer(existing.updated_at, localStamp)) return false;

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
 *
 * Resolving is not the same as everything having gone up: check `refused`.
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

  const { pushed, refused } = await push(db, transport, userId, lastSyncedAt, startedAt);
  // Only advanced once the push has run to the end. A throw above leaves the cursor where it
  // was, so the next run re-offers the same rows rather than treating them as sent. Rows the
  // server refused do not hold it back — `push` has already queued those again by themselves.
  await writeCursors(db, userId, { lastPulledAt, lastSyncedAt: startedAt });

  const outcome = await pull(db, transport, lastPulledAt, startedAt);
  const nextPulled = nextPullCursor(outcome, lastPulledAt);
  await writeCursors(db, userId, { lastPulledAt: nextPulled, lastSyncedAt: startedAt });

  return {
    pushed,
    pulled: outcome.pulled,
    deferred: outcome.deferred,
    refused,
    syncedAt: startedAt,
  };
}
