/**
 * A floating "new PR" toast, mounted from the active-workout screen whenever a logged set beats
 * every prior session's best for that exercise (`getPreviousBest` in workouts.ts). It auto-
 * dismisses on its own timer so it never sits in the way of logging the next set.
 *
 * Single driver mode for its whole life (native) — see ui.tsx's SegmentButton for why mixing
 * native- and JS-driven animations on one node is a hard crash, not just a warning.
 */

import { useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Animated, Easing, StyleSheet, Text, type TextStyle, type ViewStyle } from 'react-native';

import { useTheme } from '../ThemeProvider.js';
import { useUnit } from '../UnitsProvider.js';
import { kgToDisplay } from '../units.js';
import { fontSize, fontWeight, radius, spacing, type ColorPalette } from '../theme.js';

export interface PrToastData {
  exerciseLabel: string;
  weightKg: number;
  reps: number;
}

// The handoff's numbers. 2600ms is long enough to read an exercise name and a weight without
// becoming something you wait out — and there is deliberately no confetti and no full-screen
// takeover, because a PR happens mid-workout with a bar still to rack.
const VISIBLE_MS = 2600;
const ENTER_MS = 300;
const EXIT_MS = 220;

export function PrToast({ data, onDone }: { data: PrToastData | null; onDone: () => void }) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const unit = useUnit();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const anim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!data) return;
    anim.setValue(0);
    const sequence = Animated.sequence([
      Animated.timing(anim, {
        toValue: 1,
        duration: ENTER_MS,
        // The handoff's curve: a fast start that settles rather than bounces. A spring overshoot
        // here read as celebratory in a way the rest of this palette is not.
        easing: Easing.bezier(0.22, 1, 0.36, 1),
        useNativeDriver: true,
      }),
      Animated.delay(VISIBLE_MS),
      Animated.timing(anim, {
        toValue: 0,
        duration: EXIT_MS,
        easing: Easing.in(Easing.cubic),
        useNativeDriver: true,
      }),
    ]);
    sequence.start(({ finished }) => {
      if (finished) onDone();
    });
    return () => sequence.stop();
    // `onDone` is a fresh closure each render; re-running this effect on every keystroke would
    // restart the toast mid-animation. It only needs to run when a new PR arrives.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, anim]);

  if (!data) return null;

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.toast,
        {
          opacity: anim,
          transform: [
            { translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [-14, 0] }) },
            { scale: anim.interpolate({ inputRange: [0, 1], outputRange: [0.94, 1] }) },
          ],
        },
      ]}
    >
      <Text style={styles.emoji}>🏆</Text>
      <Text style={styles.text} numberOfLines={1}>
        {t('workout.newPr')} {data.exerciseLabel} {kgToDisplay(data.weightKg, unit)}×{data.reps}
      </Text>
    </Animated.View>
  );
}

const createStyles = (colors: ColorPalette) =>
  StyleSheet.create<{
    toast: ViewStyle;
    emoji: TextStyle;
    text: TextStyle;
  }>({
    toast: {
      position: 'absolute',
      top: spacing.sm,
      left: spacing.lg,
      right: spacing.lg,
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      backgroundColor: colors.accentSoft,
      borderWidth: 1,
      borderColor: colors.accent,
      borderRadius: radius.pill,
      paddingVertical: spacing.sm,
      paddingHorizontal: spacing.lg,
      zIndex: 10,
    },
    emoji: { fontSize: fontSize.lg },
    text: {
      flex: 1,
      color: colors.accent,
      fontSize: fontSize.sm,
      fontWeight: fontWeight.bold,
      textAlign: 'auto',
    },
  });
