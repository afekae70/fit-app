/**
 * One-time "claim my existing local data" migration.
 *
 * Before any real sign-in, and on any device where Supabase is never configured, every local
 * row is tagged with the pseudo user id `'local'` (see `db/schema.ts`). The first time a REAL
 * account signs in on a device that already has `'local'`-tagged rows, those rows need to move
 * to the real user id — otherwise a device with real workout history would appear empty the
 * moment auth is switched on, which would read as data loss even though nothing was deleted.
 *
 * This must run at most once, ever, per device — not once per sign-in. If a second, different
 * person later signs in on the same shared device, they must NOT inherit the first person's
 * data. A flag persisted outside the database (SecureStore survives a schema reset that only
 * touches SQLite) records who — if anyone — already claimed the `'local'` rows.
 */

import type { SqlExecutor } from '../db/executor.js';

const CLAIM_FLAG_KEY = 'local_data_claimed_by';

/**
 * Matches the shape `AuthStorage` (`src/auth/storage.ts`) already uses — no chunking needed
 * here, this is a single short id, nowhere near SecureStore's ~2048-byte per-value limit.
 *
 * Deliberately just an interface here, not the concrete `expo-secure-store` adapter: that native
 * module's source cannot load under vitest (a plain Node environment), so the real adapter lives
 * in `storage.ts` — the one file this module already isn't imported by — and is only ever wired
 * up from `AuthProvider.tsx`, never from a test.
 */
export interface ClaimStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

/**
 * Tables owned by `'local'` before any real sign-in. Child tables (session_exercises, sets,
 * plan_days, plan_day_exercises) need no update of their own — they carry no user_id, and
 * ownership already follows through their FK to one of these.
 */
const LOCAL_OWNED_TABLES = [
  'profile',
  'workout_sessions',
  'plans',
  'body_metrics',
  'nutrition_targets',
  'outbox',
] as const;

/**
 * Re-tags every `'local'` row to `userId`, exactly once per device.
 *
 * Safe to call more than once for the same `userId` (e.g. a second `onAuthStateChange` firing
 * for the same session on cold start): once the flag is set, every later call is a no-op: even
 * without the flag guard, re-running the UPDATEs would simply match zero rows the second time,
 * since nothing is tagged `'local'` anymore.
 */
export async function claimLocalData(
  db: SqlExecutor,
  userId: string,
  storage: ClaimStorage,
): Promise<void> {
  const alreadyClaimedBy = await storage.getItem(CLAIM_FLAG_KEY);
  if (alreadyClaimedBy !== null) return;

  for (const table of LOCAL_OWNED_TABLES) {
    await db.run(`UPDATE ${table} SET user_id = ? WHERE user_id = 'local'`, [userId]);
  }

  // Set regardless of whether any row actually existed to claim — a fresh install with nothing
  // under 'local' must still never let a later, different user claim anything.
  await storage.setItem(CLAIM_FLAG_KEY, userId);
}
