/**
 * A photographed meal, from the server's answer to rows in the food log.
 *
 * The server sends back what a vision model thinks is on the plate (`@fit/shared`'s
 * `FoodScanResult`). That is a guess — nobody can weigh rice from a photograph — and this is
 * everything that happens to the guess before it is allowed near the log:
 *
 *  - **It is read strictly.** A reply that is not the agreed shape is "could not read that",
 *    never a row with `NaN` calories.
 *  - **It is corrected by the person.** The usual error is the portion, so changing an item's
 *    grams rescales everything that followed from them.
 *  - **Only what is confirmed is saved.** `toFoodEntries` is called by the screen's own
 *    "add to log" button and by nothing else (see CLAUDE.md on applying AI output).
 *
 * Pure, so each of those can be tested without a camera, a server or a model.
 */

import {
  FOOD_SCAN_ERRORS,
  FOOD_SCAN_LIMITS,
  FoodScanErrorSchema,
  FoodScanResultSchema,
  type FoodScanError,
  type FoodScanItem,
  type FoodScanResult,
} from '@fit/shared/schemas';

import type { FoodEntryInput } from '../db/food.js';

/**
 * Why a scan did not produce a result.
 *
 * The server's reasons, and three only the phone can know: there is no network, the camera
 * was refused, and — after the server half has not been deployed — nobody answered at all.
 */
export type ScanFailure = FoodScanError | 'offline' | 'camera_denied' | 'not_configured';

export type ScanOutcome = { ok: true; result: FoodScanResult } | { ok: false; error: ScanFailure };

/**
 * What the server's reply means.
 *
 * `status` and `body` as they arrived. A 404 with no error of ours in it is Supabase saying
 * there is no such function, which is the server half not being deployed yet.
 */
export function readScanResponse(status: number, body: unknown): ScanOutcome {
  if (status >= 200 && status < 300) {
    const parsed = FoodScanResultSchema.safeParse(body);
    return parsed.success
      ? { ok: true, result: parsed.data }
      : { ok: false, error: 'not_readable' };
  }

  const refusal = FoodScanErrorSchema.safeParse(body);
  if (refusal.success) return { ok: false, error: refusal.data.error };

  // Not one of the function's own answers, so it came from in front of the function.
  if (status === 404) return { ok: false, error: 'not_set_up' };
  if (status === 401 || status === 403) return { ok: false, error: 'sign_in_required' };
  if (status === 413) return { ok: false, error: 'image_too_large' };
  if (status === 429) return { ok: false, error: 'ai_busy' };
  return { ok: false, error: 'server_error' };
}

/** Every failure there is a sentence for. Used to check that each one has its string. */
export const SCAN_FAILURES: readonly ScanFailure[] = [
  ...FOOD_SCAN_ERRORS,
  'offline',
  'camera_denied',
  'not_configured',
];

const round1 = (value: number) => Math.round(value * 10) / 10;

/**
 * The same food at a different weight.
 *
 * The portion is what a photograph gets most wrong, and what the person at the table knows
 * best. Everything else the model said about an item was that portion multiplied out, so a
 * corrected portion rescales it all in proportion. Out-of-range weights are held to the range
 * rather than refused: the field is being typed into, and "2" on the way to "250" is not an
 * error.
 */
export function withGrams(item: FoodScanItem, grams: number): FoodScanItem {
  if (!Number.isFinite(grams) || grams <= 0) return item;
  const next = Math.min(round1(grams), FOOD_SCAN_LIMITS.grams);
  const ratio = next / item.grams;
  return {
    name: item.name,
    grams: next,
    calories: Math.min(round1(item.calories * ratio), FOOD_SCAN_LIMITS.calories),
    proteinG: Math.min(round1(item.proteinG * ratio), FOOD_SCAN_LIMITS.macroGrams),
    carbsG: Math.min(round1(item.carbsG * ratio), FOOD_SCAN_LIMITS.macroGrams),
    fatG: Math.min(round1(item.fatG * ratio), FOOD_SCAN_LIMITS.macroGrams),
  };
}

export interface ScanTotals {
  calories: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
}

/** What the items on the list come to, as they stand now. */
export function scanTotals(items: readonly FoodScanItem[]): ScanTotals {
  const total = items.reduce(
    (sum, item) => ({
      calories: sum.calories + item.calories,
      proteinG: sum.proteinG + item.proteinG,
      carbsG: sum.carbsG + item.carbsG,
      fatG: sum.fatG + item.fatG,
    }),
    { calories: 0, proteinG: 0, carbsG: 0, fatG: 0 },
  );
  return {
    calories: Math.round(total.calories),
    proteinG: round1(total.proteinG),
    carbsG: round1(total.carbsG),
    fatG: round1(total.fatG),
  };
}

/**
 * The confirmed items as food-log entries for a day.
 *
 * One entry per item, as the manual screen would have written them one at a time — so the day
 * can be read, and an item removed, the same way whichever route it arrived by. No `foodKey`:
 * these are not foods from the app's own list, and the log does not pretend they are.
 */
export function toFoodEntries(items: readonly FoodScanItem[], eatenOn: string): FoodEntryInput[] {
  return items.map((item) => ({
    eatenOn,
    name: item.name,
    foodKey: null,
    grams: item.grams,
    calories: item.calories,
    proteinG: item.proteinG,
    carbsG: item.carbsG,
    fatG: item.fatG,
  }));
}
