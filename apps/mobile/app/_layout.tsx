/**
 * Root layout: initialise i18n before the first render, then mount the router.
 *
 * i18n is initialised at module scope rather than in an effect, because `I18nManager.forceRTL`
 * must be applied before any view is laid out — doing it in an effect would mirror the layout
 * one frame late and cause a visible flash on every cold start in Hebrew.
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { initI18n } from '../src/i18n/index.js';
import { colors } from '../src/theme.js';

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

export default function RootLayout() {
  return (
    <QueryClientProvider client={queryClient}>
      <SafeAreaProvider>
        <StatusBar style="light" />
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: colors.bg },
          }}
        >
          <Stack.Screen name="(tabs)" />
          {/* Presented as a sheet so the workout stays visible behind it — picking an
              exercise is a detour within the session, not a departure from it. */}
          <Stack.Screen name="exercise-picker" options={{ presentation: 'modal' }} />
        </Stack>
      </SafeAreaProvider>
    </QueryClientProvider>
  );
}
