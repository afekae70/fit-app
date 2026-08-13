/**
 * Display settings, shared across every screen.
 *
 * These live in a context rather than being read from SQLite per screen for one reason: when
 * the unit system changes, every weight in the app has to change with it in the same frame.
 * Screens that each loaded the preference on their own would update whenever they next
 * happened to remount, so the metrics tab could sit showing pounds while the workout tab
 * showed kilograms — and a user staring at two different numbers for the same lift has no way
 * to tell which one is real.
 *
 * The profile row remains the source of truth. This is a cache of two of its columns.
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

import { getProfile, saveProfile } from './db/metrics.js';
import { getExecutor } from './db/provider.js';
import { DEFAULT_UNIT_SYSTEM, parseUnitSystem, type UnitSystem } from './units.js';

export interface Settings {
  unitSystem: UnitSystem;
  /** Null means no rest timer. Absence is the off switch — see the schema comment. */
  defaultRestSeconds: number | null;
}

export interface SettingsContextValue {
  settings: Settings;
  /** True until the profile row has been read, so screens can avoid a flash of the default. */
  loaded: boolean;
  update: (patch: Partial<Settings>) => Promise<void>;
}

const FALLBACK: Settings = {
  unitSystem: DEFAULT_UNIT_SYSTEM,
  // Two minutes: long enough for a compound lift, short enough that nobody sets it wanting
  // less. Only used when the user has never opened settings.
  defaultRestSeconds: 120,
};

const SettingsContext = createContext<SettingsContextValue>({
  settings: FALLBACK,
  loaded: false,
  update: async () => undefined,
});

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Settings>(FALLBACK);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const db = await getExecutor();
      const profile = await getProfile(db);
      if (cancelled) return;

      setSettings({
        unitSystem: parseUnitSystem(profile?.unit_system),
        // A profile that exists but has never had the timer set keeps the fallback; one that
        // was explicitly cleared holds null and must stay off.
        defaultRestSeconds: profile ? profile.default_rest_seconds : FALLBACK.defaultRestSeconds,
      });
      setLoaded(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const update = useCallback(async (patch: Partial<Settings>) => {
    // Optimistic: the write is local SQLite, so it does not fail in any way the user could
    // act on, and waiting for it would make the segmented control feel unresponsive.
    setSettings((current) => ({ ...current, ...patch }));

    const db = await getExecutor();
    await saveProfile(db, {
      unitSystem: patch.unitSystem,
      defaultRestSeconds: patch.defaultRestSeconds,
    });
  }, []);

  const value = useMemo(() => ({ settings, loaded, update }), [settings, loaded, update]);

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings(): SettingsContextValue {
  return useContext(SettingsContext);
}

/** Shorthand for the overwhelmingly common case: a screen that only needs the unit system. */
export function useUnitSystem(): UnitSystem {
  return useContext(SettingsContext).settings.unitSystem;
}
