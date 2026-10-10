/**
 * The door: "welcome back", a fingerprint, and a way in for someone else.
 *
 * Shown by `LockGate` in place of the app when it is opened by someone already signed in, and
 * over the app when it is come back to after a while. What decides either is `lockPolicy.ts`.
 *
 * ## What it does
 *
 * It asks for the fingerprint by itself, once, as soon as it is on screen — the person opening
 * the app already has their finger near the sensor, and making them press a button to be asked
 * is a step that buys nothing. If they close the prompt, the screen stays and the button asks
 * again. The second button signs the account out, which is the way in for anyone whose
 * fingerprint is not on this phone, the owner with wet hands included: it leads to the ordinary
 * sign-in screen, and signing in there is not followed by this one.
 *
 * It signs out at once, without the "are you sure?" that signing out has everywhere else in
 * the app. The owner asked for that, and here it is the right call: the button says what it
 * does, there is nothing on this screen to lose, and whoever presses it is by definition about
 * to type a password anyway. Nothing is lost by it either — what has not synced yet stays on
 * the phone under this account and goes up the next time it signs in.
 *
 * ## How it looks
 *
 * The sign-in screen's own vocabulary: the same halo, breathing behind an emblem; the same
 * entrance, one piece after another once the launch splash has lifted; the same button. It is
 * the same moment — standing in front of the app — and should not look like a different
 * product.
 *
 * Opacity and transforms only, all native-driven, each on a view of its own. See CLAUDE.md.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Animated,
  Easing,
  Pressable,
  StyleSheet,
  Text,
  View,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { Fingerprint, ScanSmiley } from 'phosphor-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BrandButton } from '../components/BrandButton.js';
import { useReduceMotion } from '../components/motion.js';
import { Rise } from '../components/Rise.js';
import { splashTimeLeft } from '../components/SplashOverlay.js';
import { getProfile } from '../db/metrics.js';
import { getExecutor } from '../db/provider.js';
import { hapticLight } from '../haptics.js';
import { useTheme } from '../ThemeProvider.js';
import { fontSize, fontWeight, radius, shadow, spacing, type ColorPalette } from '../theme.js';
import { LOCK_READS, unlockWithBiometrics } from './appLock.js';
import { useAuth } from './AuthProvider.js';
import { lockGreetingName, type UnlockFailure } from './lockPolicy.js';

/** After the entrance has had time to be seen, and not before. */
const ASK_AFTER_MS = 650;

export function LockScreen({
  userId,
  onUnlocked,
  solid = false,
}: {
  userId: string;
  onUnlocked: () => void;
  /**
   * Paint its own background. Over the running app it is the only thing between the app and
   * the eye; in place of the app, at launch, the gradient the whole app sits on is behind it
   * and is meant to show.
   */
  solid?: boolean;
}) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const insets = useSafeAreaInsets();
  const { session, signOut } = useAuth();
  const [leaving, setLeaving] = useState(false);

  const [asking, setAsking] = useState(false);
  const [trouble, setTrouble] = useState<Exclude<UnlockFailure, 'cancelled'> | null>(null);
  const [name, setName] = useState(() => lockGreetingName(null, session?.user.email));

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const profile = await getProfile(await getExecutor(), userId);
        if (!cancelled) setName(lockGreetingName(profile?.display_name, session?.user.email));
      } catch {
        // The address is name enough.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [userId, session?.user.email]);

  // A ref beside the state: two prompts cannot be up at once, and the automatic ask and a
  // quick thumb on the button can otherwise both get past a flag that has not re-rendered yet.
  const busy = useRef(false);
  const ask = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    setAsking(true);
    setTrouble(null);
    const outcome = await unlockWithBiometrics(t('lock.prompt'));
    busy.current = false;
    setAsking(false);
    // No fingerprint left on the phone to ask for. A door its owner cannot open is not a lock.
    if (outcome === 'unlocked' || outcome === 'unavailable') onUnlocked();
    else if (outcome !== 'cancelled') setTrouble(outcome);
  }, [onUnlocked, t]);

  useEffect(() => {
    const timer = setTimeout(() => void ask(), splashTimeLeft() + ASK_AFTER_MS);
    return () => clearTimeout(timer);
    // Once, when the screen appears. `ask` changes identity with the language and must not
    // put the prompt up again by doing so.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <View
      style={[
        styles.screen,
        solid && styles.solid,
        { paddingTop: insets.top + spacing.xl, paddingBottom: insets.bottom + spacing.xl },
      ]}
    >
      <Rise order={0}>
        <Text style={styles.wordmark}>{t('common.appName')}</Text>
      </Rise>

      <View style={styles.centre}>
        <Emblem />

        <Rise order={1}>
          <Text style={styles.title} accessibilityRole="header">
            {t('lock.welcomeBack')}
          </Text>
        </Rise>
        {name ? (
          <Rise order={2}>
            <Text style={styles.name} numberOfLines={1}>
              {name}
            </Text>
          </Rise>
        ) : null}

        <Rise order={3} style={styles.actions}>
          <BrandButton
            label={t(LOCK_READS === 'face' ? 'lock.unlockFace' : 'lock.unlock')}
            onPress={() => void ask()}
            busy={asking}
          />
          <Pressable
            onPress={() => {
              hapticLight();
              setLeaving(true);
              // Straight to the sign-in screen: the gate above swaps this screen for it the
              // moment the session is gone. With no connection the server cannot be told and
              // the session stays, so the button is given back rather than left dead.
              void signOut()
                .catch(() => undefined)
                .finally(() => setLeaving(false));
            }}
            disabled={leaving}
            accessibilityRole="button"
            style={({ pressed }) => [styles.other, (pressed || leaving) && styles.otherPressed]}
          >
            <Text style={styles.otherText}>{t('lock.otherUser')}</Text>
          </Pressable>
          {/* Always a line tall, so a message arriving does not push the buttons about. */}
          <Text style={styles.trouble} accessibilityLiveRegion="polite">
            {trouble
              ? t(
                  trouble === 'locked_out'
                    ? 'lock.lockedOut'
                    : LOCK_READS === 'face'
                      ? 'lock.failedFace'
                      : 'lock.failed',
                )
              : ' '}
          </Text>
        </Rise>
      </View>
    </View>
  );
}

