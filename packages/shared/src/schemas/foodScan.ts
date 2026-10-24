/**
 * What comes back from photographing a meal.
 *
 * The photo goes to a small function on the server, which asks a vision model what is on the
 * plate and how much of it, and answers with this: a list of foods, each with a portion and
 * what that portion comes to. The phone validates the answer against this schema before
 * anything is shown, so a malformed reply is a clear "could not read that" and never a row of
 * `NaN` kcal in somebody's day.
 *
 * ## It is an estimate, and the shape says so
 *
 * Nobody can weigh a plate from a photograph. The portion is a guess, and every number after
 * it is that guess multiplied out. So the result carries a `confidence`, and — the part that
 * matters — nothing here is ever written to the food log by itself. It is shown, each portion
 * can be corrected, and only what the person then confirms is saved (see CLAUDE.md: the
 * Apply button is the only path by which AI output reaches the tables).
 *
 * The function that produces this is `apps/api/src/edge/scan-food.ts`. It cannot import this
 * file — it runs on its own, pasted into the Supabase dashboard — so it keeps the same bounds
 * by hand, and a test in the API workspace holds the two together.
 */

import { z } from 'zod';

/** The most a single item may claim. Bounds, not opinions: they catch a model gone wrong. */
export const FOOD_SCAN_LIMITS = {
  maxItems: 12,
  nameLength: 80,
  grams: 2000,
  calories: 5000,
  macroGrams: 500,
} as const;

export const FoodScanItemSchema = z.object({
  /** In the language the scan was asked for. */
  name: z.string().trim().min(1).max(FOOD_SCAN_LIMITS.nameLength),
  /** The estimated portion. */
  grams: z.number().positive().max(FOOD_SCAN_LIMITS.grams),
  /** For that portion, not per 100 g. */
  calories: z.number().min(0).max(FOOD_SCAN_LIMITS.calories),
  proteinG: z.number().min(0).max(FOOD_SCAN_LIMITS.macroGrams),
  carbsG: z.number().min(0).max(FOOD_SCAN_LIMITS.macroGrams),
  fatG: z.number().min(0).max(FOOD_SCAN_LIMITS.macroGrams),
});

export type FoodScanItem = z.infer<typeof FoodScanItemSchema>;

export const FoodScanResultSchema = z.object({
  /** Empty when the photo shows no food, which is an answer and not an error. */
  items: z.array(FoodScanItemSchema).max(FOOD_SCAN_LIMITS.maxItems),
  /** How sure the model says it is about what it saw and how much of it. */
  confidence: z.enum(['low', 'medium', 'high']),
});

export type FoodScanResult = z.infer<typeof FoodScanResultSchema>;

/**
 * Why a scan did not produce a result, as the function reports it.
 *
 * Codes rather than sentences: the phone says each in the reader's language, and the server
 * has no business knowing which that is.
 */
export const FOOD_SCAN_ERRORS = [
  /** No valid session. Scanning is for signed-in accounts, because each scan is spent quota. */
  'sign_in_required',
  /** The request was not a photo this can read: wrong shape, wrong type, or empty. */
  'bad_request',
  /** The photo is larger than the function accepts. The phone should have shrunk it. */
  'image_too_large',
  /** This account has scanned as many meals as one account may in a day. */
  'daily_limit',
  /** The model's own free quota is used up for now; nothing to do but wait. */
  'ai_busy',
  /** The model answered with something that is not an estimate. */
  'not_readable',
  /** The account's owner is under 18: Google's Gemini API terms are for adults (AI_MIN_AGE). */
  'age_restricted',
  /** The account has no date of birth, so its age cannot be checked against the above. */
  'age_unknown',
  /** The server half is not finished being set up: no key, or the table is missing. */
  'not_set_up',
  /** Anything else on the server's side. */
  'server_error',
] as const;

export type FoodScanError = (typeof FOOD_SCAN_ERRORS)[number];

export const FoodScanErrorSchema = z.object({ error: z.enum(FOOD_SCAN_ERRORS) });
