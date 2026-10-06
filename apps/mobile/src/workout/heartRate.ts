/**
 * Heart rate during a workout: what a reading means, and when it has stopped being one.
 *
 * The number itself comes from somewhere else — a watch, a chest strap, anything that can produce
 * beats per minute. This file does not care which. It answers the questions the screen has to ask
 * of any source: is this reading still current, which training zone is it in, and what did the
 * session look like as a whole.
 *
 * All pure, because the alternatives are a watch on a wrist and a real heart.
 */

/** One reading: beats per minute, and when it was taken (epoch milliseconds). */
export interface HeartRateSample {
  bpm: number;
  at: number;
}

/**
 * What a human heart can plausibly report.
 *
 * An optical sensor that loses skin contact does not go quiet, it goes wrong — a strap sliding on
 * a sweaty wrist reads 0, or 255, or half the true rate. Outside this band the reading is the
 * sensor's problem, not the wearer's, and showing it would be worse than showing nothing.
 */
const MIN_PLAUSIBLE_BPM = 30;
const MAX_PLAUSIBLE_BPM = 230;

export function isPlausibleBpm(bpm: number): boolean {
  return Number.isFinite(bpm) && bpm >= MIN_PLAUSIBLE_BPM && bpm <= MAX_PLAUSIBLE_BPM;
}

/**
 * How long a reading stays worth showing.
 *
 * A watch sends about one a second. Eight seconds of silence is several missed in a row, which is
 * a connection that has dropped rather than a hiccup — and a heart rate frozen on screen is a
 * number someone will pace a set against. Past this, the screen shows that it has no reading.
 */
export const STALE_AFTER_MS = 8000;

export function isFresh(sample: HeartRateSample | null, now: number): sample is HeartRateSample {
  if (!sample) return false;
  const age = now - sample.at;
  // A reading stamped in the future is a clock that disagrees with this one, not a stale one.
  return age < STALE_AFTER_MS;
}

/**
 * Maximum heart rate from age: 208 − 0.7 × age (Tanaka, 2001).
 *
 * Not 220 − age, which is the one everybody knows and which was never derived from data — it
 * overestimates in the young and underestimates past forty. Tanaka's comes from a meta-analysis
 * of 351 studies and is the one exercise physiology actually uses.
 *
 * Still an estimate: individual maxima scatter by ten beats either side of any formula. It is
 * good enough to say which zone a set was in, and not good enough to prescribe from.
 */
export function estimateMaxHeartRate(ageYears: number): number | null {
  if (!Number.isFinite(ageYears) || ageYears < 10 || ageYears > 100) return null;
  return Math.round(208 - 0.7 * ageYears);
}

/** 1 to 5, the five training zones; 0 is below all of them — resting, or between sets. */
export type HeartRateZone = 0 | 1 | 2 | 3 | 4 | 5;

/**
 * Which zone a reading is in, as a share of the maximum.
 *
 * The standard five, in tenths from 50%: recovery, endurance, tempo, threshold, maximum. Below
 * half the maximum is not training at all, which for lifting is most of the rest between sets —
 * so it gets a zone of its own rather than being called zone one.
 *
 * Null when there is no maximum to measure against, which is anyone who has not entered a birth
 * date. The screen then shows the number without a colour rather than guessing an age.
 */
export function heartRateZone(bpm: number, maxBpm: number | null): HeartRateZone | null {
  if (maxBpm === null || maxBpm <= 0 || !isPlausibleBpm(bpm)) return null;

  const share = bpm / maxBpm;
  if (share < 0.5) return 0;
  if (share < 0.6) return 1;
  if (share < 0.7) return 2;
  if (share < 0.8) return 3;
  if (share < 0.9) return 4;
  return 5;
}

/** The running picture of a session's heart rate. */
export interface HeartRateStats {
  count: number;
  /** Sum of every accepted reading, kept so the average never needs the readings themselves. */
  total: number;
  min: number | null;
  max: number | null;
}

export const EMPTY_HEART_RATE_STATS: HeartRateStats = { count: 0, total: 0, min: null, max: null };

/**
 * Fold one more reading into the session's stats.
 *
 * A running sum rather than a kept list: an hour at one reading a second is 3,600 numbers to hold
 * for the sake of an average and two extremes. Implausible readings are dropped here too, so one
 * sensor glitch cannot become the session's "maximum".
 */
export function accumulateHeartRate(stats: HeartRateStats, bpm: number): HeartRateStats {
  if (!isPlausibleBpm(bpm)) return stats;
  return {
    count: stats.count + 1,
    total: stats.total + bpm,
    min: stats.min === null ? bpm : Math.min(stats.min, bpm),
    max: stats.max === null ? bpm : Math.max(stats.max, bpm),
  };
}

export function averageHeartRate(stats: HeartRateStats): number | null {
  return stats.count > 0 ? Math.round(stats.total / stats.count) : null;
}
