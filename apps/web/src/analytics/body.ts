/**
 * A trainee's weigh-ins, as the coach reads them: one figure a day, the trend under the noise,
 * and how fast it is moving.
 *
 * A body's weight swings by a kilogram or more from one morning to the next with water and
 * salt, so a single reading says little and two readings a week apart can say the opposite of
 * what is happening. The rate here is the slope through every day in the period, not the last
 * reading minus the first, and the line drawn under the daily points is a seven-day average.
 */

import type { CoachMeasurement } from '@fit/shared/coaching';

import { daysApart, localDate } from './dates.js';

export interface BodyDay {
  /** Local day. */
  date: string;
  /** The day's readings averaged; null on a day with only a body-fat figure. */
  weightKg: number | null;
  bodyFatPct: number | null;
  muscleMassKg: number | null;
}

const average = (values: readonly number[]): number | null =>
  values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length;

const numbers = (values: readonly (number | null)[]): number[] =>
  values.filter((value): value is number => value !== null);

/** The weigh-ins between two local days, inclusive, one per day, oldest first. */
export function bodyDays(
  measurements: readonly CoachMeasurement[],
  from: string,
  to: string,
): BodyDay[] {
  const byDay = new Map<string, CoachMeasurement[]>();
  for (const measurement of measurements) {
    const day = localDate(new Date(measurement.measuredAt));
    if (day < from || day > to) continue;
    const list = byDay.get(day);
    if (list) list.push(measurement);
    else byDay.set(day, [measurement]);
  }
  return [...byDay.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([date, readings]) => ({
      date,
      weightKg: average(numbers(readings.map((r) => r.weightKg))),
      bodyFatPct: average(numbers(readings.map((r) => r.bodyFatPct))),
      muscleMassKg: average(numbers(readings.map((r) => r.muscleMassKg))),
    }));
}

/**
 * For each day with a weight, the average of the weights in the seven days ending on it. The
 * line a coach should read; the dots around it are the noise.
 */
export function weeklyAverage(days: readonly BodyDay[]): { date: string; weightKg: number }[] {
  const weighed = days.filter((day): day is BodyDay & { weightKg: number } => day.weightKg !== null);
  return weighed.map((day) => {
    const window = weighed.filter((other) => {
      const apart = daysApart(other.date, day.date);
      return apart >= 0 && apart < 7;
    });
    return { date: day.date, weightKg: average(window.map((other) => other.weightKg))! };
  });
}

/**
 * Kilograms per week, from the least-squares line through every weighed day. Null with fewer
 * than three weigh-ins or less than a week between the first and last: too little to call a
 * direction.
 */
export function weeklyRate(days: readonly BodyDay[]): number | null {
  const points = days
    .filter((day): day is BodyDay & { weightKg: number } => day.weightKg !== null)
    .map((day) => ({ x: daysApart(days[0]!.date, day.date), y: day.weightKg }));
  if (points.length < 3) return null;
  const span = points[points.length - 1]!.x - points[0]!.x;
  if (span < 7) return null;
  const meanX = average(points.map((p) => p.x))!;
  const meanY = average(points.map((p) => p.y))!;
  let covariance = 0;
  let variance = 0;
  for (const point of points) {
    covariance += (point.x - meanX) * (point.y - meanY);
    variance += (point.x - meanX) ** 2;
  }
  return variance === 0 ? null : (covariance / variance) * 7;
}

export interface BodySummary {
  latest: { date: string; weightKg: number } | null;
  /** The seven-day average at the end of the period against the one at its start. */
  changeKg: number | null;
  weeklyRateKg: number | null;
  latestBodyFat: number | null;
  /** The last body-fat figure against the first, in percentage points. */
  bodyFatChange: number | null;
  /** Days with a weigh-in. */
  weighIns: number;
}

export function bodySummary(days: readonly BodyDay[]): BodySummary {
  const trend = weeklyAverage(days);
  const lastWeighed = [...days].reverse().find((day) => day.weightKg !== null);
  const fats = days.filter((day) => day.bodyFatPct !== null);
  const firstTrend = trend[0];
  const lastTrend = trend[trend.length - 1];
  return {
    latest: lastWeighed ? { date: lastWeighed.date, weightKg: lastWeighed.weightKg! } : null,
    changeKg:
      firstTrend && lastTrend && trend.length >= 2
        ? lastTrend.weightKg - firstTrend.weightKg
        : null,
    weeklyRateKg: weeklyRate(days),
    latestBodyFat: fats[fats.length - 1]?.bodyFatPct ?? null,
    bodyFatChange:
      fats.length >= 2 ? fats[fats.length - 1]!.bodyFatPct! - fats[0]!.bodyFatPct! : null,
    weighIns: days.filter((day) => day.weightKg !== null).length,
  };
}
