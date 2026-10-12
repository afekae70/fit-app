/**
 * How much water to aim for, and how to say an amount of it.
 *
 * The aim is a rule of thumb and is presented as one: about 35 ml for each kilogram of body
 * weight, which is where most general guidance lands for an adult who trains. It is rounded to
 * a quarter of a litre, because a target of 2,817 ml claims a precision nobody has, and held
 * between a litre and a half and four litres so that a mistyped weight cannot ask for eight.
 *
 * It is not stored. Like the calorie target it is worked out from the latest weight each time,
 * so it follows the person as they change without anything having to be kept in step.
 */

/** A glass and a small bottle: the two amounts worth a button of their own. */
export const GLASS_ML = 250;
export const BOTTLE_ML = 500;

const ML_PER_KG = 35;
const MIN_GOAL_ML = 1500;
const MAX_GOAL_ML = 4000;
/** With no weight to go by: the figure the rule gives for about seventy kilograms. */
export const DEFAULT_GOAL_ML = 2500;

export function waterGoalMl(weightKg: number | null | undefined): number {
  if (weightKg === null || weightKg === undefined || !Number.isFinite(weightKg) || weightKg <= 0) {
    return DEFAULT_GOAL_ML;
  }
  const rounded = Math.round((weightKg * ML_PER_KG) / 250) * 250;
  return Math.max(MIN_GOAL_ML, Math.min(MAX_GOAL_ML, rounded));
}

/** Millilitres as litres to one decimal, without a trailing ".0": 1750 → "1.8", 2000 → "2". */
export function litres(ml: number): string {
  const value = Math.round(ml / 100) / 10;
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

/** How many whole glasses an amount is: the count the row of glasses draws. */
export function glassesOf(ml: number): number {
  return Math.max(0, Math.floor(ml / GLASS_ML));
}
