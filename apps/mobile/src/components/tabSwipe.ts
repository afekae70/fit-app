/**
 * Which tab a sideways drag lands on.
 *
 * Dragging from left to right moves forward — היום → אימון → תוכנית → התקדמות — and dragging back
 * the other way returns. That is the direction asked for, and it matches the tab bar in Hebrew,
 * where the first tab sits on the right and the page being pulled in comes from that side.
 *
 * Neither end wraps around: the last tab does not jump back to the first, which would turn a
 * mis-swipe into a leap across the app.
 */

/** Enough travel to be a deliberate drag rather than a slipped tap. */
export const SWIPE_DISTANCE = 60;

export function tabAfterSwipe(dx: number, index: number, count: number): number | null {
  if (Math.abs(dx) < SWIPE_DISTANCE) return null;
  const target = index + (dx > 0 ? 1 : -1);
  if (target < 0 || target >= count) return null;
  return target;
}
