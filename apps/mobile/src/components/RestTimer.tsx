/**
 * Rest countdown between sets.
 *
 * This is deliberately not the running session clock the workout screen refuses to show. That
 * decision was about a timer counting UP over the whole workout, which pressures you to cut
 * rest short and rush. This counts DOWN toward the rest the plan actually asked for, so it
 * pushes the other way — the common failure in a hypertrophy block is resting ninety seconds
 * when the programme said three minutes, not the reverse.
 *
 * It is anchored to a wall-clock timestamp rather than to a decrementing counter. A phone goes
 * in a pocket between sets, JS timers are throttled or stopped while backgrounded, and a
 * counter that stops ticking would come back claiming two minutes of rest remained after four
 * minutes had passed.
 */

import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AppState, Pressable, StyleSheet, Text, View, type TextStyle, type ViewStyle } from 'react-native';
import Animated, {
  Easing,
  FadeInDown,
  FadeOutDown,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { formatCountdown, remainingSeconds } from '../rest.js';
import { colors, fontSize, fontWeight, radius, spacing } from '../theme.js';

export interface RestTimerProps {
  /** Wall-clock end of the rest period, or null when nothing is running. */
  endsAt: number | null;
  /** The full rest length, used for the progress bar's starting width. */
  totalSeconds: number;
  onExtend: (seconds: number) => void;
  onDismiss: () => void;
}

export function RestTimer({ endsAt, totalSeconds, onExtend, onDismiss }: RestTimerProps) {
  const { t } = useTranslation();
  const [remaining, setRemaining] = useState(0);
  const progress = useSharedValue(0);

  // Kept in a ref so the AppState listener can read the current deadline without being torn
  // down and re-subscribed every time the timer is extended.
  const endsAtRef = useRef(endsAt);
  endsAtRef.current = endsAt;

  useEffect(() => {
    if (endsAt === null) {
      progress.value = 0;
      return;
    }

    const sync = () => {
      const left = remainingSeconds(endsAt, Date.now());
      setRemaining(left);
      return left;
    };

    sync();

    // The bar animates on the UI thread for the whole remaining span rather than being stepped
    // by the tick below: a bar redrawn 4 times a second visibly stutters next to text that is
    // only meant to change once a second.
    const remainingMs = Math.max(0, endsAt - Date.now());
    progress.value = Math.min(1, remainingMs / Math.max(1, totalSeconds * 1000));
    progress.value = withTiming(0, { duration: remainingMs, easing: Easing.linear });

    const interval = setInterval(sync, 250);

    // Coming back from the background re-reads the clock instead of trusting the interval,
    // and restarts the bar from wherever the deadline actually is now.
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return;
      const deadline = endsAtRef.current;
      if (deadline === null) return;
      sync();
      const leftMs = Math.max(0, deadline - Date.now());
      progress.value = Math.min(1, leftMs / Math.max(1, totalSeconds * 1000));
      progress.value = withTiming(0, { duration: leftMs, easing: Easing.linear });
    });

    return () => {
      clearInterval(interval);
      subscription.remove();
    };
  }, [endsAt, totalSeconds, progress]);

  const barStyle = useAnimatedStyle(() => ({ width: `${progress.value * 100}%` }));

  if (endsAt === null) return null;

  const done = remaining === 0;

  return (
    <Animated.View
      entering={FadeInDown.duration(200)}
      exiting={FadeOutDown.duration(160)}
      style={[styles.bar, done && styles.barDone]}
    >
      <View style={styles.track}>
        <Animated.View style={[styles.fill, barStyle]} />
      </View>

      <View style={styles.row}>
        <View style={styles.main}>
          <Text style={[styles.label, done && styles.labelDone]}>
            {done ? t('rest.done') : t('rest.title')}
          </Text>
          <Text style={[styles.countdown, done && styles.countdownDone]}>
            {formatCountdown(remaining)}
          </Text>
        </View>

        {/* Extending is offered rather than a full reset: needing another half minute is the
            normal case on a heavy top set, and re-deriving it from the plan would overshoot. */}
        <Pressable
          onPress={() => onExtend(30)}
          accessibilityRole="button"
          style={styles.action}
          hitSlop={8}
        >
          <Text style={styles.actionText}>+30{t('plan.restSeconds')}</Text>
        </Pressable>

        <Pressable
          onPress={onDismiss}
          accessibilityRole="button"
          accessibilityLabel={t('rest.skip')}
          style={styles.action}
          hitSlop={8}
        >
          <Text style={styles.actionText}>{done ? t('common.done') : t('rest.skip')}</Text>
        </Pressable>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create<{
  bar: ViewStyle;
  barDone: ViewStyle;
  track: ViewStyle;
  fill: ViewStyle;
  row: ViewStyle;
  main: ViewStyle;
  label: TextStyle;
  labelDone: TextStyle;
  countdown: TextStyle;
  countdownDone: TextStyle;
  action: ViewStyle;
  actionText: TextStyle;
}>({
  bar: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
    marginBottom: spacing.sm,
  },
  barDone: { borderColor: colors.accentBorder, backgroundColor: colors.accentSoft },
  track: { height: 3, backgroundColor: colors.border },
  fill: { height: 3, backgroundColor: colors.accent },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    gap: spacing.md,
  },
  main: { flex: 1 },
  label: { color: colors.textMuted, fontSize: fontSize.xxs, textAlign: 'auto' },
  labelDone: { color: colors.accent },
  countdown: {
    color: colors.text,
    fontSize: fontSize.lg,
    fontWeight: fontWeight.bold,
    // Tabular-ish: the countdown must not jitter horizontally as digits change.
    fontVariant: ['tabular-nums'],
    textAlign: 'auto',
  },
  countdownDone: { color: colors.accent },
  action: { paddingVertical: spacing.xs, paddingHorizontal: spacing.sm },
  actionText: { color: colors.textSecondary, fontSize: fontSize.xs, fontWeight: fontWeight.medium },
});
