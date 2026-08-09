/**
 * The `SyncTransport` implementation that actually talks to Supabase.
 *
 * Kept apart from the engine and deliberately thin: everything in here is a call the tests cannot
 * make (no network under vitest), so the less judgement it contains, the less goes unverified.
 * All of the decisions — what is dirty, who wins a conflict, how far the cursor moves — live in
 * engine.ts against a fake of this interface.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

import type { SyncTransport } from './engine.js';
import type { Row } from './rows.js';

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
      if (rows.length === 0) return;
      const { error } = await client.from(table).upsert(rows, { onConflict: 'id' });
      if (!error) return;

      // Postgres names the constraint but never the row, and a batch is up to 200 of them. The
      // first real sync failed on `sets_has_measurement_check` and finding out *which* set meant
      // reasoning backwards from the constraint to the app behaviour that produces it. Re-sending
      // one row at a time on failure costs a handful of requests on a path that has already
      // failed, and turns the next occurrence into an id that can be looked up directly.
      for (const row of rows) {
        const { error: rowError } = await client.from(table).upsert([row], { onConflict: 'id' });
        if (rowError) throw new SyncTransportError(table, `upsert of row ${String(row.id)}`, rowError);
      }
      // Every row passed on its own, so the batch failure was not about any single row's contents
      // — a timeout, or a conflict between two rows in the same statement. Nothing left to report.
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
      const { data, error } = await client.from(table).select('*').eq('id', id).maybeSingle();
      if (error) throw new SyncTransportError(table, 'fetchById', error);
      return (data as Row | null) ?? null;
    },
  };
}
