/**
 * Assembles the digest the coach endpoint receives.
 *
 * Everything here is read from local SQLite and reuses the same functions the screens display,
 * so the coach reasons about exactly the numbers the user is looking at. If this file ever
 * recomputed a figure independently, the coach and the UI could disagree — and the user would
 * have no way to tell which was wrong.
 *
 * Kept separate from the network client so it is testable without a server: this is where the
 * shape and the null-handling live, and both are easy to get subtly wrong.
 */

import type { CoachContextPayload } from '@fit/shared/schemas';

import type { SqlExecutor } from '../db/executor.js';
import {
  computeTargets,
  getProfile,
  listBodyMetrics,
  summariseTrend,
  type BodyMetricRow,
  type ProfileRow,
} from '../db/metrics.js';
import { getActivePlan, getSessionAdherence } from '../db/plans.js';
import { summariseAllProgress } from '../db/progression.js';
import { listSessionSummaries } from '../db/workouts.js';

/** Whole years from an ISO birth date, or null when unknown. */
function ageFromBirthDate(birthDate: string | null, today: Date): number | null {
  if (!birthDate) return null;
  const born = new Date(birthDate);
  if (Number.isNaN(born.getTime())) return null;

  let age = today.getFullYear() - born.getFullYear();
  const monthDelta = today.getMonth() - born.getMonth();
  if (monthDelta < 0 || (monthDelta === 0 && today.getDate() < born.getDate())) age -= 1;
  return age >= 0 && age <= 120 ? age : null;
}

/**
 * The `sex` sent to the coach is the profile's own value, not the BMR formula override.
 *
 * They are deliberately different fields: someone who selects 'other' picks a formula so the
 * energy maths has coefficients, but that choice is a calculation input, not a statement about
 * them. Sending the override as their sex would put a fact in the prompt they never asserted.
 */
function coachSex(profile: ProfileRow | null): 'male' | 'female' | 'other' | null {
  const sex = profile?.sex;
  return sex === 'male' || sex === 'female' || sex === 'other' ? sex : null;
}

export interface BuildPayloadOptions {
  locale: 'he' | 'en';
  /** Injected so tests are not time-dependent. */
  today?: Date;
}

export async function buildCoachPayload(
  db: SqlExecutor,
  userId: string,
  { locale, today = new Date() }: BuildPayloadOptions,
): Promise<CoachContextPayload> {
  const [profile, metrics, progress] = await Promise.all([
    getProfile(db, userId),
    listBodyMetrics(db, userId),
    summariseAllProgress(db, userId),
  ]);

  const latestWeight = metrics.find((m: BodyMetricRow) => m.weight_kg !== null)?.weight_kg ?? null;
  const targetsResult = computeTargets(profile, latestWeight, today);
  const targets = targetsResult.ok ? targetsResult.targets : null;
  const trend = summariseTrend(metrics);

  // Adherence only exists for a session that came from a plan day. A freestyle session has no
  // prescription to compare against, so the section is simply absent rather than zero-filled.
  const activePlan = await getActivePlan(db, userId);
  const recentSessions = await listSessionSummaries(db, userId, 10);
  const lastPlanned = recentSessions.find((session) => session.plan_day_id !== null);
  const adherence = lastPlanned
    ? (await getSessionAdherence(db, userId, lastPlanned.id)).map((row) => ({
        exerciseKey: row.exercise_key,
        targetSets: row.target_sets,
        targetRepsMin: row.target_reps_min,
        targetRepsMax: row.target_reps_max,
        loggedSets: row.logged_sets,
      }))
    : [];

  return {
    locale,
    profile: {
      ageYears: ageFromBirthDate(profile?.birth_date ?? null, today),
      sex: coachSex(profile),
      heightCm: profile?.height_cm ?? null,
      weightKg: latestWeight,
      activityLevel:
        (profile?.activity_level as CoachContextPayload['profile']['activityLevel']) ?? null,
      goal: (profile?.goal as CoachContextPayload['profile']['goal']) ?? null,
    },
    targets: {
      bmi: targets?.bmi ?? null,
      bmrKcal: targets?.bmrKcal ?? null,
      tdeeKcal: targets?.tdeeKcal ?? null,
      calorieTarget: targets?.calorieTarget ?? null,
      proteinG: targets?.proteinG ?? null,
      carbsG: targets?.carbsG ?? null,
      fatG: targets?.fatG ?? null,
    },
    weightTrend: {
      currentKg: latestWeight,
      // `rate` is null when there are too few points to fit a line at all. That is distinct
      // from a fitted-but-unreliable rate, and the coach prompt words the two differently —
      // "not enough data" versus "here is the slope, but do not trust it yet".
      kgPerWeek: trend.rate?.kgPerWeek ?? null,
      isReliable: trend.rate?.isReliable ?? false,
      measurementCount: trend.points.length,
    },
    // Capped at the schema's limit. A user with a very large catalogue would otherwise push the
    // volatile half of the prompt past the cached persona and invert the cost economics.
    exercises: progress.slice(0, 60).map((summary) => ({
      exerciseKey: summary.exerciseKey,
      sessionCount: summary.sessionCount,
      latestE1rmKg: summary.latestE1rm,
      bestE1rmKg: summary.bestE1rm,
      e1rmDeltaKg: summary.assessment.e1rmDeltaKg,
      volumeSlopePerSession: summary.assessment.volumeSlopePerSession,
      sessionsSinceBest: summary.assessment.sessionsSinceBest,
      isStalling: summary.assessment.isStalling,
    })),
    adherence: adherence.slice(0, 40),
    availableEquipment: [],
    planName: activePlan?.name ?? null,
  };
}
