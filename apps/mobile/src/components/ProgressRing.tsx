/**
 * A ring that fills to a fraction, with whatever the number means written inside it.
 *
 * A bar says "this much of the way along"; a ring says "this much of a thing" — a week's
 * workouts, a day's target — and reads at a glance from arm's length, which is the distance a
 * phone is held at between sets.
 *
 * The sweep animates on the way in and whenever the fraction changes, because unlike a counting
 * number this is the change itself: finishing a workout should visibly move the ring. It is
 * JS-driven — a stroke offset is not a transform and the native driver cannot carry it — and
 * that is affordable for one ring on a screen.
 *
 * Starts at twelve o'clock and sweeps clockwise in every language. A ring is a clock face, not
 * a sentence, and mirroring it in Hebrew would make it run backwards.
 */

import { useEffect, useMemo, useRef, type ReactNode } from 'react';
import { Animated, StyleSheet, View, type ViewStyle } from 'react-native';
import Svg, { Circle, G } from 'react-native-svg';

import { useTheme } from '../ThemeProvider.js';
import { duration } from '../theme.js';

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

export function ProgressRing({
  fraction,
  size = 84,
  thickness = 9,
  color,
  trackColor,
  children,
  style,
}: {
  /** 0–1. Anything outside is clamped, so a fifth workout in a four-workout week fills the ring. */
  fraction: number;
  size?: number;
  thickness?: number;
  color?: string;
  trackColor?: string;
  /** What goes in the middle — usually the number the ring is about. */
  children?: ReactNode;
  style?: ViewStyle;
}) {
  const { colors } = useTheme();
  const clamped = Math.max(0, Math.min(1, Number.isFinite(fraction) ? fraction : 0));

  const radius = (size - thickness) / 2;
  const circumference = useMemo(() => 2 * Math.PI * radius, [radius]);

  const swept = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(swept, {
      toValue: clamped,
      duration: duration.slow,
      useNativeDriver: false,
    }).start();
  }, [clamped, swept]);

  const offset = swept.interpolate({
    inputRange: [0, 1],
    outputRange: [circumference, 0],
  });

  return (
    <View style={[{ width: size, height: size }, style]}>
      <Svg width={size} height={size}>
        {/* Rotated so the sweep begins at the top rather than at three o'clock. */}
        <G rotation={-90} origin={`${size / 2}, ${size / 2}`}>
          <Circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            stroke={trackColor ?? colors.surfaceRaised}
            strokeWidth={thickness}
            fill="none"
          />
          <AnimatedCircle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            stroke={color ?? colors.accent}
            strokeWidth={thickness}
            strokeLinecap="round"
            fill="none"
            strokeDasharray={`${circumference}, ${circumference}`}
            strokeDashoffset={offset}
          />
        </G>
      </Svg>
      <View style={styles.middle} pointerEvents="none">
        {children}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  middle: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
});
