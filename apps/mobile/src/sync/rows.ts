/**
 * Converting one row between SQLite's types and Postgres's, and deciding which of two versions
 * of a row is the later one.
 *
 * Pure functions over plain objects — no database, no network — because this is where a sync
 * quietly corrupts data if it is wrong, and it is the one part that can be tested exhaustively.
 */

import type { SyncTable } from './tables.js';

export type Row = Record<string, unknown>;

/**
 * Is `a` strictly later than `b`?
 *
 * Parsed rather than compared as strings, which is the whole reason this function exists. Both
 * sides store ISO 8601, but not the same spelling of it: SQLite holds what `Date#toISOString`
 * produced (`2026-08-09T12:00:00.000Z`) and PostgREST returns the offset form
 * (`2026-08-09T12:00:00+00:00`). Those two are the same instant and compare as `'2' < '+'` is
 * false — a string comparison would declare the earlier one later, roughly half the time, and
 * the loser's edit would be silently overwritten.
 *
 * A missing or unparseable timestamp loses. It cannot be shown to be newer, and the alternative —
 * treating unknown as newer — would let one malformed row overwrite good data on every sync.
 */
export function isNewer(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a) return false;
  if (!b) return true;
  const ta = Date.parse(a);
  const tb = Date.parse(b);
  if (Number.isNaN(ta)) return false;
  if (Number.isNaN(tb)) return true;
  return ta > tb;
}

/** The later of two timestamps, for advancing a cursor. Either may be absent. */
export function laterOf(a: string | null, b: string | null): string | null {
  return isNewer(b, a) ? b : a;
}

/** The earlier of two timestamps, for holding a cursor back. An absent value never wins. */
export function earlierOf(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return isNewer(a, b) ? b : a;
}

/**
 * Did the server refuse this one row, as opposed to the request not working at all?
 *
 * The difference decides what a sync does next. A row the server will not take — its slot is
 * occupied, its parent is not there, a value fails a check — is a fact about that row: it is
 * set aside and everything else carries on. A dead connection or an expired session is a fact
 * about the whole run, and carrying on would only fail every remaining request the same way.
 *
 * Postgres says which it is in the error code:
 *
 *  - class `23`, integrity constraints: unique, foreign key, not-null, check;
 *  - class `22`, a value the column cannot hold;
 *  - `42501`, which is what row-level security answers with.
 *
 * Anything else — no code at all, or one of PostgREST's own (`PGRST301` for an expired token) —
 * is not about a row, and is deliberately not guessed at.
 */
export function isRowRefusal(code: string | null | undefined): boolean {
  if (!code) return false;
  return /^(22|23)[0-9A-Z]{3}$/.test(code) || code === '42501';
}

/**
 * Did the server say it has no such table?
 *
 * `PGRST205` is PostgREST's "could not find the table in the schema cache"; `42P01` is
 * Postgres's own "relation does not exist", which is what a function would raise. Either means
 * the app is ahead of the server: it knows about a table whose migration has not been run yet.
 *
 * That is not a reason to stop syncing everything else. See `SyncTable.optional`.
 */
export function isMissingRelation(code: string | null | undefined): boolean {
  return code === 'PGRST205' || code === '42P01';
}

/** `23505`: the row wants a value that a unique constraint says another row already holds. */
export function isUniqueViolation(code: string | null | undefined): boolean {
  return code === '23505';
}

/**
 * Where a deleted row's ordering column is sent to live.
 *
 * A soft-deleted row parks its index at `-rowid` locally, which frees the slot in SQLite's
 * UNIQUE index. The server needs the same slot freed and will not take a negative — `sets`
 * checks `set_index >= 1` — so the sentinel is reflected into a high positive band instead.
 * `rowid` is unique within its table, so no two tombstones can land on the same parked value.
 *
 * Far enough above `PUSH_PARK` that the two bands cannot meet.
 */
const TOMBSTONE_PARK = 1_000_000;

/**
 * SQLite row -> the JSON body PostgREST expects.
 *
 * Only the declared columns travel: a local-only column that happens to share a table would
 * otherwise be sent and rejected as unknown by PostgREST, failing the whole batch.
 */
