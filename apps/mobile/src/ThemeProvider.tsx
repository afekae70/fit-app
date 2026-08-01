/**
 * Light/dark scheme state, shared through context because `StyleSheet.create` calls live at
 * module scope in every screen — they need the current palette handed to them as a value
 * (via `useTheme()` inside the component, memoized against `colors`), not read from a static
 * import, or a scheme switch would never repaint anything already on screen.
 *
 * Defaults to the OS appearance on first launch, then remembers whatever the user picks
 * afterward — `expo-secure-store` rather than a new storage dependency, since it is already
 * linked into the app for the auth session and a one-line preference does not justify adding
 * another native module.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Appearance } from 'react-native';
import * as SecureStore from 'expo-secure-store';

import { darkColors, lightColors, type ColorPalette } from './theme.js';

export type ColorScheme = 'dark' | 'light';

const STORAGE_KEY = 'fit_app_color_scheme';

interface ThemeContextValue {
  scheme: ColorScheme;
  colors: ColorPalette;
  toggleScheme: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [scheme, setScheme] = useState<ColorScheme>(
    Appearance.getColorScheme() === 'light' ? 'light' : 'dark',
  );

  useEffect(() => {
    void SecureStore.getItemAsync(STORAGE_KEY)
      .then((saved) => {
        if (saved === 'light' || saved === 'dark') setScheme(saved);
      })
      // A saved preference is a nice-to-have, not a requirement — the OS-appearance default
      // already set above stays in place if the keystore read fails for any reason.
      .catch(() => {});
  }, []);

  const toggleScheme = useCallback(() => {
    setScheme((current) => {
      const next: ColorScheme = current === 'dark' ? 'light' : 'dark';
      // Fire-and-forget: the scheme itself flips immediately via the state update below,
      // independent of whether persisting it succeeds.
      void SecureStore.setItemAsync(STORAGE_KEY, next).catch(() => {});
      return next;
    });
  }, []);

  const colors = scheme === 'dark' ? darkColors : lightColors;
  const value = useMemo(() => ({ scheme, colors, toggleScheme }), [scheme, colors, toggleScheme]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider');
  return ctx;
}
