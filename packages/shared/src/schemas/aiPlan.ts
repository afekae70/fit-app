/**
 * What the AI coach can propose: a full workout plan, or a nutrition menu.
 *
 * These are **tool schemas**, not `output_config.format` schemas. The coach still has an
 * ordinary conversation — it decides mid-turn whether a question calls for prose or for
 * structured data, the same way a human coach might say "sure, here's a plan" and then hand
 * over a written-out program. `output_config.format` forces every response into one fixed
 * shape and cannot mix free text with structured output in the same turn; tool use can, which
 * is why this is built on tools rather than the structured-output endpoint (see
 * `shared/tool-use-concepts.md` in the claude-api skill).
 *
 * A proposal is never applied automatically. `generatePlan`-style flows in the original
 * architecture held AI output for review before writing it into real tables — same principle
 * here: the model's tool call produces a card in the chat UI with an explicit "Apply" action,
 * and only that action touches `plans` / `plan_days` / `plan_day_exercises`.
 */

import { z } from 'zod';
import zodToJsonSchema from 'zod-to-json-schema';

import { EXERCISE_SEED } from '../catalog/exercises.js';

/**
 * Constrained to the real catalogue rather than a free-text string. Without this, "the model
 * invents an exercise name that isn't in the app" is a real failure mode — the UI has nothing
 * to render for a key with no catalogue entry, and the user can't log against it. The tradeoff
 * is a big enum in the tool schema (139 entries today); that cost is paid once, since tool
 * definitions sit in the cached prefix alongside the persona (see claude-provider.ts).
 */
const EXERCISE_KEYS = EXERCISE_SEED.map((exercise) => exercise.nameEn) as [string, ...string[]];
export const exerciseKeySchema = z.enum(EXERCISE_KEYS);

export const aiPrescriptionSchema = z
  .object({
    exerciseKey: exerciseKeySchema,
    targetSets: z.number().int().min(1).max(10),
    targetRepsMin: z.number().int().min(1).max(50),
    targetRepsMax: z.number().int().min(1).max(50),
    /**
     * e.g. "superset with the next exercise". Shown, never stored — the plan tables have no
     * free-text column here, and `.nullable()` rather than `.optional()` is deliberate: strict
     * tool use (see below) requires every property in `required`, and `null` is how a schema
     * marked `additionalProperties: false` represents "nothing to say" without making the key
     * itself optional.
     */
    notes: z.string().max(200).nullable(),
  })
  .strict();

export const aiPlanDaySchema = z
  .object({
    /** "Push", "Pull A", etc — shown as the day name if applied. */
    name: z.string().min(1).max(60),
    exercises: z.array(aiPrescriptionSchema).min(1).max(12),
  })
  .strict();

export const aiWorkoutPlanSchema = z
  .object({
    planName: z.string().min(1).max(80),
    /** One or two sentences on the structure and why — split, frequency, progression logic. */
    rationale: z.string().min(1).max(600),
    days: z.array(aiPlanDaySchema).min(1).max(7),
  })
  .strict();

export type AiPrescription = z.infer<typeof aiPrescriptionSchema>;
export type AiPlanDay = z.infer<typeof aiPlanDaySchema>;
export type AiWorkoutPlan = z.infer<typeof aiWorkoutPlanSchema>;

/* -------------------------------------------------------------------------- */
/* Nutrition menu                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Deliberately a menu, not a food diary. The original scope note stands: tracking what the
 * user actually ate needs a food database and logging UI, and is explicitly out of scope.
 * A menu is a suggestion the coach reads out — matched against the calorie/macro targets
 * already in the digest — with nothing new to persist or reconcile against real intake.
 */
export const aiFoodItemSchema = z
  .object({
    name: z.string().min(1).max(80),
    /** Null for items where a gram weight doesn't make sense ("2 eggs", "1 scoop"). */
    grams: z.number().positive().max(2000).nullable(),
    kcal: z.number().int().min(0).max(3000),
    proteinG: z.number().min(0).max(300),
    carbsG: z.number().min(0).max(500),
    fatG: z.number().min(0).max(200),
  })
  .strict();

export const aiMealSchema = z
  .object({
    /** e.g. "Breakfast" — in the digest's language, since the model already knows the locale. */
    name: z.string().min(1).max(40),
    items: z.array(aiFoodItemSchema).min(1).max(10),
  })
  .strict();

export const aiNutritionMenuSchema = z
  .object({
    /** e.g. "Matches your 2381 kcal cut target within 3%." Ties the menu back to real numbers. */
    summary: z.string().min(1).max(300),
    meals: z.array(aiMealSchema).min(1).max(6),
    totalKcal: z.number().int().min(0).max(10_000),
    totalProteinG: z.number().min(0).max(600),
    totalCarbsG: z.number().min(0).max(1500),
    totalFatG: z.number().min(0).max(500),
  })
  .strict();

export type AiFoodItem = z.infer<typeof aiFoodItemSchema>;
export type AiMeal = z.infer<typeof aiMealSchema>;
export type AiNutritionMenu = z.infer<typeof aiNutritionMenuSchema>;

/* -------------------------------------------------------------------------- */
/* Tool definitions                                                           */
/* -------------------------------------------------------------------------- */

/**
 * `$refStrategy: 'none'` inlines every nested object instead of emitting `$ref`/`definitions`.
 * Tool input schemas are plain JSON Schema read by the model, not validated against a spec
 * that requires refs — inlining keeps the schema self-contained and avoids relying on each
 * provider's `$ref` support being identical.
 */
function toToolSchema(schema: z.ZodType): Record<string, unknown> {
  const converted = zodToJsonSchema(schema, { target: 'jsonSchema7', $refStrategy: 'none' });
  // zod-to-json-schema always emits a `$schema` key; tool input_schema has no use for it and
  // some providers reject unrecognised top-level keys.
  const { $schema: _drop, ...rest } = converted as Record<string, unknown>;
  return rest;
}

export const PROPOSE_WORKOUT_PLAN_TOOL = {
  name: 'propose_workout_plan',
  description:
    'Propose a structured weekly workout plan for the athlete to review and apply. Call this ' +
    'when the athlete asks for a new plan, a redesigned plan, or a fresh program — not for ' +
    'small in-conversation suggestions like "try adding a set". Use only exercises from the ' +
    'allowed enum values; do not invent exercise names. Base the split, frequency, and volume ' +
    "on the athlete's digest: their goal, current progression, and stalling flags.",
  input_schema: toToolSchema(aiWorkoutPlanSchema),
} as const;

export const PROPOSE_NUTRITION_MENU_TOOL = {
  name: 'propose_nutrition_menu',
  description:
    'Propose a concrete nutrition menu (meals with specific foods and portions) that adds up ' +
    "to the athlete's existing calorie and macro targets from the digest. Call this when the " +
    'athlete asks what to eat or for a meal plan — not for general nutrition advice in prose. ' +
    'Do not invent a different calorie target; match the one already computed for them.',
  input_schema: toToolSchema(aiNutritionMenuSchema),
} as const;
