/**
 * Runtime configuration read from `app.json` → `expo.extra`.
 *
 * Only the API base URL lives here. The LLM key deliberately does not: anything in `extra` is
 * baked into the bundle and shipped to every device, where it is trivially extractable. The
 * coach endpoint exists precisely so the key stays on a server.
 *
 * `localhost` does not resolve to the developer's machine from a physical device — it resolves
 * to the phone. During development the URL therefore has to be the machine's LAN address, or
 * the port must be forwarded over USB (`adb reverse tcp:3000 tcp:3000`), which makes
 * `127.0.0.1` work because the phone's own loopback is then bridged to the host.
 */

import Constants from 'expo-constants';

interface ExtraConfig {
  apiBaseUrl?: string;
  supabaseUrl?: string;
  supabaseAnonKey?: string;
}

const extra = (Constants.expoConfig?.extra ?? {}) as ExtraConfig;

/** Null when unset, so screens can say "not configured" instead of failing on a bad fetch. */
export const API_BASE_URL: string | null = extra.apiBaseUrl?.trim() || null;

/**
 * The anon key is safe to bundle — it identifies the Supabase *project*, not a user. Row Level
 * Security is what actually protects data; nothing here is a secret the way the LLM key is.
 */
export const SUPABASE_URL: string | null = extra.supabaseUrl?.trim() || null;
export const SUPABASE_ANON_KEY: string | null = extra.supabaseAnonKey?.trim() || null;

export const isCoachConfigured = (): boolean => API_BASE_URL !== null;
export const isAuthConfigured = (): boolean => SUPABASE_URL !== null && SUPABASE_ANON_KEY !== null;
