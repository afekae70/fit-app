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
}

const extra = (Constants.expoConfig?.extra ?? {}) as ExtraConfig;

/** Null when unset, so screens can say "not configured" instead of failing on a bad fetch. */
export const API_BASE_URL: string | null = extra.apiBaseUrl?.trim() || null;

export const isCoachConfigured = (): boolean => API_BASE_URL !== null;
