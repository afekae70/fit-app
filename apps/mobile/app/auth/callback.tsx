/**
 * Where the sign-up confirmation and password-recovery emails redirect back into the app (see
 * `AUTH_CALLBACK_URL` in `AuthProvider.tsx`). expo-router hands this screen the URL's query
 * params via `useLocalSearchParams()` automatically — cold start (app not yet running) and
 * warm start (already open) both land here the same way, no manual `Linking` listener needed.
 *
 * This screen sits as a plain sibling route to `(tabs)` in `_layout.tsx`'s `<Stack>`, which is
 * itself nested inside `AppGate`. That nesting is exactly why this screen must navigate
 * explicitly on success rather than relying on `AppGate` to react to the new session: `AppGate`
 * only gates *above* the `<Stack>`, so a session becoming non-null does not by itself move the
 * `<Stack>` off whichever screen it was already showing.
 */

import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { useAuth } from '../../src/auth/AuthProvider.js';
import { classifyCallbackParams } from '../../src/auth/callbackParams.js';
import { AUTH_ERROR_I18N_KEY } from '../../src/auth/friendlyAuthError.js';
import { Banner } from '../../src/components/ui.js';
import { useTheme } from '../../src/ThemeProvider.js';
import { fontSize, fontWeight, radius, spacing, type ColorPalette } from '../../src/theme.js';

export default function AuthCallbackScreen() {
  const { t } = useTranslation();
  const { exchangeCode } = useAuth();
  const params = useLocalSearchParams<{ code?: string; type?: string }>();
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  // A code is single-use — Supabase invalidates it once exchanged. Guards against this effect
  // re-running (e.g. a parent re-render) and trying to consume the same code twice.
  const handled = useRef(false);

  useEffect(() => {
    if (handled.current) return;
    handled.current = true;

    const classification = classifyCallbackParams(params);
    if (classification.kind === 'invalid') {
      setErrorKey('link_expired');
      return;
    }

    void (async () => {
      const result = await exchangeCode(classification.code);
      if (result.error) {
        setErrorKey(result.error);
        return;
      }

      if (classification.kind === 'recovery') {
        // Never falls through to the tabs first — this is a navigation-level guarantee,
        // independent of however AppGate itself is currently gating.
        router.replace('/auth/reset-password');
      } else {
        router.replace('/');
      }
    })();
  }, [params, exchangeCode]);

  if (errorKey) {
    return (
      <View style={styles.screen}>
        <Banner tone="warning">{t(AUTH_ERROR_I18N_KEY[errorKey] ?? AUTH_ERROR_I18N_KEY.unknown!)}</Banner>
        <Pressable
          onPress={() => router.replace('/')}
          style={styles.button}
          accessibilityRole="button"
        >
          <Text style={styles.buttonText}>{t('auth.backToSignIn')}</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <ActivityIndicator color={colors.accent} />
    </View>
  );
}

const createStyles = (colors: ColorPalette) =>
  StyleSheet.create({
    // Transparent, not colors.bg — same as the sign-in wall this screen sits alongside.
    screen: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      gap: spacing.md,
      paddingHorizontal: spacing.lg,
    },
    button: {
      marginTop: spacing.sm,
      paddingVertical: spacing.md,
      paddingHorizontal: spacing.xl,
      borderRadius: radius.md,
      backgroundColor: colors.accentSoft,
      borderWidth: 1,
      borderColor: colors.accentBorder,
    },
    buttonText: { color: colors.accent, fontSize: fontSize.md, fontWeight: fontWeight.bold },
  });
