/**
 * Body-weight trend analysis.
 *
 * Daily scale weight swings by 1-2 kg from water, glycogen, sodium and gut contents. Reading
 * raw daily values as progress is the single most common way people misjudge a diet — and it
 * would make the AI coach's advice wrong too. Everything here exists to smooth that noise
 * before any decision is made from it.
 */

import { KCAL_PER_KG_BODY_MASS } from './constants.js';
import { leastSquaresSlope } from './strength.js';

export interface WeightPoint {
  date: Date;
  weightKg: number;
}

/**
 * Trailing simple moving average over a window of days.
 *
 * Uses a *date*-based window rather than a fixed count of readings, because weigh-ins are
 * irregular — a count-based window would silently compare a dense week against a sparse
 * month. Days with multiple readings are averaged first so a day you weighed twice does not
 * get double weight.
 */
export function movingAverage(
  points: readonly WeightPoint[],
  windowDays = 7,
): WeightPoint[] {
  if (points.length === 0) return [];

  const sorted = [...points].sort((a, b) => a.date.getTime() - b.date.getTime());
  const windowMs = windowDays * 24 * 60 * 60 * 1000;

  return sorted.map((point) => {
    const windowStart = point.date.getTime() - windowMs;
    const inWindow = sorted.filter(
      (p) => p.date.getTime() > windowStart && p.date.getTime() <= point.date.getTime(),
    );
    const mean = inWindow.reduce((sum, p) => sum + p.weightKg, 0) / inWindow.length;
    return { date: point.date, weightKg: mean };
  });
}

/** Average one reading per calendar day (UTC), so duplicate weigh-ins don't skew a window. */
export function collapseToDailyAverages(points: readonly WeightPoint[]): WeightPoint[] {
  const byDay = new Map<string, { sum: number; count: number; date: Date }>();

  for (const p of points) {
    const key = p.date.toISOString().slice(0, 10);
    const existing = byDay.get(key);
    if (existing) {
      existing.sum += p.weightKg;
      existing.count += 1;
    } else {
      byDay.set(key, { sum: p.weightKg, count: 1, date: new Date(`${key}T12:00:00.000Z`) });
    }
  }

  return [...byDay.values()]
    .map(({ sum, count, date }) => ({ date, weightKg: sum / count }))
    .sort((a, b) => a.date.getTime() - b.date.getTime());
}

export interface RateOfChange {
  /** Positive means gaining, negative means losing. */
  kgPerWeek: number;
  /** Number of distinct days contributing to the estimate. */
  dayCount: number;
  /** Calendar days spanned from first to last reading. */
  spanDays: number;
  /**
   * False when the estimate rests on too little data or too short a span to be meaningful.
   * Callers — and especially the AI context builder — should not present an unreliable rate
   * as fact. Fewer than ~14 days of data cannot separate a real trend from water weight.
   */
  isReliable: boolean;
}

/**
 * Rate of body-weight change in kg/week, by least-squares regression over daily averages.
 *
 * Regression rather than (last − first) / weeks, because endpoint subtraction is at the mercy
 * of noise in exactly two readings; a salty meal the night before the final weigh-in can flip
 * the sign. Regression uses every point.
 */
export function weeklyRateOfChange(
  points: readonly WeightPoint[],
  { minDays = 14 } = {},
): RateOfChange | null {
  const daily = collapseToDailyAverages(points);
  if (daily.length < 2) return null;

  const first = daily[0];
  const last = daily[daily.length - 1];
  if (!first || !last) return null;

  const spanDays = Math.round(
    (last.date.getTime() - first.date.getTime()) / (24 * 60 * 60 * 1000),
  );

  // Regress against actual elapsed days, not array index, so irregular gaps are handled.
  const dayOffsets = daily.map(
    (p) => (p.date.getTime() - first.date.getTime()) / (24 * 60 * 60 * 1000),
  );
  const slopePerDay = slopeAgainst(dayOffsets, daily.map((p) => p.weightKg));
  if (slopePerDay === null) return null;

  return {
    kgPerWeek: slopePerDay * 7,
    dayCount: daily.length,
    spanDays,
    isReliable: daily.length >= 3 && spanDays >= minDays,
  };
}

/** Least-squares slope of y against arbitrary (non-uniform) x values. */
export function slopeAgainst(xs: readonly number[], ys: readonly number[]): number | null {
  const n = Math.min(xs.length, ys.length);
  if (n < 2) return null;

  const meanX = xs.slice(0, n).reduce((a, b) => a + b, 0) / n;
  const meanY = ys.slice(0, n).reduce((a, b) => a + b, 0) / n;

  let numerator = 0;
  let denominator = 0;
  for (let i = 0; i < n; i++) {
    const x = xs[i];
    const y = ys[i];
    if (x === undefined || y === undefined) continue;
    numerator += (x - meanX) * (y - meanY);
    denominator += (x - meanX) ** 2;
  }

  return denominator === 0 ? null : numerator / denominator;
}

/**
 * Compare observed weight change against what the prescribed calorie target predicted, and
 * return the daily calorie adjustment that would close the gap.
 *
 * This is what makes the weekly recalculation self-correcting: rather than trusting the
 * activity multiplier's estimate of TDEE forever, it treats the estimate as a hypothesis and
 * corrects it against what the scale actually did.
 *
 * The 7700 kcal/kg conversion is approximate — early diet changes shift glycogen and water,
 * not just fat — so damp the correction rather than applying it in full.
 */
export function calorieAdjustmentFromDrift(
  observedKgPerWeek: number,
  expectedKgPerWeek: number,
  { dampingFactor = 0.5, maxDailyAdjustment = 300 } = {},
): number {
  const driftKgPerWeek = observedKgPerWeek - expectedKgPerWeek;
  const rawDailyKcal = (driftKgPerWeek * KCAL_PER_KG_BODY_MASS) / 7;
  // Gaining faster than intended => reduce intake, hence the negation.
  const adjustment = -rawDailyKcal * dampingFactor;
  const clamped = Math.round(
    Math.max(-maxDailyAdjustment, Math.min(maxDailyAdjustment, adjustment)),
  );
  // Normalise negative zero: `Object.is(-0, 0)` is false, so a bare -0 here would break
  // equality checks and "no adjustment needed" comparisons downstream.
  return clamped === 0 ? 0 : clamped;
}

/** Expected weekly weight change implied by a daily calorie surplus/deficit. */
export function expectedKgPerWeek(dailyCalorieDelta: number): number {
  return (dailyCalorieDelta * 7) / KCAL_PER_KG_BODY_MASS;
}

export { leastSquaresSlope };
