/** Age and body-composition calculations that don't involve energy expenditure. */

/**
 * Age in whole years at `on` (default: today).
 *
 * Derived from date of birth rather than stored as a number, so it can never go stale —
 * a stored `age` column silently becomes wrong on the user's birthday and quietly skews
 * every BMR calculation from then on.
 */
export function ageInYears(birthDate: Date, on: Date = new Date()): number {
  let age = on.getUTCFullYear() - birthDate.getUTCFullYear();
  const monthDelta = on.getUTCMonth() - birthDate.getUTCMonth();
  const dayDelta = on.getUTCDate() - birthDate.getUTCDate();
  // Birthday hasn't occurred yet this year.
  if (monthDelta < 0 || (monthDelta === 0 && dayDelta < 0)) {
    age -= 1;
  }
  return age;
}

/**
 * Body Mass Index in kg/m².
 *
 * Worth knowing the limitation, because the AI coach should not lean on it: BMI does not
 * distinguish muscle from fat, so it systematically misclassifies people who lift. A
 * muscular trainee can read "overweight" at a low body-fat percentage. Prefer body-fat
 * percentage and the weight trend when both are available.
 */
export function bmi(weightKg: number, heightCm: number): number {
  if (heightCm <= 0) throw new RangeError('heightCm must be greater than 0');
  if (weightKg <= 0) throw new RangeError('weightKg must be greater than 0');
  const heightM = heightCm / 100;
  return weightKg / (heightM * heightM);
}

export type BmiCategory = 'underweight' | 'normal' | 'overweight' | 'obese';

/** Standard WHO cutoffs. Subject to the same muscle-vs-fat caveat as `bmi`. */
export function bmiCategory(bmiValue: number): BmiCategory {
  if (bmiValue < 18.5) return 'underweight';
  if (bmiValue < 25) return 'normal';
  if (bmiValue < 30) return 'overweight';
  return 'obese';
}

/** Lean body mass in kg, given a measured body-fat percentage (0-100). */
export function leanBodyMassKg(weightKg: number, bodyFatPct: number): number {
  if (bodyFatPct < 0 || bodyFatPct >= 100) {
    throw new RangeError('bodyFatPct must be in [0, 100)');
  }
  return weightKg * (1 - bodyFatPct / 100);
}

/**
 * Estimate body-fat percentage without a bio-impedance reading.
 *
 * A Deurenberg-style relation from BMI, age and sex. It needs no scale hardware at all, and on
 * a consumer device is about as defensible as the vendor's undisclosed proprietary formula —
 * which is the honest framing: this is arithmetic on height, weight and age, not a measurement
 * of the body.
 *
 * Its error is largest exactly where this app's users sit. BMI cannot tell muscle from fat, so
 * for a trained lifter the estimate reads high; treat the direction it moves over months as
 * meaningful and the absolute number as indicative. Anything actually measured must win over
 * this — see `summariseComposition`.
 */
export function estimateBodyFatPctFromBmi(input: {
  weightKg: number;
  heightCm: number;
  ageYears: number;
  sex: 'male' | 'female';
}): number | null {
  const { weightKg, heightCm, ageYears, sex } = input;
  if (heightCm <= 0 || weightKg <= 0) return null;

  const bmiValue = bmi(weightKg, heightCm);
  const sexFactor = sex === 'male' ? 1 : 0;

  const pct = 1.2 * bmiValue + 0.23 * ageYears - 10.8 * sexFactor - 5.4;
  if (!Number.isFinite(pct) || pct <= 0 || pct >= 70) return null;

  return Number(pct.toFixed(1));
}
