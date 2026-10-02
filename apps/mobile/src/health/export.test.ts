/**
 * What gets written into Health Connect, and what deliberately does not.
 *
 * The mapping is the part worth testing: a wrong exercise type puts a walk in Samsung Health
 * labelled as weightlifting, and a wrong clientRecordId puts the same hour in twice. Both are
 * visible in someone else's app, where this app cannot go and fix them.
 *
 * Real catalogue keys throughout — the mapping is keyed by them, so a test with invented keys
 * would pass while the shipped thing exported everything as OTHER_WORKOUT.
 */

import { describe, expect, it } from 'vitest';

import {
  buildHealthRecords,
  healthExerciseType,
  summariseForHealth,
  type HealthExportExercise,
  type HealthExportSession,
  type HealthExportSet,
} from './export.js';
import { HEALTH_EXERCISE_TYPE } from './exerciseTypes.js';

function set(overrides: Partial<HealthExportSet> = {}): HealthExportSet {
  return {
    reps: 10,
    weightKg: 50,
    durationSeconds: null,
    distanceM: null,
    isWarmup: false,
    ...overrides,
  };
}

function exercise(exerciseKey: string, sets: HealthExportSet[]): HealthExportExercise {
  return { exerciseKey, sets };
}

function session(overrides: Partial<HealthExportSession> = {}): HealthExportSession {
  return {
    id: 'session-1',
    name: null,
    startedAt: '2026-09-28T17:00:00.000Z',
    endedAt: '2026-09-28T18:05:00.000Z',
    bodyWeightKg: 80,
    exercises: [exercise('Barbell Bench Press', [set(), set()])],
    ...overrides,
  };
}

describe('healthExerciseType', () => {
  it('calls anything with lifting in it strength training', () => {
    expect(healthExerciseType(['Barbell Bench Press'])).toBe(
      HEALTH_EXERCISE_TYPE.STRENGTH_TRAINING,
    );
    // A lift and a cool-down ride is still a lifting session; the ride is not what it was for.
    expect(healthExerciseType(['Barbell Bench Press', 'Stationary Bike'])).toBe(
      HEALTH_EXERCISE_TYPE.STRENGTH_TRAINING,
    );
  });

  it('maps a cardio-only session to its own kind', () => {
    expect(healthExerciseType(['Walk'])).toBe(HEALTH_EXERCISE_TYPE.WALKING);
    expect(healthExerciseType(['Treadmill Run'])).toBe(HEALTH_EXERCISE_TYPE.RUNNING_TREADMILL);
    expect(healthExerciseType(['Outdoor Run'])).toBe(HEALTH_EXERCISE_TYPE.RUNNING);
    expect(healthExerciseType(['Outdoor Cycling'])).toBe(HEALTH_EXERCISE_TYPE.BIKING);
    // Health Connect has no treadmill walk, so it is a walk rather than something invented.
    expect(healthExerciseType(['Walk', 'Treadmill Walk'])).toBe(HEALTH_EXERCISE_TYPE.WALKING);
  });

  it('refuses to pick a side between two kinds of cardio', () => {
    expect(healthExerciseType(['Walk', 'Swim'])).toBe(HEALTH_EXERCISE_TYPE.OTHER_WORKOUT);
  });
});

