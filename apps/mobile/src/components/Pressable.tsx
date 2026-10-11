/**
 * `Pressable`, with the app's press: whatever is pressed gives a little under the finger.
 *
 * Every screen imports this instead of React Native's. It is the same component, and a button
 * written the way buttons here already are —
 *
 *     style={({ pressed }) => [styles.button, pressed && styles.pressed]}
 *
 * — now also sinks to 97% while it is held and springs back when it is let go. Before this,
 * that was true of three components that had each built it for themselves; the other ninety
 * only dimmed, and the difference between a button that moves and one that fades was whichever
 * screen you happened to be on.
 *
 * ## Which ones move
 *
 * The ones that already answer a press. A `style` given as a function of `pressed` is a
 * button saying it wants press feedback, and it gets this as well. A `style` given as a plain
 * object is left exactly as it was: that is how backdrops, tab-bar slots and wrappers are
 * written, and a full-screen backdrop that shrank when tapped would be a bug, not a feel.
 *
 * So the rule for a new button is the one it already followed, and nothing has to be
 * remembered: describe the pressed state, and the press comes with it.
 *
 * ## One driver
 *
 * The scale is a transform on the native driver. It goes last in the style, so it replaces any
 * `transform` the pressed style set by hand — there is one press in the app, not one per
 * screen — and the pressable's own style is plain values, so no node carries a JS-driven
 * value beside it (see CLAUDE.md).
 */

import { useRef, useState, type Ref } from 'react';
import {
  AccessibilityInfo,
  Animated,
  Pressable as NativePressable,
  type GestureResponderEvent,
  type PressableProps,
  type PressableStateCallbackType,
  type View,
} from 'react-native';

const AnimatedPressable = Animated.createAnimatedComponent(NativePressable);

/** How far a pressed thing sinks. Enough to be felt on a card, not enough to move its text. */
export const PRESSED_SCALE = 0.97;

/*
 * Reduce-motion, read once for the whole app.
 *
 * There are a hundred of these on some screens; a subscription each would be a hundred
 * listeners for one setting. Held at module scope and read at the moment of the press.
 */
let reduceMotion = false;
void AccessibilityInfo.isReduceMotionEnabled()
  .then((enabled) => {
    reduceMotion = enabled;
  })
  .catch(() => undefined);
AccessibilityInfo.addEventListener('reduceMotionChanged', (enabled) => {
  reduceMotion = enabled;
});

type Props = PressableProps & { ref?: Ref<View> };

export function Pressable(props: Props) {
  // Decided by how the style is written, which does not change between renders of one call
  // site — and the two branches are separate components, so neither's hooks depend on it.
  return typeof props.style === 'function' ? (
    <Springy {...props} />
  ) : (
    <NativePressable {...props} />
  );
}

function Springy({ style, children, onPressIn, onPressOut, ...rest }: Props) {
  const [pressed, setPressed] = useState(false);
  const scale = useRef(new Animated.Value(1)).current;

  const settle = (toValue: number) =>
    Animated.spring(scale, {
      toValue,
      friction: 7,
      tension: 220,
      useNativeDriver: true,
    }).start();

  // The state a style or a child is given. Other platforms add fields to this type (hover,
  // focus) that a phone never sets.
  const state = { pressed } as PressableStateCallbackType;

  return (
    <AnimatedPressable
      {...rest}
      onPressIn={(event: GestureResponderEvent) => {
        setPressed(true);
        if (!reduceMotion) settle(PRESSED_SCALE);
        onPressIn?.(event);
      }}
      onPressOut={(event: GestureResponderEvent) => {
        setPressed(false);
        settle(1);
        onPressOut?.(event);
      }}
      style={[typeof style === 'function' ? style(state) : style, { transform: [{ scale }] }]}
    >
      {typeof children === 'function' ? children(state) : children}
    </AnimatedPressable>
  );
}
