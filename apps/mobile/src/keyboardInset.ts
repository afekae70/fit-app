/**
 * How much of a view the keyboard is covering — and the two coordinate systems that make it hard.
 *
 * The sum is one subtraction. Everything that has gone wrong with it has been about *where the
 * numbers are counted from*, and it went wrong twice, so both are written down here.
 *
 * ## 1. `onLayout` is relative to the parent
 *
 * React Native's `KeyboardAvoidingView` takes its frame from `onLayout` and compares it with the
 * keyboard's position on the screen. Those agree only for a view that starts at the top of the
 * window. This app draws a brand bar above every screen, so the padding came out short by that
 * bar's height. Fixed by measuring with `measureInWindow` instead.
 *
 * ## 2. `measureInWindow` does not count from the top of the screen either
 *
 * It counts from the top of the *visible display frame*, which starts under the status bar.
 * `RootViewUtil.getViewportOffset` subtracts `getWindowVisibleDisplayFrame().top` from every
 * measurement, and on an edge-to-edge window — where the app is drawn behind the status bar —
 * that is the status bar's height. So a view at the very top of the screen measures as a
 * *negative* y.
 *
 * The keyboard, meanwhile, reports `screenY` from `mVisibleViewArea.bottom`: a real screen
 * coordinate, counted from the top of the glass. (`ReactRootView.checkForKeyboardEvents`.)
 *
 * So the two are apart by exactly the status bar — 44.5dp on the phone this was built for, where
 * the bar being typed into is 62dp of field and padding. "Half hidden" was precisely that.
 *
 * `toScreenY` is the conversion. Anything compared against the keyboard has to go through it.
 */

/**
 * A `measureInWindow` y, as a real screen coordinate.
 *
 * `windowTop` is how far down the screen `measureInWindow` starts counting: the top safe-area
 * inset, which is the status bar. Pass `useSafeAreaInsets().top`.
 */
export function toScreenY(windowY: number, windowTop: number): number {
  return windowY + (Number.isFinite(windowTop) ? Math.max(0, windowTop) : 0);
}

/**
 * Where `measureInWindow` starts counting on a given platform.
 *
 * The status-bar gap described above is Android's, and specifically Fabric's: it comes from
 * `RootViewUtil.getViewportOffset`, which has no counterpart on iOS. There, `measureInWindow`
 * and the keyboard's `screenY` are both real screen coordinates and need no reconciling — so
 * adding the top inset on an iPhone would be the same bug in the other direction: a notch's
 * height of empty space above the keyboard.
 *
 * Pass `Platform.OS` and `useSafeAreaInsets().top`; use the result as `windowTop`.
 */
export function windowTopFor(platform: string, safeAreaTop: number): number {
  return platform === 'android' ? safeAreaTop : 0;
}

export interface KeyboardInsetInput {
  /** The view's top edge as `measureInWindow` reports it — never `onLayout`. */
  top: number;
  height: number;
  /** The keyboard's top edge once it is up, as its event reports it. Null while it is hidden. */
  keyboardTop: number | null;
  /** Where `measureInWindow` counts from: the top safe-area inset. See `toScreenY`. */
  windowTop: number;
  /** Extra room to keep above the keys. */
  offset?: number;
}

/**
 * Pixels of bottom padding that bring the view's content clear of the keyboard.
 *
 * Zero when the keyboard is hidden, and zero when the view already ends above it — a screen that
 * stops short of the bottom edge, for a tab bar, needs less than the keyboard's height or nothing.
 */
export function keyboardInset({
  top,
  height,
  keyboardTop,
  windowTop,
  offset = 0,
}: KeyboardInsetInput): number {
  if (keyboardTop === null) return 0;
  if (![top, height, keyboardTop, offset].every(Number.isFinite)) return 0;

  const overlap = toScreenY(top, windowTop) + height - keyboardTop + offset;
  return overlap > 0 ? Math.ceil(overlap) : 0;
}

export interface FieldOverlapInput {
  /** The field's top edge as `measureInWindow` reports it. */
  y: number;
  height: number;
  /** The keyboard's top edge, as its event reports it. */
  keyboardTop: number;
  /** Where `measureInWindow` counts from. See `toScreenY`. */
  windowTop: number;
  /** Clear space to leave between the field and the keys. */
  margin?: number;
}

/**
 * How far a page has to scroll for a focused field to clear the keyboard.
 *
 * Zero when the field is already above the keys, margin included: a field that can be seen is
 * left where it is, and never pulled down toward the keyboard. The same two coordinate systems
 * meet here as in `keyboardInset`, so the field's y goes through `toScreenY` first.
 */
export function fieldOverlap({
  y,
  height,
  keyboardTop,
  windowTop,
  margin = 0,
}: FieldOverlapInput): number {
  if (![y, height, keyboardTop, margin].every(Number.isFinite)) return 0;
  const overlap = toScreenY(y, windowTop) + height + margin - keyboardTop;
  return overlap > 0 ? Math.ceil(overlap) : 0;
}
