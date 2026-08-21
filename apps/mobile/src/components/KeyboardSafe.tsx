/**
 * Keeps the focused field above the keyboard.
 *
 * This used to be free. `android:windowSoftInputMode="adjustResize"` is set, and for years that
 * meant Android shrank the window when the keyboard opened, so a bottom-anchored input simply
 * moved up and every ScrollView scrolled its focused child into a smaller viewport by itself.
 * Screens only needed `KeyboardAvoidingView` on iOS, which is exactly what they had.
 *
 * From Android 15, an app targeting API 35 or above is drawn edge to edge whether it asks to be
 * or not — and an edge-to-edge window does not resize for the keyboard. The keyboard is simply
 * painted over the app. `adjustResize` still appears in the manifest and does nothing, which is
 * why this looked like a screen bug rather than a platform change: the setting that used to fix
 * it is still right there.
 *
 * So the padding is applied on both platforms now. On a version of Android that does still
 * resize, this stays correct rather than double-counting: `KeyboardAvoidingView` measures its
 * own frame, and a window that already shrank leaves it nothing to add.
 */

import type { ReactNode } from 'react';
import {
  KeyboardAvoidingView,
  StyleSheet,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

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
  return (
    <KeyboardAvoidingView
      style={[styles.fill, style]}
      // `padding` on both. `height` also works on Android but animates the whole subtree's
      // size, which makes a long list of sets visibly reflow every time a field is tapped.
      behavior="padding"
      keyboardVerticalOffset={offset}
    >
      {children}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
});
