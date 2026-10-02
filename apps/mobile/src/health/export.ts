/**
 * Turning a finished workout into Health Connect records.
 *
 * Health Connect is Android's system health store, and the reason to write into it is that other
 * apps read from it: a workout logged here then shows up in Samsung Health, Google Fit, a ring's
 * app, anything the user already looks at. Write once, appear everywhere, without this app having
 * to integrate with any of them.
 *
 * Three record types carry a workout:
 *
 *  - `ExerciseSession` — the block of time, its kind, its name. The entry itself.
 *  - `Distance` — kilometres, for the cardio that has them.
 *  - `ActiveCaloriesBurned` — the estimate, and only where the app already shows one.
 *
 * All of it is pure here: the native module lives in writer.ts, so the mapping — which is where
 * the mistakes are — can be tested against real catalogue keys with no device involved.
 *
 * Every record carries a `clientRecordId` built from the session's own id. That is what makes
 * writing idempotent: re-exporting a workout replaces its records instead of adding a second
 * copy of the same hour, and editing a workout and exporting again overwrites what was there,
 * since the version rides on the session's `updated_at`.
 */

import { EXERCISE_BY_KEY } from '@fit/shared/catalog';
import type { HealthConnectRecord } from 'react-native-health-connect';

import { caloriesBurned, cardioKind, cardioMet } from '../workout/calories.js';
import { HEALTH_EXERCISE_TYPE } from './exerciseTypes.js';

/** One logged set, in the shape the sets table stores it. */
export interface HealthExportSet {
  reps: number | null;
  weightKg: number | null;
  durationSeconds: number | null;
  distanceM: number | null;
  isWarmup: boolean;
}

export interface HealthExportExercise {
  /** The catalogue key, which is the English name — see EXERCISE_BY_KEY. */
  exerciseKey: string;
  sets: readonly HealthExportSet[];
}

export interface HealthExportSession {
  id: string;
  name: string | null;
  startedAt: string;
  endedAt: string | null;
  /** Last edit, which becomes the record version so a re-export wins over what is stored. */
  updatedAt?: string | null;
  /** The weigh-in a calorie estimate needs. Without it, no calories are written. */
  bodyWeightKg: number | null;
  exercises: readonly HealthExportExercise[];
}

export interface HealthSessionStats {
  exerciseType: number;
  startTime: string;
  endTime: string;
  durationMinutes: number;
  /** Exercises that hold at least one working set. */
  exerciseCount: number;
  /** Working sets — warmups excluded, as everywhere else in the app. */
  setCount: number;
  volumeKg: number;
  distanceMeters: number;
  caloriesKcal: number | null;
}

/**
 * A session shorter than this is not a workout, it is a mis-tap.
 *
 * Writing it would put a one-minute block into Samsung Health's day, which is noise in someone
 * else's app — the kind of thing that makes people turn an integration off.
 */
const MINIMUM_SECONDS = 60;

/**
 * Cardio keys mapped to what Health Connect calls them.
 *
 * Specific where the distinction exists in both places — a treadmill run and a run outdoors are
 * separate types there as they are here — and silent where it does not: Health Connect has no
 * treadmill *walk*, so that is a walk.
 */
const CARDIO_TYPE_BY_KEY: Readonly<Record<string, number>> = {
  'Treadmill Run': HEALTH_EXERCISE_TYPE.RUNNING_TREADMILL,
  'Outdoor Run': HEALTH_EXERCISE_TYPE.RUNNING,
  Walk: HEALTH_EXERCISE_TYPE.WALKING,
  'Treadmill Walk': HEALTH_EXERCISE_TYPE.WALKING,
  'Incline Walk': HEALTH_EXERCISE_TYPE.WALKING,
  'Outdoor Cycling': HEALTH_EXERCISE_TYPE.BIKING,
  'Stationary Bike': HEALTH_EXERCISE_TYPE.BIKING_STATIONARY,
  'Assault Bike': HEALTH_EXERCISE_TYPE.BIKING_STATIONARY,
  Hike: HEALTH_EXERCISE_TYPE.HIKING,
  'Ruck March': HEALTH_EXERCISE_TYPE.HIKING,
  Swim: HEALTH_EXERCISE_TYPE.SWIMMING_POOL,
  'Rowing Machine': HEALTH_EXERCISE_TYPE.ROWING_MACHINE,
  Elliptical: HEALTH_EXERCISE_TYPE.ELLIPTICAL,
  'Jump Rope': HEALTH_EXERCISE_TYPE.JUMP_ROPE,
};

