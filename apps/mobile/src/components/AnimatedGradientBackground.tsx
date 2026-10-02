/**
 * The light behind the whole app, and the one thing on screen that knows what you are doing.
 *
 * Three `LinearGradient` layers cross-fade in a slow loop rather than one gradient whose stops
 * are animated: `Animated` can interpolate a number, not a colour-stop array. Absolute-fill and
 * `pointerEvents="none"`, so it never takes a touch.
 *
 * ## It follows the session
 *
 * Resting, it drifts: eighteen seconds a pass, barely a tint above the ground. While a workout is
 * open it warms — the accent comes further forward and the cycle quickens — so the app feels
 * awake in the hand without a single label saying so. The change is deliberately below the level
 * anyone would describe; it is read as "this screen is live", not as a colour.
 *
 * ## The stops come from the palette
 *
 * They used to be hard-coded hexes from an older scheme, which is how the ambience was left
 * painting an indigo that no longer existed anywhere else in the app. Each layer is now the
 * palette's own ground, lifted through one of its own tints and back, so the two ends are always
 * exactly `bg` and only the middle carries hue. Re-tune the palette and this follows.
 */

import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useMemo, useRef } from 'react';
import { Animated, Easing, StyleSheet } from 'react-native';

import { useTheme } from '../ThemeProvider.js';
import { useWorkoutActive } from '../workout/activeWorkout.js';

const RESTING_MS = 18000;
const TRAINING_MS = 11000;

export function AnimatedGradientBackground() {
  const { colors } = useTheme();
  const training = useWorkoutActive();
  const t = useRef(new Animated.Value(0)).current;
  const mood = useRef(new Animated.Value(0)).current;

  const layers = useMemo(
    () =>
      [
        [colors.bg, colors.accentSoft, colors.bg],
        [colors.bg, colors.surfaceRaised, colors.bg],
        [colors.bg, colors.infoSoft, colors.bg],
      ] as const,
    [colors],
  );

  useEffect(() => {
    t.setValue(0);
    const loop = Animated.loop(
      Animated.timing(t, {
        toValue: 3,
        duration: training ? TRAINING_MS : RESTING_MS,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [t, training]);

  // How far forward the colour comes. Opacity only, so it stays on the native driver alongside
  // the cross-fade it is multiplied into.
  useEffect(() => {
    Animated.timing(mood, {
      toValue: training ? 1 : 0,
      duration: 900,
      easing: Easing.inOut(Easing.quad),
      useNativeDriver: true,
    }).start();
  }, [mood, training]);

  const presence = mood.interpolate({ inputRange: [0, 1], outputRange: [0.55, 1] });

  return (
    <Animated.View style={StyleSheet.absoluteFill} pointerEvents="none">
      {layers.map((stops, index) => (
        <Animated.View
          key={index}
          style={[
            StyleSheet.absoluteFill,
            {
              opacity: Animated.multiply(
                presence,
                t.interpolate({
                  // Each layer is at full strength on its own beat and gone on the others, with
                  // the ends wrapping so the loop has no seam.
                  inputRange: [0, 1, 2, 3].map((beat) => (beat - index + 3) % 3),
                  outputRange: [1, 0, 0, 1],
                  extrapolate: 'clamp',
                }),
              ),
            },
          ]}
        >
          <LinearGradient
            colors={stops}
            start={{ x: 0.1, y: 0 }}
            end={{ x: 0.9, y: 1 }}
            style={StyleSheet.absoluteFill}
          />
        </Animated.View>
      ))}
    </Animated.View>
  );
}
