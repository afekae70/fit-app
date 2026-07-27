/**
 * The sign-in / sign-up form shown in place of the chat composer when there is no session.
 *
 * Deliberately not a separate route. The coach is the only feature that needs an account, so
 * putting the form on its own screen would mean navigating away from the thing the user came
 * to do and back again. Rendered inline, it disappears the moment `session` becomes non-null —
 * `AuthProvider`'s `onAuthStateChange` subscription flips that automatically, so there is
 * nothing here that needs to notice sign-in succeeded and dismiss itself.
 */

import { useState } from 'react';
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
import { colors, fontSize, fontWeight, radius, spacing } from '../theme.js';
import { useAuth } from './AuthProvider.js';

const ERROR_KEY: Record<string, string> = {
  invalid_credentials: 'auth.errorInvalidCredentials',
  already_registered: 'auth.errorAlreadyRegistered',
  weak_password: 'auth.errorWeakPassword',
  email_not_confirmed: 'auth.errorEmailNotConfirmed',
  not_configured: 'auth.errorNotConfigured',
  unknown: 'auth.errorUnknown',
};

export function AuthGate() {
  const { t } = useTranslation();
  const { signIn, signUp } = useAuth();

  const [mode, setMode] = useState<'signIn' | 'signUp'>('signIn');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  // Supabase's default project settings require confirming a new address by email before
  // sign-in works. Surfaced explicitly after sign-up so the user does not conclude the button
  // is broken when nothing visibly happens next.
  const [awaitingConfirmation, setAwaitingConfirmation] = useState(false);

  const submit = () => {
    const trimmedEmail = email.trim();
    if (!trimmedEmail || password.length === 0 || busy) return;

    setBusy(true);
    setErrorKey(null);

    void (async () => {
      const result =
        mode === 'signIn' ? await signIn(trimmedEmail, password) : await signUp(trimmedEmail, password);

      setBusy(false);
      if (result.error) {
        setErrorKey(result.error);
      } else if (mode === 'signUp') {
        setAwaitingConfirmation(true);
      }
      // A successful sign-in needs no local state change: AuthProvider's subscription updates
      // `session`, and the coach screen re-renders past this component on its own.
    })();
  };

  if (awaitingConfirmation) {
    return (
      <View style={styles.card}>
        <Banner tone="info">{t('auth.checkYourEmail')}</Banner>
        <Pressable
          onPress={() => {
            setAwaitingConfirmation(false);
            setMode('signIn');
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

      {errorKey ? <Banner tone="warning">{t(ERROR_KEY[errorKey] ?? ERROR_KEY.unknown!)}</Banner> : null}

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

const styles = StyleSheet.create<{
  card: ViewStyle;
  title: TextStyle;
  subtitle: TextStyle;
  input: TextStyle;
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
