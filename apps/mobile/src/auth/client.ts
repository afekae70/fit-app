/**
 * The Supabase client, used for authentication only.
 *
 * Every other screen in the app reads and writes local SQLite — this client exists purely to
 * mint the access token the coach endpoint checks. Nothing here talks to Postgres; Phase 2/3
 * sync (CRUD against Supabase directly, protected by RLS) is a separate, larger piece of work
 * this client is deliberately not wired into yet.
 */

import 'react-native-url-polyfill/auto';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import { SUPABASE_ANON_KEY, SUPABASE_URL } from '../config.js';
import { secureChunkedStorage } from './storage.js';

let client: SupabaseClient | null = null;

/**
 * Null when the project is not configured yet — the app.json placeholders are still empty.
 * Callers treat that the same way they already treat a missing API base URL: a clear
 * "not configured" state, not a crash on first use.
 */
export function getSupabaseClient(): SupabaseClient | null {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return null;

  // Constructed once and reused: creating a second client would run its own auth-refresh
  // timer and the two could race to persist a session to the same SecureStore keys.
  client ??= createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
      storage: secureChunkedStorage,
      autoRefreshToken: true,
      persistSession: true,
      // No OAuth redirect flow in a bare React Native app — this only matters on web.
      detectSessionInUrl: false,
    },
  });

  return client;
}
