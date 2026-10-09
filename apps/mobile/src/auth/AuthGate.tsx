/**
 * The screen someone without a session sees: the mark, the name, and a way in.
 *
 * It is the first thing a new person sees of the app and the only thing a returning one has to
 * get past, so it does two jobs at once — it says what this is, and it stays out of the way.
 * The logo and the name arrive first, the form rises in under them, and switching between
 * signing in and signing up changes what is in the card without the card going anywhere.
 *
 * ## There is no "check your email"
 *
 * Signing up signs you in. An account used to be parked behind a confirmation link, which is a
 * reasonable thing for a service to want and a poor thing to ask of someone standing in a gym
 * who has just decided to try an app: leave, find the email, come back. The questions that make
 * the app useful — see `OnboardingFlow` — now follow the form directly instead.
 *
 * Password reset still goes by email, because there is no other way to prove who is asking.
 *
 * ## Motion
 *
 * Opacity and transforms only, all native-driven, each on a view of its own. The focus ring on
 * a field and the tint of the selected tab's label are plain styles that change on a render,
 * never colours tweened on a node that also carries a transform — see CLAUDE.md.
 *
 * Nothing moves sideways. The two tabs cross-fade rather than slide a pill between them: a
 * translation is a physical distance, and in a right-to-left layout "towards the second tab" is
 * the opposite of what it would assume.
 */

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Animated,
  Easing,
  Image,
  Keyboard,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type ImageStyle,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { EnvelopeSimple, Eye, EyeSlash, LockSimple } from 'phosphor-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import appIcon from '../../assets/icon.png';

import { BrandButton } from '../components/BrandButton.js';
import { Field } from '../components/Field.js';
import { KeyboardSafe } from '../components/KeyboardSafe.js';
import { FadeSlideIn, useReduceMotion } from '../components/motion.js';
import { splashTimeLeft } from '../components/SplashOverlay.js';
import { Banner } from '../components/ui.js';
import { hapticLight } from '../haptics.js';
import { SETUP_TOTAL } from '../onboarding/profileSetup.js';
import { useTheme } from '../ThemeProvider.js';
import {
  duration,
  fontSize,
  fontWeight,
  radius,
  shadow,
  spacing,
  type ColorPalette,
} from '../theme.js';
import { useAuth } from './AuthProvider.js';
import { AUTH_ERROR_I18N_KEY } from './friendlyAuthError.js';

type Mode = 'signIn' | 'signUp';
/** Which of the card's contents is showing. Small, closely related steps of one flow. */
type GateView = 'form' | 'forgotPassword' | 'resetEmailSent';

