/**
 * Physiological constants used by the energy and macro calculations.
 *
 * These live in one place because both the mobile app (for optimistic display) and the
 * API (authoritative, and what gets fed to the AI coach) must agree exactly. A discrepancy
 * here would mean the UI shows one TDEE and the coach reasons about a different one.
 */

export const ACTIVITY_LEVELS = [
  'sedentary',
  'light',
  'moderate',
  'active',
  'very_active',
] as const;

export type ActivityLevel = (typeof ACTIVITY_LEVELS)[number];

/**
 * Harris-Benedict style activity multipliers applied to BMR to reach TDEE.
 *
 * These are population estimates with meaningful individual variance — treat the resulting
 * TDEE as a starting hypothesis to be corrected against observed weight change, not as a
 * measured value. That correction is what the weekly recalculation job does.
 */
export const ACTIVITY_MULTIPLIERS: Record<ActivityLevel, number> = {
  sedentary: 1.2, // desk job, little deliberate movement
  light: 1.375, // light exercise 1-3 days/week
  moderate: 1.55, // moderate exercise 3-5 days/week
  active: 1.725, // hard exercise 6-7 days/week
  very_active: 1.9, // physical job or two-a-day training
};

export const GOALS = ['cut', 'maintain', 'bulk'] as const;
export type Goal = (typeof GOALS)[number];

/** Default calorie adjustment applied to TDEE, as a multiplier, per goal. */
export const GOAL_CALORIE_MULTIPLIERS: Record<Goal, number> = {
  cut: 0.8, // 20% deficit
  maintain: 1.0,
  bulk: 1.1, // 10% surplus — lean gaining; larger surpluses mostly add fat
};

/**
 * Protein targets in grams per kg of bodyweight.
 * Higher during a deficit, where the goal is to preserve lean mass while losing weight.
 */
export const PROTEIN_G_PER_KG: Record<Goal, number> = {
  cut: 2.2,
  maintain: 1.8,
  bulk: 1.9,
};

/** Share of total calories from fat, before the hormonal-health floor is applied. */
export const FAT_CALORIE_SHARE = 0.25;

/**
 * Minimum fat intake in g/kg bodyweight. Very low fat intake is associated with
 * hormonal disruption, so this floor overrides the percentage-based figure.
 */
export const MIN_FAT_G_PER_KG = 0.8;

export const KCAL_PER_G = {
  protein: 4,
  carbs: 4,
  fat: 9,
} as const;

/**
 * Approximate energy deficit required to lose 1 kg of body mass.
 * Used to sanity-check observed vs. expected rate of change. It is an approximation:
 * early loss includes glycogen and water, so short-window estimates overstate fat loss.
 */
export const KCAL_PER_KG_BODY_MASS = 7700;
