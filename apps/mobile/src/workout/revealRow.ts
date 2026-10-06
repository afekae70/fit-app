/**
 * How far to scroll so the set being filled in is not under the keyboard.
 *
 * The number is typed in a bar above the keys, and the bar names the set — but naming a row is
 * not the same as seeing it. With the row hidden there is no weight beside the reps being typed,
 * no set above it to compare against, and no tick to watch appear. So when an edit starts, the
 * list moves just far enough for the row to clear everything that has risen from the bottom of
 * the screen.
 *
 * It is one subtraction, kept here rather than inline because the last time this screen scrolled
 * a field above the keyboard it was by a number measured at the wrong moment, and the list jumped
 * a keyboard's height up the page. The arithmetic is here, where it can be tested; *when* to
 * measure is the screen's business, and the rule there is to ask the row where it is at the moment
 * of scrolling rather than remember where it was when it was tapped.
 */

/** A row's place on screen, in window coordinates, as `measureInWindow` reports it. */
export interface RowFrame {
  y: number;
  height: number;
}

/**
 * Asks a row where it is right now.
 *
 * A function rather than a frame because the answer changes: the list is scrolled, the keyboard
 * arrives, the layout shrinks. Whatever was true at the tap is stale by the time it is used. It
 * calls back only when the row is still there to be measured.
 */
export type MeasureRow = (done: (frame: RowFrame) => void) => void;

export interface RevealInput {
  row: RowFrame;
  /** The top edge of the keyboard once it is up, in the same coordinates. */
  keyboardTop: number;
  /** The entry bar sitting on top of the keyboard. */
  barHeight: number;
  /** Air between the row and the bar, so the row is not read against the bar's edge. */
  margin?: number;
}

/**
 * Pixels to scroll the list by. Zero when the row is already clear — a row that can be seen is
 * left exactly where the user put it.
 */
export function scrollToReveal({ row, keyboardTop, barHeight, margin = 12 }: RevealInput): number {
  const values = [row.y, row.height, keyboardTop, barHeight, margin];
  if (!values.every(Number.isFinite)) return 0;

  const visibleBottom = keyboardTop - Math.max(0, barHeight);
  const overlap = row.y + Math.max(0, row.height) + margin - visibleBottom;
  return overlap > 0 ? Math.ceil(overlap) : 0;
}
