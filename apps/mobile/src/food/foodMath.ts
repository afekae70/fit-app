/**
 * The arithmetic of a food log: what an amount of a food holds, what a day adds up to, and
 * which foods a few typed letters mean.
 *
 * No database and no React, so the parts that would be wrong silently — a rounding that makes
 * three eggs not three times one egg, a search that cannot find "rice" under "White rice" —
 * can be tested as plain functions.
 */

import { FOOD_SEED, type FoodSeed } from './foods.js';

export interface Macros {
  /** Kilocalories, whole. */
  calories: number;
  /** Grams, to a tenth. */
  proteinG: number;
  carbsG: number;
  fatG: number;
}

/** The most that can be logged as one entry. Above this it is a typo, not a meal. */
export const MAX_GRAMS = 5000;
export const MAX_CALORIES = 20000;
export const MAX_NAME = 120;

const tenth = (n: number) => Math.round(n * 10) / 10;

/** What `grams` of a listed food holds. */
export function macrosFor(food: FoodSeed, grams: number): Macros {
  const share = grams / 100;
  return {
    calories: Math.round(food.kcal * share),
    proteinG: tenth(food.protein * share),
    carbsG: tenth(food.carbs * share),
    fatG: tenth(food.fat * share),
  };
}

/**
 * A typed amount as a number, or null if it is not one that can be logged.
 *
 * A comma is taken as a decimal point: half the keyboards this runs on type "1,5" for one and
 * a half, and reading that as fifteen — or refusing it — is the app being wrong about what was
 * plainly meant.
 */
export function parseAmount(raw: string, max: number = MAX_GRAMS): number | null {
  const text = raw.trim().replace(',', '.');
  if (!/^\d+(\.\d+)?$/.test(text)) return null;
  const value = Number(text);
  return Number.isFinite(value) && value > 0 && value <= max ? value : null;
}

/** Like `parseAmount`, for a field that may be left empty or hold zero: a macro, say. */
export function parseOptional(raw: string, max: number): number | null | undefined {
  const text = raw.trim().replace(',', '.');
  if (text === '') return null;
  if (!/^\d+(\.\d+)?$/.test(text)) return undefined;
  const value = Number(text);
  return Number.isFinite(value) && value <= max ? value : undefined;
}

const fold = (text: string) => text.toLocaleLowerCase().trim();

/**
 * The listed foods a search means, best first.
 *
 * Every typed word has to appear in the food's name, in either language, in any order — so
 * "rice brown" and "אורז מלא" both find brown rice. A name that *starts* with what was typed
 * comes before one that merely contains it: typing "חל" should offer milk before challah bread
 * would, if there were one. An empty search is the whole list, in its own order.
 */
export function searchFoods(query: string): FoodSeed[] {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return [...FOOD_SEED];

  const scored: { food: FoodSeed; rank: number; order: number }[] = [];
  for (const [order, food] of FOOD_SEED.entries()) {
    const he = fold(food.he);
    const en = fold(food.en);
    if (!words.every((word) => he.includes(word) || en.includes(word))) continue;
    const first = words[0]!;
    const starts = he.startsWith(first) || en.startsWith(first);
    scored.push({ food, rank: starts ? 0 : 1, order });
  }
  return scored.sort((a, b) => a.rank - b.rank || a.order - b.order).map((entry) => entry.food);
}

export interface Eaten {
  calories: number;
  protein_g: number | null;
  carbs_g: number | null;
  fat_g: number | null;
}

/**
 * What a day's entries add up to.
 *
 * An entry logged by hand may carry calories and nothing else. Its missing protein counts as
 * none, because there is nothing else it can count as — which makes the day's protein a floor
 * rather than a figure, and is why the screen marks a total that had gaps in it.
 */
export function sumDay(entries: readonly Eaten[]): Macros & { partial: boolean } {
  let calories = 0;
  let protein = 0;
  let carbs = 0;
  let fat = 0;
  let partial = false;
  for (const entry of entries) {
    calories += entry.calories;
    protein += entry.protein_g ?? 0;
    carbs += entry.carbs_g ?? 0;
    fat += entry.fat_g ?? 0;
    if (entry.protein_g === null || entry.carbs_g === null || entry.fat_g === null) partial = true;
  }
  return {
    calories: Math.round(calories),
    proteinG: tenth(protein),
    carbsG: tenth(carbs),
    fatG: tenth(fat),
    partial,
  };
}

/** How far along a target the day is, from 0 to 1 — and past 1, capped, when it is over. */
export function progressTowards(eaten: number, target: number | null | undefined): number {
  if (!target || target <= 0) return 0;
  return Math.max(0, Math.min(1, eaten / target));
}
