/**
 * Runtime configuration read from `app.json` → `expo.extra`.
 *
 * Addresses only. The LLM key deliberately is not here: anything in `extra` is baked into the
 * bundle and shipped to every device, where it is trivially extractable. The coach and the
 * meal scan are reached through a server precisely so the key stays on one.
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
  aiFunction?: string;
}

const extra = (Constants.expoConfig?.extra ?? {}) as ExtraConfig;

/**
 * The anon key is safe to bundle — it identifies the Supabase *project*, not a user. Row Level
 * Security is what actually protects data; nothing here is a secret the way the LLM key is.
 */
export const SUPABASE_URL: string | null = extra.supabaseUrl?.trim() || null;
export const SUPABASE_ANON_KEY: string | null = extra.supabaseAnonKey?.trim() || null;

/**
 * Where the Supabase function that does the AI work answers, as the last part of its URL. It
 * reads photographed meals and it answers as the coach (`apps/api/src/edge/main.ts`).
 *
 * Configuration and not a constant, because it is not ours to choose: a function created in the
 * Supabase dashboard is listed under the name it was given and served at an address the
 * dashboard generates. The first deployment was named `scan-food`, lives at another address
 * entirely, and answered "not found" to an app that had assumed the two were the same.
 *
 * Held to the characters an address of this kind can have, so that nothing read from
 * configuration is ever spliced into a URL as a path of its own.
 */
const aiFunction = extra.aiFunction?.trim() ?? '';
export const AI_FUNCTION: string = /^[A-Za-z0-9_-]{1,64}$/.test(aiFunction)
  ? aiFunction
  : 'scan-food';

/** The function's whole address, or null when there is no Supabase project to have one. */
export const AI_FUNCTION_URL: string | null = SUPABASE_URL
  ? `${SUPABASE_URL.replace(/\/+$/, '')}/functions/v1/${AI_FUNCTION}`
  : null;

/**
 * Where the coach is asked: `<this>/coach/chat`.
 *
 * The Supabase function, unless `apiBaseUrl` names a server of our own. The coach was built
 * on the Fastify service (`apps/api`), which costs money to keep running and is switched off;
 * the function answers the same request at the same path for nothing. `apiBaseUrl` is kept for
 * what it is still good for — pointing a development build at a service on the desk.
 *
 * Null when neither exists, so screens can say "not configured" instead of failing on a bad
 * fetch.
 */
export const API_BASE_URL: string | null = extra.apiBaseUrl?.trim() || AI_FUNCTION_URL;

export const isCoachConfigured = (): boolean => API_BASE_URL !== null;
export const isAuthConfigured = (): boolean => SUPABASE_URL !== null && SUPABASE_ANON_KEY !== null;
