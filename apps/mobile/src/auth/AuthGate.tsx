/**
 * The sign-in / sign-up form shown in place of the chat composer when there is no session.
 *
 * Deliberately not a separate route. The coach is the only feature that needs an account, so
 * putting the form on its own screen would mean navigating away from the thing the user came
 * to do and back again. Rendered inline, it disappears the moment `session` becomes non-null —
 * `AuthProvider`'s `onAuthStateChange` subscription flips that automatically, so there is
 * nothing here that needs to notice sign-in succeeded and dismiss itself.
 *
 * Also reused full-screen by `AppGate.tsx` as the whole-app sign-in wall — nothing here assumes
 * which container it's rendered inside.
 */

import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

import { Banner } from '../components/ui.js';
import { useTheme } from '../ThemeProvider.js';
import { fontSize, fontWeight, radius, spacing, type ColorPalette } from '../theme.js';
import { useAuth } from './AuthProvider.js';
import { AUTH_ERROR_I18N_KEY } from './friendlyAuthError.js';

/** Which of the form's sub-views is showing. A single component with an internal view state,
 *  same as the original `awaitingConfirmation` boolean this replaces — these are all small,
 *  closely related steps of one flow, not separate screens. */
type GateView = 'form' | 'awaitingConfirmation' | 'forgotPassword' | 'resetEmailSent';

