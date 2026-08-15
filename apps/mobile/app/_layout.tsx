/**
 * Root layout: initialise i18n before the first render, then mount the router.
 *
 * i18n is initialised at module scope rather than in an effect, because `I18nManager.forceRTL`
 * must be applied before any view is laid out — doing it in an effect would mirror the layout
 * one frame late and cause a visible flash on every cold start in Hebrew.
 *
 * `ThemeProvider` sits above everything, including `AuthProvider`/`AppGate` — the sign-in
 * screens need `useTheme()` too, and are exactly where `AnimatedGradientBackground` shows,
 * since they are otherwise the emptiest screens in the app.
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { AppGate } from '../src/auth/AppGate.js';
import { AuthProvider } from '../src/auth/AuthProvider.js';
import { AnimatedGradientBackground } from '../src/components/AnimatedGradientBackground.js';
import { ErrorBoundary } from '../src/components/ErrorBoundary.js';
import { initI18n, isRtlLanguage, loadStoredLanguage, type Language } from '../src/i18n/index.js';
import { ThemeProvider, useTheme } from '../src/ThemeProvider.js';

initI18n();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Gyms and military bases have poor signal — the plan calls for offline-first, so
      // cached data stays usable rather than refetching aggressively on a flaky connection.
      staleTime: 60_000,
      retry: 2,
    },
  },
});

function RootLayoutInner() {
  const { scheme } = useTheme();
  const { i18n } = useTranslation();

  // The stored choice, applied once the app is up. Reading it synchronously before the first
  // render is not possible (SecureStore is async), and no longer necessary: the direction
  // wrapper below follows i18next, so a late switch repaints instead of needing a restart.
  useEffect(() => {
    void loadStoredLanguage().then((stored) => {
      if (stored !== i18n.language) void i18n.changeLanguage(stored);
    });
  }, [i18n]);

  /*
   * Layout direction, in place.
   *
   * `I18nManager.forceRTL` only takes effect on the next launch, which is why switching language
   * used to leave the text translated and the layout facing the wrong way until the app was
   * reopened. Yoga's `direction` mirrors this subtree immediately, so every logical property
   * (marginStart, paddingEnd, textAlign: 'auto') resolves against the language actually showing.
   *
   * It does NOT update `I18nManager.isRTL`. Anything reading that flag stays stale until
   * relaunch — see SwipeableRow, which keys its swipe on the language for exactly this reason.
   */
  const direction = isRtlLanguage(i18n.language as Language) ? 'rtl' : 'ltr';

  return (
    <View style={{ flex: 1, direction }}>
      <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
      <AnimatedGradientBackground />
      <AppGate>
        <ErrorBoundary>
          <Stack
            screenOptions={{
              headerShown: false,
              // Transparent, not a solid fill — AnimatedGradientBackground sits behind the
              // whole stack, and every screen's own content already paints its own surfaces.
              contentStyle: { backgroundColor: 'transparent' },
              // A deliberate fade+rise on every push/pop, the same direction on both platforms —
              // the native iOS slide and Android fade read as two different apps side by side.
              animation: 'fade_from_bottom',
            }}
          >
            <Stack.Screen name="(tabs)" />
            {/* Presented as a sheet so the workout stays visible behind it — picking an
                exercise is a detour within the session, not a departure from it. */}
            <Stack.Screen name="exercise-picker" options={{ presentation: 'modal' }} />
          </Stack>
        </ErrorBoundary>
      </AppGate>
    </View>
  );
}

export default function RootLayout() {
  return (
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <SafeAreaProvider>
            <RootLayoutInner />
          </SafeAreaProvider>
        </AuthProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}