/** The fallback for a cardio exercise the catalogue does not know — a user's own entry. */
const CARDIO_TYPE_BY_KIND: Readonly<Record<string, number>> = {
  walk: HEALTH_EXERCISE_TYPE.WALKING,
  run: HEALTH_EXERCISE_TYPE.RUNNING,
  cycle: HEALTH_EXERCISE_TYPE.BIKING_STATIONARY,
  swim: HEALTH_EXERCISE_TYPE.SWIMMING_POOL,
  row: HEALTH_EXERCISE_TYPE.ROWING_MACHINE,
  other: HEALTH_EXERCISE_TYPE.OTHER_WORKOUT,
};

/** True when the exercise is measured by the clock and the distance rather than by load. */
function isCardioKey(exerciseKey: string): boolean {
  if (CARDIO_TYPE_BY_KEY[exerciseKey] !== undefined) return true;
  return EXERCISE_BY_KEY.get(exerciseKey)?.loadType === 'cardio';
}

function cardioTypeFor(exerciseKey: string): number {
  return (
    CARDIO_TYPE_BY_KEY[exerciseKey] ??
    CARDIO_TYPE_BY_KIND[cardioKind(exerciseKey)] ??
    HEALTH_EXERCISE_TYPE.OTHER_WORKOUT
  );
}

/**
 * Which kind of session this was, as Health Connect's single type field.
 *
 * A workout here can be several things at once and that field cannot, so:
 *
 *  - all cardio, all of one kind — a ride is a ride, a walk is a walk;
 *  - all cardio of different kinds — OTHER_WORKOUT, because calling a walk-and-swim a swim would
 *    put the wrong icon and the wrong assumptions on it in every app downstream;
 *  - anything with lifting in it — STRENGTH_TRAINING, which is what the session is for even when
 *    it ends with ten minutes on a bike.
 */
export function healthExerciseType(exerciseKeys: readonly string[]): number {
  if (exerciseKeys.length === 0) return HEALTH_EXERCISE_TYPE.OTHER_WORKOUT;
  if (!exerciseKeys.every(isCardioKey)) return HEALTH_EXERCISE_TYPE.STRENGTH_TRAINING;

  const types = new Set(exerciseKeys.map(cardioTypeFor));
  const [only] = [...types];
  return types.size === 1 && only !== undefined ? only : HEALTH_EXERCISE_TYPE.OTHER_WORKOUT;
}

/**
 * The numbers a workout contributes, or null when there is nothing to contribute.
 *
 * Null covers the cases that should never reach another app at all: a session still open, times
 * that run backwards (a clock change mid-workout), something too short to be training, and a
 * session with no exercises in it — started by accident and finished.
 */