export function AuthGate() {
  const { t } = useTranslation();
  const { signIn, signUp, resetPassword } = useAuth();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const insets = useSafeAreaInsets();
  const scroll = useRef<ScrollView>(null);

  const [mode, setMode] = useState<Mode>('signIn');
  const [view, setView] = useState<GateView>('form');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [forgotEmail, setForgotEmail] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);

  /*
   * Bring the form above the keyboard.
   *
   * `KeyboardSafe` makes the room; this uses it. The form is the last thing on the page, so
   * the end of the scroll is exactly where it is fully visible — and the mark above it gives
   * way, which is the right thing to lose while someone is typing a password. Delayed a beat
   * because the room is made a frame or two after the keyboard reports.
   */
  useEffect(() => {
    const shown = Keyboard.addListener('keyboardDidShow', () => {
      setTimeout(() => scroll.current?.scrollToEnd({ animated: true }), 120);
    });
    return () => shown.remove();
  }, []);

  const canSubmit = email.trim().length > 0 && password.length > 0;

  const submit = () => {
    const trimmedEmail = email.trim();
    if (!canSubmit || busy) return;
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
      // On success nothing here changes: `AuthProvider`'s subscription sets the session, and
      // the gate above this component renders past it. The button keeps spinning until then,
      // which is the honest state for the half second it takes.
      if (result.error) {
        setBusy(false);
        setErrorKey(result.error);
      }
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

  const choose = (next: Mode) => {
    if (next === mode || busy) return;
    hapticLight();
    setMode(next);
    setErrorKey(null);
  };

  const backToSignIn = () => {
    setView('form');
    setMode('signIn');
    setErrorKey(null);
  };

  const error = errorKey ? (
    <Banner tone="warning">{t(AUTH_ERROR_I18N_KEY[errorKey] ?? AUTH_ERROR_I18N_KEY.unknown!)}</Banner>
  ) : null;

  return (
    <KeyboardSafe style={styles.screen}>
      <ScrollView
        ref={scroll}
        style={styles.screen}
        contentContainerStyle={[
          styles.content,
          { paddingTop: insets.top + spacing.xl, paddingBottom: insets.bottom + spacing.xl },
        ]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <Brand />

        <Rise order={3} style={styles.card}>
          {view === 'form' ? (
            <>
              <Tabs mode={mode} onChoose={choose} />

              {/* Keyed on the mode, so switching replays the entrance of what is inside the
                  card. The card itself is outside this and does not move. */}
              <FadeSlideIn key={mode} style={styles.body}>
                {mode === 'signUp' ? (
                  <View style={styles.progress}>
                    <View style={styles.track}>
                      <View style={[styles.fill, { width: `${100 / SETUP_TOTAL}%` }]} />
                    </View>
                    <Text style={styles.progressText}>
                      {t('setup.stepOf', { step: 1, total: SETUP_TOTAL })}
                    </Text>
                  </View>
                ) : null}

                <Text style={styles.subtitle}>
                  {mode === 'signIn' ? t('auth.subtitleSignIn') : t('auth.subtitle')}
                </Text>

                <Field
                  icon={EnvelopeSimple}
                  value={email}
                  onChangeText={setEmail}
                  placeholder={t('auth.emailPlaceholder')}
                  autoCapitalize="none"
                  autoCorrect={false}
                  autoComplete="email"
                  keyboardType="email-address"
                  editable={!busy}
                />
                <Field
                  icon={LockSimple}
                  value={password}
                  onChangeText={setPassword}
                  placeholder={t('auth.passwordPlaceholder')}
                  secureTextEntry={!showPassword}
                  autoCapitalize="none"
                  autoCorrect={false}
                  autoComplete={mode === 'signIn' ? 'current-password' : 'new-password'}
                  editable={!busy}
                  trailing={
                    <Pressable
                      onPress={() => setShowPassword((current) => !current)}
                      hitSlop={10}
                      accessibilityRole="button"
                      accessibilityLabel={t(showPassword ? 'auth.hidePassword' : 'auth.showPassword')}
                    >
                      {showPassword ? (
                        <EyeSlash size={20} color={colors.textMuted} />
                      ) : (
                        <Eye size={20} color={colors.textMuted} />
                      )}
                    </Pressable>
                  }
                />
                {mode === 'signUp' ? (
                  <Field
                    icon={LockSimple}
                    value={confirmPassword}
                    onChangeText={setConfirmPassword}
                    placeholder={t('auth.confirmPasswordPlaceholder')}
                    secureTextEntry={!showPassword}
                    autoCapitalize="none"
                    autoCorrect={false}
                    autoComplete="new-password"
                    editable={!busy}
                    onSubmitEditing={submit}
                  />
                ) : (
                  <Pressable
                    onPress={() => {
                      setForgotEmail(email);
                      setErrorKey(null);
                      setView('forgotPassword');
                    }}
                    hitSlop={8}
                    style={styles.forgot}
                  >
                    <Text style={styles.link}>{t('auth.forgotPassword')}</Text>
                  </Pressable>
                )}

                {error}

                <BrandButton
                  label={mode === 'signIn' ? t('auth.signIn') : t('auth.signUp')}
                  onPress={submit}
                  disabled={!canSubmit}
                  busy={busy}
                  style={styles.submit}
                />

                {mode === 'signUp' ? <Text style={styles.note}>{t('auth.signUpNext')}</Text> : null}
              </FadeSlideIn>
            </>
          ) : null}

          {view === 'forgotPassword' ? (
            <FadeSlideIn key="forgot" style={styles.body}>
              <Text style={styles.title}>{t('auth.resetPasswordTitle')}</Text>
              <Text style={styles.subtitle}>{t('auth.resetPasswordSubtitle')}</Text>

              <Field
                icon={EnvelopeSimple}
                value={forgotEmail}
                onChangeText={setForgotEmail}
                placeholder={t('auth.emailPlaceholder')}
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="email"
                keyboardType="email-address"
                editable={!busy}
                onSubmitEditing={submitForgotPassword}
              />

              {error}

              <BrandButton
                label={t('auth.resetPasswordSend')}
                onPress={submitForgotPassword}
                disabled={!forgotEmail.trim()}
                busy={busy}
                style={styles.submit}
              />

              <Pressable onPress={backToSignIn} hitSlop={8} style={styles.centredLink}>
                <Text style={styles.link}>{t('auth.backToSignIn')}</Text>
              </Pressable>
            </FadeSlideIn>
          ) : null}

          {view === 'resetEmailSent' ? (
            <FadeSlideIn key="sent" style={styles.body}>
              <Banner tone="info">{t('auth.resetEmailSent')}</Banner>
              <Pressable onPress={backToSignIn} hitSlop={8} style={styles.centredLink}>
                <Text style={styles.link}>{t('auth.backToSignIn')}</Text>
              </Pressable>
            </FadeSlideIn>
          ) : null}
        </Rise>
      </ScrollView>
    </KeyboardSafe>
  );
}

/* -------------------------------------------------------------------------- */
/* The mark and the name                                                       */
/* -------------------------------------------------------------------------- */

/**
 * The logo, with a slow halo behind it, and the name and the line under it.
 *
 * The halo breathes for as long as the screen is up — a still logo on a still screen looks
 * like a picture of an app rather than one. It is a separate view behind the logo, scaled and
 * faded natively, so the logo itself never moves once it has arrived.
 */
function Brand() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const reduceMotion = useReduceMotion();
  const breathe = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (reduceMotion) return;
    const breathing = Animated.loop(
      Animated.sequence([
        Animated.timing(breathe, {
          toValue: 1,
          duration: 2200,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.timing(breathe, {
          toValue: 0,
          duration: 2200,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
      ]),
    );
    breathing.start();
    return () => breathing.stop();
  }, [breathe, reduceMotion]);

  return (
    <View style={styles.brand}>
      <Rise order={0} spring style={styles.markWrap}>
        <Animated.View
          style={[
            styles.halo,
            {
              opacity: breathe.interpolate({ inputRange: [0, 1], outputRange: [0.55, 0.15] }),
              transform: [
                { scale: breathe.interpolate({ inputRange: [0, 1], outputRange: [1, 1.28] }) },
              ],
            },
          ]}
        />
        <View style={styles.markShadow}>
          <Image source={appIcon} style={styles.mark} accessibilityIgnoresInvertColors />
        </View>
      </Rise>

      <Rise order={1}>
        <Text style={styles.name} accessibilityRole="header">
          {t('common.appName')}
        </Text>
      </Rise>
      <Rise order={2}>
        <Text style={styles.slogan}>{t('common.slogan')}</Text>
      </Rise>
    </View>
  );
}

/**
 * One piece of the entrance: it fades in and rises, `order` places behind the first.
 *
 * Waits for the launch splash to lift before starting. The splash sits over everything for its
 * first couple of seconds, and an entrance played underneath it is an entrance nobody saw —
 * the screen would simply be there, finished, when the splash left.
 */
function Rise({
  order,
  spring = false,
  style,
  children,
}: {
  order: number;
  /** For the logo: arrives with a small overshoot instead of easing to a stop. */
  spring?: boolean;
  style?: ViewStyle;
  children: ReactNode;
}) {
  const reduceMotion = useReduceMotion();
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (reduceMotion) {
      progress.setValue(1);
      return;
    }
    const delay = splashTimeLeft() + order * 110;
    const animation = spring
      ? Animated.spring(progress, {
          toValue: 1,
          friction: 6,
          tension: 60,
          delay,
          useNativeDriver: true,
        })
      : Animated.timing(progress, {
          toValue: 1,
          duration: duration.slow + 120,
          delay,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        });
    animation.start();
    return () => animation.stop();
  }, [progress, order, spring, reduceMotion]);

  return (
    <Animated.View
      style={[
        style,
        {
          opacity: progress,
          transform: spring
            ? [{ scale: progress.interpolate({ inputRange: [0, 1], outputRange: [0.7, 1] }) }]
            : [{ translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [18, 0] }) }],
        },
      ]}
    >
      {children}
    </Animated.View>
  );
}