export function toRemote(table: SyncTable, row: Row): Row {
  const out: Row = {};
  /*
   * A deleted row has to vacate its slot on the server, not merely stop claiming one.
   *
   * Omitting the column was the previous answer, on the reasoning that an upsert would then
   * leave the server's own value alone. It does — and that is the bug: the deleted row keeps
   * sitting on `(parent, index)` for ever, so the moment a surviving sibling is reordered into
   * that position the server refuses it with a unique violation, and one rejected row stops the
   * entire push. Locally the same collision is avoided by parking; the server was never told.
   */
  const deleted = row.deleted_at !== null && row.deleted_at !== undefined;

  for (const column of table.columns) {
    if (deleted && table.indexColumns?.includes(column)) {
      const parked = row[column];
      // Only the local sentinel is reflected. Anything else is a row deleted by some path that
      // did not park it, and its own value is as good as any.
      if (typeof parked === 'number' && parked < 0) {
        out[column] = TOMBSTONE_PARK - parked;
        continue;
      }
    }
    const value = row[column];
    if (value === undefined) continue;

    if (table.booleans.includes(column)) {
      // SQLite has no boolean type; the repository writes 0 and 1.
      out[column] = value === null ? null : value !== 0;
    } else if (table.json.includes(column)) {
      out[column] = parseJsonColumn(value);
    } else {
      out[column] = value;
    }
  }
  return out;
}

/**
 * Is this a timestamp column?
 *
 * By naming convention rather than a hand-kept list per table: every timestamp in both schemas
 * ends in `_at` (`started_at`, `completed_at`, `measured_at`, `done_at`, `updated_at`,
 * `deleted_at`, `created_at`) and nothing else does. A list would be one more place to forget to
 * update when a column is added, and forgetting would corrupt dates rather than fail.
 */
const isTimestampColumn = (column: string): boolean => column.endsWith('_at');

/**
 * PostgREST row -> the values SQLite should hold.
 *
 * Numeric columns come back from PostgREST as strings when the Postgres type is `numeric`
 * (weight_kg, rpe, and friends) — arbitrary precision does not survive a JSON number, so the
 * driver does not try. Left as-is deliberately: SQLite's REAL affinity converts a numeric string
 * on write, and forcing a parse here would turn an unexpected value into NaN instead of letting
 * it fail loudly.
 *
 * Timestamps, by contrast, are rewritten, and must be. Postgres hands back `2026-08-09T12:00:00+00:00`
 * where every local row holds `2026-08-09T12:00:00.000Z`. Storing the offset form verbatim would
 * put two spellings of the same instant in one column, and the app compares dates as strings all
 * over the place — `WHERE started_at >= ?` for a date range, `MAX(updated_at)` for a cursor,
 * `ON CONFLICT ... WHERE excluded.updated_at > sets.updated_at` for the merge itself. Under a
 * string comparison `'+'` sorts below every digit, so a pulled row would read as older than
 * everything local: it would lose every conflict it should win, and drop out of history ranges
 * it belongs in. Normalising on the way in keeps one format in the column and those comparisons
 * honest.
 */
export function fromRemote(table: SyncTable, row: Row): Row {
  const out: Row = {};
  for (const column of table.columns) {
    const value = row[column];

    if (table.booleans.includes(column)) {
      out[column] = value === null || value === undefined ? null : value ? 1 : 0;
    } else if (table.json.includes(column)) {
      out[column] = value === null || value === undefined ? null : JSON.stringify(value);
    } else if (isTimestampColumn(column)) {
      out[column] = normalizeTimestamp(value);
    } else {
      out[column] = value ?? null;
    }
  }
  return out;
}

/**
 * Any ISO 8601 spelling -> the exact format the rest of the app writes.
 *
 * An unparseable value is passed through rather than nulled. Losing the moment a workout happened
 * because its timestamp had an unexpected shape is worse than storing something odd, and a null
 * here would be indistinguishable from a column that was genuinely empty.
 */
export function normalizeTimestamp(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') return value;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? value : new Date(parsed).toISOString();
}

/**
 * A jsonb column's local form is a JSON string, but nothing enforces that — `raw_payload` holds
 * whatever a scale's BLE adapter wrote. Sending an unparseable string as jsonb fails the request
 * for the entire batch, so a value that will not parse travels as a JSON string instead: the
 * reading itself is still worth keeping, and it survives the round trip unchanged.
 */
function parseJsonColumn(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}
