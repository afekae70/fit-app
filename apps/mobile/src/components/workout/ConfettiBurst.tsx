/**
 * Confetti, thrown once from behind the trophy when a workout is finished.
 *
 * Views, not a canvas and not a library: three dozen small coloured shapes, each moved by a
 * transform. Adding an animation package for two seconds a workout would be a native module
 * and a rebuild for every user (see CLAUDE.md); this needs nothing the app does not have.
 *
 * ## One clock, one driver
 *
 * A single value runs from 0 to 1 over the life of the burst, on the native driver, and every
 * piece reads its own flight off it: out to the side, up and then down, turning, and gone
 * before it lands. Opacity and transform only — both native — so nothing is laid out again
 * while it plays and no node carries a JS-driven value beside a native one.
 *
 * Where the pieces go is `workout/confetti.ts`, which is tested; this only draws them.
 *
 * Nothing is drawn at all with reduce-motion on. The trophy and the line under it already say
 * what happened, and confetti that does not move is litter.
 */

import { useEffect, useMemo, useRef } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';

import { useTheme } from '../../ThemeProvider.js';
import { confettiPieces, type ConfettiPiece } from '../../workout/confetti.js';
import { useReduceMotion } from '../motion.js';

const PIECES = 36;
/** Shorter than the trophy is held for, so the last piece is gone before the screen moves on. */
const BURST_MS = 1700;
/** A beat after the trophy starts to land, so the burst reads as coming from it. */
const START_AFTER_MS = 140;

export function ConfettiBurst() {
  const { colors } = useTheme();
  const reduceMotion = useReduceMotion();
  const clock = useRef(new Animated.Value(0)).current;
  const pieces = useMemo(() => confettiPieces(PIECES), []);

  // The app's own colours, so the celebration is in the same palette as the thing celebrated.
  const palette = [colors.accent, colors.info, colors.warning, colors.accentLift, colors.text];

  useEffect(() => {
    if (reduceMotion) return undefined;
    const animation = Animated.timing(clock, {
      toValue: 1,
      duration: BURST_MS,
      delay: START_AFTER_MS,
      // Even time: each piece shapes its own flight below, and easing the clock as well would
      // bend every one of them the same way.
      easing: Easing.linear,
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [clock, reduceMotion]);

  if (reduceMotion) return null;

  return (
    <View pointerEvents="none" style={styles.origin}>
      {pieces.map((piece, index) => (
        <Animated.View
          key={index}
          style={[
            styles.piece,
            {
              width: piece.size,
              height: piece.shape === 'bar' ? Math.round(piece.size * 1.8) : piece.size,
              borderRadius: piece.shape === 'bar' ? 2 : piece.size / 2,
              backgroundColor: palette[piece.color % palette.length],
            },
            flight(clock, piece),
          ]}
        />
      ))}
    </View>
  );
}

/** One piece's path, read off the shared clock. */
function flight(clock: Animated.Value, piece: ConfettiPiece) {
  // Never exactly zero: the ranges below must rise, and two equal stops at the start do not.
  const start = Math.max(0.001, piece.delay);
  // The top of the throw comes early: paper leaves fast and hangs.
  const peak = start + (1 - start) * 0.32;

  return {
    opacity: clock.interpolate({
      inputRange: [0, start, start + 0.04, 0.78, 1],
      outputRange: [0, 0, 1, 1, 0],
      extrapolate: 'clamp' as const,
    }),
    transform: [
      {
        translateX: clock.interpolate({
          inputRange: [start, peak, 1],
          // Most of the sideways travel is in the throw; it drifts the rest of the way.
          outputRange: [0, piece.dx * 0.78, piece.dx],
          extrapolate: 'clamp' as const,
        }),
      },
      {
        translateY: clock.interpolate({
          inputRange: [start, peak, 1],
          outputRange: [0, -piece.rise, piece.fall],
          extrapolate: 'clamp' as const,
        }),
      },
      {
        rotate: clock.interpolate({
          inputRange: [start, 1],
          outputRange: ['0deg', `${piece.spin}deg`],
          extrapolate: 'clamp' as const,
        }),
      },
    ],
  };
}

const styles = StyleSheet.create({
  // A point at the middle of whatever this is laid over; every piece starts on it.
  origin: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  piece: { position: 'absolute' },
});
