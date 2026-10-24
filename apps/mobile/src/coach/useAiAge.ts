/**
 * Whether this account may use the AI features, from the date of birth on this phone's profile.
 *
 * The server function makes the same decision on every request, from the same rule
 * (`aiAgeVerdict` in the shared package), and that is the check that counts. This one only
 * keeps the app from offering a button whose every press would be refused.
 *
 * Null until the profile has been read, and every AI entry point treats null as "not yet": it
 * offers nothing rather than flashing a button that may vanish. Read again on focus, because
 * the age is edited on the nutrition screen and the answer should follow without a restart.
 */

import { aiAgeVerdict, type AiAgeVerdict } from '@fit/shared/calculations';
import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';

import { useCurrentUserId } from '../auth/CurrentUserProvider.js';
import { getProfile } from '../db/metrics.js';
import { getExecutor } from '../db/provider.js';

export function useAiAge(): AiAgeVerdict | null {
  const userId = useCurrentUserId();
  const [verdict, setVerdict] = useState<AiAgeVerdict | null>(null);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      void (async () => {
        try {
          const profile = await getProfile(await getExecutor(), userId);
          if (!cancelled) setVerdict(aiAgeVerdict(profile?.birth_date ?? null));
        } catch (error) {
          // Stays null, so nothing AI is offered: an unreadable profile is not a passed check.
          console.warn(
            '[ai-age] profile read failed:',
            error instanceof Error ? error.message : error,
          );
        }
      })();
      return () => {
        cancelled = true;
      };
    }, [userId]),
  );

  return verdict;
}
