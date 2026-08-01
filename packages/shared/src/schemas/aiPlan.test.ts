/**
 * The tool definitions are the actual contract Claude sees. If `toToolSchema` silently drops a
 * constraint (a range, a required field) the model never learns about it, and the failure mode
 * is not an error — it's a plausible-looking plan with an exercise sitting outside safe bounds.
 */

import { describe, expect, it } from 'vitest';

import { EXERCISE_SEED } from '../catalog/exercises.js';
import {
  aiNutritionMenuSchema,
  aiWorkoutPlanSchema,
  exerciseKeySchema,
  PROPOSE_NUTRITION_MENU_TOOL,
  PROPOSE_WORKOUT_PLAN_TOOL,
} from './aiPlan.js';

describe('exerciseKeySchema', () => {
  it('accepts a real catalogue key', () => {
    expect(exerciseKeySchema.safeParse('Barbell Bench Press').success).toBe(true);
  });

  it('rejects an invented exercise name', () => {
    // The failure mode this guards against: the model names something plausible-sounding that
    // isn't in the catalogue, and the app has nothing to render or log against.
    expect(exerciseKeySchema.safeParse('Reverse Cable Superset Curl 3000').success).toBe(false);
  });

  it('covers every exercise actually in the catalogue', () => {
    for (const exercise of EXERCISE_SEED) {
      expect(exerciseKeySchema.safeParse(exercise.nameEn).success).toBe(true);
    }
  });
});

describe('aiWorkoutPlanSchema', () => {
  const validPlan = {
    planName: 'Push Pull Legs',
    rationale: 'Three-day split hitting each muscle group with enough recovery between sessions.',
    days: [
      {
        name: 'Push',
        exercises: [
          {
            exerciseKey: 'Barbell Bench Press',
            targetSets: 4,
            targetRepsMin: 6,
            targetRepsMax: 10,
            notes: null,
          },
        ],
      },
    ],
  };

  it('accepts a well-formed plan', () => {
    expect(aiWorkoutPlanSchema.safeParse(validPlan).success).toBe(true);
  });

  it('rejects a plan whose rep range exceeds the safety bound', () => {
    const bad = {
      ...validPlan,
      days: [
        {
          ...validPlan.days[0],
          exercises: [{ ...validPlan.days[0]!.exercises[0], targetRepsMax: 500 }],
        },
      ],
    };
    expect(aiWorkoutPlanSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects an exercise outside the catalogue', () => {
    const bad = {
      ...validPlan,
      days: [
        {
          ...validPlan.days[0],
          exercises: [{ ...validPlan.days[0]!.exercises[0], exerciseKey: 'Not A Real Lift' }],
        },
      ],
    };
    expect(aiWorkoutPlanSchema.safeParse(bad).success).toBe(false);
  });

  it('requires at least one day and at least one exercise per day', () => {
    expect(aiWorkoutPlanSchema.safeParse({ ...validPlan, days: [] }).success).toBe(false);
    expect(
      aiWorkoutPlanSchema.safeParse({ ...validPlan, days: [{ name: 'Push', exercises: [] }] })
        .success,
    ).toBe(false);
  });

  it('caps days at 7 and exercises per day at 12', () => {
    const eightDays = Array.from({ length: 8 }, (_, i) => ({ ...validPlan.days[0], name: `Day ${i}` }));
    expect(aiWorkoutPlanSchema.safeParse({ ...validPlan, days: eightDays }).success).toBe(false);

    const thirteenExercises = Array.from({ length: 13 }, () => validPlan.days[0]!.exercises[0]);
    expect(
      aiWorkoutPlanSchema.safeParse({
        ...validPlan,
        days: [{ name: 'Push', exercises: thirteenExercises }],
      }).success,
    ).toBe(false);
  });
});

describe('aiNutritionMenuSchema', () => {
  const validMenu = {
    summary: 'Matches your 2381 kcal cut target within 3%.',
    meals: [
      {
        name: 'Breakfast',
        items: [
          { name: 'Oats', grams: 80, kcal: 300, proteinG: 10, carbsG: 54, fatG: 6 },
          { name: 'Eggs', grams: null, kcal: 150, proteinG: 12, carbsG: 1, fatG: 10 },
        ],
      },
    ],
    totalKcal: 450,
    totalProteinG: 22,
    totalCarbsG: 55,
    totalFatG: 16,
  };

  it('accepts a well-formed menu, including a null gram weight', () => {
    expect(aiNutritionMenuSchema.safeParse(validMenu).success).toBe(true);
  });

  it('rejects a food item with an implausible calorie value', () => {
    const bad = {
      ...validMenu,
      meals: [{ ...validMenu.meals[0], items: [{ ...validMenu.meals[0]!.items[0], kcal: 99999 }] }],
    };
    expect(aiNutritionMenuSchema.safeParse(bad).success).toBe(false);
  });

  it('requires at least one meal with at least one item', () => {
    expect(aiNutritionMenuSchema.safeParse({ ...validMenu, meals: [] }).success).toBe(false);
  });
});

describe('tool definitions sent to the model', () => {
  it('inline the schema rather than emitting $ref/definitions', () => {
    // A tool schema the model reads directly should be self-contained. $ref support is not
    // guaranteed identical across providers, and there is nothing here that needs reuse.
    const planSchema = JSON.stringify(PROPOSE_WORKOUT_PLAN_TOOL.input_schema);
    expect(planSchema).not.toContain('$ref');
    expect(planSchema).not.toContain('definitions');

    const menuSchema = JSON.stringify(PROPOSE_NUTRITION_MENU_TOOL.input_schema);
    expect(menuSchema).not.toContain('$ref');
    expect(menuSchema).not.toContain('definitions');
  });

  it('does not leak the zod-to-json-schema $schema key into the tool definition', () => {
    expect(PROPOSE_WORKOUT_PLAN_TOOL.input_schema).not.toHaveProperty('$schema');
    expect(PROPOSE_NUTRITION_MENU_TOOL.input_schema).not.toHaveProperty('$schema');
  });

  it('preserves the exercise enum constraint in the compiled JSON schema', () => {
    // This is the actual guarantee the model relies on — if the conversion step dropped the
    // enum, Claude would see a bare string field and could name anything.
    const schema = PROPOSE_WORKOUT_PLAN_TOOL.input_schema as {
      properties: {
        days: {
          items: {
            properties: {
              exercises: { items: { properties: { exerciseKey: { enum?: string[] } } } };
            };
          };
        };
      };
    };
    const enumValues = schema.properties.days.items.properties.exercises.items.properties
      .exerciseKey.enum;
    expect(enumValues).toBeDefined();
    expect(enumValues!.length).toBe(EXERCISE_SEED.length);
    expect(enumValues).toContain('Barbell Bench Press');
  });

  it('preserves numeric bounds in the compiled JSON schema', () => {
    const schema = PROPOSE_WORKOUT_PLAN_TOOL.input_schema as {
      properties: {
        days: {
          items: {
            properties: {
              exercises: {
                items: { properties: { targetRepsMax: { maximum?: number; minimum?: number } } };
              };
            };
          };
        };
      };
    };
    const bounds =
      schema.properties.days.items.properties.exercises.items.properties.targetRepsMax;
    expect(bounds.minimum).toBe(1);
    expect(bounds.maximum).toBe(50);
  });

  it('gives each tool a distinct, stable name matching what the provider will dispatch on', () => {
    expect(PROPOSE_WORKOUT_PLAN_TOOL.name).toBe('propose_workout_plan');
    expect(PROPOSE_NUTRITION_MENU_TOOL.name).toBe('propose_nutrition_menu');
  });
});
