/**
 * The arithmetic behind drag-to-reorder, kept apart from the gesture that drives it.
 *
 * Split out for the same reason the BLE parsers are: this is the part that is easy to get
 * subtly wrong and impossible to eyeball. A drop index that is off by one looks like a laggy
 * animation rather than a bug, and it can only be caught by a test that does the sums.
 *
 * Rows are deliberately not assumed to be equal height. An exercise card with two sets is a
 * different size from one with six, so every threshold here is computed from the real measured
 * heights instead of a row-height constant.
 */

/**
 * Which index a row lands on, given how far it has been dragged.
 *
 * The row passes over a neighbour once it has travelled beyond that neighbour's midpoint — the
 * same rule the eye applies, so the list rearranges when it looks like it should. Walking stops
 * at the first neighbour not cleared, because heights vary and a later short row must not be
 * jumped over while a taller one in between is still only half covered.
 *
 * `dy` is the distance dragged from where the row started: positive down, negative up.
 */
export function resolveDropIndex(
  heights: readonly number[],
  activeIndex: number,
  dy: number,
): number {
  if (activeIndex < 0 || activeIndex >= heights.length) return activeIndex;

  let target = activeIndex;
  let travelled = 0;

  if (dy > 0) {
    for (let i = activeIndex + 1; i < heights.length; i++) {
      const height = heights[i] ?? 0;
      travelled += height;
      if (dy <= travelled - height / 2) break;
      target = i;
    }
  } else if (dy < 0) {
    for (let i = activeIndex - 1; i >= 0; i--) {
      const height = heights[i] ?? 0;
      travelled += height;
      if (-dy <= travelled - height / 2) break;
      target = i;
    }
  }

  return target;
}

/**
 * How far a row that is NOT being dragged should slide, to open a gap where the dragged one
 * will land.
 *
 * Only the rows between the origin and the target move, and they move by exactly the height of
 * the dragged row — which is why the gap that opens is always the right size regardless of how
 * different the two cards are.
 */
export function shiftForIndex(
  index: number,
  activeIndex: number,
  targetIndex: number,
  activeHeight: number,
): number {
  if (index === activeIndex) return 0;

  // Dragged downward: everything it passed slides up to fill the space it left.
  if (targetIndex > activeIndex && index > activeIndex && index <= targetIndex) {
    return -activeHeight;
  }
  // Dragged upward: everything it passed slides down.
  if (targetIndex < activeIndex && index >= targetIndex && index < activeIndex) {
    return activeHeight;
  }
  return 0;
}

/**
 * Where the dragged row must come to rest, so it settles into the gap rather than snapping.
 *
 * Not simply `dy`: the finger can be anywhere within the target slot when it lifts, and letting
 * the card stay there would leave it visibly misaligned for the instant before the reordered
 * list re-renders underneath it.
 */
export function restingOffset(
  heights: readonly number[],
  activeIndex: number,
  targetIndex: number,
): number {
  if (targetIndex === activeIndex) return 0;

  let offset = 0;
  if (targetIndex > activeIndex) {
    for (let i = activeIndex + 1; i <= targetIndex; i++) offset += heights[i] ?? 0;
  } else {
    for (let i = targetIndex; i < activeIndex; i++) offset -= heights[i] ?? 0;
  }
  return offset;
}
