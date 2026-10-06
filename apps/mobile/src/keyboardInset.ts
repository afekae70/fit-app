/**
 * How much of a view the keyboard is covering.
 *
 * One subtraction, and the whole of it is which coordinates go in. Both the view and the keyboard
 * must be measured **in the window** — from the top of the screen — or the answer is short by
 * however far the view starts below that.
 *
 * That is not a hypothetical. React Native's `KeyboardAvoidingView` takes the view's frame from
 * `onLayout`, which is relative to its *parent*, and compares it with the keyboard's position on
 * the *screen*. On a screen that begins at the very top the two agree. This app draws a brand bar
 * above every screen, so each one began some eighty pixels down, and the padding came out exactly
 * that much short: a field docked "above the keyboard" sat eighty pixels behind it. Scrolling
 * screens hid the error, because they scrolled the focused field the rest of the way. A bar
 * pinned to the bottom had nothing to scroll, and its number was typed blind.
 */

export interface KeyboardInsetInput {
  /** The view's top edge, in window coordinates — `measureInWindow`, never `onLayout`. */
  top: number;
  height: number;
  /** The keyboard's top edge once it is up, in the same coordinates. Null while it is hidden. */
  keyboardTop: number | null;
  /** Extra room to keep above the keys. */
  offset?: number;
}

/**
 * Pixels of bottom padding that bring the view's content clear of the keyboard.
 *
 * Zero when the keyboard is hidden, and zero when the view already ends above it — a screen that
 * stops short of the bottom edge, for a tab bar, needs less than the keyboard's height or nothing.
 */
export function keyboardInset({ top, height, keyboardTop, offset = 0 }: KeyboardInsetInput): number {
  if (keyboardTop === null) return 0;
  if (![top, height, keyboardTop, offset].every(Number.isFinite)) return 0;

  const overlap = top + height - keyboardTop + offset;
  return overlap > 0 ? Math.ceil(overlap) : 0;
}
