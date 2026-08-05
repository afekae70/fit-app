/**
 * The rest countdown that appears when a set is ticked off.
 *
 * Two design decisions carry this component:
 *
 * **It counts from a deadline, not a tick counter.** The interval only decides when to
 * re-render; the number shown is always `deadline - now`. A counter decremented once a second
 * drifts, and — worse — stops entirely when the OS suspends timers with the phone in a pocket
 * between sets, which is exactly when this timer is running. Coming back to a rest timer frozen
 * at 0:47 after two minutes away would be worse than having none.
 *
 * **Progress reads as a bar, not a ring.** The prototype draws an SVG arc; `react-native-svg`
 * is a native module that would strand the installed app on old JS (see CLAUDE.md), and the
 * usual pure-View substitute — two half-discs rotating over a disc — depends on transform
 * origins and clipping behaving identically on both platforms. A bar cannot misrender, and the
 * countdown itself is carried by the number, which is what people actually read.
 *
 * The prototype hides the finish bar while resting; the caller does that by checking `visible`.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
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

import { hapticSuccess } from '../haptics.js';
import { DEFAULT_REST_SECONDS, formatRest, restFraction } from './restTime.js';
import { useTheme } from '../ThemeProvider.js';
import { fontSize, fontWeight, radius, spacing, type ColorPalette } from '../theme.js';

const RING = 48;

export { DEFAULT_REST_SECONDS } from './restTime.js';

export interface RestTimerProps {
  /** Epoch ms the rest ends at, or null when not resting. */
  deadline: number | null;
  /** Total seconds this rest was set to, so the ring knows what fraction remains. */
  totalSeconds: number;
  /** What comes next, e.g. "Bench Press · set 3". */
  nextLabel: string;
  onAddTime: () => void;
  onSkip: () => void;
  onFinished: () => void;
}

export function RestTimer({
  deadline,
  totalSeconds,
  nextLabel,
  onAddTime,
  onSkip,
  onFinished,
}: RestTimerProps) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const [remaining, setRemaining] = useState(0);
  const entrance = useRef(new Animated.Value(0)).current;
  const firedFor = useRef<number | null>(null);

  useEffect(() => {
    if (deadline === null) return;
    firedFor.current = null;

    const update = () => {
      const left = (deadline - Date.now()) / 1000;
      setRemaining(left);
      // Guarded by deadline so a re-render cannot fire the buzz twice for one rest.
      if (left <= 0 && firedFor.current !== deadline) {
        firedFor.current = deadline;
        hapticSuccess();
        onFinished();
      }
    };

    update();
    const id = setInterval(update, 250);
    return () => clearInterval(id);
    // `onFinished` is a fresh closure each render; re-running would restart the interval on
    // every parent render. The deadline is the only thing that should restart it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deadline]);

  useEffect(() => {
    Animated.timing(entrance, {
      toValue: deadline === null ? 0 : 1,
      duration: 240,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [deadline, entrance]);

  if (deadline === null) return null;

  const fraction = restFraction(remaining, totalSeconds);
  // The ring empties as time runs out, so the sweep is over the *elapsed* portion.
  const elapsedDeg = (1 - fraction) * 360;

  return (
    <Animated.View
      style={[
        styles.bar,
        {
          opacity: entrance,
          transform: [
            { translateY: entrance.interpolate({ inputRange: [0, 1], outputRange: [12, 0] }) },
          ],
        },
      ]}
    >
      <View style={styles.ring}>
        <Text style={styles.ringLabel}>{formatRest(remaining)}</Text>
      </View>

      <View style={styles.main}>
        <Text style={styles.title}>{t('workout.resting')}</Text>
        <Text style={styles.next} numberOfLines={1}>
          {t('workout.restNext')}: {nextLabel}
        </Text>
        <View style={styles.track}>
          <View style={[styles.fill, { width: `${Math.round(fraction * 100)}%` }]} />
        </View>
      </View>

      <Pressable onPress={onAddTime} style={styles.addBtn} accessibilityRole="button">
        <Text style={styles.addText}>{t('workout.restAdd')}</Text>
      </Pressable>
      <Pressable onPress={onSkip} style={styles.skipBtn} accessibilityRole="button">
        <Text style={styles.skipText}>{t('workout.restSkip')}</Text>
      </Pressable>
    </Animated.View>
  );
}

const createStyles = (colors: ColorPalette) =>
  StyleSheet.create<{
    bar: ViewStyle;
    ring: ViewStyle;
    ringLabel: TextStyle;
    main: ViewStyle;
    title: TextStyle;
    next: TextStyle;
    track: ViewStyle;
    fill: ViewStyle;
    addBtn: ViewStyle;
    addText: TextStyle;
    skipBtn: ViewStyle;
    skipText: TextStyle;
  }>({
    bar: {
      position: 'absolute',
      left: 0,
      right: 0,
      bottom: 0,
      zIndex: 5,
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      paddingVertical: spacing.md,
      paddingHorizontal: spacing.lg,
      backgroundColor: colors.surface,
      borderTopWidth: 1,
      borderTopColor: colors.accentBorder,
    },
    ring: {
      width: RING,
      height: RING,
      borderRadius: RING / 2,
      borderWidth: 2,
      borderColor: colors.accentBorder,
      backgroundColor: colors.accentSoft,
      alignItems: 'center',
      justifyContent: 'center',
    },
    ringLabel: {
      color: colors.accent,
      fontSize: fontSize.xs,
      fontWeight: fontWeight.bold,
    },
    main: { flex: 1, gap: 2 },
    title: { color: colors.text, fontSize: fontSize.sm, fontWeight: fontWeight.medium, textAlign: 'auto' },
    next: { color: colors.textFaint, fontSize: fontSize.xs, textAlign: 'auto' },
    track: {
      height: 3,
      marginTop: 4,
      borderRadius: 2,
      backgroundColor: colors.bg,
      overflow: 'hidden',
    },
    fill: { height: '100%', backgroundColor: colors.accent, borderRadius: 2 },
    addBtn: {
      minHeight: 44,
      justifyContent: 'center',
      paddingHorizontal: spacing.md,
      borderRadius: radius.sm,
      borderWidth: 1,
      borderColor: colors.borderStrong,
    },
    addText: { color: colors.text, fontSize: fontSize.xs },
    skipBtn: {
      minHeight: 44,
      justifyContent: 'center',
      paddingHorizontal: spacing.lg,
      borderRadius: radius.sm,
      borderWidth: 1,
      borderColor: colors.accent,
      backgroundColor: colors.accentSoft,
    },
    skipText: { color: colors.accent, fontSize: fontSize.xs, fontWeight: fontWeight.bold },
  });
