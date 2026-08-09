/**
 * Whole-app sign-in wall.
 *
 * Below this, every screen assumes `useCurrentUserId()` returns a real id — this is the one
 * place that enforces that invariant, so no individual screen has to handle "what if nobody's
 * signed in".
 *
 * Before Supabase is configured (`isConfigured === false` — the state of this repo until
 * deployment, see `AuthProvider`), the app behaves exactly as it always has: no wall, everything
 * scoped to the fixed pseudo-user id `'local'`. Once configured, a signed-out visitor sees a
 * full-screen sign-in form instead of the tabs — reusing `AuthGate` verbatim, the same
 * email/password form already used in its compact form to unlock the coach chat.
 *
 * `/auth/*` routes (`app/auth/callback.tsx`, `app/auth/reset-password.tsx`) are exempt from the
 * wall entirely. That's not a style choice: the callback screen's whole job is to *create* a
 * session from a confirmation/recovery deep link, which happens precisely when there is no
 * session yet — gating it behind "you need a session to get past this screen" would make a
 * confirmation link unable to ever complete.
 */

import { usePathname } from 'expo-router';
import type { ReactNode } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useTheme } from '../ThemeProvider.js';
import { spacing } from '../theme.js';
import { AuthGate } from './AuthGate.js';
import { useAuth } from './AuthProvider.js';
import { CurrentUserProvider } from './CurrentUserProvider.js';
import { SyncProvider } from '../sync/SyncProvider.js';

const LOCAL_USER_ID = 'local';

export function AppGate({ children }: { children: ReactNode }) {
  const { session, isConfigured } = useAuth();
  const insets = useSafeAreaInsets();
  const pathname = usePathname();
  const { colors } = useTheme();

  if (pathname.startsWith('/auth/')) {
    return <>{children}</>;
  }

  // Only relevant once configured: the stored session takes a tick to resolve on cold start.
  if (isConfigured && session === undefined) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  if (isConfigured && session === null) {
    return (
      <KeyboardAvoidingView
        style={styles.screen}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={[styles.gateContent, { paddingTop: insets.top + spacing.xxl }]}>
          <AuthGate />
        </View>
      </KeyboardAvoidingView>
    );
  }

  const userId = isConfigured ? session!.user.id : LOCAL_USER_ID;
  // Sync mounts here rather than in the root layout because it needs the resolved user id, and
  // because there is nothing to sync until someone is signed in. It also makes a change of
  // account restart cleanly: the gate remounts this subtree, and the new provider starts from
  // that user's own cursors rather than inheriting the previous account's.
  return (
    <CurrentUserProvider userId={userId}>
      <SyncProvider userId={userId}>{children}</SyncProvider>
    </CurrentUserProvider>
  );
}

// Transparent, not colors.bg — this is exactly where AnimatedGradientBackground is meant to
// show through, the emptiest, most ambient real estate in the whole app.
const styles = StyleSheet.create({
  screen: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  gateContent: { flex: 1, justifyContent: 'center', paddingHorizontal: spacing.lg },
});
