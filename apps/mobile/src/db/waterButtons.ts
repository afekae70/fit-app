/**
 * Each person's two water buttons, on their profile row — where the profile sync carries them
 * to the account's other phones (`sync/profileSync.ts`, server columns from 0019).
 *
 * Two columns rather than one value, because the sync compares field by field: one button set
 * on one phone and the other on another both survive. NULL is "never set", shown as 250 and 500.
 * What an amount may be is `food/waterButtons.ts`'s rule, the same one the server checks.
 */

import { isButtonAmount, type WaterButtons } from '../food/waterButtons.js';
import type { SqlExecutor } from './executor.js';
import type { Clock } from './workouts.js';

const defaultClock: Clock = () => new Date().toISOString();

/** This account's buttons, or null while they have never been set (or hold nonsense). */
export async function getWaterButtons(
  db: SqlExecutor,
  userId: string,
): Promise<WaterButtons | null> {
  const row = await db.get<{ water_button_1_ml: unknown; water_button_2_ml: unknown }>(
    `SELECT water_button_1_ml, water_button_2_ml FROM profile WHERE user_id = ?`,
    [userId],
  );
  if (!row) return null;
  const first = row.water_button_1_ml;
  const second = row.water_button_2_ml;
  return isButtonAmount(first) && isButtonAmount(second) ? [first, second] : null;
}

/**
 * Set both buttons. Creates the profile row if this account has none yet, as the profile
 * picture does; the sync notices the changed fields by comparing, so nothing else is marked.
 * Resolves to whether they were set: false for an amount the server would refuse.
 */
export async function setWaterButtons(
  db: SqlExecutor,
  userId: string,
  buttons: WaterButtons,
  clock: Clock = defaultClock,
): Promise<boolean> {
  if (!isButtonAmount(buttons[0]) || !isButtonAmount(buttons[1])) return false;
  const now = clock();
  await db.run(`INSERT OR IGNORE INTO profile (user_id, updated_at) VALUES (?, ?)`, [userId, now]);
  await db.run(
    `UPDATE profile SET water_button_1_ml = ?, water_button_2_ml = ?, updated_at = ?
      WHERE user_id = ?`,
    [buttons[0], buttons[1], now, userId],
  );
  return true;
}
