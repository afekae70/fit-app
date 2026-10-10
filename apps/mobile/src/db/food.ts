/**
 * The food log: what was eaten on which day.
 *
 * One row per thing eaten. A row holds its own numbers — calories, and protein, carbohydrate
 * and fat where they are known — rather than pointing at the food list and an amount, for the
 * same reason a workout stores the weight lifted rather than a pointer to a plan: the list is
 * a guide that will be corrected over time, and correcting it must not rewrite what somebody
 * logged last March. `food_key` and `grams` are kept beside the numbers, as a record of how
 * they were arrived at.
 *
 * The day is a local calendar date, `YYYY-MM-DD`, not a moment. "What did I eat today" is a
 * question about a day where the person is, and a meal at 23:30 belongs to that day whatever
 * the time is in UTC.
 *
 * Rows are never removed, only marked deleted, like everything else that syncs: a deletion has
 * to reach the cloud and the user's other phone, and a row that is simply gone tells them
 * nothing.
 */

import { MAX_CALORIES, MAX_GRAMS, MAX_NAME } from '../food/foodMath.js';
import type { SqlExecutor } from './executor.js';
import type { Clock, IdFactory } from './workouts.js';

const defaultClock: Clock = () => new Date().toISOString();

export interface FoodEntryRow {
  id: string;
  user_id: string;
  eaten_on: string;
  name: string;
  food_key: string | null;
  grams: number | null;
  calories: number;
  protein_g: number | null;
  carbs_g: number | null;
  fat_g: number | null;
  created_at: string;
  updated_at: string | null;
  deleted_at: string | null;
}

export interface FoodEntryInput {
  /** The local day it was eaten on, `YYYY-MM-DD`. */
  eatenOn: string;
  name: string;
  /** The listed food it was logged from, if it was. */
  foodKey?: string | null;
  grams?: number | null;
  calories: number;
  proteinG?: number | null;
  carbsG?: number | null;
  fatG?: number | null;
}

const within = (value: number | null | undefined, max: number): number | null =>
  value === null || value === undefined || !Number.isFinite(value) || value < 0
    ? null
    : Math.min(value, max);

/**
 * Log one thing eaten. Resolves to the new row's id, or null if it is not something that can
 * be logged: no name, or calories that are not a number.
 *
 * The bounds are the server's own (0014), applied here first. A row the server would refuse
 * stays on the phone as an unsynced row for ever, retried on every sync; it is better never
 * written.
 */
export async function addFoodEntry(
  db: SqlExecutor,
  userId: string,
  newId: IdFactory,
  input: FoodEntryInput,
  clock: Clock = defaultClock,
): Promise<string | null> {
  const name = input.name.trim().slice(0, MAX_NAME);
  if (name === '') return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.eatenOn)) return null;
  if (!Number.isFinite(input.calories) || input.calories < 0) return null;

  const id = newId();
  const now = clock();
  await db.run(
    `INSERT INTO food_entries
       (id, user_id, eaten_on, name, food_key, grams, calories, protein_g, carbs_g, fat_g,
        created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      userId,
      input.eatenOn,
      name,
      input.foodKey ?? null,
      within(input.grams, MAX_GRAMS),
      Math.min(Math.round(input.calories), MAX_CALORIES),
      within(input.proteinG, 2000),
      within(input.carbsG, 2000),
      within(input.fatG, 2000),
      now,
      now,
    ],
  );
  return id;
}

/** Everything logged for one day, in the order it was logged. */
export async function listFoodEntries(
  db: SqlExecutor,
  userId: string,
  date: string,
): Promise<FoodEntryRow[]> {
  return db.all<FoodEntryRow>(
    `SELECT * FROM food_entries
      WHERE user_id = ? AND eaten_on = ? AND deleted_at IS NULL
      ORDER BY created_at, id`,
    [userId, date],
  );
}

/** Take an entry out of the log. Marked, not removed — see the top of the file. */
export async function deleteFoodEntry(
  db: SqlExecutor,
  userId: string,
  entryId: string,
  clock: Clock = defaultClock,
): Promise<void> {
  const at = clock();
  await db.run(
    `UPDATE food_entries SET deleted_at = ?, updated_at = ?
      WHERE id = ? AND user_id = ? AND deleted_at IS NULL`,
    [at, at, entryId, userId],
  );
}

/**
 * The things this person logs, most recent first, each once.
 *
 * For logging the same breakfast again in one tap. "The same" is the same name with the same
 * calories: a bowl of oats at 40 g and one at 80 g are two things worth offering, and two
 * logs of the identical bowl are one. The newest of each is the one returned, so its amount
 * and numbers are whatever was last used.
 */
export async function listRecentFoods(
  db: SqlExecutor,
  userId: string,
  limit = 20,
): Promise<FoodEntryRow[]> {
  return db.all<FoodEntryRow>(
    `SELECT f.* FROM food_entries f
      WHERE f.user_id = ? AND f.deleted_at IS NULL
        AND f.created_at = (
          SELECT MAX(g.created_at) FROM food_entries g
           WHERE g.user_id = f.user_id AND g.deleted_at IS NULL
             AND lower(g.name) = lower(f.name) AND g.calories = f.calories
        )
      GROUP BY lower(f.name), f.calories
      ORDER BY MAX(f.created_at) DESC
      LIMIT ?`,
    [userId, limit],
  );
}
