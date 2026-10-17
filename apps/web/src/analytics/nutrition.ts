/**
 * A trainee's eating and drinking, as the coach reads it: day by day, and averaged over the
 * days that were actually logged.
 *
 * A day with nothing logged is not a day of eating nothing, and averaging it in as zero would
 * make every forgetful week look like a fast. So averages are over logged days only, and how
 * many days were logged is said beside them — it is often the more useful number. Today is left
 * out of every average: it is still being eaten.
 */

import type { CoachFoodEntry, CoachNutrition, SharedTargets } from '@fit/shared/coaching';

import { daysBetween } from './dates.js';

export interface NutritionDay {
  date: string;
  calories: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  waterMl: number;
  entries: CoachFoodEntry[];
}

/** Within this share of the calorie target either way counts as on target. */
export const ON_TARGET_BAND = 0.1;

/** Every day between two local days, inclusive, oldest first — the empty ones too. */
export function nutritionDays(
  nutrition: CoachNutrition,
  from: string,
  to: string,
): NutritionDay[] {
  const days = new Map<string, NutritionDay>(
    daysBetween(from, to).map((date) => [
      date,
      { date, calories: 0, proteinG: 0, carbsG: 0, fatG: 0, waterMl: 0, entries: [] },
    ]),
  );
  for (const entry of nutrition.entries) {
    const day = days.get(entry.date);
    if (!day) continue;
    day.entries.push(entry);
    day.calories += entry.calories;
    day.proteinG += entry.proteinG ?? 0;
    day.carbsG += entry.carbsG ?? 0;
    day.fatG += entry.fatG ?? 0;
  }
  for (const water of nutrition.water) {
    const day = days.get(water.date);
    if (day) day.waterMl += water.ml;
  }
  return [...days.values()];
}

export interface NutritionSummary {
  /** Finished days in the period: everything before today. */
  days: number;
  loggedDays: number;
  avgCalories: number | null;
  avgProteinG: number | null;
  avgCarbsG: number | null;
  avgFatG: number | null;
  /** Logged days within the band around the target; null without a target. */
  onTargetDays: number | null;
  /** Over days with any water logged. */
  avgWaterMl: number | null;
  waterDays: number;
}

const mean = (values: readonly number[]): number | null =>
  values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length;

export function nutritionSummary(
  days: readonly NutritionDay[],
  targets: SharedTargets | null,
  today: string,
): NutritionSummary {
  const finished = days.filter((day) => day.date < today);
  const logged = finished.filter((day) => day.entries.length > 0);
  const watered = finished.filter((day) => day.waterMl > 0);
  return {
    days: finished.length,
    loggedDays: logged.length,
    avgCalories: mean(logged.map((day) => day.calories)),
    avgProteinG: mean(logged.map((day) => day.proteinG)),
    avgCarbsG: mean(logged.map((day) => day.carbsG)),
    avgFatG: mean(logged.map((day) => day.fatG)),
    onTargetDays: targets
      ? logged.filter(
          (day) =>
            Math.abs(day.calories - targets.calorieTarget) <=
            targets.calorieTarget * ON_TARGET_BAND,
        ).length
      : null,
    avgWaterMl: mean(watered.map((day) => day.waterMl)),
    waterDays: watered.length,
  };
}