export function AuthGate() {
  const { t } = useTranslation();
  const { signIn, signUp, resetPassword, resendConfirmation } = useAuth();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const [mode, setMode] = useState<'signIn' | 'signUp'>('signIn');
  const [view, setView] = useState<GateView>('form');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [forgotEmail, setForgotEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [resendBusy, setResendBusy] = useState(false);
  const [resendSent, setResendSent] = useState(false);

  const submit = () => {
    const trimmedEmail = email.trim();
    if (!trimmedEmail || password.length === 0 || busy) return;
    // Checked client-side, before any network call — a typo here is never a server-side concern.
    if (mode === 'signUp' && password !== confirmPassword) {
      setErrorKey('password_mismatch');
      return;
    }

    setBusy(true);
    setErrorKey(null);

    void (async () => {
      const result =
        mode === 'signIn' ? await signIn(trimmedEmail, password) : await signUp(trimmedEmail, password);

      setBusy(false);
      if (result.error) {
        setErrorKey(result.error);
      } else if (mode === 'signUp') {
        setView('awaitingConfirmation');
      }
      // A successful sign-in needs no local state change: AuthProvider's subscription updates
      // `session`, and the gate above this component re-renders past it on its own.
    })();
  };

  const submitForgotPassword = () => {
    const trimmed = forgotEmail.trim();
    if (!trimmed || busy) return;

    setBusy(true);
    setErrorKey(null);

    void (async () => {
      const result = await resetPassword(trimmed);
      setBusy(false);
      if (result.error) setErrorKey(result.error);
      else setView('resetEmailSent');
    })();
  };

  const resend = () => {
    if (resendBusy || resendSent) return;
    setResendBusy(true);
    void (async () => {
      // Errors are not surfaced here beyond the generic banner state below — a failed resend
      // (e.g. rate-limited) is low-stakes enough that "it didn't visibly resend, try again in a
      // bit" is an acceptable outcome without a dedicated error path of its own.
      await resendConfirmation(email);
      setResendBusy(false);
      setResendSent(true);
    })();
  };

  const backToSignIn = () => {
    setView('form');
    setMode('signIn');
    setErrorKey(null);
    setResendSent(false);
  };

  if (view === 'awaitingConfirmation') {
    return (
      <View style={styles.card}>
        <Banner tone="info">{t('auth.checkYourEmail')}</Banner>
        <Pressable
          onPress={resend}
          disabled={resendBusy || resendSent}
          style={styles.switchModeButton}
        >
          {resendBusy ? (
            <ActivityIndicator color={colors.accent} />
          ) : (
            <Text style={styles.switchModeText}>
              {resendSent ? t('auth.resendConfirmationSent') : t('auth.resendConfirmation')}
            </Text>
          )}
        </Pressable>
        <Pressable onPress={backToSignIn} style={styles.switchModeButton}>
          <Text style={styles.switchModeText}>{t('auth.backToSignIn')}</Text>
        </Pressable>
      </View>
    );
  }

  if (view === 'resetEmailSent') {
    return (
      <View style={styles.card}>
        <Banner tone="info">{t('auth.resetEmailSent')}</Banner>
        <Pressable onPress={backToSignIn} style={styles.switchModeButton}>
          <Text style={styles.switchModeText}>{t('auth.backToSignIn')}</Text>
        </Pressable>
      </View>
    );
  }

  if (view === 'forgotPassword') {
    return (
      <View style={styles.card}>
        <Text style={styles.title}>{t('auth.resetPasswordTitle')}</Text>
        <Text style={styles.subtitle}>{t('auth.resetPasswordSubtitle')}</Text>

        <TextInput
          value={forgotEmail}
          onChangeText={setForgotEmail}
          placeholder={t('auth.emailPlaceholder')}
          placeholderTextColor={colors.textMuted}
          style={styles.input}
          autoCapitalize="none"
          autoComplete="email"
          keyboardType="email-address"
          editable={!busy}
        />

        {errorKey ? (
          <Banner tone="warning">{t(AUTH_ERROR_I18N_KEY[errorKey] ?? AUTH_ERROR_I18N_KEY.unknown!)}</Banner>
        ) : null}

        <Pressable
          onPress={submitForgotPassword}
          disabled={busy || !forgotEmail.trim()}
          style={[styles.submitButton, (busy || !forgotEmail.trim()) && styles.submitButtonDisabled]}
          accessibilityRole="button"
        >
          {busy ? (
            <ActivityIndicator color={colors.bg} />
          ) : (
            <Text style={styles.submitButtonText}>{t('auth.resetPasswordSend')}</Text>
          )}
        </Pressable>

        <Pressable
          onPress={() => {
            setView('form');
            setErrorKey(null);
          }}
          style={styles.switchModeButton}
        >
          <Text style={styles.switchModeText}>{t('auth.backToSignIn')}</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.card}>
      <Text style={styles.title}>{mode === 'signIn' ? t('auth.signInTitle') : t('auth.signUpTitle')}</Text>
      <Text style={styles.subtitle}>{t('auth.subtitle')}</Text>

      <TextInput
        value={email}
        onChangeText={setEmail}
        placeholder={t('auth.emailPlaceholder')}
        placeholderTextColor={colors.textMuted}
        style={styles.input}
        autoCapitalize="none"
        autoComplete="email"
        keyboardType="email-address"
        editable={!busy}
      />
      <TextInput
        value={password}
        onChangeText={setPassword}
        placeholder={t('auth.passwordPlaceholder')}
        placeholderTextColor={colors.textMuted}
        style={styles.input}
        secureTextEntry
        autoComplete={mode === 'signIn' ? 'current-password' : 'new-password'}
        editable={!busy}
      />
      {mode === 'signUp' ? (
        <TextInput
          value={confirmPassword}
          onChangeText={setConfirmPassword}
          placeholder={t('auth.confirmPasswordPlaceholder')}
          placeholderTextColor={colors.textMuted}
          style={styles.input}
          secureTextEntry
          autoComplete="new-password"
          editable={!busy}
        />
      ) : null}

      {mode === 'signIn' ? (
        <Pressable
          onPress={() => {
            setForgotEmail(email);
            setErrorKey(null);
            setView('forgotPassword');
          }}
          style={styles.forgotPasswordButton}
        >
          <Text style={styles.switchModeText}>{t('auth.forgotPassword')}</Text>
        </Pressable>
      ) : null}

      {errorKey ? (
          <Banner tone="warning">{t(AUTH_ERROR_I18N_KEY[errorKey] ?? AUTH_ERROR_I18N_KEY.unknown!)}</Banner>
        ) : null}

      <Pressable
        onPress={submit}
        disabled={busy || !email.trim() || password.length === 0}
        style={[
          styles.submitButton,
          (busy || !email.trim() || password.length === 0) && styles.submitButtonDisabled,
        ]}
        accessibilityRole="button"
      >
        {busy ? (
          <ActivityIndicator color={colors.bg} />
        ) : (
          <Text style={styles.submitButtonText}>
            {mode === 'signIn' ? t('auth.signIn') : t('auth.signUp')}
          </Text>
        )}
      </Pressable>

      <Pressable
        onPress={() => {
          setMode((current) => (current === 'signIn' ? 'signUp' : 'signIn'));
          setErrorKey(null);
        }}
        style={styles.switchModeButton}
      >
        <Text style={styles.switchModeText}>
          {mode === 'signIn' ? t('auth.switchToSignUp') : t('auth.switchToSignIn')}
        </Text>
      </Pressable>
    </View>
  );
}

const createStyles = (colors: ColorPalette) =>
  StyleSheet.create<{
    card: ViewStyle;
    title: TextStyle;
    subtitle: TextStyle;
    input: TextStyle;
    forgotPasswordButton: ViewStyle;
    submitButton: ViewStyle;
    submitButtonDisabled: ViewStyle;
    submitButtonText: TextStyle;
    switchModeButton: ViewStyle;
    switchModeText: TextStyle;
  }>({
  card: { gap: spacing.sm, padding: spacing.lg },
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
  forgotPasswordButton: { alignSelf: 'flex-end', padding: spacing.xs },
  submitButton: {
    marginTop: spacing.sm,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.accent,
    alignItems: 'center',
  },
  submitButtonDisabled: { backgroundColor: colors.surfaceHigh },
  submitButtonText: { color: colors.bg, fontSize: fontSize.md, fontWeight: fontWeight.bold },
  switchModeButton: { marginTop: spacing.sm, alignItems: 'center', padding: spacing.sm },
  switchModeText: { color: colors.accent, fontSize: fontSize.sm },
});
