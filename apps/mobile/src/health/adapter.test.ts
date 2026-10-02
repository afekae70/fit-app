/**
 * Health Connect mapping tests.
 *
 * Pure functions over recorded-shape objects, so the matching and conversion logic is verified
 * without the native module, without a watch, and without a development build.
 */

import { describe, expect, it } from 'vitest';

import {
  checkAvailability,
  findMatchingWorkout,
  isStrengthWorkout,
  toImportedWorkout,
  type HealthWorkout,
} from './adapter.js';
import { HEALTH_EXERCISE_TYPE } from './exerciseTypes.js';

const STRENGTH = HEALTH_EXERCISE_TYPE.STRENGTH_TRAINING;
const RUNNING = HEALTH_EXERCISE_TYPE.RUNNING;

function workout(overrides: Partial<HealthWorkout> = {}): HealthWorkout {
  return {
    id: 'hc-1',
    exerciseType: STRENGTH,
    startTime: '2026-07-25T17:00:00.000Z',
    endTime: '2026-07-25T18:05:00.000Z',
    ...overrides,
  };
}

describe('toImportedWorkout', () => {
  it('computes duration in whole minutes', () => {
    const imported = toImportedWorkout(workout());
    expect(imported?.durationMinutes).toBe(65);
  });

  it('carries heart rate and calories through', () => {
    const imported = toImportedWorkout(
      workout({ activeCalories: 412, averageHeartRateBpm: 128, maxHeartRateBpm: 165 }),
    );
    expect(imported?.activeCalories).toBe(412);
    expect(imported?.averageHeartRateBpm).toBe(128);
    expect(imported?.maxHeartRateBpm).toBe(165);
  });

  it('reports missing optional fields as null rather than undefined', () => {
    const imported = toImportedWorkout(workout());
    expect(imported?.activeCalories).toBeNull();
    expect(imported?.averageHeartRateBpm).toBeNull();
  });

  it('rejects an inverted time range instead of producing a negative duration', () => {
    const bad = workout({
      startTime: '2026-07-25T18:00:00.000Z',
      endTime: '2026-07-25T17:00:00.000Z',
    });
    expect(toImportedWorkout(bad)).toBeNull();
  });

  it('rejects a zero-length session', () => {
    const zero = workout({ endTime: '2026-07-25T17:00:00.000Z' });
    expect(toImportedWorkout(zero)).toBeNull();
  });

  it('rejects unparseable timestamps', () => {
    expect(toImportedWorkout(workout({ startTime: 'not-a-date' }))).toBeNull();
  });

  it('rejects a session under 30 seconds, which rounds to zero minutes', () => {
    const brief = workout({
      startTime: '2026-07-25T17:00:00.000Z',
      endTime: '2026-07-25T17:00:20.000Z',
    });
    expect(toImportedWorkout(brief)).toBeNull();
  });
});

describe('isStrengthWorkout', () => {
  it('accepts strength training and weightlifting', () => {
    expect(isStrengthWorkout(workout({ exerciseType: HEALTH_EXERCISE_TYPE.STRENGTH_TRAINING }))).toBe(
      true,
    );
    expect(isStrengthWorkout(workout({ exerciseType: HEALTH_EXERCISE_TYPE.WEIGHTLIFTING }))).toBe(
      true,
    );
  });

  it('rejects a run, which a watch writes into the same store', () => {
    // A watch writes walks, runs and sleep into the same store. Attaching a 40-minute walk
    // to a bench-press session would produce nonsense duration and calorie figures.
    expect(isStrengthWorkout(workout({ exerciseType: RUNNING }))).toBe(false);
  });
});

describe('findMatchingWorkout', () => {
  const session = {
    startedAt: '2026-07-25T17:05:00.000Z',
    endedAt: '2026-07-25T18:00:00.000Z',
  };

  it('matches a watch session that overlaps the logged one', () => {
    const match = findMatchingWorkout([workout()], session);
    expect(match?.id).toBe('hc-1');
  });

  it('matches when the watch was started AFTER the app', () => {
    const later = workout({
      id: 'later',
      startTime: '2026-07-25T17:10:00.000Z',
      endTime: '2026-07-25T18:02:00.000Z',
    });
    expect(findMatchingWorkout([later], session)?.id).toBe('later');
  });

  it('picks the candidate with the greatest overlap, not the nearest start', () => {
    const slight = workout({
      id: 'slight',
      startTime: '2026-07-25T17:04:00.000Z',
      endTime: '2026-07-25T17:12:00.000Z',
    });
    const full = workout({
      id: 'full',
      startTime: '2026-07-25T17:06:00.000Z',
      endTime: '2026-07-25T17:58:00.000Z',
    });

    // 'slight' starts closer to the session, but covers only 7 minutes of it.
    expect(findMatchingWorkout([slight, full], session)?.id).toBe('full');
  });

  it('ignores a non-strength session by default', () => {
    const run = workout({ exerciseType: RUNNING });
    expect(findMatchingWorkout([run], session)).toBeNull();
  });

  it('can be told to consider any activity type', () => {
    const run = workout({ exerciseType: RUNNING });
    expect(findMatchingWorkout([run], session, { strengthOnly: false })?.id).toBe('hc-1');
  });

  it('ignores a session from a different day', () => {
    const yesterday = workout({
      startTime: '2026-07-24T17:00:00.000Z',
      endTime: '2026-07-24T18:00:00.000Z',
    });
    expect(findMatchingWorkout([yesterday], session)).toBeNull();
  });

  it('ignores a long recording whose start is far outside the tolerance', () => {
    // An all-day recording technically overlaps, but attaching it would report a 10-hour
    // bench session.
    const allDay = workout({
      startTime: '2026-07-25T08:00:00.000Z',
      endTime: '2026-07-25T20:00:00.000Z',
    });
    expect(findMatchingWorkout([allDay], session)).toBeNull();
  });

  it('returns null with no candidates', () => {
    expect(findMatchingWorkout([], session)).toBeNull();
  });

  it('skips candidates with corrupt times without throwing', () => {
    const corrupt = workout({ id: 'bad', endTime: 'nonsense' });
    const good = workout({ id: 'good' });
    expect(findMatchingWorkout([corrupt, good], session)?.id).toBe('good');
  });
});

describe('checkAvailability', () => {
  it('is available on Android with the native module and Health Connect installed', () => {
    expect(checkAvailability({ platform: 'android', hasNativeModule: true, isInstalled: true })).toEqual(
      { available: true },
    );
  });

  it('reports the missing native module distinctly from a missing app', () => {
    // These need different messages: one is "install Health Connect", the other is "this
    // build cannot do it at all". A single greyed-out button would explain neither.
    expect(checkAvailability({ platform: 'android', hasNativeModule: false })).toEqual({
      available: false,
      reason: 'no_native_module',
    });
    expect(
      checkAvailability({ platform: 'android', hasNativeModule: true, isInstalled: false }),
    ).toEqual({ available: false, reason: 'not_installed' });
  });

  it('reports iOS as unsupported — Health Connect is Android only', () => {
    expect(checkAvailability({ platform: 'ios', hasNativeModule: true })).toEqual({
      available: false,
      reason: 'not_android',
    });
  });
});
