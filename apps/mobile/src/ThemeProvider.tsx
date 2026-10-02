/**
 * Light/dark scheme state, shared through context because `StyleSheet.create` calls live at
 * module scope in every screen — they need the current palette handed to them as a value
 * (via `useTheme()` inside the component, memoized against `colors`), not read from a static
 * import, or a scheme switch would never repaint anything already on screen.
 *
 * ## Three settings, two palettes
 *
 * The preference is `system`, `light` or `dark`, and `system` is the default. A phone that goes
 * dark at sunset should take this app with it: the app was following the OS only at the moment it
 * launched, so an app left open through the evening stayed bright until it was killed, and one
 * opened after dark kept whatever had been picked months earlier.
 *
 * `scheme` is what is actually on screen and is only ever `light` or `dark` — no screen should
 * have to resolve "system" for itself. `preference` is what the settings screen shows.
 *
 * Stored in `expo-secure-store` rather than adding a storage dependency: it is already linked for
 * the auth session, and a one-line preference does not justify another native module.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Appearance } from 'react-native';
import * as SecureStore from 'expo-secure-store';

import { darkColors, lightColors, type ColorPalette } from './theme.js';

export type ColorScheme = 'dark' | 'light';
/** What the user asked for, which may be "whatever the phone is doing". */
export type ThemePreference = ColorScheme | 'system';

const STORAGE_KEY = 'fit_app_color_scheme';

interface ThemeContextValue {
  /** The palette actually in use — resolved, never "system". */
  scheme: ColorScheme;
  colors: ColorPalette;
  /** What was chosen: a fixed scheme, or following the device. */
  preference: ThemePreference;
  setPreference: (preference: ThemePreference) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

const systemScheme = (): ColorScheme => (Appearance.getColorScheme() === 'light' ? 'light' : 'dark');

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [preference, setStoredPreference] = useState<ThemePreference>('system');
  const [deviceScheme, setDeviceScheme] = useState<ColorScheme>(systemScheme);

  useEffect(() => {
    void SecureStore.getItemAsync(STORAGE_KEY)
      .then((saved) => {
        if (saved === 'light' || saved === 'dark' || saved === 'system') setStoredPreference(saved);
      })
      // A saved preference is a nice-to-have, not a requirement — following the device, the
      // default set above, stays in place if the keystore read fails for any reason.
      .catch(() => {});
  }, []);

  /*
   * Follow the phone while it is open, not only at launch.
   *
   * Android switches at sunset, on a schedule, or because someone flipped a quick setting, and
   * an app that read the appearance once is wrong from that moment until it is killed. The
   * listener is kept regardless of the preference: switching back to "system" must land on what
   * the phone is doing now, not on what it was doing at startup.
   */
  useEffect(() => {
    const subscription = Appearance.addChangeListener(({ colorScheme }) => {
      setDeviceScheme(colorScheme === 'light' ? 'light' : 'dark');
    });
    return () => subscription.remove();
  }, []);

  const setPreference = useCallback((next: ThemePreference) => {
    setStoredPreference(next);
    // Fire-and-forget: the scheme changes immediately via the state update, independent of
    // whether persisting it succeeds.
    void SecureStore.setItemAsync(STORAGE_KEY, next).catch(() => {});
  }, []);

  const scheme: ColorScheme = preference === 'system' ? deviceScheme : preference;
  const colors = scheme === 'dark' ? darkColors : lightColors;
  const value = useMemo(
    () => ({ scheme, colors, preference, setPreference }),
    [scheme, colors, preference, setPreference],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider');
  return ctx;
}
