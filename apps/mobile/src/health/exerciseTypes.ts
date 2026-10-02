/**
 * Health Connect's exercise-type codes.
 *
 * They are plain integers on the wire, and the ones this app uses are listed here by name so
 * that nothing else has to carry a bare number with a comment next to it. The values are
 * `androidx.health.connect.client.records.ExerciseSessionRecord`'s own, mirrored by
 * `react-native-health-connect`'s `ExerciseType` constant — but written out rather than imported,
 * because that package is the native module and importing it here would pull it into the pure
 * modules and their tests.
 *
 * This file exists because the numbers were wrong. The read side had 56 labelled
 * STRENGTH_TRAINING (it is RUNNING), 32 labelled GYMNASTICS (it is GOLF) and a test that agreed
 * with both mistakes — which is exactly what happens when the same magic number is typed out in
 * three places. One list, checked once, against the SDK.
 */
export const HEALTH_EXERCISE_TYPE = {
  OTHER_WORKOUT: 0,
  BIKING: 8,
  BIKING_STATIONARY: 9,
  BOOT_CAMP: 10,
  CALISTHENICS: 13,
  ELLIPTICAL: 25,
  GYMNASTICS: 34,
  HIGH_INTENSITY_INTERVAL_TRAINING: 36,
  HIKING: 37,
  JUMP_ROPE: 41,
  ROWING_MACHINE: 54,
  RUNNING: 56,
  RUNNING_TREADMILL: 57,
  STAIR_CLIMBING_MACHINE: 69,
  STRENGTH_TRAINING: 70,
  STRETCHING: 71,
  SWIMMING_POOL: 74,
  WALKING: 79,
  WEIGHTLIFTING: 81,
  YOGA: 83,
} as const;

export type HealthExerciseType = (typeof HEALTH_EXERCISE_TYPE)[keyof typeof HEALTH_EXERCISE_TYPE];
