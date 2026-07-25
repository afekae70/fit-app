/** BMR, TDEE, calorie targets and macronutrient splits. */

import {
  ACTIVITY_MULTIPLIERS,
  FAT_CALORIE_SHARE,
  GOAL_CALORIE_MULTIPLIERS,
  KCAL_PER_G,
  MIN_FAT_G_PER_KG,
  PROTEIN_G_PER_KG,
  type ActivityLevel,
  type Goal,
} from './constants.js';

/**
 * The Mifflin-St Jeor equation defines coefficients for male and female only. This type is
 * deliberately narrower than the profile's `sex` field (which also allows 'other') so that
 * the ambiguous case cannot reach the formula implicitly — the caller has to resolve it.
 *
 * See `resolveBmrSex`.
 */
export type BmrSex = 'male' | 'female';

/**
 * Resolve a profile's `sex` to the coefficient set BMR should use.
 *
 * Returns `null` for 'other' unless the user has explicitly chosen a formula. A null result
 * means the UI must ask, or the user must supply a measured BMR — it must NOT be silently
 * defaulted, because the male/female constant differs by 166 kcal/day and guessing would
 * quietly bias every downstream calorie target.
 */
export function resolveBmrSex(
  sex: 'male' | 'female' | 'other',
  explicitFormulaChoice?: BmrSex,
): BmrSex | null {
  if (sex === 'male' || sex === 'female') return sex;
  return explicitFormulaChoice ?? null;
}

export interface BmrInput {
  weightKg: number;
  heightCm: number;
  ageYears: number;
  sex: BmrSex;
}

/**
 * Basal Metabolic Rate in kcal/day, via Mifflin-St Jeor.
 *
 *   male:   (10 × kg) + (6.25 × cm) − (5 × age) + 5
 *   female: (10 × kg) + (6.25 × cm) − (5 × age) − 161
 *
 * Mifflin-St Jeor is the current default recommendation over Harris-Benedict, which tends to
 * overestimate. Note it does not account for body composition — at a given weight a lean,
 * muscular person has a genuinely higher BMR than this predicts. If a measured body-fat
 * percentage is available, `katchMcArdleBmr` is more accurate.
 */
export function bmr({ weightKg, heightCm, ageYears, sex }: BmrInput): number {
  if (weightKg <= 0) throw new RangeError('weightKg must be greater than 0');
  if (heightCm <= 0) throw new RangeError('heightCm must be greater than 0');
  if (ageYears < 0) throw new RangeError('ageYears must not be negative');

  const base = 10 * weightKg + 6.25 * heightCm - 5 * ageYears;
  return sex === 'male' ? base + 5 : base - 161;
}

/**
 * Katch-McArdle BMR in kcal/day, based on lean body mass rather than total weight.
 *
 *   BMR = 370 + (21.6 × lean body mass in kg)
 *
 * Preferred when a trustworthy body-fat percentage is available — which is exactly what a
 * body-composition smart scale provides. It is also sex-agnostic, so it sidesteps the
 * `resolveBmrSex` question entirely.
 */
export function katchMcArdleBmr(leanBodyMassKg: number): number {
  if (leanBodyMassKg <= 0) throw new RangeError('leanBodyMassKg must be greater than 0');
  return 370 + 21.6 * leanBodyMassKg;
}

/** Total Daily Energy Expenditure in kcal/day. */
export function tdee(bmrKcal: number, activityLevel: ActivityLevel): number {
  return bmrKcal * ACTIVITY_MULTIPLIERS[activityLevel];
}

export interface CalorieTargetOptions {
  /** Override the default per-goal multiplier, e.g. 0.85 for a gentler cut. */
  multiplier?: number;
  /**
   * Refuse to prescribe below BMR. On by default: sustained intake under BMR risks lean-mass
   * loss and metabolic adaptation, and is the kind of advice this app should not give.
   */
  floorAtBmr?: boolean;
  bmrKcal?: number;
}

export interface CalorieTargetResult {
  calories: number;
  /** True when the requested deficit was clamped by the BMR floor. Surface this to the user. */
  clampedToBmr: boolean;
}

/**
 * Daily calorie target for a goal, derived from TDEE.
 *
 * Returns whether the value was clamped so the caller can explain it rather than silently
 * showing a number that doesn't match the requested deficit.
 */
export function calorieTarget(
  tdeeKcal: number,
  goal: Goal,
  options: CalorieTargetOptions = {},
): CalorieTargetResult {
  const { multiplier, floorAtBmr = true, bmrKcal } = options;
  const factor = multiplier ?? GOAL_CALORIE_MULTIPLIERS[goal];
  const raw = tdeeKcal * factor;

  if (floorAtBmr && bmrKcal !== undefined && raw < bmrKcal) {
    return { calories: Math.round(bmrKcal), clampedToBmr: true };
  }
  return { calories: Math.round(raw), clampedToBmr: false };
}

export interface MacroSplit {
  proteinG: number;
  carbsG: number;
  fatG: number;
  /** Recomputed from the rounded gram figures, so it may differ slightly from the input. */
  totalKcal: number;
}

/**
 * Split a calorie target into protein / fat / carbohydrate grams.
 *
 * Order of operations matters and is deliberate:
 *   1. Protein is set from bodyweight (goal-dependent g/kg) — the priority macro for a lifter.
 *   2. Fat is the greater of a calorie percentage and a g/kg floor, for hormonal health.
 *   3. Carbohydrate takes whatever calories remain — the training fuel, and the flexible one.
 *
 * If protein + fat already exceed the target (possible on an aggressive cut for a heavy
 * person), carbs floor at 0 and `totalKcal` will exceed `targetKcal`. The caller should
 * detect that and suggest a smaller deficit rather than presenting an impossible split.
 */
export function macroSplit(targetKcal: number, weightKg: number, goal: Goal): MacroSplit {
  if (targetKcal <= 0) throw new RangeError('targetKcal must be greater than 0');
  if (weightKg <= 0) throw new RangeError('weightKg must be greater than 0');

  const proteinG = Math.round(PROTEIN_G_PER_KG[goal] * weightKg);

  const fatFromShare = (targetKcal * FAT_CALORIE_SHARE) / KCAL_PER_G.fat;
  const fatFloor = MIN_FAT_G_PER_KG * weightKg;
  const fatG = Math.round(Math.max(fatFromShare, fatFloor));

  const usedKcal = proteinG * KCAL_PER_G.protein + fatG * KCAL_PER_G.fat;
  const carbsG = Math.max(0, Math.round((targetKcal - usedKcal) / KCAL_PER_G.carbs));

  return {
    proteinG,
    carbsG,
    fatG,
    totalKcal:
      proteinG * KCAL_PER_G.protein + carbsG * KCAL_PER_G.carbs + fatG * KCAL_PER_G.fat,
  };
}
