/**
 * Meals kept to be logged again.
 *
 * Most people eat the same few meals most of the time. The food log already offers single
 * things eaten before (`listRecentFoods`); this is the step up from that — a named group, the
 * whole breakfast, logged with one tap instead of four.
 *
 * A saved meal is a copy of what its items were when it was saved: names and numbers, not
 * pointers at log entries or at the food list. Deleting the log entry it was made from, or
 * correcting the list later, leaves it as the person saved it.
 *
 * The items live on the row as JSON. A meal is read and written whole and never searched by
 * what is in it, and as one row it syncs as one thing: there is no state in which another
 * phone has the meal and half its items.
 */

import { MAX_CALORIES, MAX_GRAMS, MAX_NAME } from '../food/foodMath.js';
import type { SqlExecutor } from './executor.js';
import { addFoodEntry } from './food.js';
import type { Clock, IdFactory } from './workouts.js';

const defaultClock: Clock = () => new Date().toISOString();

/** The server's bounds (0017), applied here first so nothing is written that it would refuse. */
export const MAX_MEAL_NAME = 80;
export const MAX_MEAL_ITEMS = 30;

export interface SavedMealItem {
  name: string;
  /** The listed food it was logged from, if it was. */
  foodKey: string | null;
  grams: number | null;
  calories: number;
  proteinG: number | null;
  carbsG: number | null;
  fatG: number | null;
}

export interface SavedMeal {
  id: string;
  name: string;
  items: SavedMealItem[];
}

const amount = (value: unknown, max: number): number | null =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.min(value, max) : null;

/**
 * One item, from anything: what the app is about to save, or what came back from the cloud.
 * Null for something that could not be logged — no name, or calories that are not a number.
 */
export function readMealItem(value: unknown): SavedMealItem | null {
  if (typeof value !== 'object' || value === null) return null;
  const raw = value as Record<string, unknown>;
  const name = typeof raw.name === 'string' ? raw.name.trim().slice(0, MAX_NAME) : '';
  if (name === '') return null;
  const calories = amount(raw.calories, MAX_CALORIES);
  if (calories === null) return null;
  return {
    name,
    foodKey:
      typeof raw.foodKey === 'string' && /^[a-z0-9_]{1,64}$/.test(raw.foodKey) ? raw.foodKey : null,
    grams: amount(raw.grams, MAX_GRAMS),
    calories: Math.round(calories),
    proteinG: amount(raw.proteinG, 2000),
    carbsG: amount(raw.carbsG, 2000),
    fatG: amount(raw.fatG, 2000),
  };
}

/**
 * The items of a stored meal. Never throws: the column is text that another build, or another
 * phone, wrote. Items that cannot be read are left out; a meal with none left is no meal.
 */
export function readMealItems(json: string | null): SavedMealItem[] {
  if (!json) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed
    .map(readMealItem)
    .filter((item): item is SavedMealItem => item !== null)
    .slice(0, MAX_MEAL_ITEMS);
}

/** What a meal adds up to in calories, for the line under its name. */
export function mealCalories(items: readonly SavedMealItem[]): number {
  return Math.round(items.reduce((sum, item) => sum + item.calories, 0));
}

/**
 * Keep a meal. Resolves to its id, or null when there is nothing to keep: no name, or no item
 * that could be logged.
 */
export async function saveMeal(
  db: SqlExecutor,
  userId: string,
  newId: IdFactory,
  input: { name: string; items: readonly unknown[] },
  clock: Clock = defaultClock,
): Promise<string | null> {
  const name = input.name.trim().slice(0, MAX_MEAL_NAME);
  if (name === '') return null;
  const items = input.items
    .map(readMealItem)
    .filter((item): item is SavedMealItem => item !== null)
    .slice(0, MAX_MEAL_ITEMS);
  if (items.length === 0) return null;

  const id = newId();
  const now = clock();
  await db.run(
    `INSERT INTO saved_meals (id, user_id, name, items, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [id, userId, name, JSON.stringify(items), now, now],
  );
  return id;
}

/** The person's saved meals, newest first. A meal whose items cannot be read is not offered. */
export async function listSavedMeals(db: SqlExecutor, userId: string): Promise<SavedMeal[]> {
  const rows = await db.all<{ id: string; name: string; items: string | null }>(
    `SELECT id, name, items FROM saved_meals
      WHERE user_id = ? AND deleted_at IS NULL
      ORDER BY created_at DESC, id`,
    [userId],
  );
  return rows
    .map((row) => ({ id: row.id, name: row.name, items: readMealItems(row.items) }))
    .filter((meal) => meal.items.length > 0);
}

/** Stop keeping a meal. Marked, not removed, so the other phone stops offering it too. */
export async function deleteSavedMeal(
  db: SqlExecutor,
  userId: string,
  mealId: string,
  clock: Clock = defaultClock,
): Promise<void> {
  const at = clock();
  await db.run(
    `UPDATE saved_meals SET deleted_at = ?, updated_at = ?
      WHERE id = ? AND user_id = ? AND deleted_at IS NULL`,
    [at, at, mealId, userId],
  );
}

/**
 * Log everything in a meal on one day. Resolves to how many entries were written.
 *
 * Each item becomes an ordinary food entry — the log does not know it came from a meal, and
 * afterwards one of them can be swiped away without the others, which is what "the usual, but
 * no toast today" needs.
 */
export async function logSavedMeal(
  db: SqlExecutor,
  userId: string,
  newId: IdFactory,
  meal: Pick<SavedMeal, 'items'>,
  eatenOn: string,
  clock: Clock = defaultClock,
): Promise<number> {
  let written = 0;
  for (const item of meal.items) {
    const id = await addFoodEntry(
      db,
      userId,
      newId,
      {
        eatenOn,
        name: item.name,
        foodKey: item.foodKey,
        grams: item.grams,
        calories: item.calories,
        proteinG: item.proteinG,
        carbsG: item.carbsG,
        fatG: item.fatG,
      },
      clock,
    );
    if (id) written += 1;
  }
  return written;
}
