/**
 * When a sync happens, and what the rest of the app can see of it.
 *
 * The engine itself decides nothing about scheduling; this is the only place that does. It runs a
 * sync on three occasions, chosen because each is a moment the user either just produced data
 * worth saving or is about to look at data that might be stale:
 *
 *   - **Sign-in** — a new device has an empty database and needs the history.
 *   - **Foreground** — the other phone may have logged a workout while this one was in a pocket.
 *   - **On request** — the pull-to-refresh already on the settings screen.
 *
 * Notably *not* on every write. Logging a set is not a moment to spend the user's battery and
 * data on a round trip, and a workout is a burst of twenty of them. The push is a delta keyed on
 * `updated_at`, so waiting costs nothing but time — everything unsent is still unsent later.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { AppState, type AppStateStatus } from 'react-native';

import { getSupabaseClient } from '../auth/client.js';
import { getExecutor } from '../db/provider.js';
import { runSync, type SyncResult } from './engine.js';
import { createSupabaseTransport } from './transport.js';

export type SyncStatus =
  /** No Supabase project configured — this build is local-only and that is not an error. */
  | { kind: 'unconfigured' }
  | { kind: 'idle'; lastSyncedAt: string | null }
  | { kind: 'syncing' }
  | { kind: 'offline'; lastSyncedAt: string | null }
  | { kind: 'error'; message: string; lastSyncedAt: string | null };

interface SyncState {
  status: SyncStatus;
  /** Run a sync now. Returns null if one was already running or syncing is not possible. */
  syncNow: () => Promise<SyncResult | null>;
}

const SyncContext = createContext<SyncState | null>(null);

export function SyncProvider({ userId, children }: { userId: string; children: ReactNode }) {
  const [status, setStatus] = useState<SyncStatus>(() =>
    getSupabaseClient() ? { kind: 'idle', lastSyncedAt: null } : { kind: 'unconfigured' },
  );

  // A ref, not state: two syncs overlapping would both push the same rows and both advance the
  // cursor, and the second would base its cursor on a half-finished first. Re-rendering is not
  // wanted here either — this guard changes nothing on screen.
  const running = useRef(false);

  const syncNow = useCallback(async (): Promise<SyncResult | null> => {
    const client = getSupabaseClient();
    if (!client) {
      setStatus({ kind: 'unconfigured' });
      return null;
    }
    // The pseudo-user that stands in before any real sign-in owns rows that belong to this device
    // alone. Pushing them under a real account would merge a stranger's data into it if the phone
    // were ever handed on, so they stay put until `claimLocalData` adopts them.
    if (userId === 'local') return null;
    if (running.current) return null;

    running.current = true;
    const previous = lastSyncedFrom(status);
    setStatus({ kind: 'syncing' });

    try {
      const db = await getExecutor();
      const result = await runSync(db, createSupabaseTransport(client), userId);
      setStatus({ kind: 'idle', lastSyncedAt: result.syncedAt });
      return result;
    } catch (error) {
      // A failed sync is genuinely routine — a tunnel, a dead hotspot, an expired token being
      // refreshed. It is reported and forgotten; nothing local was lost, and the cursor did not
      // move, so the next attempt picks up exactly where this one stopped.
      const offline = looksOffline(error);
      if (!offline) {
        /*
         * Logged, not just shown.
         *
         * `SyncTransportError` is documented as carrying enough detail to be actionable in a
         * log, and until now nothing wrote it to one — the table, the operation, the Postgres
         * code and the row id all existed and then went only to a single line of status text on
         * a settings card. Diagnosing a failed sync meant asking the user to read their screen
         * out. An offline failure stays quiet; it is routine and says nothing.
         */
        const detail = error as { code?: string; details?: string | null; table?: string };
        console.warn(
          '[sync] failed:',
          messageOf(error),
          detail.code ? `code=${detail.code}` : '',
          detail.details ? `details=${detail.details}` : '',
        );
      }
      setStatus(
        offline
          ? { kind: 'offline', lastSyncedAt: previous }
          : { kind: 'error', message: messageOf(error), lastSyncedAt: previous },
      );
      return null;
    } finally {
      running.current = false;
    }
    // `status` is read only to carry the previous timestamp into a failure. Depending on it would
    // rebuild this callback on every status change and re-fire the effects below with it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  // Sign-in, and every change of account afterwards.
  useEffect(() => {
    void syncNow();
  }, [syncNow]);

  // Coming back to the foreground. `background -> active` specifically, not any change: iOS emits
  // `inactive` for a notification shade pull or a call banner, and syncing on those would fire
  // repeatedly while the user is doing nothing.
  useEffect(() => {
    let previous = AppState.currentState;
    const subscription = AppState.addEventListener('change', (next: AppStateStatus) => {
      if (previous.match(/inactive|background/) && next === 'active') void syncNow();
      previous = next;
    });
    return () => subscription.remove();
  }, [syncNow]);

  return <SyncContext.Provider value={{ status, syncNow }}>{children}</SyncContext.Provider>;
}

export function useSync(): SyncState {
  const ctx = useContext(SyncContext);
  if (!ctx) throw new Error('useSync() must be used inside <SyncProvider>.');
  return ctx;
}

function lastSyncedFrom(status: SyncStatus): string | null {
  return 'lastSyncedAt' in status ? status.lastSyncedAt : null;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Did this fail because there is no connection, rather than because something is wrong?
 *
 * Read from the error rather than asked of the OS on purpose. Answering it properly would mean
 * adding NetInfo, and a native module means every user needs a new build of the app before they
 * can sync at all — a steep price for the difference between "no connection" and "sync failed" in
 * one line of status text. React Native's fetch reports a dead network with these messages, and
 * misreading one only shows the more generic of two harmless messages.
 */
function looksOffline(error: unknown): boolean {
  return /network request failed|failed to fetch|network error|timeout/i.test(messageOf(error));
}
