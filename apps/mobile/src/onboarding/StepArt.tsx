/**
 * The picture at the top of each setup question.
 *
 * Drawn rather than photographed, and from what the app already carries: the icon set, and the
 * violet-to-pink of the logo. A photograph of somebody else's body at the top of "what do you
 * weigh?" says something this app does not want to say, has to be licensed, and costs every
 * install a megabyte or two for a screen seen once. An emblem in the brand's own colours says
 * what the question is about and nothing else.
 *
 * ## Motion
 *
 * It arrives with a small overshoot, then floats — a few points up and down, slowly, with two
 * sparks drifting out of step with it. Enough that a screen someone is reading does not look
 * like a still, not so much that it competes with the ruler underneath.
 *
 * Every value is native-driven and every one sits on a node of its own: scale and opacity for
 * the entrance on one view, the float's translation on another, each spark on its own. Nothing
 * here animates a colour or a size, so there is no JS-driven value for any of them to share a
 * node with — see CLAUDE.md for what happens when one does.
 */

import { useEffect, useMemo, useRef } from 'react';
import { Animated, Easing, StyleSheet, View, type ViewStyle } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import type { Icon } from 'phosphor-react-native';

import { useReduceMotion } from '../components/motion.js';
import { useTheme } from '../ThemeProvider.js';
import { radius, shadow, type ColorPalette } from '../theme.js';

const HALO = 156;
const DISC = 108;

export function StepArt({ icon: IconComponent }: { icon: Icon }) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const reduceMotion = useReduceMotion();

  const arrive = useRef(new Animated.Value(0)).current;
  const float = useRef(new Animated.Value(0)).current;
  const drift = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (reduceMotion) {
      arrive.setValue(1);
      return;
    }

    const arriving = Animated.spring(arrive, {
      toValue: 1,
      friction: 6,
      tension: 70,
      useNativeDriver: true,
    });
    arriving.start();

    const loop = (value: Animated.Value, ms: number) =>
      Animated.loop(
        Animated.sequence([
          Animated.timing(value, {
            toValue: 1,
            duration: ms,
            easing: Easing.inOut(Easing.sin),
            useNativeDriver: true,
          }),
          Animated.timing(value, {
            toValue: 0,
            duration: ms,
            easing: Easing.inOut(Easing.sin),
            useNativeDriver: true,
          }),
        ]),
      );

    // Two periods that do not divide into each other, so the sparks and the emblem never fall
    // into step and the whole thing never visibly repeats.
    const floating = loop(float, 2400);
    const drifting = loop(drift, 3100);
    floating.start();
    drifting.start();

    return () => {
      arriving.stop();
      floating.stop();
      drifting.stop();
    };
  }, [arrive, float, drift, reduceMotion]);

  return (
    <View style={styles.wrap} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Animated.View
        style={{
          opacity: arrive,
          transform: [{ scale: arrive.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1] }) }],
        }}
      >
        <View style={styles.halo}>
          <Animated.View
            style={[
              styles.spark,
              styles.sparkOne,
              {
                transform: [
                  { translateY: drift.interpolate({ inputRange: [0, 1], outputRange: [0, -10] }) },
                  { scale: drift.interpolate({ inputRange: [0, 1], outputRange: [1, 0.7] }) },
                ],
              },
            ]}
          />
          <Animated.View
            style={[
              styles.spark,
              styles.sparkTwo,
              {
                transform: [
                  { translateY: float.interpolate({ inputRange: [0, 1], outputRange: [0, 8] }) },
                  { scale: float.interpolate({ inputRange: [0, 1], outputRange: [0.75, 1] }) },
                ],
              },
            ]}
          />

          <Animated.View
            style={{
              transform: [
                { translateY: float.interpolate({ inputRange: [0, 1], outputRange: [3, -5] }) },
              ],
            }}
          >
            <View style={styles.discShadow}>
              <LinearGradient
                colors={[colors.accent, colors.info]}
                start={{ x: 0.1, y: 0 }}
                end={{ x: 0.9, y: 1 }}
                style={styles.disc}
              >
                <IconComponent size={54} color="#FFFFFF" weight="duotone" />
              </LinearGradient>
            </View>
          </Animated.View>
        </View>
      </Animated.View>
    </View>
  );
}

const createStyles = (colors: ColorPalette) =>
  StyleSheet.create<{
    wrap: ViewStyle;
    halo: ViewStyle;
    discShadow: ViewStyle;
    disc: ViewStyle;
    spark: ViewStyle;
    sparkOne: ViewStyle;
    sparkTwo: ViewStyle;
  }>({
    wrap: { alignItems: 'center' },
    halo: {
      width: HALO,
      height: HALO,
      borderRadius: radius.pill,
      backgroundColor: colors.accentSoft,
      alignItems: 'center',
      justifyContent: 'center',
    },
    // The shadow lives on a plain view around the gradient: a gradient view clips to its own
    // rounded corners, and a shadow drawn by the thing that clips is a shadow that is cut off.
    discShadow: {
      borderRadius: radius.pill,
      backgroundColor: colors.accent,
      ...shadow(colors.accent).hero,
    },
    disc: {
      width: DISC,
      height: DISC,
      borderRadius: radius.pill,
      alignItems: 'center',
      justifyContent: 'center',
      overflow: 'hidden',
    },
    spark: { position: 'absolute', borderRadius: radius.pill },
    sparkOne: { width: 14, height: 14, top: 14, end: 22, backgroundColor: colors.info },
    sparkTwo: { width: 9, height: 9, bottom: 22, start: 20, backgroundColor: colors.accent },
  });
