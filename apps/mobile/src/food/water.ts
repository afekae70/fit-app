/**
 * How much water to aim for, and how to say an amount of it.
 *
 * The aim is 45 ml for each kilogram of body weight: 72 kg is 3.24 litres. That is the rule
 * the app's owner trains by, and it is applied as it is stated — the figure is not rounded to
 * a quarter litre or nudged toward a rounder one, because someone who knows the rule will do
 * the multiplication in their head and expect to see its answer.
 *
 * It is held between one litre and six. Neither bound is an opinion about the rule: six litres
 * is what it gives at 133 kg, and above that the likelier explanation is a mistyped weight —
 * which should not turn into advice to drink eleven litres.
 *
 * It is not stored. Like the calorie target it is worked out from the latest weight each time,
 * so it follows the person as they change without anything having to be kept in step.
 */

/** A glass and a small bottle: the two amounts worth a button of their own. */
export const GLASS_ML = 250;
export const BOTTLE_ML = 500;

export const WATER_ML_PER_KG = 45;
const MIN_GOAL_ML = 1000;
const MAX_GOAL_ML = 6000;
/** With no weight to go by: what the rule gives for seventy kilograms. */
export const DEFAULT_GOAL_ML = 70 * WATER_ML_PER_KG;

export function waterGoalMl(weightKg: number | null | undefined): number {
  if (weightKg === null || weightKg === undefined || !Number.isFinite(weightKg) || weightKg <= 0) {
    return DEFAULT_GOAL_ML;
  }
  // The rule's own answer, to the millilitre. Rounding happens once, where it is shown.
  const exact = Math.round(weightKg * WATER_ML_PER_KG);
  return Math.max(MIN_GOAL_ML, Math.min(MAX_GOAL_ML, exact));
}

/**
 * Millilitres as litres, to two decimals and no further than needed:
 * 3240 → "3.24", 3600 → "3.6", 2000 → "2", 250 → "0.25".
 */
export function litres(ml: number): string {
  const value = Math.round(ml / 10) / 100;
  return String(value);
}

/** How many whole glasses an amount is: the count the row of glasses draws. */
export function glassesOf(ml: number): number {
  return Math.max(0, Math.floor(ml / GLASS_ML));
}
