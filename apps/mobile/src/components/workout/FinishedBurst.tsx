/**
 * The whole of finishing a workout: a trophy in the middle of the screen, and then the screen
 * moves on.
 *
 * It replaced a sheet that asked whether to save, what to call the session and how hard it had
 * been. Nobody taps "cancel" on a workout they just did, and the name and the effort rating are
 * both editable afterwards from the session itself — so the sheet was three questions standing
 * between a finished set and the feeling of having finished. The save happens first and this
 * plays over it.
 *
 * It holds itself to a couple of seconds and then calls `onDone`. Nothing waits on it: the
 * session is already written by the time the trophy appears.
 */

import { useEffect, useMemo, useRef } from 'react';
import { Animated, Easing, StyleSheet, Text, type TextStyle, type ViewStyle } from 'react-native';

import { ProgressRing } from '../ProgressRing.js';
import { useTheme } from '../../ThemeProvider.js';
import { radius, shadow, type ColorPalette } from '../../theme.js';

/** Long enough to register as a moment, short enough that nobody waits it out. */
const HOLD_MS = 1900;
const OUT_MS = 380;

export function FinishedBurst({ onDone }: { onDone: () => void }) {
  const { colors } = useTheme();
  const s = useMemo(() => createStyles(colors), [colors]);

  const enter = useRef(new Animated.Value(0)).current;
  const leave = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    Animated.spring(enter, { toValue: 1, useNativeDriver: true, friction: 5, tension: 70 }).start();
    const timer = setTimeout(() => {
      Animated.timing(leave, {
        toValue: 0,
        duration: OUT_MS,
        easing: Easing.in(Easing.cubic),
        useNativeDriver: true,
      }).start(({ finished }) => {
        if (finished) onDone();
      });
    }, HOLD_MS);
    return () => clearTimeout(timer);
  }, [enter, leave, onDone]);

  return (
    <Animated.View
      pointerEvents="none"
      style={[StyleSheet.absoluteFill, s.backdrop, { opacity: leave }]}
    >
      <Animated.View
        style={[
          s.badge,
          {
            opacity: enter,
            transform: [
              { scale: enter.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1] }) },
            ],
          },
        ]}
      >
        {/* The workout's own ring, swept to full — the same shape the header counts sets in. */}
        <ProgressRing fraction={1} size={132} thickness={9}>
          <Text style={s.trophy}>🏆</Text>
        </ProgressRing>
      </Animated.View>
    </Animated.View>
  );
}

const createStyles = (colors: ColorPalette) =>
  StyleSheet.create<{ backdrop: ViewStyle; badge: ViewStyle; trophy: TextStyle }>({
    // Dimmed rather than opaque: the workout stays visible behind it, which is what makes this
    // read as the end of that session rather than as another screen.
    backdrop: {
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.bg,
      opacity: 0.96,
      zIndex: 50,
    },
    badge: {
      padding: 18,
      borderRadius: radius.pill,
      backgroundColor: colors.surface,
      ...shadow(colors.shadow).hero,
    },
    trophy: { fontSize: 54 },
  });
