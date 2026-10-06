/**
 * Keeps a screen's content above the keyboard.
 *
 * This used to be free. `android:windowSoftInputMode="adjustResize"` is set, and for years that
 * meant Android shrank the window when the keyboard opened, so a bottom-anchored input simply
 * moved up and every ScrollView scrolled its focused child into a smaller viewport by itself.
 *
 * From Android 15, an app targeting API 35 or above is drawn edge to edge whether it asks to be
 * or not — and an edge-to-edge window does not resize for the keyboard. The keyboard is simply
 * painted over the app. `adjustResize` still appears in the manifest and does nothing, which is
 * why this looked like a screen bug rather than a platform change: the setting that used to fix
 * it is still right there.
 *
 * So the room is made here, as bottom padding equal to however much of this view the keyboard
 * covers.
 *
 * ## Why this is not `KeyboardAvoidingView` any more
 *
 * It was, and it was wrong on every screen in the app by the same amount. `KeyboardAvoidingView`
 * takes its own frame from `onLayout` — relative to its parent — and compares it with the
 * keyboard's position on the screen. Those are two different coordinate systems that happen to
 * agree only when the view starts at the very top of the window. This app draws a brand bar above
 * every screen, so the padding came out short by exactly that bar's height.
 *
 * Nobody saw it for a long time, because the screens that used this also scrolled the focused
 * field above the keys, and the scroll made up the difference. The number bar on the workout
 * screen is pinned to the bottom with nothing to scroll: it sat a brand-bar's height behind the
 * keyboard, and its number was typed blind. (`keyboardVerticalOffset` is the prop meant to bridge
 * the gap, but it is read only when a keyboard event arrives, not when it changes — measuring it
 * and feeding it in is a race against the first keystroke.)
 *
 * Here the view is measured in the window — `measureInWindow`, the same coordinates the keyboard
 * reports in — and the arithmetic is `keyboardInset`, which is tested.
 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Keyboard, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { keyboardInset } from '../keyboardInset.js';

export function KeyboardSafe({
  children,
  style,
  /**
   * Extra space above the keyboard, for a screen whose input is not the very last thing —
   * a send button beside it, or a tab bar underneath.
   */
  offset = 0,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  offset?: number;
}) {
  const frame = useRef<View>(null);
  const keyboardTop = useRef<number | null>(null);
  const [inset, setInset] = useState(0);

  /**
   * Re-measure and re-pad.
   *
   * Measures the outer view, whose frame does not change when its own padding does — so setting
   * the padding cannot trigger the layout that would measure it again.
   */
  const update = useCallback(() => {
    if (keyboardTop.current === null) {
      setInset(0);
      return;
    }
    frame.current?.measureInWindow((_x, top, _width, height) => {
      setInset(keyboardInset({ top, height, keyboardTop: keyboardTop.current, offset }));
    });
  }, [offset]);

  useEffect(() => {
    const shown = Keyboard.addListener('keyboardDidShow', (event) => {
      keyboardTop.current = event.endCoordinates.screenY;
      update();
    });
    const hidden = Keyboard.addListener('keyboardDidHide', () => {
      keyboardTop.current = null;
      setInset(0);
    });

    // Mounted with the keyboard already up — a screen pushed while a field was focused.
    const metrics = Keyboard.isVisible() ? Keyboard.metrics() : undefined;
    if (metrics) {
      keyboardTop.current = metrics.screenY;
      update();
    }

    return () => {
      shown.remove();
      hidden.remove();
    };
  }, [update]);

  return (
    // `collapsable={false}`: a view that only lays out its children can be flattened out of the
    // native tree, and a view that is not there cannot be asked where it is.
    <View
      ref={frame}
      collapsable={false}
      onLayout={update}
      style={[styles.fill, { paddingBottom: inset }]}
    >
      {/* The caller's style goes on a view of its own, so a screen with bottom padding of its
          own keeps it: the keyboard's share is added outside, not written over the top. */}
      <View style={[styles.fill, style]}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
});