/* -------------------------------------------------------------------------- */
/* Tabs                                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Sign in / sign up, as two halves of one control.
 *
 * Each half has its own highlight, and the two cross-fade: one opacity value, read forwards by
 * one and backwards by the other. See the note at the top of the file for why it is not a pill
 * sliding from one to the other.
 */
function Tabs({ mode, onChoose }: { mode: Mode; onChoose: (next: Mode) => void }) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const position = useRef(new Animated.Value(mode === 'signUp' ? 1 : 0)).current;

  useEffect(() => {
    Animated.timing(position, {
      toValue: mode === 'signUp' ? 1 : 0,
      duration: duration.normal,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [position, mode]);

  const tab = (value: Mode, label: string, opacity: Animated.AnimatedInterpolation<number>) => (
    <Pressable
      onPress={() => onChoose(value)}
      accessibilityRole="tab"
      accessibilityState={{ selected: mode === value }}
      style={styles.tab}
    >
      <Animated.View style={[styles.tabOn, { opacity }]} />
      <Text style={[styles.tabText, mode === value && styles.tabTextOn]}>{label}</Text>
    </Pressable>
  );

  return (
    <View style={styles.tabs} accessibilityRole="tablist">
      {tab(
        'signIn',
        t('auth.tabSignIn'),
        position.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }),
      )}
      {tab('signUp', t('auth.tabSignUp'), position)}
    </View>
  );
}

