/**
 * The contract between the app and the AI coach endpoint.
 *
 * The app sends a *digest*, never raw training rows. Two reasons, and both matter:
 *
 *  1. **Cost and accuracy.** A model asked to derive e1RM from 200 set rows will spend tokens
 *     doing arithmetic and will sometimes get it wrong. The app already computes these figures
 *     in SQL, against the same `@fit/shared` functions the UI displays — so the coach reasons
 *     about the exact numbers the user is looking at.
 *  2. **Size.** The whole payload stays in the low kilobytes, which keeps the volatile part of
 *     the prompt small and the cacheable prefix (persona + catalogue) dominant.
 *
 * Why the app is the source of truth today: training data lives in the phone's SQLite and is
 * not yet replayed to Postgres. The server therefore has nothing to build a context from and
 * takes the client's word for it. That is acceptable pre-auth — the user is describing their
 * own training to their own coach — but it is a trust boundary, and once auth and sync land
 * the server should recompute this from the database rather than accept it from the client.
 * Until then the schema is validated strictly so a malformed or hostile payload is rejected at
 * the edge instead of being interpolated into a prompt.
 */

import { z } from 'zod';

/** A finite number within plausible human/barbell range — rejects NaN, Infinity and garbage. */
const bounded = (min: number, max: number) => z.number().finite().min(min).max(max);

export const coachProfileSchema = z.object({
  ageYears: z.number().int().min(13).max(120).nullable(),
  sex: z.enum(['male', 'female', 'other']).nullable(),
  heightCm: bounded(90, 260).nullable(),
  weightKg: bounded(25, 400).nullable(),
  activityLevel: z
    .enum(['sedentary', 'light', 'moderate', 'active', 'very_active'])
    .nullable(),
  goal: z.enum(['cut', 'maintain', 'bulk']).nullable(),
});

export const coachTargetsSchema = z.object({
  bmi: bounded(5, 100).nullable(),
  bmrKcal: z.number().int().min(500).max(6000).nullable(),
  tdeeKcal: z.number().int().min(500).max(12000).nullable(),
  calorieTarget: z.number().int().min(500).max(12000).nullable(),
  proteinG: z.number().int().min(0).max(600).nullable(),
  carbsG: z.number().int().min(0).max(1500).nullable(),
  fatG: z.number().int().min(0).max(500).nullable(),
});

/** One exercise's trajectory. `isStalling` is computed in SQL, not inferred by the model. */
export const coachExerciseProgressSchema = z.object({
  /** The catalogue's stable English key, so the model and the app mean the same lift. */
  exerciseKey: z.string().min(1).max(120),
  sessionCount: z.number().int().min(0).max(10_000),
  latestE1rmKg: bounded(0, 1000).nullable(),
  bestE1rmKg: bounded(0, 1000).nullable(),
  /** Change in estimated 1RM between the most recent session and the one before it. */
  e1rmDeltaKg: bounded(-1000, 1000).nullable(),
  /** Least-squares slope of working-set volume across sessions. */
  volumeSlopePerSession: bounded(-100_000, 100_000).nullable(),
  sessionsSinceBest: z.number().int().min(0).max(10_000),
  isStalling: z.boolean(),
});

export const coachWeightTrendSchema = z.object({
  currentKg: bounded(25, 400).nullable(),
  /** Signed: negative while losing. Least-squares over the trailing window. */
  kgPerWeek: bounded(-10, 10).nullable(),
  /**
   * False when there are too few measurements over too short a window for the slope to mean
   * anything. The coach must not read a two-day trend as a trajectory.
   */
  isReliable: z.boolean(),
  measurementCount: z.number().int().min(0).max(100_000),
});

/** Prescribed vs actual for one exercise in the most recent planned session. */
export const coachAdherenceSchema = z.object({
  exerciseKey: z.string().min(1).max(120),
  targetSets: z.number().int().min(0).max(100).nullable(),
  targetRepsMin: z.number().int().min(0).max(1000).nullable(),
  targetRepsMax: z.number().int().min(0).max(1000).nullable(),
  loggedSets: z.number().int().min(0).max(100),
});

export const coachContextSchema = z.object({
  /** BCP-47-ish; drives the language the coach replies in. */
  locale: z.enum(['he', 'en']).default('he'),
  profile: coachProfileSchema,
  targets: coachTargetsSchema,
  weightTrend: coachWeightTrendSchema,
  /** Capped so a user with a huge catalogue cannot blow up the prompt. */
  exercises: z.array(coachExerciseProgressSchema).max(60),
  adherence: z.array(coachAdherenceSchema).max(40).default([]),
  /** Equipment available where they are training, so the coach cannot prescribe a missing machine. */
  availableEquipment: z.array(z.string().min(1).max(80)).max(60).default([]),
  planName: z.string().min(1).max(120).nullable().default(null),
});

export const coachMessageSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string().min(1).max(8000),
});

export const coachChatRequestSchema = z.object({
  context: coachContextSchema,
  /**
   * Full history each turn — the endpoint is stateless. Bounded because the volatile tail of
   * the prompt is the part that never caches; an unbounded history would grow cost linearly
   * with no ceiling.
   */
  messages: z.array(coachMessageSchema).min(1).max(40),
});

export type CoachProfile = z.infer<typeof coachProfileSchema>;
export type CoachTargets = z.infer<typeof coachTargetsSchema>;
export type CoachExerciseProgress = z.infer<typeof coachExerciseProgressSchema>;
export type CoachWeightTrend = z.infer<typeof coachWeightTrendSchema>;
export type CoachAdherence = z.infer<typeof coachAdherenceSchema>;
export type CoachContextPayload = z.infer<typeof coachContextSchema>;
export type CoachChatRequest = z.infer<typeof coachChatRequestSchema>;
