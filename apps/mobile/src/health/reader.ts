/**
 * The Health Connect transport: reads workouts recorded by the watch.
 *
 * On Android there is no direct path from a Galaxy Watch to a third-party app. The chain is
 * Watch → Samsung Health → Health Connect → here, which means the data is only as fresh as
 * Samsung Health's last sync. That is a property of the platform, not something this code can
 * work around, so `readWorkouts` reports what it finds rather than pretending to poll a watch.
 *
 * All matching and conversion logic lives in adapter.ts, pure and unit-tested. This file is the
 * part that needs the native module, and like the BLE scanner it loads it lazily: in Expo Go the
 * module is absent, and a static import would crash the app at startup instead of letting the
 * screen explain that a development build is required.
 */

import { Platform } from 'react-native';

import {
  checkAvailability,
  findMatchingWorkout,
  toImportedWorkout,
  type HealthAvailability,
  type HealthWorkout,
  type ImportedWorkoutData,
} from './adapter.js';

/** The record types read. Weight is included so a Samsung scale can feed the weight tracker. */
const READ_PERMISSIONS = [
  { accessType: 'read', recordType: 'ExerciseSession' },
  { accessType: 'read', recordType: 'HeartRate' },
  { accessType: 'read', recordType: 'ActiveCaloriesBurned' },
  { accessType: 'read', recordType: 'TotalCaloriesBurned' },
  { accessType: 'read', recordType: 'Weight' },
] as const;

interface HealthConnectModule {
  initialize(): Promise<boolean>;
  requestPermission(permissions: readonly unknown[]): Promise<unknown[]>;
  getGrantedPermissions(): Promise<unknown[]>;
  getSdkStatus(): Promise<number>;
  readRecords(
    recordType: string,
    options: { timeRangeFilter: { operator: string; startTime: string; endTime: string } },
  ): Promise<{ records: unknown[] }>;
}

/**
 * Health Connect SDK status codes.
 *
 * 3 means available; 1 means unavailable on this device; 2 means the app that provides it needs
 * an update. Only 3 is usable, and the two failure codes are worth distinguishing because the
 * user's remedy differs — one is "this phone cannot", the other is "update Health Connect".
 */
const SDK_AVAILABLE = 3;
const SDK_PROVIDER_UPDATE_REQUIRED = 2;

function loadHealthConnect(): HealthConnectModule | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('react-native-health-connect') as HealthConnectModule;
  } catch {
    return null;
  }
}

/**
 * Whether Health Connect can be used at all.
 *
 * Delegates the decision to the pure `checkAvailability` so the rule lives in one tested place;
 * this only gathers the facts it needs.
 */
export async function checkHealthAvailability(): Promise<HealthAvailability> {
  const module = loadHealthConnect();
  if (!module) {
    return checkAvailability({ platform: Platform.OS, hasNativeModule: false });
  }

  try {
    const status = await module.getSdkStatus();
    return checkAvailability({
      platform: Platform.OS,
      hasNativeModule: true,
      isInstalled: status === SDK_AVAILABLE,
    });
  } catch {
    return checkAvailability({ platform: Platform.OS, hasNativeModule: true, isInstalled: false });
  }
}

/** True when Health Connect exists but the provider app itself needs updating. */
export async function needsProviderUpdate(): Promise<boolean> {
  const module = loadHealthConnect();
  if (!module) return false;
  try {
    return (await module.getSdkStatus()) === SDK_PROVIDER_UPDATE_REQUIRED;
  } catch {
    return false;
  }
}

/**
 * Ask for read access.
 *
 * Health Connect permissions are granted inside the Health Connect app, per data type — not by
 * the usual runtime dialog. A user can therefore grant exercise but deny heart rate, so the
 * result is the set actually granted rather than a single boolean.
 */
export async function requestHealthPermissions(): Promise<boolean> {
  const module = loadHealthConnect();
  if (!module) return false;

  try {
    await module.initialize();
    const granted = await module.requestPermission(READ_PERMISSIONS);
    return granted.length > 0;
  } catch {
    return false;
  }
}