const MARK = 96;
/** How much wider than the logo the halo behind it is, at rest. */
const HALO_SPREAD = 28;

const createStyles = (colors: ColorPalette) =>
  StyleSheet.create<{
    screen: ViewStyle;
    content: ViewStyle;
    brand: ViewStyle;
    markWrap: ViewStyle;
    halo: ViewStyle;
    markShadow: ViewStyle;
    mark: ImageStyle;
    name: TextStyle;
    slogan: TextStyle;
    card: ViewStyle;
    body: ViewStyle;
    tabs: ViewStyle;
    tab: ViewStyle;
    tabOn: ViewStyle;
    tabText: TextStyle;
    tabTextOn: TextStyle;
    progress: ViewStyle;
    track: ViewStyle;
    fill: ViewStyle;
    progressText: TextStyle;
    title: TextStyle;
    subtitle: TextStyle;
    forgot: ViewStyle;
    centredLink: ViewStyle;
    link: TextStyle;
    submit: ViewStyle;
    note: TextStyle;
  }>({
    // No fill: this is exactly where the gradient the whole app sits on is meant to show.
    screen: { flex: 1 },
    // Centred when it fits, scrollable when the keyboard takes half the screen.
    content: {
      flexGrow: 1,
      justifyContent: 'center',
      paddingHorizontal: spacing.xl,
      gap: spacing.xxl,
    },

    brand: { alignItems: 'center', gap: spacing.sm },
    markWrap: {
      width: MARK,
      height: MARK,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: spacing.md,
    },
    // Placed by its own offsets rather than left to the wrapper's centring: where an absolute
    // child lands when it is given none has changed between layout-engine versions before.
    halo: {
      position: 'absolute',
      top: -HALO_SPREAD / 2,
      start: -HALO_SPREAD / 2,
      width: MARK + HALO_SPREAD,
      height: MARK + HALO_SPREAD,
      borderRadius: 38,
      backgroundColor: colors.accentBorder,
    },
    // On a plain view around the image, because an image clipped to rounded corners cannot
    // also cast the shadow of those corners.
    markShadow: {
      borderRadius: 26,
      backgroundColor: colors.surface,
      ...shadow(colors.accent).hero,
    },
    mark: { width: MARK, height: MARK, borderRadius: 26 },
    name: {
      color: colors.accent,
      fontSize: 36,
      fontWeight: fontWeight.bold,
      letterSpacing: 0.4,
      textAlign: 'center',
    },
    slogan: { color: colors.textMuted, fontSize: fontSize.md, textAlign: 'center' },

    card: {
      backgroundColor: colors.surface,
      borderRadius: radius.xl,
      padding: spacing.lg,
      gap: spacing.lg,
      ...shadow(colors.shadow).hero,
    },
    body: { gap: spacing.md },

    tabs: {
      flexDirection: 'row',
      backgroundColor: colors.surfaceRaised,
      borderRadius: radius.lg,
      padding: spacing.xs,
      gap: spacing.xs,
    },
    tab: {
      flex: 1,
      minHeight: 42,
      borderRadius: radius.md,
      alignItems: 'center',
      justifyContent: 'center',
    },
    tabOn: {
      ...StyleSheet.absoluteFillObject,
      borderRadius: radius.md,
      backgroundColor: colors.surface,
      ...shadow(colors.shadow).card,
    },
    tabText: { color: colors.textMuted, fontSize: fontSize.sm, fontWeight: fontWeight.medium },
    tabTextOn: { color: colors.accent, fontWeight: fontWeight.bold },

    progress: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
    track: {
      flex: 1,
      height: 6,
      borderRadius: radius.pill,
      backgroundColor: colors.surfaceHigh,
      overflow: 'hidden',
    },
    fill: { height: '100%', borderRadius: radius.pill, backgroundColor: colors.accent },
    progressText: {
      color: colors.textMuted,
      fontSize: fontSize.xs,
      fontVariant: ['tabular-nums'],
    },

    title: {
      color: colors.text,
      fontSize: fontSize.lg,
      fontWeight: fontWeight.bold,
      textAlign: 'auto',
    },
    subtitle: { color: colors.textMuted, fontSize: fontSize.sm, lineHeight: 20, textAlign: 'auto' },

    forgot: { alignSelf: 'flex-end', paddingVertical: spacing.xs },
    centredLink: { alignSelf: 'center', padding: spacing.sm },
    link: { color: colors.accent, fontSize: fontSize.sm, fontWeight: fontWeight.medium },
    submit: { marginTop: spacing.xs },
    note: { color: colors.textFaint, fontSize: fontSize.xs, lineHeight: 18, textAlign: 'center' },
  });
