/**
 * `claimLocalData` runs at a genuinely sensitive moment — the first time a real account touches
 * a device that may already hold real workout history under the `'local'` pseudo-user. Getting
 * the once-only guard wrong in either direction is bad: too loose, and a second person signing
 * in on a shared device inherits the first person's data; too strict, and a legitimate first
 * sign-in never claims anything, and the user's own history appears to have vanished.
 */

import { beforeEach, describe, expect, it } from 'vitest';

import type { SqlExecutor } from '../db/executor.js';
import { saveProfile } from '../db/metrics.js';
import { createPlan } from '../db/plans.js';
import { createTestExecutor } from '../db/testUtils.js';
import { startSession } from '../db/workouts.js';
import { claimLocalData, type ClaimStorage } from './claimLocalData.js';

/** In-memory stand-in for SecureStore, so the flag persists across calls within one test. */
function createFakeStorage(): ClaimStorage {
  const store = new Map<string, string>();
  return {
    // eslint-disable-next-line @typescript-eslint/require-await
    async getItem(key) {
      return store.get(key) ?? null;
    },
    // eslint-disable-next-line @typescript-eslint/require-await
    async setItem(key, value) {
      store.set(key, value);
    },
  };
}

let db: SqlExecutor;
let storage: ClaimStorage;
let counter = 0;
const newId = () => `id-${String(++counter).padStart(3, '0')}`;
const clock = () => '2026-07-28T10:00:00.000Z';

beforeEach(() => {
  db = createTestExecutor();
  storage = createFakeStorage();
  counter = 0;
});

describe('claimLocalData', () => {
  it('re-tags every local-owned table to the real user id on first sign-in', async () => {
    await saveProfile(db, 'local', { heightCm: 180 }, clock);
    await startSession(db, 'local', newId, {}, clock);
    await createPlan(db, 'local', newId, 'Push Pull Legs', clock);

    await claimLocalData(db, 'user-real', storage);

    expect(await db.get(`SELECT user_id FROM profile`)).toEqual({ user_id: 'user-real' });
    expect(await db.all(`SELECT user_id FROM workout_sessions`)).toEqual([
      { user_id: 'user-real' },
    ]);
    expect(await db.all(`SELECT user_id FROM plans`)).toEqual([{ user_id: 'user-real' }]);
  });

  it('records the claim so a repeat call is a no-op', async () => {
    await createPlan(db, 'local', newId, 'Block 1', clock);
    await claimLocalData(db, 'user-real', storage);

    // Simulate a fresh 'local' row appearing after the claim (should never happen in practice,
    // but proves the guard is the flag, not "are there still local rows").
    await createPlan(db, 'local', newId, 'Block 2', clock);
    await claimLocalData(db, 'user-real', storage);

    const stillLocal = await db.all<{ id: string }>(`SELECT id FROM plans WHERE user_id = 'local'`);
    expect(stillLocal).toHaveLength(1);
  });

  it('never lets a second, different user inherit the first user\'s claimed data', async () => {
    await createPlan(db, 'local', newId, 'First User Plan', clock);
    await claimLocalData(db, 'user-first', storage);

    // A different person signs in on the same device later.
    await createPlan(db, 'local', newId, 'Never Claimed', clock);
    await claimLocalData(db, 'user-second', storage);

    const secondUsersPlans = await db.all(`SELECT * FROM plans WHERE user_id = 'user-second'`);
    expect(secondUsersPlans).toHaveLength(0);

    const firstUsersPlans = await db.all<{ name: string }>(
      `SELECT name FROM plans WHERE user_id = 'user-first'`,
    );
    expect(firstUsersPlans.map((p) => p.name)).toEqual(['First User Plan']);
  });

  it('sets the flag even when nothing is tagged local, so a later user still cannot claim', async () => {
    await claimLocalData(db, 'user-first', storage);
    await createPlan(db, 'local', newId, 'Appears After First Claim', clock);
    await claimLocalData(db, 'user-second', storage);

    expect(await db.all(`SELECT * FROM plans WHERE user_id = 'user-second'`)).toHaveLength(0);
  });
});
