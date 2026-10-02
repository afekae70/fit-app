/**
 * Watch / health-platform import.
 *
 * A Galaxy Watch does not talk to this app directly. The chain is:
 *
 *     Galaxy Watch → Samsung Health → Health Connect (Android) → this app
 *
 * Health Connect is Android's system-level health store; Samsung Health writes into it, and
 * apps read from it with per-type permission. That is the only supported path — there is no
 * public Samsung Health SDK for third-party reads, and pairing the watch over raw Bluetooth
 * is not something the watch exposes.
 *
 * The mapping logic lives here as pure functions so it is testable now. Actually reading
 * requires `react-native-health-connect`, a native module, which means a development build —
 * exactly the same constraint as the BLE scale.
 */

import { HEALTH_EXERCISE_TYPE } from './exerciseTypes.js';

/** A workout session as Health Connect reports it. */
export interface HealthWorkout {
  id: string;
  /** Health Connect exercise type code. */
  exerciseType: number;
  title?: string | null;
  startTime: string;
  endTime: string;
  /** Kilocalories actively burned, when the watch recorded them. */
  activeCalories?: number | null;
  averageHeartRateBpm?: number | null;
  maxHeartRateBpm?: number | null;
}

/** What the app takes from a watch session. */
export interface ImportedWorkoutData {
  durationMinutes: number;
  startedAt: string;
  endedAt: string;
  activeCalories: number | null;
  averageHeartRateBpm: number | null;
  maxHeartRateBpm: number | null;
}

/**
 * Health Connect exercise-type codes worth offering as a strength session.
 *
 * The list is deliberately narrow. A watch records walking, cycling and sleep into the same
 * store, and offering to attach a 40-minute walk to a bench-press session would produce
 * nonsense duration and calorie figures.
 */
export const STRENGTH_EXERCISE_TYPES: readonly number[] = [
  HEALTH_EXERCISE_TYPE.STRENGTH_TRAINING,
  HEALTH_EXERCISE_TYPE.WEIGHTLIFTING,
  HEALTH_EXERCISE_TYPE.CALISTHENICS,
  HEALTH_EXERCISE_TYPE.GYMNASTICS,
  HEALTH_EXERCISE_TYPE.HIGH_INTENSITY_INTERVAL_TRAINING,
];

export function isStrengthWorkout(workout: HealthWorkout): boolean {
  return STRENGTH_EXERCISE_TYPES.includes(workout.exerciseType);
}

/**
 * Convert a Health Connect session into the fields the app stores.
 *
 * Returns null when the times are missing or inverted rather than producing a negative
 * duration — a corrupt record from the watch should be skipped, not written to history.
 */
export function toImportedWorkout(workout: HealthWorkout): ImportedWorkoutData | null {
  const start = new Date(workout.startTime).getTime();
  const end = new Date(workout.endTime).getTime();

  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  if (end <= start) return null;

  const durationMinutes = Math.round((end - start) / 60000);
  if (durationMinutes <= 0) return null;

  return {
    durationMinutes,
    startedAt: new Date(start).toISOString(),
    endedAt: new Date(end).toISOString(),
    activeCalories: workout.activeCalories ?? null,
    averageHeartRateBpm: workout.averageHeartRateBpm ?? null,
    maxHeartRateBpm: workout.maxHeartRateBpm ?? null,
  };
}

/**
 * Pick the watch session that best matches a logged workout.
 *
 * Matching is by time overlap, not by nearest start: a user typically starts the app and the
 * watch a few minutes apart, and whichever came first varies. Overlap handles both orders,
 * and requiring a real overlap avoids attaching yesterday's run to today's session.
 *
 * `toleranceMinutes` allows for the gap between tapping "start" in each app.
 */
export function findMatchingWorkout(
  candidates: readonly HealthWorkout[],
  session: { startedAt: string; endedAt: string },
  { toleranceMinutes = 30, strengthOnly = true } = {},
): HealthWorkout | null {
  const sessionStart = new Date(session.startedAt).getTime();
  const sessionEnd = new Date(session.endedAt).getTime();
  if (!Number.isFinite(sessionStart) || !Number.isFinite(sessionEnd)) return null;

  const toleranceMs = toleranceMinutes * 60_000;

  let best: { workout: HealthWorkout; overlap: number } | null = null;

  for (const candidate of candidates) {
    if (strengthOnly && !isStrengthWorkout(candidate)) continue;

    const start = new Date(candidate.startTime).getTime();
    const end = new Date(candidate.endTime).getTime();
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue;

    // Reject anything whose start is nowhere near the session, even if a long watch
    // recording technically overlaps.
    if (Math.abs(start - sessionStart) > toleranceMs) continue;

    const overlap = Math.min(end, sessionEnd) - Math.max(start, sessionStart);
    if (overlap <= 0) continue;

    if (!best || overlap > best.overlap) best = { workout: candidate, overlap };
  }

  return best?.workout ?? null;
}

/* -------------------------------------------------------------------------- */
/* Availability                                                                */
/* -------------------------------------------------------------------------- */

export type HealthAvailability =
  | { available: true }
  | { available: false; reason: 'not_android' | 'no_native_module' | 'not_installed' };

/**
 * Whether health import can run at all.
 *
 * Reported as a typed reason rather than a bare boolean so the UI can explain *why* — "install
 * Health Connect" and "this needs a development build" are very different messages, and a
 * greyed-out button with no explanation is the worst of both.
 */
export function checkAvailability(input: {
  platform: string;
  hasNativeModule: boolean;
  isInstalled?: boolean;
}): HealthAvailability {
  if (input.platform !== 'android') return { available: false, reason: 'not_android' };
  // In Expo Go the native module is simply absent — no amount of permission prompting helps.
  if (!input.hasNativeModule) return { available: false, reason: 'no_native_module' };
  if (input.isInstalled === false) return { available: false, reason: 'not_installed' };
  return { available: true };
}
