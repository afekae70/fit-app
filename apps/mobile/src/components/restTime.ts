/**
 * Rest-timer arithmetic, kept out of `RestTimer.tsx` so it can be tested.
 *
 * The component is JSX and vitest runs these tests in plain node, so importing the `.tsx` to
 * reach one function fails to parse. This is the same split the app already uses for
 * `callbackParams.ts` and `stream.ts`: the decision is pure and testable, the rendering is not.
 */

export const DEFAULT_REST_SECONDS = 90;

/** How much a "+30" press adds. */
export const REST_STEP_SECONDS = 30;

/**
 * `m:ss`, the prototype's format.
 *
 * Rounds **up**, so a timer never displays a second it has not finished — counting to 1:29 while
 * a second is still running reads as a skipped tick. Floors at zero, because the interval keeps
 * firing briefly past the deadline and "-0:01" flashing on the way out looks like a bug.
 */
export function formatRest(seconds: number): string {
  const clamped = Math.max(0, Math.ceil(seconds));
  const minutes = Math.floor(clamped / 60);
  const rest = clamped % 60;
  return `${minutes}:${String(rest).padStart(2, '0')}`;
}

/**
 * Fraction of the rest still remaining, 1 → 0.
 *
 * Clamped at both ends: the ring must not overshoot when a "+30" lands after the deadline has
 * already passed, which would otherwise make `remaining / total` exceed 1.
 */
export function restFraction(remainingSeconds: number, totalSeconds: number): number {
  if (totalSeconds <= 0) return 0;
  return Math.min(1, Math.max(0, remainingSeconds / totalSeconds));
}
