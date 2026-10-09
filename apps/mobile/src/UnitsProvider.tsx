/**
 * The active unit preference, shared through context.
 *
 * Context rather than a per-screen read for the same reason `ThemeProvider` is: when the
 * preference changes, every weight in the app has to change with it in the same frame. Screens
 * that each loaded it themselves would update only when they next happened to remount, so the
 * metrics screen could sit showing pounds while the workout screen showed kilograms — and a
 * user looking at two different numbers for one lift has no way to tell which is real.
 *
 * Unlike the colour scheme, this is NOT stored in `expo-secure-store`. It lives on the profile
 * row, because the server already models it there (`profiles.unit_preference`, with a CHECK
 * constraint) and because it is a fact about the person rather than about the device: someone
 * who thinks in pounds thinks in pounds on every phone they own. It is therefore per-user, and
 * this provider sits below `CurrentUserProvider` so a change of account reloads it.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import { DEFAULT_UNIT_PREFERENCE, parseUnitPreference, type UnitPreference } from '@fit/shared';

import { getProfile, saveProfile } from './db/metrics.js';
import { getExecutor } from './db/provider.js';
import { onProfilePulled } from './sync/profileEvents.js';

interface UnitsContextValue {
  unit: UnitPreference;
  setUnit: (next: UnitPreference) => void;
}

const UnitsContext = createContext<UnitsContextValue>({
  unit: DEFAULT_UNIT_PREFERENCE,
  setUnit: () => {},
});

export function UnitsProvider({ userId, children }: { userId: string; children: ReactNode }) {
  const [unit, setUnitState] = useState<UnitPreference>(DEFAULT_UNIT_PREFERENCE);

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      void (async () => {
        const db = await getExecutor();
        const profile = await getProfile(db, userId);
        if (cancelled) return;
        setUnitState(parseUnitPreference(profile?.unit_preference));
      })();
    };
    load();
    // The preference can arrive after this has mounted: on a new phone the profile comes down
    // from the server a moment after sign-in, and until then there is nothing to read here.
    const stop = onProfilePulled(load);
    return () => {
      cancelled = true;
      stop();
    };
  }, [userId]);

  const setUnit = useCallback(
    (next: UnitPreference) => {
      // Applied to the UI first and persisted after. The write is local SQLite, so it cannot
      // fail in any way the user could act on, and awaiting it would leave the segmented
      // control visibly lagging the tap.
      setUnitState(next);
      void (async () => {
        const db = await getExecutor();
        await saveProfile(db, userId, { unitPreference: next });
      })();
    },
    [userId],
  );

  const value = useMemo(() => ({ unit, setUnit }), [unit, setUnit]);

  return <UnitsContext.Provider value={value}>{children}</UnitsContext.Provider>;
}

/** The active preference. The overwhelmingly common case — most screens only read. */
export function useUnit(): UnitPreference {
  return useContext(UnitsContext).unit;
}

/** Read and write, for the settings screen. */
export function useUnits(): UnitsContextValue {
  return useContext(UnitsContext);
}
