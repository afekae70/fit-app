/**
 * Entrance motion, shared.
 *
 * Every screen in this app reveals the same way: a skeleton, then content appearing all at once
 * the instant SQLite answers. That is not slow, but it is abrupt — the eye gets no cue about
 * what arrived or in what order, so a six-card screen reads as a single flash.
 *
 * `FadeSlideIn` is the one answer to that, used everywhere rather than re-derived per screen.
 * Two things about how it is built are load-bearing:
 *
 * **Only `opacity` and `translateY` are animated, both native-driven.** That is not a stylistic
 * preference — see CLAUDE.md: a node carrying one native-driven and one JS-driven value in the
 * same style array is a hard crash, not a warning. Restricting this component to the two
 * properties the native driver supports means it cannot be the node that causes one, no matter
 * what a caller wraps it around.
 *
 * **It travels vertically.** A horizontal entrance would need flipping against
 * `I18nManager.isRTL`, since a translation is a physical delta and does not mirror the way
 * logical padding does. Vertical motion has no handedness and reads identically in both
 * directions, which is worth more here than any horizontal variant would be.
 *
 * Honours the OS "reduce motion" setting. An animation that cannot be turned off is the
 * opposite of pleasant for anyone who finds movement uncomfortable, and this is the only place
 * that switch has to be read.
 */

import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  AccessibilityInfo,
  Animated,
  Easing,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { duration, stagger } from '../theme.js';

/**
 * How far the content rises.
 *
 * 8, because that is what the design system's `fu` entrance specifies — the same value the
 * `Card`/`Banner`/`EmptyState` entrance in ui.tsx has always used. This module is now the one
 * implementation of that token, so there is nowhere for the two to drift apart.
 */
const TRAVEL = 8;

/**
 * The reduce-motion preference, read once and kept current.
 *
 * A hook rather than a module constant because the setting can change while the app is open,
 * and a user who turns it on mid-session should not have to relaunch to be taken seriously.
 */
export function useReduceMotion(): boolean {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void AccessibilityInfo.isReduceMotionEnabled().then((value) => {
      if (!cancelled) setReduced(value);
    });

    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduced);
    return () => {
      cancelled = true;
      subscription.remove();
    };
  }, []);

  return reduced;
}

export interface FadeSlideInProps {
  children: ReactNode;
  /**
   * Position in a list. Multiplies the stagger, capped by `stagger.maxSteps` so a long list
   * does not turn its tail into a wait.
   */
  index?: number;
  /** Extra delay before the stagger, for content that should follow a header in. */
  delay?: number;
  style?: StyleProp<ViewStyle>;
}

export function FadeSlideIn({ children, index = 0, delay = 0, style }: FadeSlideInProps) {
  const reduceMotion = useReduceMotion();
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (reduceMotion) {
      // Straight to the end state. Not a zero-duration animation — that still schedules a frame
      // and can flash, and there is nothing to animate towards anyway.
      progress.setValue(1);
      return;
    }

    const animation = Animated.timing(progress, {
      toValue: 1,
      duration: duration.normal,
      delay: delay + Math.min(index, stagger.maxSteps) * stagger.step,
      // Decelerating: fast at the start, settling at the end. An entrance that eases in as well
      // reads as hesitant, which is the wrong note for content that is already loaded.
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    });
    animation.start();

    // Stopped rather than left running: a screen that unmounts mid-entrance (a fast tab switch)
    // would otherwise keep a handle to a value nothing renders.
    return () => animation.stop();
  }, [progress, index, delay, reduceMotion]);

  return (
    <Animated.View
      style={[
        style,
        {
          opacity: progress,
          transform: [
            {
              translateY: progress.interpolate({
                inputRange: [0, 1],
                outputRange: [TRAVEL, 0],
              }),
            },
          ],
        },
      ]}
    >
      {children}
    </Animated.View>
  );
}
