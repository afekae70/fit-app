/**
 * How hard a whole session was, and what that adds up to over a week.
 *
 * Volume — sets times weight — describes what was moved, and describes it badly for anything
 * that is not a barbell. An hour of heavy squats and an hour of light machine work can produce
 * similar tonnage and cost completely different amounts. Session RPE is the other half: one
 * number, given by the person who did it, for how hard the whole thing was.
 *
 * ## Load is effort times time
 *
 * `sRPE × minutes`, the standard session-load metric. It is deliberately crude — a 10-minute
 * maximal effort and a 100-minute easy one land in the same place, which is roughly true of
 * what they cost and completely false about what they train. Load is for watching the *trend*
 * in what training is costing, not for comparing two sessions of different kinds.
 *
 * ## Five choices, not ten
 *
 * The scale is 1-10 and the app offers five anchored points on it. A number given while catching
 * your breath is not precise to one point in ten, and offering ten buttons would claim it is.
 * The anchors are what the reader is actually judging: could I have done much more, a little
 * more, or nothing at all.
 */

/** The offered ratings and what each one means. Values are points on the usual 1-10 scale. */
export const SESSION_EFFORT_CHOICES = [2, 4, 6, 8, 10] as const;

export type SessionEffort = (typeof SESSION_EFFORT_CHOICES)[number];

/**
 * Session load: effort times duration.
 *
 * Null when either half is missing, rather than 0. A session with no rating has an unknown cost,
 * and a zero would drag a weekly average down as though it had been free.
 */
export function sessionLoad(
  rpe: number | null | undefined,
  minutes: number | null | undefined,
): number | null {
  if (typeof rpe !== 'number' || !Number.isFinite(rpe) || rpe <= 0) return null;
  if (typeof minutes !== 'number' || !Number.isFinite(minutes) || minutes <= 0) return null;
  return Math.round(rpe * minutes);
}

/**
 * Weekly load from the sessions in a week, and how it compares with the week before.
 *
 * The ratio is what sports science calls acute:chronic — this week's load against the recent
 * average — and a jump much above 1.5 is the shape that precedes injuries. It is reported as a
 * plain ratio rather than a warning, because one hard week after a holiday is not a problem and
 * the app is in no position to tell the two apart.
 */
export function loadRatio(thisWeek: number, previousWeeks: readonly number[]): number | null {
  const known = previousWeeks.filter((n) => Number.isFinite(n) && n > 0);
  if (known.length === 0 || thisWeek <= 0) return null;
  const average = known.reduce((sum, n) => sum + n, 0) / known.length;
  if (average <= 0) return null;
  return Number((thisWeek / average).toFixed(2));
}
