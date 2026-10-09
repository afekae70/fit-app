/**
 * This account's role, for a screen to show: remembered at once, refreshed when it can be.
 *
 * Three sources, each replacing the one before as it arrives: what this session already
 * learned (instant, in memory), what the phone remembered from last time (a few milliseconds),
 * and what the server says now (a request). A screen opened twice does not flicker, a screen
 * opened offline still has a word to show, and a role the owner has just changed is right the
 * next time anything asks.
 *
 * Null means "not known yet", and callers draw nothing for it. Guessing "trainee" while the
 * answer loads would tell a coach, for half a second on every screen, that they are not one.
 *
 * See `accountRole.ts` for why remembering this is harmless.
 */

import * as SecureStore from 'expo-secure-store';
import { useEffect, useState } from 'react';

import {
  accountRoleKey,
  parseStoredRole,
  serialiseRole,
  type AccountRole,
} from './accountRole.js';
import { useCoachingApi } from './useCoachingApi.js';

/** What this run of the app has already learned, by account. */
const known = new Map<string, AccountRole>();

export function useAccountRole(userId: string): AccountRole | null {
  const api = useCoachingApi();
  const [role, setRole] = useState<AccountRole | null>(() => known.get(userId) ?? null);

  useEffect(() => {
    // The stand-in user of a build with no accounts is nobody's coach and nobody's trainee.
    if (!api || userId === 'local') return;
    let cancelled = false;

    const adopt = (next: AccountRole) => {
      known.set(userId, next);
      if (!cancelled) setRole(next);
    };

    void (async () => {
      if (!known.has(userId)) {
        const remembered = parseStoredRole(
          await SecureStore.getItemAsync(accountRoleKey(userId)).catch(() => null),
        );
        // Only if the server has not answered in the meantime: its answer is the newer one.
        if (remembered && !known.has(userId)) adopt(remembered);
      }

      const status = await api.status();
      // A failure — no signal, a server without coaching — leaves whatever was showing.
      if (!status.ok) return;
      const fresh: AccountRole = { role: status.value.role, isAdmin: status.value.isAdmin };
      adopt(fresh);
      await SecureStore.setItemAsync(accountRoleKey(userId), serialiseRole(fresh)).catch(
        () => undefined,
      );
    })();

    return () => {
      cancelled = true;
    };
  }, [api, userId]);

  return role;
}
