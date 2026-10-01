/**
 * What the app opens on: the logo, the name, and a ring turning while the first screen is built.
 *
 * The native splash is a single still frame Android shows before any JavaScript exists; it
 * cannot animate and it cannot know the theme. This takes over the moment the app can draw, and
 * hands off to the real screen when it is ready — so the seam between "launching" and "running"
 * is one continuous movement rather than a flash of a different picture.
 *
 * Everything here is native-driven: opacity, scale and rotation only, no colour and no layout.
 * A launch animation that drops frames is worse than none, and this is the one moment the JS
 * thread is busiest — it is parsing the bundle, opening the database and reading the keystore
 * while this plays.
 *
 * It holds for a moment of its own accord. A splash that vanishes in 80ms on a fast phone and
 * lingers for two seconds on a slow one reads as a glitch on the fast one; `MINIMUM_MS` is what
 * makes the entrance deliberate. Nothing waits on it — the app underneath is already live.
 */

import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Animated,
  Easing,
  Image,
  StyleSheet,
  View,
  type ImageStyle,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

import appIcon from '../../assets/icon.png';

import { useTheme } from '../ThemeProvider.js';
import { radius } from '../theme.js';

/** How long the entrance is given before it is allowed to leave. */
const MINIMUM_MS = 1500;
const FADE_MS = 420;

export function SplashOverlay() {
  const { t } = useTranslation();
  const { colors } = useTheme();

  const [gone, setGone] = useState(false);

  const logo = useRef(new Animated.Value(0)).current;
  const name = useRef(new Animated.Value(0)).current;
  const spin = useRef(new Animated.Value(0)).current;
  const breathe = useRef(new Animated.Value(0)).current;
  const slogan = useRef(new Animated.Value(0)).current;
  const leaving = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    // The logo arrives first and overshoots a little; the name follows it up a moment later.
    Animated.sequence([
      Animated.spring(logo, { toValue: 1, useNativeDriver: true, friction: 6, tension: 60 }),
      Animated.timing(name, {
        toValue: 1,
        duration: 320,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      // The slogan last and slower: it is the line that is read rather than recognised.
      Animated.timing(slogan, {
        toValue: 1,
        duration: 420,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
    ]).start();

    // The ring turns for as long as this is on screen.
    const turning = Animated.loop(
      Animated.timing(spin, {
        toValue: 1,
        duration: 1400,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    turning.start();

    // And the logo breathes, so a held frame never looks like a frozen one.
    const breathing = Animated.loop(
      Animated.sequence([
        Animated.timing(breathe, {
          toValue: 1,
          duration: 1100,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(breathe, {
          toValue: 0,
          duration: 1100,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
      ]),
    );
    breathing.start();

    const timer = setTimeout(() => {
      // Out by rising and fading, which reads as the splash lifting off the screen underneath
      // rather than the screen replacing it.
      Animated.timing(leaving, {
        toValue: 0,
        duration: FADE_MS,
        easing: Easing.in(Easing.cubic),
        useNativeDriver: true,
      }).start(({ finished }) => {
        if (finished) setGone(true);
      });
    }, MINIMUM_MS);

    return () => {
      clearTimeout(timer);
      turning.stop();
      breathing.stop();
    };
  }, [logo, name, spin, breathe, slogan, leaving]);

  if (gone) return null;

  return (
    <Animated.View
      // Nothing here is tappable, and the app underneath is already alive — a stray touch during
      // the entrance belongs to whatever it lands on once this is gone.
      pointerEvents="none"
      style={[
        StyleSheet.absoluteFill,
        styles.fill,
        {
          backgroundColor: colors.bg,
          opacity: leaving,
          transform: [
            { scale: leaving.interpolate({ inputRange: [0, 1], outputRange: [1.06, 1] }) },
          ],
        },
      ]}
    >
      <LinearGradient
        colors={[colors.accentSoft, colors.bg]}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />

      <View style={styles.centre}>
        <View style={styles.markWrap}>
          {/* The ring, drawn as a circle with one side missing — the cheapest honest spinner
              there is, and it needs no drawing surface. */}
          <Animated.View
            style={[
              styles.ring,
              {
                borderColor: colors.accentBorder,
                borderTopColor: colors.accent,
                transform: [
                  {
                    rotate: spin.interpolate({
                      inputRange: [0, 1],
                      outputRange: ['0deg', '360deg'],
                    }),
                  },
                ],
              },
            ]}
          />

          <Animated.View
            style={{
              opacity: logo,
              transform: [
                { scale: Animated.multiply(logo, breathe.interpolate({ inputRange: [0, 1], outputRange: [1, 1.05] })) },
              ],
            }}
          >
            <Image
              source={appIcon}
              style={styles.logo}
              accessibilityIgnoresInvertColors
            />
          </Animated.View>
        </View>

        <Animated.Text
          style={[
            styles.name,
            {
              color: colors.accent,
              opacity: name,
              transform: [
                { translateY: name.interpolate({ inputRange: [0, 1], outputRange: [14, 0] }) },
              ],
            },
          ]}
        >
          {t('common.appName')}
        </Animated.Text>

        <Animated.Text
          style={[
            styles.slogan,
            {
              color: colors.textMuted,
              opacity: slogan,
              transform: [
                { translateY: slogan.interpolate({ inputRange: [0, 1], outputRange: [10, 0] }) },
              ],
            },
          ]}
        >
          {t('common.slogan')}
        </Animated.Text>

        <Animated.View style={{ opacity: slogan }}>
          <Dots color={colors.accentBorder} />
        </Animated.View>
      </View>
    </Animated.View>
  );
}

/** Three dots rising in turn — the smallest possible "working on it". */
function Dots({ color }: { color: string }) {
  const values = useRef([0, 1, 2].map(() => new Animated.Value(0))).current;

  useEffect(() => {
    const loops = values.map((value, index) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(index * 160),
          Animated.timing(value, { toValue: 1, duration: 320, useNativeDriver: true }),
          Animated.timing(value, { toValue: 0, duration: 320, useNativeDriver: true }),
          Animated.delay((values.length - index) * 160),
        ]),
      ),
    );
    for (const loop of loops) loop.start();
    return () => {
      for (const loop of loops) loop.stop();
    };
  }, [values]);

  return (
    <View style={styles.dots}>
      {values.map((value, index) => (
        <Animated.View
          key={index}
          style={[
            styles.dot,
            {
              backgroundColor: color,
              opacity: value.interpolate({ inputRange: [0, 1], outputRange: [0.35, 1] }),
              transform: [
                { translateY: value.interpolate({ inputRange: [0, 1], outputRange: [0, -5] }) },
              ],
            },
          ]}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create<{
  fill: ViewStyle;
  centre: ViewStyle;
  markWrap: ViewStyle;
  ring: ViewStyle;
  logo: ImageStyle;
  name: TextStyle;
  slogan: TextStyle;
  dots: ViewStyle;
  dot: ViewStyle;
}>({
  fill: { alignItems: 'center', justifyContent: 'center', zIndex: 100 },
  centre: { alignItems: 'center', gap: 16 },
  markWrap: { width: 168, height: 168, alignItems: 'center', justifyContent: 'center' },
  ring: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: radius.pill,
    borderWidth: 3,
  },
  logo: { width: 120, height: 120, borderRadius: radius.pill },
  name: { fontSize: 30, fontWeight: '700', letterSpacing: 0.5 },
  slogan: { fontSize: 14, letterSpacing: 0.3, marginTop: -8, textAlign: 'center' },
  dots: { flexDirection: 'row', gap: 8 },
  dot: { width: 8, height: 8, borderRadius: 4 },
});
