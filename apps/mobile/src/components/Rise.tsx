/**
 * One piece of a full-screen entrance: it fades in and rises, `order` places behind the first.
 *
 * For the screens that stand in front of the app — signing in, unlocking — and are therefore the
 * first thing drawn after launch. It waits for the launch splash to lift before starting. The
 * splash sits over everything for its first couple of seconds, and an entrance played
 * underneath it is an entrance nobody saw: the screen would simply be there, finished, when the
 * splash left.
 *
 * Opacity and transform only, so the whole thing runs on the native driver and nothing here
 * can be mixed with a JS-driven value on the same node.
 */

import { useEffect, useRef, type ReactNode } from 'react';
import { Animated, Easing, type ViewStyle } from 'react-native';

import { duration } from '../theme.js';
import { useReduceMotion } from './motion.js';
import { splashTimeLeft } from './SplashOverlay.js';

export function Rise({
  order,
  spring = false,
  style,
  children,
}: {
  order: number;
  /** For a logo or an emblem: arrives with a small overshoot instead of easing to a stop. */
  spring?: boolean;
  style?: ViewStyle;
  children: ReactNode;
}) {
  const reduceMotion = useReduceMotion();
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (reduceMotion) {
      progress.setValue(1);
      return;
    }
    const delay = splashTimeLeft() + order * 110;
    const animation = spring
      ? Animated.spring(progress, {
          toValue: 1,
          friction: 6,
          tension: 60,
          delay,
          useNativeDriver: true,
        })
      : Animated.timing(progress, {
          toValue: 1,
          duration: duration.slow + 120,
          delay,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        });
    animation.start();
    return () => animation.stop();
  }, [progress, order, spring, reduceMotion]);

  return (
    <Animated.View
      style={[
        style,
        {
          opacity: progress,
          transform: spring
            ? [{ scale: progress.interpolate({ inputRange: [0, 1], outputRange: [0.7, 1] }) }]
            : [{ translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [18, 0] }) }],
        },
      ]}
    >
      {children}
    </Animated.View>
  );
}