/**
 * The fingerprint, in a disc, with the sign-in screen's halo breathing behind it.
 *
 * The halo is a separate view, scaled and faded natively, so the disc itself never moves once
 * it has arrived.
 */
function Emblem() {
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
    <Rise order={0} spring style={styles.emblemWrap}>
      <Animated.View
        style={[
          styles.halo,
          {
            opacity: breathe.interpolate({ inputRange: [0, 1], outputRange: [0.55, 0.15] }),
            transform: [
              { scale: breathe.interpolate({ inputRange: [0, 1], outputRange: [1, 1.22] }) },
            ],
          },
        ]}
      />
      <View style={styles.disc}>
        {LOCK_READS === 'face' ? (
          <ScanSmiley size={58} color={colors.accent} weight="regular" />
        ) : (
          <Fingerprint size={58} color={colors.accent} weight="regular" />
        )}
      </View>
    </Rise>
  );
}

const DISC = 116;
/** How much wider than the disc the halo behind it is, at rest. */
const HALO_SPREAD = 30;

const createStyles = (colors: ColorPalette) =>
  StyleSheet.create<{
    screen: ViewStyle;
    solid: ViewStyle;
    wordmark: TextStyle;
    centre: ViewStyle;
    emblemWrap: ViewStyle;
    halo: ViewStyle;
    disc: ViewStyle;
    title: TextStyle;
    name: TextStyle;
    actions: ViewStyle;
    other: ViewStyle;
    otherPressed: ViewStyle;
    otherText: TextStyle;
    trouble: TextStyle;
  }>({
    // No fill unless asked: at launch this is where the app's own gradient is meant to show.
    screen: { flex: 1, paddingHorizontal: spacing.xl },
    solid: { backgroundColor: colors.bg },
    wordmark: {
      color: colors.accent,
      fontSize: fontSize.xl,
      fontWeight: fontWeight.bold,
      letterSpacing: 0.4,
      textAlign: 'center',
    },
    centre: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.sm },

    emblemWrap: {
      width: DISC,
      height: DISC,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: spacing.xl,
    },
    // Placed by its own offsets rather than left to the wrapper's centring, as on the sign-in
    // screen: where an absolute child lands when given none has changed between versions.
    halo: {
      position: 'absolute',
      top: -HALO_SPREAD / 2,
      start: -HALO_SPREAD / 2,
      width: DISC + HALO_SPREAD,
      height: DISC + HALO_SPREAD,
      borderRadius: (DISC + HALO_SPREAD) / 2,
      backgroundColor: colors.accentBorder,
    },
    disc: {
      width: DISC,
      height: DISC,
      borderRadius: DISC / 2,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.accentBorder,
      ...shadow(colors.accent).hero,
    },

    title: {
      color: colors.text,
      fontSize: 30,
      fontWeight: fontWeight.bold,
      textAlign: 'center',
    },
    name: { color: colors.textMuted, fontSize: fontSize.lg, textAlign: 'center' },

    actions: { alignSelf: 'stretch', gap: spacing.md, marginTop: spacing.xxl },
    // The quieter of the two: an outline the same shape and height as the button above it.
    other: {
      minHeight: 54,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: colors.border,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: spacing.lg,
    },
    otherPressed: { opacity: 0.6 },
    otherText: { color: colors.textMuted, fontSize: fontSize.md, fontWeight: fontWeight.medium },
    trouble: { color: colors.danger, fontSize: fontSize.sm, textAlign: 'center' },
  });
