/**
 * Whole-app sign-in wall.
 *
 * Below this, every screen assumes `useCurrentUserId()` returns a real id — this is the one
 * place that enforces that invariant, so no individual screen has to handle "what if nobody's
 * signed in".
 *
 * Before Supabase is configured (`isConfigured === false` — the state of this repo until
 * deployment, see `AuthProvider`), the app behaves exactly as it always has: no wall, everything
 * scoped to the fixed pseudo-user id `'local'`. Once configured, a signed-out visitor sees the
 * sign-in screen (`AuthGate`) instead of the tabs.
 *
 * Signing in is not quite the end of it. An account that has not yet said how much it weighs,
 * how tall it is and what it is training for is asked — `OnboardingGate`, the innermost thing
 * here — before it reaches the app. That is every new account, straight after the sign-up
 * form, and nobody else.
 *
 * The `/auth/callback` route is exempt from the wall entirely. That's not a style choice: its
 * whole job is to *create* a session from a recovery deep link, which happens precisely when
 * there is no session yet — gating it behind "you need a session to get past this screen" would
 * make a recovery link unable to ever complete.
 *
 * That exemption only works for a link the router can route, which is a link that opened the
 * app or arrived while someone was signed in. While nobody is signed in this gate shows the
 * sign-in screen *in place of* the navigator, so a link arriving then has no navigator to land
 * on and expo-router drops it — the app simply came to the front, which is exactly how the reset
 * failed on 2026-11-07 once the email link reached the app. The sign-in screen therefore reads
 * such a link itself (see `AuthGate`).
 *
 * After a reset link, the session exists but is only for choosing a new password: while
 * `recovering`, the sign-in screen stays up with that form on it, whichever way the link came.
 */

import { usePathname } from 'expo-router';
import { useRef, type ReactNode } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { ErrorBoundary } from '../components/ErrorBoundary.js';
import { useTheme } from '../ThemeProvider.js';
import { AuthGate } from './AuthGate.js';
import { useAuth } from './AuthProvider.js';
import { CurrentUserProvider } from './CurrentUserProvider.js';
import { LockGate } from './LockGate.js';
import { OnboardingGate } from '../onboarding/OnboardingGate.js';
import { SyncProvider } from '../sync/SyncProvider.js';
import { UnitsProvider } from '../UnitsProvider.js';

const LOCAL_USER_ID = 'local';

export function AppGate({ children }: { children: ReactNode }) {
  const { session, isConfigured, recovering } = useAuth();
  const pathname = usePathname();
  const { colors } = useTheme();
  // Whether the sign-in screen has been up during this run of the app. A session that follows
  // it came from a password typed a moment ago, and is not asked for a fingerprint as well.
  const sawSignedOut = useRef(false);
  if (isConfigured && session === null) sawSignedOut.current = true;

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

  // The sign-in screen lays itself out — its own safe areas, its own room for the keyboard.
  // Wrapped, because the app's error boundary is among the children this gate has not let
  // through yet: without one here a fault on this screen would have nothing to catch it.
  if (isConfigured && (session === null || recovering)) {
    return (
      <ErrorBoundary>
        <AuthGate />
      </ErrorBoundary>
    );
  }

  const userId = isConfigured ? session!.user.id : LOCAL_USER_ID;
  // Sync mounts here rather than in the root layout because it needs the resolved user id, and
  // because there is nothing to sync until someone is signed in. It also makes a change of
  // account restart cleanly: the gate remounts this subtree, and the new provider starts from
  // that user's own cursors rather than inheriting the previous account's.
  return (
    <CurrentUserProvider userId={userId}>
      <SyncProvider userId={userId}>
        {/* Below CurrentUserProvider for the same reason as SyncProvider: the preference is a
            per-user profile field, so switching account must reload it rather than inherit the
            previous person's units. */}
        <UnitsProvider userId={userId}>
          {/* Innermost, so the questions can use everything above: whose answers they are,
              which units to ask in — and so the first sync is already running behind them,
              bringing down the history of someone who is signing in on a new phone. */}
          {/* The door, outside the setup questions and inside sync: the training data can be
              coming down while the fingerprint is asked for, and nothing of the account is
              drawn until it has been given. See LockGate. */}
          <LockGate userId={userId} signedInJustNow={sawSignedOut.current}>
            <OnboardingGate userId={userId}>{children}</OnboardingGate>
          </LockGate>
        </UnitsProvider>
      </SyncProvider>
    </CurrentUserProvider>
  );
}

// Transparent, not colors.bg — this is exactly where AnimatedGradientBackground is meant to
// show through, the emptiest, most ambient real estate in the whole app.
const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
