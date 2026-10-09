/**
 * The `SyncTransport` implementation that actually talks to Supabase.
 *
 * Kept apart from the engine and deliberately thin: everything in here is a call the tests cannot
 * make (no network under vitest), so the less judgement it contains, the less goes unverified.
 * All of the decisions — what is dirty, who wins a conflict, how far the cursor moves — live in
 * engine.ts against a fake of this interface.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

import type { RowRejection, SyncTransport } from './engine.js';
import { isRowRefusal, type Row } from './rows.js';

/**
 * How many ids go in one `id=in.(...)` filter.
 *
 * The list travels in the URL, and a uuid is 36 characters: a hundred of them is under four
 * kilobytes, comfortably inside what every proxy between the phone and Postgres will carry.
 */
const ID_CHUNK = 100;

type ServerError = { message: string; code?: string; details?: string | null };

function rejection(row: Row, error: ServerError): RowRejection {
  return { id: String(row.id), code: error.code ?? null, message: error.message };
}

/** Raised when the server refuses a write, carrying enough detail to be actionable in a log. */
export class SyncTransportError extends Error {
  constructor(
    readonly table: string,
    readonly operation: string,
    cause: { message: string; code?: string; details?: string | null },
  ) {
    super(`sync: ${operation} on ${table} failed: ${cause.message}`);
    this.name = 'SyncTransportError';
    this.code = cause.code;
    this.details = cause.details ?? null;
  }

  readonly code: string | undefined;
  readonly details: string | null;
}

export function createSupabaseTransport(client: SupabaseClient): SyncTransport {
  return {
    async ensureProfile(userId) {
      // `ignoreDuplicates` rather than a plain upsert: a profile that already exists carries the
      // user's display name, height and goal, and a blank upsert from here would overwrite them
      // with nulls. This call only has to guarantee the row exists for the foreign keys.
      const { error } = await client
        .from('profiles')
        .upsert({ id: userId }, { onConflict: 'id', ignoreDuplicates: true });
      if (error) throw new SyncTransportError('profiles', 'ensureProfile', error);
    },

    async upsert(table, rows) {
      if (rows.length === 0) return [];
      const { error } = await client.from(table).upsert(rows, { onConflict: 'id' });
      if (!error) return [];

      // Postgres names the constraint but never the row, and a batch is up to 200 of them. The
      // first real sync failed on `sets_has_measurement_check` and finding out *which* set meant
      // reasoning backwards from the constraint to the app behaviour that produces it. Re-sending
      // one row at a time on failure costs a handful of requests on a path that has already
      // failed, and turns the next occurrence into an id that can be looked up directly.
      //
      // It is also what lets the rest of the batch through. A statement is all or nothing, so
      // one row the server will not take had been keeping the other 199 off it as well.
      const rejections: RowRejection[] = [];
      for (const row of rows) {
        const { error: rowError } = await client.from(table).upsert([row], { onConflict: 'id' });
        if (!rowError) continue;
        // Not about this row — the connection, the session. Nothing after it would work either.
        if (!isRowRefusal(rowError.code)) {
          throw new SyncTransportError(table, `upsert of row ${String(row.id)}`, rowError);
        }
        rejections.push(rejection(row, rowError));
      }
      // Possibly empty: every row passed on its own, so the batch failure was not about any
      // single row's contents — a timeout, or a conflict between two rows in the same statement.
      return rejections;
    },

    async patch(table, rows) {
      // One request per row: PostgREST patches by filter, and a batch of tombstones is a batch
      // of different ids with different timestamps. The engine only hands over the ones the
      // server actually has, so this is a handful per sync at most.
      const rejections: RowRejection[] = [];
      for (const row of rows) {
        const { id, ...changes } = row;
        const { error } = await client.from(table).update(changes).eq('id', id);
        if (!error) continue;
        if (!isRowRefusal(error.code)) {
          throw new SyncTransportError(table, `patch of row ${String(id)}`, error);
        }
        rejections.push(rejection(row, error));
      }
      return rejections;
    },

    async changedSince(table, since, limit) {
      let query = client.from(table).select('*').order('updated_at', { ascending: true }).limit(limit);
      // A null cursor means "everything", which is the first sync on a new device.
      if (since) query = query.gt('updated_at', since);

      const { data, error } = await query;
      if (error) throw new SyncTransportError(table, 'changedSince', error);
      return (data ?? []) as Row[];
    },

    async fetchById(table, id) {
      // `maybeSingle` returns null instead of erroring when there is no row — which is the
      // expected answer here, not a failure: the parent may have been hard-deleted upstream.
      // The client cannot type a table chosen at runtime, so `data` arrives as `any`; the
      // cast on the return is what narrows it.
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      const { data, error } = await client.from(table).select('*').eq('id', id).maybeSingle();
      if (error) throw new SyncTransportError(table, 'fetchById', error);
      return (data as Row | null) ?? null;
    },

    async fetchByIds(table, ids) {
      const found: Row[] = [];
      for (let i = 0; i < ids.length; i += ID_CHUNK) {
        const { data, error } = await client
          .from(table)
          .select('*')
          .in('id', ids.slice(i, i + ID_CHUNK));
        if (error) throw new SyncTransportError(table, 'fetchByIds', error);
        found.push(...((data ?? []) as Row[]));
      }
      return found;
    },
  };
}
