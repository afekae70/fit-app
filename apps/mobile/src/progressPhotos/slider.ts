/**
 * Where the divider of the before-and-after slider is, after a drag.
 *
 * Kept as a distance from the frame's *start* edge — the right in Hebrew, the left in English —
 * because that is how the layout places the earlier photo: from the start, the way the page is
 * read, before and then after. A touch, though, moves in physical pixels and does not mirror
 * (see CLAUDE.md, gestures), so a drag to the right is a move away from the start in English and
 * towards it in Hebrew. That one flip is the whole of the right-to-left handling, and it is here.
 */

/** The divider after dragging `dx` physical pixels from where it was at the touch's start. */
export function dividerAfterDrag(
  fromStart: number,
  dx: number,
  width: number,
  isRTL: boolean,
): number {
  const moved = fromStart + (isRTL ? -dx : dx);
  return Math.max(0, Math.min(width, moved));
}

/** A screen reader's step: a tenth of the frame, towards the start or away from it. */
export function dividerStep(fromStart: number, width: number, towardsStart: boolean): number {
  const step = width / 10;
  return Math.max(0, Math.min(width, fromStart + (towardsStart ? -step : step)));
}

/** How much of the earlier photo shows, as a whole percentage, for a screen reader. */
export function shownPercent(fromStart: number, width: number): number {
  return width <= 0 ? 0 : Math.round((fromStart / width) * 100);
}
