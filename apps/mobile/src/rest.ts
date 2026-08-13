/**
 * Rest-countdown arithmetic.
 *
 * Kept out of RestTimer.tsx on purpose. That file imports react-native and contains JSX, which
 * vitest deliberately does not load (see vitest.config.ts) — so logic left inside it could not
 * be tested at all. Same seam as executor.ts vs provider.ts.
 *
 * Both functions take the current time as an argument rather than reading the clock. The whole
 * design of the timer rests on being derived from a wall-clock deadline instead of a
 * decrementing counter, and that is only checkable if "now" can be moved around.
 */

/** Seconds left until the deadline, never negative. */
export function remainingSeconds(endsAt: number, now: number): number {
  // Rounded up, so a timer with any time left never displays 0:00.
  return Math.max(0, Math.ceil((endsAt - now) / 1000));
}

/** `M:SS`. Rest is minutes, never hours, so there is no third field. */
export function formatCountdown(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${minutes}:${String(rest).padStart(2, '0')}`;
}
