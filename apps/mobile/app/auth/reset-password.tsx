/**
 * "Set a new password" — reached only via `app/auth/callback.tsx` after a successful PKCE
 * exchange for a password-recovery link, never by manual navigation. The recovery session that
 * exchange created is single-purpose: once a new password is set, this screen signs the user out
 * and sends them back to the normal sign-in form to sign in fresh, rather than leaving them
 * signed in via the recovery session — that sidesteps ever having to treat "signed in because of
 * a recovery link" as equivalent to an ordinary session elsewhere in the app.
 *
 * Sits outside `AppGate`'s wall (see the `/auth/` exemption there) since it's reached exactly
 * when a session exists but the user hasn't proven a new password yet — gating it the normal way
 * would either loop back to a sign-in form pointlessly or skip straight to the tabs, both wrong.
 */

import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAuth } from '../../src/auth/AuthProvider.js';
import { AUTH_ERROR_I18N_KEY } from '../../src/auth/friendlyAuthError.js';
import { Banner } from '../../src/components/ui.js';
import { useTheme } from '../../src/ThemeProvider.js';
import { fontSize, fontWeight, radius, spacing, type ColorPalette } from '../../src/theme.js';

/** How long the "password updated" banner stays up before signing out and redirecting — long
 *  enough to actually be read, short enough not to feel stuck. */
const CONFIRMATION_DELAY_MS = 1500;

export default function ResetPasswordScreen() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { updatePassword, signOut } = useAuth();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const submit = () => {
    if (newPassword.length === 0 || busy) return;
    if (newPassword !== confirmPassword) {
      setErrorKey('password_mismatch');
      return;
    }

    setBusy(true);
    setErrorKey(null);

    void (async () => {
      const result = await updatePassword(newPassword);
      setBusy(false);
      if (result.error) {
        setErrorKey(result.error);
        return;
      }

      setDone(true);
      setTimeout(() => {
        void (async () => {
          await signOut();
          router.replace('/');
        })();
      }, CONFIRMATION_DELAY_MS);
    })();
  };

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={[styles.content, { paddingTop: insets.top + spacing.xxl }]}>
        {done ? (
          <Banner tone="success">{t('auth.passwordUpdated')}</Banner>
        ) : (
          <>
            <Text style={styles.title}>{t('auth.setNewPasswordTitle')}</Text>
            <Text style={styles.subtitle}>{t('auth.setNewPasswordSubtitle')}</Text>

            <TextInput
              value={newPassword}
              onChangeText={setNewPassword}
              placeholder={t('auth.newPasswordPlaceholder')}
              placeholderTextColor={colors.textMuted}
              style={styles.input}
              secureTextEntry
              autoComplete="new-password"
              editable={!busy}
            />
            <TextInput
              value={confirmPassword}
              onChangeText={setConfirmPassword}
              placeholder={t('auth.confirmNewPasswordPlaceholder')}
              placeholderTextColor={colors.textMuted}
              style={styles.input}
              secureTextEntry
              autoComplete="new-password"
              editable={!busy}
            />

            {errorKey ? (
              <Banner tone="warning">
                {t(AUTH_ERROR_I18N_KEY[errorKey] ?? AUTH_ERROR_I18N_KEY.unknown!)}
              </Banner>
            ) : null}

            <Pressable
              onPress={submit}
              disabled={busy || newPassword.length === 0}
              style={[
                styles.submitButton,
                (busy || newPassword.length === 0) && styles.submitButtonDisabled,
              ]}
              accessibilityRole="button"
            >
              {busy ? (
                <ActivityIndicator color={colors.bg} />
              ) : (
                <Text style={styles.submitButtonText}>{t('auth.updatePassword')}</Text>
              )}
            </Pressable>
          </>
        )}
      </View>
    </KeyboardAvoidingView>
  );
}

const createStyles = (colors: ColorPalette) =>
  StyleSheet.create<{
    screen: ViewStyle;
    content: ViewStyle;
    title: TextStyle;
    subtitle: TextStyle;
    input: TextStyle;
    submitButton: ViewStyle;
    submitButtonDisabled: ViewStyle;
    submitButtonText: TextStyle;
  }>({
    // Transparent, not colors.bg — this screen sits outside AppGate's wall alongside the
    // sign-in form, where AnimatedGradientBackground is meant to show through.
    screen: { flex: 1 },
    content: { flex: 1, justifyContent: 'center', paddingHorizontal: spacing.lg, gap: spacing.sm },
    title: {
      color: colors.text,
      fontSize: fontSize.lg,
      fontWeight: fontWeight.bold,
      textAlign: 'auto',
    },
    subtitle: {
      color: colors.textMuted,
      fontSize: fontSize.sm,
      marginBottom: spacing.sm,
      textAlign: 'auto',
    },
    input: {
      color: colors.text,
      fontSize: fontSize.sm,
      backgroundColor: colors.surfaceRaised,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.border,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      textAlign: 'auto',
    },
    submitButton: {
      marginTop: spacing.sm,
      paddingVertical: spacing.md,
      borderRadius: radius.md,
      backgroundColor: colors.accent,
      alignItems: 'center',
    },
    submitButtonDisabled: { backgroundColor: colors.surfaceHigh },
    submitButtonText: { color: colors.bg, fontSize: fontSize.md, fontWeight: fontWeight.bold },
  });
