/**
 * Let only the newest read of the database reach the screen.
 *
 * The workout screen reloads itself from several places — ticking a set, saving a typed number,
 * coming back to the tab — and each reload is a chain of awaits. Two of them overlap constantly,
 * and nothing made them land in the order they started: an older snapshot arriving last put the
 * screen back the way it was a moment ago, which is exactly what "I ticked the second set and
 * the first one lost its tick" looks like. The data was never wrong; the picture was.
 *
 * So every reload takes a ticket on the way in and checks it before it writes. A reload that has
 * been overtaken finishes its work and says nothing.
 */

export interface LatestOnly {
  /** Take a ticket. Every earlier ticket is now stale. */
  begin: () => number;
  /** Whether this ticket is still the newest one handed out. */
  isCurrent: (ticket: number) => boolean;
}

export function createLatestOnly(): LatestOnly {
  let current = 0;
  return {
    begin: () => {
      current += 1;
      return current;
    },
    isCurrent: (ticket: number) => ticket === current,
  };
}
