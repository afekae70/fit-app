/**
 * Heart rate, without a heart.
 *
 * The screen will show whatever these functions say, to someone mid-set who is not going to
 * double-check it. So the cases that matter are the ones where the sensor is wrong or silent:
 * a reading that is not a pulse, a reading that stopped arriving, a session with one glitch in it.
 */

import { describe, expect, it } from 'vitest';

import {
  accumulateHeartRate,
  averageHeartRate,
  EMPTY_HEART_RATE_STATS,
  estimateMaxHeartRate,
  heartRateZone,
  isFresh,
  isPlausibleBpm,
  STALE_AFTER_MS,
} from './heartRate.js';

describe('isPlausibleBpm', () => {
  it('accepts what a heart can do', () => {
    expect(isPlausibleBpm(48)).toBe(true);
    expect(isPlausibleBpm(132)).toBe(true);
    expect(isPlausibleBpm(198)).toBe(true);
  });

  it('rejects what only a sensor off the skin reports', () => {
    expect(isPlausibleBpm(0)).toBe(false);
    expect(isPlausibleBpm(255)).toBe(false);
    expect(isPlausibleBpm(-5)).toBe(false);
    expect(isPlausibleBpm(Number.NaN)).toBe(false);
  });
});

describe('isFresh', () => {
  const now = 1_000_000;

  it('holds a reading for a few seconds', () => {
    expect(isFresh({ bpm: 120, at: now - 1000 }, now)).toBe(true);
    expect(isFresh({ bpm: 120, at: now - (STALE_AFTER_MS - 1) }, now)).toBe(true);
  });

  it('lets go of one that stopped arriving', () => {
    // A frozen number is one someone will pace a set against.
    expect(isFresh({ bpm: 120, at: now - STALE_AFTER_MS }, now)).toBe(false);
    expect(isFresh({ bpm: 120, at: now - 60_000 }, now)).toBe(false);
  });

  it('has nothing to show before the first reading', () => {
    expect(isFresh(null, now)).toBe(false);
  });

  it('does not call a reading stale because two clocks disagree', () => {
    expect(isFresh({ bpm: 120, at: now + 2000 }, now)).toBe(true);
  });
});

describe('estimateMaxHeartRate', () => {
  it('follows Tanaka rather than 220 minus age', () => {
    expect(estimateMaxHeartRate(20)).toBe(194);
    expect(estimateMaxHeartRate(30)).toBe(187);
    expect(estimateMaxHeartRate(50)).toBe(173);
  });

  it('declines to guess from an age that is not one', () => {
    expect(estimateMaxHeartRate(Number.NaN)).toBeNull();
    expect(estimateMaxHeartRate(3)).toBeNull();
    expect(estimateMaxHeartRate(140)).toBeNull();
  });
});

describe('heartRateZone', () => {
  const max = 190;

  it('puts a reading in the zone its share of the maximum falls in', () => {
    expect(heartRateZone(90, max)).toBe(0); // 47% — between sets
    expect(heartRateZone(100, max)).toBe(1); // 53%
    expect(heartRateZone(120, max)).toBe(2); // 63%
    expect(heartRateZone(140, max)).toBe(3); // 74%
    expect(heartRateZone(160, max)).toBe(4); // 84%
    expect(heartRateZone(180, max)).toBe(5); // 95%
  });

  it('keeps the top zone above the estimated maximum', () => {
    // The formula is an estimate; plenty of people beat it. That is zone five, not an error.
    expect(heartRateZone(200, max)).toBe(5);
  });

  it('has no zone without a maximum to measure against', () => {
    expect(heartRateZone(140, null)).toBeNull();
  });

  it('has no zone for a reading that is not a pulse', () => {
    expect(heartRateZone(0, max)).toBeNull();
    expect(heartRateZone(255, max)).toBeNull();
  });
});

describe('accumulateHeartRate', () => {
  it('keeps the average and both extremes without keeping the readings', () => {
    const stats = [110, 150, 130].reduce(accumulateHeartRate, EMPTY_HEART_RATE_STATS);

    expect(stats.count).toBe(3);
    expect(stats.min).toBe(110);
    expect(stats.max).toBe(150);
    expect(averageHeartRate(stats)).toBe(130);
  });

  it('does not let one sensor glitch become the session maximum', () => {
    const stats = [120, 255, 0, 124].reduce(accumulateHeartRate, EMPTY_HEART_RATE_STATS);

    expect(stats.count).toBe(2);
    expect(stats.max).toBe(124);
    expect(averageHeartRate(stats)).toBe(122);
  });

  it('has no average before the first reading', () => {
    expect(averageHeartRate(EMPTY_HEART_RATE_STATS)).toBeNull();
  });
});
