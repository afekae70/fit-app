/**
 * The Supabase client the dashboard signs in and reads through.
 *
 * The same project and the same anon key as the app (both public by design). A coach signs in
 * with the email and password they use in the app; from then on every request carries their
 * session, and the coach functions decide, row by row, what that session may see.
 *
 * The session is kept in the browser's local storage, so a coach stays signed in between
 * visits on their own computer, and signs out from the menu on one they share.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let client: SupabaseClient | null = null;

/** Null when the build carries no project — a checkout whose app.json has none. */
export function getSupabase(): SupabaseClient | null {
  if (!__SUPABASE_URL__ || !__SUPABASE_ANON_KEY__) return null;
  client ??= createClient(__SUPABASE_URL__, __SUPABASE_ANON_KEY__, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      // No email links land on this site: password resets happen in the app.
      detectSessionInUrl: false,
      // Its own key, so a coach who is also signed in to anything else on this origin is not
      // signed in or out of it by this page.
      // The app's first name, kept: renaming the key would sign every coach out.
      storageKey: 'novafit-coach-session',
    },
  });
  return client;
}