interface RawSession {
  metadata?: { id?: string } | null;
  exerciseType?: number;
  title?: string | null;
  startTime?: string;
  endTime?: string;
}

interface RawHeartRate {
  samples?: { beatsPerMinute?: number }[] | null;
  startTime?: string;
  endTime?: string;
}

interface RawCalories {
  energy?: { inKilocalories?: number } | null;
  startTime?: string;
  endTime?: string;
}

/**
 * Read exercise sessions in a window, enriched with heart rate and calories.
 *
 * Heart rate and calories are separate record types in Health Connect — a session does not carry
 * them — so they are read for the same window and attributed to whichever session they overlap.
 */
export async function readWorkouts(input: {
  startTime: string;
  endTime: string;
}): Promise<HealthWorkout[]> {
  const module = loadHealthConnect();
  if (!module) return [];

  const timeRangeFilter = {
    operator: 'between',
    startTime: input.startTime,
    endTime: input.endTime,
  };

  try {
    await module.initialize();

    const [sessions, heartRates, activeCalories] = await Promise.all([
      module.readRecords('ExerciseSession', { timeRangeFilter }),
      module.readRecords('HeartRate', { timeRangeFilter }).catch(() => ({ records: [] })),
      module
        .readRecords('ActiveCaloriesBurned', { timeRangeFilter })
        .catch(() => ({ records: [] })),
    ]);

    return (sessions.records as RawSession[])
      .filter((raw) => raw.startTime && raw.endTime)
      .map((raw) => {
        const start = new Date(raw.startTime!).getTime();
        const end = new Date(raw.endTime!).getTime();

        const overlaps = (from?: string, to?: string): boolean => {
          if (!from || !to) return false;
          return new Date(from).getTime() < end && new Date(to).getTime() > start;
        };

        const bpm = (heartRates.records as RawHeartRate[])
          .filter((record) => overlaps(record.startTime, record.endTime))
          .flatMap((record) => record.samples ?? [])
          .map((sample) => sample.beatsPerMinute)
          .filter((value): value is number => typeof value === 'number' && value > 0);

        const kcal = (activeCalories.records as RawCalories[])
          .filter((record) => overlaps(record.startTime, record.endTime))
          .reduce((total, record) => total + (record.energy?.inKilocalories ?? 0), 0);

        return {
          id: raw.metadata?.id ?? `${raw.startTime!}-${raw.exerciseType ?? 0}`,
          exerciseType: raw.exerciseType ?? 0,
          title: raw.title ?? null,
          startTime: raw.startTime!,
          endTime: raw.endTime!,
          activeCalories: kcal > 0 ? Math.round(kcal) : null,
          averageHeartRateBpm:
            bpm.length > 0 ? Math.round(bpm.reduce((a, b) => a + b, 0) / bpm.length) : null,
          maxHeartRateBpm: bpm.length > 0 ? Math.max(...bpm) : null,
        } satisfies HealthWorkout;
      });
  } catch {
    return [];
  }
}

/**
 * Find the watch's record of a session that has just been logged.
 *
 * The window is widened past the session's own bounds because the watch is usually started a
 * little before the first set and stopped a little after the last. Matching itself is by time
 * *overlap* rather than nearest start — see `findMatchingWorkout` — so a 40-minute walk that
 * merely began near the session cannot be attached to a bench press.
 */
export async function importForSession(session: {
  startedAt: string;
  endedAt: string;
}): Promise<ImportedWorkoutData | null> {
  const PADDING_MS = 2 * 60 * 60 * 1000;

  const workouts = await readWorkouts({
    startTime: new Date(new Date(session.startedAt).getTime() - PADDING_MS).toISOString(),
    endTime: new Date(new Date(session.endedAt).getTime() + PADDING_MS).toISOString(),
  });

  const match = findMatchingWorkout(workouts, session);
  return match ? toImportedWorkout(match) : null;
}
