/**
 * Water: how much was drunk on which day.
 *
 * A row per glass, and a day's water is their sum. Not one counter per day — that would be a
 * single number two phones could both be changing, and "I pressed it twice" would be an edit
 * to it rather than what it is here: one row, marked deleted, which syncs like any other.
 *
 * The day is a local calendar date, as for food and for the same reason: "how much did I drink
 * today" is a question about a day where the person is.
 */

import type { SqlExecutor } from './executor.js';
import type { Clock, IdFactory } from './workouts.js';

const defaultClock: Clock = () => new Date().toISOString();

/** The most one tap can add. Above this it is a typo; the server holds the same bound (0017). */
export const MAX_WATER_ML = 5000;

const isDay = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value);

/** Add a drink. Resolves to the new row's id, or null for an amount that is not one. */
export async function addWater(
  db: SqlExecutor,
  userId: string,
  newId: IdFactory,
  input: { drunkOn: string; ml: number },
  clock: Clock = defaultClock,
): Promise<string | null> {
  if (!isDay(input.drunkOn)) return null;
  const ml = Math.round(input.ml);
  if (!Number.isFinite(ml) || ml < 1 || ml > MAX_WATER_ML) return null;

  const id = newId();
  const now = clock();
  await db.run(
    `INSERT INTO water_entries (id, user_id, drunk_on, ml, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [id, userId, input.drunkOn, ml, now, now],
  );
  return id;
}

/** Millilitres drunk on one day. */
export async function getWaterTotal(
  db: SqlExecutor,
  userId: string,
  date: string,
): Promise<number> {
  const row = await db.get<{ total: number | null }>(
    `SELECT SUM(ml) AS total FROM water_entries
      WHERE user_id = ? AND drunk_on = ? AND deleted_at IS NULL`,
    [userId, date],
  );
  return row?.total ?? 0;
}

/**
 * Take back the last drink added to a day. Resolves to whether there was one.
 *
 * The last one, because that is the one a slip of the thumb just added. Marked deleted rather
 * than removed, so the correction reaches the cloud instead of being undone by the next pull.
 */
export async function undoLastWater(
  db: SqlExecutor,
  userId: string,
  date: string,
  clock: Clock = defaultClock,
): Promise<boolean> {
  const last = await db.get<{ id: string }>(
    `SELECT id FROM water_entries
      WHERE user_id = ? AND drunk_on = ? AND deleted_at IS NULL
      ORDER BY created_at DESC, id DESC
      LIMIT 1`,
    [userId, date],
  );
  if (!last) return false;
  const at = clock();
  await db.run(`UPDATE water_entries SET deleted_at = ?, updated_at = ? WHERE id = ?`, [
    at,
    at,
    last.id,
  ]);
  return true;
}

/** Millilitres per day over a span of days, inclusive. Days with none are simply absent. */
export async function listWaterByDay(
  db: SqlExecutor,
  userId: string,
  from: string,
  to: string,
): Promise<{ day: string; ml: number }[]> {
  return db.all<{ day: string; ml: number }>(
    `SELECT drunk_on AS day, SUM(ml) AS ml FROM water_entries
      WHERE user_id = ? AND drunk_on BETWEEN ? AND ? AND deleted_at IS NULL
      GROUP BY drunk_on
      ORDER BY drunk_on`,
    [userId, from, to],
  );
}
