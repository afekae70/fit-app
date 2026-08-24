/**
 * The part that means nobody has to remember.
 *
 * Mounted once at the root. It watches for the app coming to the foreground and, if a day has
 * passed since the last one, writes a backup into the folder the user chose. Nothing is shown
 * while it works — a backup that interrupts is a backup people turn off.
 *
 * Foreground rather than a timer or a background task: a background job needs its own native
 * module and the OS is free to never run it, and a timer only fires while the app is open
 * anyway. Coming back to the app is both a reliable moment and one where a pause costs nothing.
 *
 * Finishing a workout also triggers one, through `requestBackup` — that is when new data exists,
 * and it is the moment worth protecting.
 */

import { useEffect, type ReactNode } from 'react';
import { AppState, type AppStateStatus } from 'react-native';

import { useCurrentUserId } from '../auth/CurrentUserProvider.js';
import { createBackup } from '../db/backup.js';
import { getExecutor } from '../db/provider.js';
import { SCHEMA_VERSION } from '../db/schema.js';
import { backupIfDue } from './store.js';

/**
 * Ask for a backup, if one is due.
 *
 * A module-level function rather than a hook, so the finish-workout path can call it without
 * threading a context through three screens. It resolves to the outcome and never throws: a
 * failed backup must not take a workout's save down with it.
 */
export async function requestBackup(
  userId: string,
  { afterWorkout = false } = {},
): Promise<void> {
  try {
    await backupIfDue(
      async () => {
        const db = await getExecutor();
        return JSON.stringify(await createBackup(db, userId, SCHEMA_VERSION));
      },
      { afterWorkout },
    );
  } catch {
    // Deliberately silent here. The settings screen is where the state of backups is reported;
    // a toast on the way back into the app would be noise on every launch.
  }
}

export function AutoBackup({ children }: { children: ReactNode }) {
  const userId = useCurrentUserId();

  useEffect(() => {
    // Once on mount, so opening the app after a week away produces one without waiting for a
    // second foreground.
    void requestBackup(userId);

    let previous = AppState.currentState;
    const subscription = AppState.addEventListener('change', (next: AppStateStatus) => {
      if (previous.match(/inactive|background/) && next === 'active') {
        void requestBackup(userId);
      }
      previous = next;
    });
    return () => subscription.remove();
  }, [userId]);

  return <>{children}</>;
}
