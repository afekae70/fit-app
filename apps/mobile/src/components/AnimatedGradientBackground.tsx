/**
 * Ambient, slowly shifting gradient behind the whole app — cycling through green, blue, and a
 * neutral wash, echoing the accent colour rather than introducing new hues.
 *
 * Three `LinearGradient` layers cross-fade in a loop instead of one gradient whose own colours
 * are animated, because Animated cannot interpolate a colour-stop array directly — only scalar
 * values like opacity. Absolute-fill and `pointerEvents="none"`, so it never intercepts touches.
 *
 * Every content screen still paints its own opaque surfaces (cards, inputs, the screen's own
 * background) on top of this, so it mostly shows through in the gaps between them — most
 * visibly on the sign-in screens, which are otherwise the emptiest real estate in the app.
 */

import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet } from 'react-native';

import { useTheme } from '../ThemeProvider.js';

const CYCLE_MS = 18000;

type GradientStops = readonly [string, string, string];
type LayerSet = readonly [GradientStops, GradientStops, GradientStops];

const DARK_LAYERS: LayerSet = [
  ['#0B0F14', '#173C28', '#0B0F14'],
  ['#0B0F14', '#0F3049', '#0B0F14'],
  ['#0B0F14', '#141A21', '#0B0F14'],
];

const LIGHT_LAYERS: LayerSet = [
  ['#F5F8F7', '#DCF1E6', '#F5F8F7'],
  ['#F5F8F7', '#DBEBF7', '#F5F8F7'],
  ['#F5F8F7', '#FFFFFF', '#F5F8F7'],
];

export function AnimatedGradientBackground() {
  const { scheme } = useTheme();
  const t = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    t.setValue(0);
    const loop = Animated.loop(
      Animated.timing(t, {
        toValue: 3,
        duration: CYCLE_MS,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [t]);

  const [layerA, layerB, layerC] = scheme === 'dark' ? DARK_LAYERS : LIGHT_LAYERS;

  const opacityA = t.interpolate({ inputRange: [0, 1, 2, 3], outputRange: [1, 0, 0, 1] });
  const opacityB = t.interpolate({ inputRange: [0, 1, 2, 3], outputRange: [0, 1, 0, 0] });
  const opacityC = t.interpolate({ inputRange: [0, 1, 2, 3], outputRange: [0, 0, 1, 0] });

  return (
    <Animated.View style={StyleSheet.absoluteFill} pointerEvents="none">
      {(
        [
          [layerA, opacityA],
          [layerB, opacityB],
          [layerC, opacityC],
        ] as const
      ).map(([layerColors, opacity], index) => (
        <Animated.View key={index} style={[StyleSheet.absoluteFill, { opacity }]}>
          <LinearGradient
            colors={layerColors}
            locations={[0, 0.55, 1]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={StyleSheet.absoluteFill}
          />
        </Animated.View>
      ))}
    </Animated.View>
  );
}