export function summariseForHealth(session: HealthExportSession): HealthSessionStats | null {
  if (!session.endedAt) return null;

  const start = new Date(session.startedAt).getTime();
  const end = new Date(session.endedAt).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  if (end - start < MINIMUM_SECONDS * 1000) return null;
  if (session.exercises.length === 0) return null;

  let setCount = 0;
  let volumeKg = 0;
  let distanceMeters = 0;
  let exerciseCount = 0;
  let caloriesKcal: number | null = null;

  for (const exercise of session.exercises) {
    const working = exercise.sets.filter((set) => !set.isWarmup);
    if (working.length > 0) exerciseCount += 1;

    setCount += working.length;
    for (const set of working) {
      volumeKg += (set.weightKg ?? 0) * (set.reps ?? 0);
      distanceMeters += set.distanceM ?? 0;
    }

    // Calories, only for the cardio the app already estimates them for. A number invented here
    // for a bench press would be a different number from the one on screen, and two estimates
    // that disagree are worse than one.
    if (!isCardioKey(exercise.exerciseKey)) continue;

    const seconds = working.reduce((total, set) => total + (set.durationSeconds ?? 0), 0);
    const metres = working.reduce((total, set) => total + (set.distanceM ?? 0), 0);
    if (seconds <= 0) continue;

    const speedKmh = metres > 0 ? metres / 1000 / (seconds / 3600) : null;
    const kcal = caloriesBurned(
      cardioMet(cardioKind(exercise.exerciseKey), speedKmh),
      session.bodyWeightKg,
      seconds,
    );
    if (kcal !== null) caloriesKcal = (caloriesKcal ?? 0) + kcal;
  }

  return {
    exerciseType: healthExerciseType(session.exercises.map((exercise) => exercise.exerciseKey)),
    startTime: new Date(start).toISOString(),
    endTime: new Date(end).toISOString(),
    durationMinutes: Math.round((end - start) / 60000),
    exerciseCount,
    setCount,
    volumeKg: Math.round(volumeKg),
    distanceMeters: Math.round(distanceMeters),
    caloriesKcal,
  };
}

/** What the session is called in the other app, and the line under it. */
export interface HealthExportText {
  /** Used when the workout was never named. */
  title: string;
  notes?: string;
}

/**
 * The record version.
 *
 * Health Connect replaces a stored record only when the incoming one carries a higher version
 * for the same `clientRecordId`. The session's last edit is therefore the version: finishing a
 * workout, then renaming it an hour later and exporting again, has to win over what the first
 * export wrote. Seconds rather than milliseconds — the field is a 64-bit integer and these go
 * through JSON.
 */
function recordVersion(session: HealthExportSession, endTime: string): number {
  const stamps = [session.updatedAt, endTime]
    .map((value) => (value ? new Date(value).getTime() : NaN))
    .filter((value) => Number.isFinite(value));
  return Math.floor(Math.max(...stamps) / 1000);
}

/**
 * The records to insert for one finished workout — empty when it should not be written at all.
 *
 * Distance and calories are separate records rather than fields because that is how Health
 * Connect models them, and they are written only when there is something to write: a Distance
 * record of zero would make a bench-press session look like a walk that went nowhere.
 */
export function buildHealthRecords(
  session: HealthExportSession,
  text: HealthExportText,
): HealthConnectRecord[] {
  const stats = summariseForHealth(session);
  if (!stats) return [];

  const { startTime, endTime } = stats;
  const clientRecordVersion = recordVersion(session, endTime);
  // 1 is RECORDING_METHOD_ACTIVELY_RECORDED: a session the user started and stopped, not one
  // inferred from sensors and not typed in afterwards. Spelled as the number because the enum
  // lives in the native package, which this module stays clear of.
  const recordingMethod = 1;
  const metadata = (suffix: string) => ({
    clientRecordId: `novafit-session-${session.id}${suffix}`,
    clientRecordVersion,
    recordingMethod,
  });

  const title = session.name?.trim() || text.title;

  const records: HealthConnectRecord[] = [
    {
      recordType: 'ExerciseSession',
      startTime,
      endTime,
      exerciseType: stats.exerciseType,
      title,
      ...(text.notes ? { notes: text.notes } : {}),
      metadata: metadata(''),
    },
  ];

  if (stats.distanceMeters > 0) {
    records.push({
      recordType: 'Distance',
      startTime,
      endTime,
      distance: { value: stats.distanceMeters, unit: 'meters' },
      metadata: metadata('-distance'),
    });
  }

  if (stats.caloriesKcal !== null && stats.caloriesKcal > 0) {
    records.push({
      recordType: 'ActiveCaloriesBurned',
      startTime,
      endTime,
      energy: { value: stats.caloriesKcal, unit: 'kilocalories' },
      metadata: metadata('-calories'),
    });
  }

  return records;
}
