/**
 * Reordering the workout by dragging a picture along the exercise strip.
 *
 * Kept apart from the component so the two decisions it makes can be tested to the slot: where a
 * drag lands, and which exercise that moves where in the session.
 */

/**
 * The slot a drag ends in, given how far it travelled (already including any auto-scroll), the
 * width of one slot, and how many there are. Rounded to the nearest slot and kept on the strip.
 */
export function stripDropTarget(from: number, travelled: number, slot: number, count: number): number {
  if (count <= 0 || slot <= 0) return from;
  const target = from + Math.round(travelled / slot);
  return Math.max(0, Math.min(count - 1, target));
}

/**
 * Turn a station move into an exercise move for the session's own reorder.
 *
 * A station is one exercise, or a superset of several performed together. Only a single-exercise
 * station moves: pulling one half of a superset out by dragging its picture would quietly break
 * the pair. It lands at the target station's edge — its first exercise moving back, its last
 * moving forward — so it never ends up inside a superset either.
 *
 * Null when nothing should move.
 */
export function stationMove(
  groups: readonly (readonly number[])[],
  from: number,
  to: number,
): { fromIndex: number; toIndex: number } | null {
  if (from === to) return null;
  const moving = groups[from];
  const target = groups[to];
  if (!moving || !target || moving.length !== 1) return null;
  const fromIndex = moving[0]!;
  const toIndex = to > from ? target[target.length - 1]! : target[0]!;
  return fromIndex === toIndex ? null : { fromIndex, toIndex };
}
