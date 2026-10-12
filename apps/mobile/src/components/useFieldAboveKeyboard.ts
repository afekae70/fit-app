/**
 * Keeps the field being typed in above the keyboard, on a screen that scrolls.
 *
 * On current Android the keyboard is drawn over the app rather than shrinking it (the long
 * version is at the top of `KeyboardSafe.tsx`). `KeyboardSafe` makes room at the bottom of the
 * page; nothing then moves the page into that room. A field low on the screen stays exactly
 * where it was, behind the keys, and its number is typed blind.
 *
 * This is the second half: when the keyboard has come up, find the field that has the focus,
 * work out how much of it the keyboard covers, and scroll by that much and no more.
 *
 * It is the calendar screen's own fix (`app/(tabs)/plan.tsx`), taken out so that the next
 * screen with a field low on a long page does not have to learn it again. One difference: it
 * waits a moment before measuring, as the sign-in form does. A field at the very end of a page
 * has nowhere to scroll to until `KeyboardSafe` has added its room, and that lands a frame or
 * two after the keyboard reports.
 *
 * Use: wrap the screen in `KeyboardSafe`, and give the `ScrollView` the `ref`, the `onScroll`
 * and `scrollEventThrottle={16}`.
 */

import { useCallback, useEffect, useRef } from 'react';
import {
  Keyboard,
  Platform,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type ScrollView,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { fieldOverlap, windowTopFor } from '../keyboardInset.js';
import { spacing } from '../theme.js';
import { TextInput } from './Text.js';

/** How long `KeyboardSafe` is given to make its room before the field is measured. */
const ROOM_MS = 120;

export function useFieldAboveKeyboard() {
  const scrollRef = useRef<ScrollView>(null);
  const scrollY = useRef(0);
  // Where `measureInWindow` counts from, which is not where the keyboard does. In a ref so a
  // change to it does not rebuild the keyboard subscription.
  const windowTop = useRef(0);
  windowTop.current = windowTopFor(Platform.OS, useSafeAreaInsets().top);

  useEffect(() => {
    let waiting: ReturnType<typeof setTimeout> | null = null;
    const shown = Keyboard.addListener('keyboardDidShow', (event) => {
      const keyboardTop = event.endCoordinates.screenY;
      if (waiting) clearTimeout(waiting);
      waiting = setTimeout(() => {
        waiting = null;
        const field = TextInput.State.currentlyFocusedInput();
        if (!field) return;
        field.measureInWindow((_x, y, _width, height) => {
          const overlap = fieldOverlap({
            y,
            height,
            keyboardTop,
            windowTop: windowTop.current,
            margin: spacing.lg,
          });
          if (overlap <= 0) return;
          scrollY.current += overlap;
          scrollRef.current?.scrollTo({ y: scrollY.current, animated: true });
        });
      }, ROOM_MS);
    });
    return () => {
      shown.remove();
      if (waiting) clearTimeout(waiting);
    };
  }, []);

  /** Where the page is, so that "scroll by this much" has something to add to. */
  const onScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    scrollY.current = event.nativeEvent.contentOffset.y;
  }, []);

  return { scrollRef, onScroll };
}
