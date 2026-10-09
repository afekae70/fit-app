/**
 * The `ProfileTransport` that actually talks to Supabase.
 *
 * Thin for the same reason `transport.ts` is: nothing in here can run under a test, so nothing
 * in here decides anything. Which fields go and which come back is `profileSync.ts`.
 *
 * Reads the whole row, `role` and `coach_code` included, because asking for columns by name
 * would fail outright against a server that does not have the newest one yet. What is done
 * with the row is limited to the fields `profileSync` lists — and writing is limited by the
 * server itself, which since 0011 grants a client those columns and no others.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

import type { ProfileTransport } from './profileSync.js';
import { SyncTransportError } from './transport.js';

export function createProfileTransport(client: SupabaseClient): ProfileTransport {
  return {
    async fetch(userId) {
      // `select('*')` has no type the client can know, so `data` arrives as `any`; the cast on
      // the return is what narrows it.
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      const { data, error } = await client
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .maybeSingle();
      if (error) throw new SyncTransportError('profiles', 'fetch', error);
      return (data as Record<string, unknown> | null) ?? null;
    },

    async update(userId, changes) {
      const { error } = await client.from('profiles').update(changes).eq('id', userId);
      if (error) throw new SyncTransportError('profiles', 'update', error);
    },
  };
}
