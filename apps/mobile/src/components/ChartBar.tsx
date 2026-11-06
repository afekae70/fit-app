/**
 * One bar of a bar chart: a soft gradient that grows up from the baseline when it appears.
 *
 * The app's charts were flat blocks that were simply there when the screen opened. Two things
 * are added, and both are about reading the chart rather than decorating it:
 *
 *  - **It grows in**, each bar a beat after the one before. The eye follows the sweep along
 *    the timeline, which is the direction the chart is meant to be read in.
 *  - **It can be told apart from its neighbours.** `dimmed` fades a bar while a finger is on
 *    another one, so the bar being read is the only one at full strength.
 *
 * ## One driver
 *
 * The growth is `scaleY` about the bottom edge, on the native driver: a transform, so nothing
 * is laid out again on any frame. Dimming is plain opacity on a *separate, unanimated* node
 * around it — see CLAUDE.md for what happens when a JS-driven value and a native-driven one
 * meet on the same node.
 *
 * Scaling squashes the rounded top while it grows. That lasts a quarter of a second and reads
 * as the bar being drawn; animating `height` instead would relayout the whole chart per frame.
 */

import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';

import { useTheme } from '../ThemeProvider.js';
import { duration, radius, stagger } from '../theme.js';
import { useReduceMotion } from './motion.js';

export interface ChartBarProps {
  /** How tall the bar stands once grown, in pixels. Nothing is drawn at zero. */
  height: number;
  /** Place along the chart, which is the order the bars grow in. */
  index?: number;
  /** Another bar is being read; this one steps back. */
  dimmed?: boolean;
  /** A quieter bar — the months before the one being looked at. */
  muted?: boolean;
  /** Corner radius. A pill by default, as the narrow bars are. */
  corner?: number;
}

export function ChartBar({
  height,
  index = 0,
  dimmed = false,
  muted = false,
  corner = radius.pill,
}: ChartBarProps) {
  const { colors } = useTheme();
  const reduceMotion = useReduceMotion();
  const grow = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (reduceMotion) {
      grow.setValue(1);
      return;
    }
    const animation = Animated.timing(grow, {
      toValue: 1,
      duration: duration.slow,
      delay: Math.min(index, stagger.maxSteps * 2) * 30,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
    // Once, when the bar first appears. A bar whose height changes afterwards — a set ticked
    // on another screen — simply takes its new height; growing from nothing again would read
    // as the data having been lost and found.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [grow, reduceMotion]);

  if (height <= 0) return null;

  return (
    <View style={dimmed ? styles.dimmed : null}>
      <Animated.View
        style={[styles.bar, { height, borderRadius: corner, transform: [{ scaleY: grow }] }]}
      >
        <LinearGradient
          // Strongest at the top, where the value is read, easing off toward the baseline.
          colors={
            muted ? [colors.accentBorder, colors.accentSoft] : [colors.accent, colors.accentBorder]
          }
          start={{ x: 0, y: 0 }}
          end={{ x: 0, y: 1 }}
          style={StyleSheet.absoluteFill}
        />
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  // The gradient is a child and would otherwise square off the corners.
  bar: { overflow: 'hidden', transformOrigin: 'bottom' },
  dimmed: { opacity: 0.35 },
});
