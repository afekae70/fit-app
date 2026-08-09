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
 * SQLite row -> the JSON body PostgREST expects.
 *
 * Only the declared columns travel: a local-only column that happens to share a table would
 * otherwise be sent and rejected as unknown by PostgREST, failing the whole batch.
 */
export function toRemote(table: SyncTable, row: Row): Row {
  const out: Row = {};
  for (const column of table.columns) {
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