describe('summariseForHealth', () => {
  it('counts working sets and volume, and leaves warmups out', () => {
    const stats = summariseForHealth(
      session({
        exercises: [
          exercise('Barbell Bench Press', [
            set({ isWarmup: true, weightKg: 20 }),
            set({ weightKg: 60, reps: 8 }),
            set({ weightKg: 60, reps: 6 }),
          ]),
        ],
      }),
    );

    expect(stats).not.toBeNull();
    expect(stats?.setCount).toBe(2);
    expect(stats?.exerciseCount).toBe(1);
    expect(stats?.volumeKg).toBe(60 * 8 + 60 * 6);
    expect(stats?.durationMinutes).toBe(65);
    expect(stats?.exerciseType).toBe(HEALTH_EXERCISE_TYPE.STRENGTH_TRAINING);
  });

  it('sums the distance of a cardio effort and estimates its calories', () => {
    const stats = summariseForHealth(
      session({
        startedAt: '2026-09-28T06:00:00.000Z',
        endedAt: '2026-09-28T07:00:00.000Z',
        exercises: [
          exercise('Walk', [
            set({ reps: null, weightKg: null, durationSeconds: 3600, distanceM: 5000 }),
          ]),
        ],
      }),
    );

    expect(stats?.distanceMeters).toBe(5000);
    expect(stats?.exerciseType).toBe(HEALTH_EXERCISE_TYPE.WALKING);
    // 5 km in an hour is a brisk walk: a MET in the fours, which for 80 kg over an hour is a
    // few hundred kilocalories. The exact figure is calories.ts's business, tested there.
    expect(stats?.caloriesKcal).toBeGreaterThan(200);
    expect(stats?.caloriesKcal).toBeLessThan(500);
  });

  it('reports no calories without a weigh-in', () => {
    const stats = summariseForHealth(
      session({
        bodyWeightKg: null,
        exercises: [
          exercise('Walk', [
            set({ reps: null, weightKg: null, durationSeconds: 3600, distanceM: 5000 }),
          ]),
        ],
      }),
    );

    expect(stats?.caloriesKcal).toBeNull();
  });

  it('skips a session that is still open', () => {
    expect(summariseForHealth(session({ endedAt: null }))).toBeNull();
  });

  it('skips a mis-tap and a clock that ran backwards', () => {
    expect(summariseForHealth(session({ endedAt: '2026-09-28T17:00:30.000Z' }))).toBeNull();
    expect(summariseForHealth(session({ endedAt: '2026-09-28T16:00:00.000Z' }))).toBeNull();
  });

  it('skips a session with nothing in it', () => {
    expect(summariseForHealth(session({ exercises: [] }))).toBeNull();
  });
});

describe('buildHealthRecords', () => {
  const text = { title: 'Workout', notes: '2 sets' };

  it('writes one session record for a lifting workout', () => {
    const records = buildHealthRecords(session({ name: 'Push A' }), text);

    expect(records).toHaveLength(1);
    const record = records[0]!;
    expect(record.recordType).toBe('ExerciseSession');
    expect(record).toMatchObject({
      startTime: '2026-09-28T17:00:00.000Z',
      endTime: '2026-09-28T18:05:00.000Z',
      title: 'Push A',
      notes: '2 sets',
      exerciseType: HEALTH_EXERCISE_TYPE.STRENGTH_TRAINING,
    });
  });

  it('falls back to the given title when the workout was never named', () => {
    const records = buildHealthRecords(session({ name: '   ' }), text);
    expect(records[0]).toMatchObject({ title: 'Workout' });
  });

  it('adds distance and calories for a walk', () => {
    const records = buildHealthRecords(
      session({
        exercises: [
          exercise('Walk', [
            set({ reps: null, weightKg: null, durationSeconds: 3900, distanceM: 5200 }),
          ]),
        ],
      }),
      text,
    );

    expect(records.map((record) => record.recordType)).toEqual([
      'ExerciseSession',
      'Distance',
      'ActiveCaloriesBurned',
    ]);
    expect(records[1]).toMatchObject({ distance: { value: 5200, unit: 'meters' } });
  });

  it('keys every record to the session so a second export replaces the first', () => {
    const only = session({
      exercises: [
        exercise('Walk', [set({ reps: null, weightKg: null, durationSeconds: 3900, distanceM: 1 })]),
      ],
    });
    const ids = buildHealthRecords(only, text).map((record) => record.metadata?.clientRecordId);

    expect(ids).toEqual([
      'novafit-session-session-1',
      'novafit-session-session-1-distance',
      'novafit-session-session-1-calories',
    ]);
  });

  it('raises the record version when the workout has been edited since', () => {
    const first = buildHealthRecords(session(), text)[0]!;
    const edited = buildHealthRecords(session({ updatedAt: '2026-09-28T19:30:00.000Z' }), text)[0]!;

    expect(edited.metadata?.clientRecordVersion).toBeGreaterThan(
      first.metadata?.clientRecordVersion ?? 0,
    );
  });

  it('writes nothing for a workout that should not leave the app', () => {
    expect(buildHealthRecords(session({ endedAt: null }), text)).toEqual([]);
  });
});
