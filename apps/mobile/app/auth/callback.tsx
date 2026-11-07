/**
 * Where the password-recovery email redirects back into the app (see `AUTH_CALLBACK_URL` in
 * `AuthProvider.tsx`), when the router can route it: a link that opened the app, or one that
 * arrived while someone was signed in. A link arriving while the sign-in screen is up never
 * reaches here — there is no navigator mounted to route it — and the sign-in screen reads it
 * itself instead (see `AppGate`, `AuthGate`).
 *
 * On success it goes to `/`, and `AppGate` decides what that shows: the new-password form on
 * the sign-in screen while the reset's session is `recovering`, the app otherwise. This screen
 * sits inside the `<Stack>` that `AppGate` gates, which is why it has to navigate at all: a
 * change of session does not by itself move the `<Stack>` off whichever screen it is showing.
 */

import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { Pressable } from '../../src/components/Pressable.js';
import { Text } from '../../src/components/Text.js';

import { useAuth } from '../../src/auth/AuthProvider.js';
import { classifyCallbackParams } from '../../src/auth/callbackParams.js';
import { AUTH_ERROR_I18N_KEY } from '../../src/auth/friendlyAuthError.js';
import { Banner } from '../../src/components/ui.js';
import { useTheme } from '../../src/ThemeProvider.js';
import { fontSize, fontWeight, radius, spacing, type ColorPalette } from '../../src/theme.js';

export default function AuthCallbackScreen() {
  const { t } = useTranslation();
  const { exchangeCode } = useAuth();
  const params = useLocalSearchParams<{
    code?: string;
    type?: string;
    error_code?: string;
    error?: string;
  }>();
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
    if (classification.kind !== 'code') {
      setErrorKey('link_expired');
      return;
    }

    void (async () => {
      const result = await exchangeCode(classification.code);
      if (result.error) {
        setErrorKey(result.error);
        return;
      }

      // A reset has set `recovering` by now, so `/` is the new-password form rather than the
      // tabs. A code that was not a reset (none is sent today) has simply signed them in.
      router.replace('/');
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
