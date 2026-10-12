/**
 * Water and saved meals against a real SQLite database, and against the server script that
 * makes their tables: what is kept, what is refused, what taking one back leaves behind, and
 * that both travel through sync the way the food log does.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  BOTTLE_ML,
  DEFAULT_GOAL_ML,
  GLASS_ML,
  glassesOf,
  litres,
  WATER_ML_PER_KG,
  waterGoalMl,
} from '../food/water.js';
import { PURGED_TABLES, purgeUserData } from './account.js';
import type { SqlExecutor } from './executor.js';
import { listFoodEntries } from './food.js';
import {
  deleteSavedMeal,
  listSavedMeals,
  logSavedMeal,
  MAX_MEAL_ITEMS,
  MAX_MEAL_NAME,
  mealCalories,
  readMealItems,
  saveMeal,
} from './savedMeals.js';
import { createTestExecutor } from './testUtils.js';
import { addWater, getWaterTotal, listWaterByDay, MAX_WATER_ML, undoLastWater } from './water.js';
import { SYNC_TABLES } from '../sync/tables.js';

const USER = 'user-1';
const TODAY = '2026-10-12';

let db: SqlExecutor & { close: () => void };
let counter = 0;
let tick = Date.parse('2026-10-12T08:00:00.000Z');
const newId = () => `id-${++counter}`;
const clock = () => new Date((tick += 1000)).toISOString();

beforeEach(() => {
  db = createTestExecutor();
  counter = 0;
});
afterEach(() => db.close());

const SERVER_SQL = readFileSync(
  join(import.meta.dirname, '../../../api/drizzle/0017_water_and_saved_meals.sql'),
  'utf8',
);

describe('drinking water', () => {
  it('adds up the day', async () => {
    await addWater(db, USER, newId, { drunkOn: TODAY, ml: GLASS_ML }, clock);
    await addWater(db, USER, newId, { drunkOn: TODAY, ml: BOTTLE_ML }, clock);
    expect(await getWaterTotal(db, USER, TODAY)).toBe(750);
  });

  it('is nothing on a day with none', async () => {
    expect(await getWaterTotal(db, USER, TODAY)).toBe(0);
  });

  it('keeps each day and each person apart', async () => {
    await addWater(db, USER, newId, { drunkOn: TODAY, ml: 250 }, clock);
    await addWater(db, USER, newId, { drunkOn: '2026-10-11', ml: 500 }, clock);
    await addWater(db, 'someone-else', newId, { drunkOn: TODAY, ml: 1000 }, clock);
    expect(await getWaterTotal(db, USER, TODAY)).toBe(250);
    expect(await getWaterTotal(db, USER, '2026-10-11')).toBe(500);
  });

  it('refuses an amount that is not one, and a day that is not a day', async () => {
    for (const ml of [0, -250, Number.NaN, Number.POSITIVE_INFINITY, MAX_WATER_ML + 1]) {
      expect(await addWater(db, USER, newId, { drunkOn: TODAY, ml }, clock), String(ml)).toBeNull();
    }
    expect(await addWater(db, USER, newId, { drunkOn: 'today', ml: 250 }, clock)).toBeNull();
    expect(await getWaterTotal(db, USER, TODAY)).toBe(0);
  });

  it('takes back the last one added, and only that one', async () => {
    await addWater(db, USER, newId, { drunkOn: TODAY, ml: 250 }, clock);
    await addWater(db, USER, newId, { drunkOn: TODAY, ml: 500 }, clock);
    expect(await undoLastWater(db, USER, TODAY, clock)).toBe(true);
    expect(await getWaterTotal(db, USER, TODAY)).toBe(250);
    expect(await undoLastWater(db, USER, TODAY, clock)).toBe(true);
    expect(await undoLastWater(db, USER, TODAY, clock)).toBe(false);
    expect(await getWaterTotal(db, USER, TODAY)).toBe(0);
  });

  it('marks the row rather than removing it, so the correction can reach the cloud', async () => {
    const id = await addWater(db, USER, newId, { drunkOn: TODAY, ml: 250 }, clock);
    await undoLastWater(db, USER, TODAY, clock);
    const row = await db.get<{ deleted_at: string | null; updated_at: string | null }>(
      `SELECT deleted_at, updated_at FROM water_entries WHERE id = ?`,
      [id],
    );
    expect(row?.deleted_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(row?.updated_at).toBe(row?.deleted_at);
  });

  it('does not take back another day’s water, or another person’s', async () => {
    await addWater(db, USER, newId, { drunkOn: '2026-10-11', ml: 250 }, clock);
    await addWater(db, 'someone-else', newId, { drunkOn: TODAY, ml: 250 }, clock);
    expect(await undoLastWater(db, USER, TODAY, clock)).toBe(false);
    expect(await getWaterTotal(db, USER, '2026-10-11')).toBe(250);
    expect(await getWaterTotal(db, 'someone-else', TODAY)).toBe(250);
  });

  it('lists a span of days, leaving out the ones with none', async () => {
    await addWater(db, USER, newId, { drunkOn: '2026-10-10', ml: 250 }, clock);
    await addWater(db, USER, newId, { drunkOn: '2026-10-10', ml: 250 }, clock);
    await addWater(db, USER, newId, { drunkOn: TODAY, ml: 500 }, clock);
    await addWater(db, USER, newId, { drunkOn: '2026-10-01', ml: 999 }, clock);
    expect(await listWaterByDay(db, USER, '2026-10-06', TODAY)).toEqual([
      { day: '2026-10-10', ml: 500 },
      { day: TODAY, ml: 500 },
    ]);
  });
});

describe('how much water to aim for', () => {
  it('is 45 ml for each kilogram: 72 kg is 3.24 litres', () => {
    // The owner's own example, as given.
    expect(waterGoalMl(72)).toBe(3240);
    expect(litres(waterGoalMl(72))).toBe('3.24');
  });

  it('is the rule as stated, not rounded to something tidier', () => {
    expect(WATER_ML_PER_KG).toBe(45);
    expect(waterGoalMl(60)).toBe(2700);
    expect(waterGoalMl(82)).toBe(3690);
    expect(waterGoalMl(100)).toBe(4500);
    // A weight with a decimal, as a scale gives it, and an odd one whose answer ends in a 5.
    expect(waterGoalMl(72.4)).toBe(3258);
    expect(litres(waterGoalMl(72.4))).toBe('3.26');
    expect(waterGoalMl(73)).toBe(3285);
    expect(litres(waterGoalMl(73))).toBe('3.29');
  });

  it('follows the rule across every weight a person is likely to be', () => {
    for (let kg = 40; kg <= 130; kg += 1) {
      expect(waterGoalMl(kg), `${kg} kg`).toBe(kg * 45);
    }
  });

  it('does not turn a mistyped weight into advice to drink a bucket', () => {
    expect(waterGoalMl(250)).toBe(6000);
    expect(waterGoalMl(720)).toBe(6000);
    expect(waterGoalMl(7)).toBe(1000);
  });

  it('falls back to a default with no weight to go by', () => {
    for (const weight of [null, undefined, 0, -5, Number.NaN]) {
      expect(waterGoalMl(weight)).toBe(DEFAULT_GOAL_ML);
    }
  });

  it('says an amount in litres, to two decimals and no further than needed', () => {
    expect(litres(3240)).toBe('3.24');
    expect(litres(3600)).toBe('3.6');
    expect(litres(2000)).toBe('2');
    expect(litres(1750)).toBe('1.75');
    // A glass is a quarter of a litre, and reads as one.
    expect(litres(250)).toBe('0.25');
    expect(litres(0)).toBe('0');
    expect(litres(3245)).toBe('3.25');
  });

  it('uses the rule at seventy kilograms when there is no weight', () => {
    expect(DEFAULT_GOAL_ML).toBe(3150);
  });

  it('counts whole glasses', () => {
    expect(glassesOf(0)).toBe(0);
    expect(glassesOf(249)).toBe(0);
    expect(glassesOf(750)).toBe(3);
  });
});

const EGGS = {
  name: 'ביצה קשה',
  foodKey: 'egg',
  grams: 100,
  calories: 155,
  proteinG: 12.6,
  carbsG: 1.1,
  fatG: 10.6,
};
const TOAST = {
  name: 'לחם מלא',
  foodKey: null,
  grams: 60,
  calories: 150,
  proteinG: 6,
  carbsG: 26,
  fatG: 2,
};

describe('keeping a meal', () => {
  it('keeps its name and what it is made of', async () => {
    const id = await saveMeal(
      db,
      USER,
      newId,
      { name: '  ארוחת בוקר  ', items: [EGGS, TOAST] },
      clock,
    );
    expect(await listSavedMeals(db, USER)).toEqual([
      { id, name: 'ארוחת בוקר', items: [EGGS, TOAST] },
    ]);
  });

  it('refuses a meal with no name, or with nothing in it that could be logged', async () => {
    expect(await saveMeal(db, USER, newId, { name: '   ', items: [EGGS] }, clock)).toBeNull();
    expect(await saveMeal(db, USER, newId, { name: 'ריק', items: [] }, clock)).toBeNull();
    expect(
      await saveMeal(
        db,
        USER,
        newId,
        { name: 'שבור', items: [{ name: '', calories: 10 }, null] },
        clock,
      ),
    ).toBeNull();
    expect(await listSavedMeals(db, USER)).toEqual([]);
  });

  it('keeps within what the server will take', async () => {
    const many = Array.from({ length: MAX_MEAL_ITEMS + 5 }, (_, index) => ({
      ...EGGS,
      name: `פריט ${index}`,
    }));
    await saveMeal(db, USER, newId, { name: 'x'.repeat(200), items: many }, clock);
    const [meal] = await listSavedMeals(db, USER);
    expect(meal?.name).toHaveLength(MAX_MEAL_NAME);
    expect(meal?.items).toHaveLength(MAX_MEAL_ITEMS);
  });

  it('lists the newest first, and only this person’s', async () => {
    await saveMeal(db, USER, newId, { name: 'בוקר', items: [EGGS] }, clock);
    await saveMeal(db, USER, newId, { name: 'ערב', items: [TOAST] }, clock);
    await saveMeal(db, 'someone-else', newId, { name: 'שלהם', items: [EGGS] }, clock);
    expect((await listSavedMeals(db, USER)).map((meal) => meal.name)).toEqual(['ערב', 'בוקר']);
  });

  it('stops offering a meal that was removed, and marks it so the cloud hears', async () => {
    const id = await saveMeal(db, USER, newId, { name: 'בוקר', items: [EGGS] }, clock);
    await deleteSavedMeal(db, USER, id!, clock);
    expect(await listSavedMeals(db, USER)).toEqual([]);
    const row = await db.get<{ deleted_at: string | null }>(
      `SELECT deleted_at FROM saved_meals WHERE id = ?`,
      [id],
    );
    expect(row?.deleted_at).toMatch(/^\d{4}-/);
  });

  it('cannot remove somebody else’s', async () => {
    const id = await saveMeal(db, USER, newId, { name: 'בוקר', items: [EGGS] }, clock);
    await deleteSavedMeal(db, 'someone-else', id!, clock);
    expect(await listSavedMeals(db, USER)).toHaveLength(1);
  });

  it('adds up to its calories', () => {
    expect(mealCalories([EGGS, TOAST])).toBe(305);
    expect(mealCalories([])).toBe(0);
  });
});

describe('logging a kept meal', () => {
  it('writes each item to the day as an ordinary entry', async () => {
    await saveMeal(db, USER, newId, { name: 'בוקר', items: [EGGS, TOAST] }, clock);
    const [meal] = await listSavedMeals(db, USER);
    expect(await logSavedMeal(db, USER, newId, meal!, TODAY, clock)).toBe(2);

    const entries = await listFoodEntries(db, USER, TODAY);
    expect(
      entries.map((entry) => [entry.name, entry.calories, entry.food_key, entry.grams]),
    ).toEqual([
      ['ביצה קשה', 155, 'egg', 100],
      ['לחם מלא', 150, null, 60],
    ]);
    expect(entries[0]).toMatchObject({ protein_g: 12.6, carbs_g: 1.1, fat_g: 10.6 });
  });

  it('can be logged again tomorrow: the meal is not used up', async () => {
    await saveMeal(db, USER, newId, { name: 'בוקר', items: [EGGS] }, clock);
    const [meal] = await listSavedMeals(db, USER);
    await logSavedMeal(db, USER, newId, meal!, TODAY, clock);
    await logSavedMeal(db, USER, newId, meal!, '2026-10-13', clock);
    expect(await listFoodEntries(db, USER, '2026-10-13')).toHaveLength(1);
    expect(await listSavedMeals(db, USER)).toHaveLength(1);
  });

  it('writes nothing for a day that is not a day', async () => {
    expect(await logSavedMeal(db, USER, newId, { items: [EGGS] }, 'tomorrow', clock)).toBe(0);
  });
});

describe('reading a meal that something else wrote', () => {
  it('reads what it can and leaves out what it cannot', () => {
    const stored = JSON.stringify([
      EGGS,
      { name: 'בלי קלוריות' },
      'not an item',
      { name: 'מספרים שגויים', calories: 90, grams: -5, proteinG: 'much', foodKey: 'Not A Key' },
    ]);
    expect(readMealItems(stored)).toEqual([
      EGGS,
      {
        name: 'מספרים שגויים',
        foodKey: null,
        grams: null,
        calories: 90,
        proteinG: null,
        carbsG: null,
        fatG: null,
      },
    ]);
  });

  it('is nothing, and no error, for text that is not a list', () => {
    for (const stored of [null, '', 'not json', '{}', '"text"', '42']) {
      expect(readMealItems(stored), String(stored)).toEqual([]);
    }
  });

  it('does not offer a meal whose items cannot be read', async () => {
    await db.run(
      `INSERT INTO saved_meals (id, user_id, name, items, created_at, updated_at)
       VALUES ('broken', ?, 'שבור', 'not json', ?, ?)`,
      [USER, clock(), clock()],
    );
    expect(await listSavedMeals(db, USER)).toEqual([]);
  });
});

describe('both, as part of the account', () => {
  it('are deleted with the account, and only that account’s', async () => {
    await addWater(db, USER, newId, { drunkOn: TODAY, ml: 250 }, clock);
    await addWater(db, 'someone-else', newId, { drunkOn: TODAY, ml: 250 }, clock);
    await saveMeal(db, USER, newId, { name: 'בוקר', items: [EGGS] }, clock);
    await saveMeal(db, 'someone-else', newId, { name: 'שלהם', items: [EGGS] }, clock);
    expect(PURGED_TABLES).toEqual(expect.arrayContaining(['water_entries', 'saved_meals']));

    await purgeUserData(db, USER);
    expect(await getWaterTotal(db, USER, TODAY)).toBe(0);
    expect(await listSavedMeals(db, USER)).toEqual([]);
    expect(await getWaterTotal(db, 'someone-else', TODAY)).toBe(250);
    expect(await listSavedMeals(db, 'someone-else')).toHaveLength(1);
  });

  it.each(['water_entries', 'saved_meals'])(
    '%s syncs, with every column that is not sync’s own bookkeeping',
    async (name) => {
      const table = SYNC_TABLES.find((entry) => entry.table === name);
      expect(table).toBeDefined();
      // The server gets the table from a script run by hand; until then the rest must sync.
      expect(table?.optional).toBe(true);

      const local = (await db.all<{ name: string }>(`PRAGMA table_info(${name})`)).map(
        (column) => column.name,
      );
      expect([...table!.columns].sort()).toEqual(
        local.filter((column) => column !== 'remote_updated_at').sort(),
      );
      expect(local).toContain('remote_updated_at');
    },
  );

  it.each(['water_entries', 'saved_meals'])(
    '%s sends only columns the server’s table has',
    (name) => {
      const body = new RegExp(
        String.raw`CREATE TABLE IF NOT EXISTS public\.${name} \(([\s\S]*?)\n\);`,
      ).exec(SERVER_SQL)?.[1];
      expect(body).toBeDefined();
      const serverColumns = [
        ...body!.matchAll(/^\s{2}([a-z_]+)\s+(?:uuid|text|date|integer|jsonb|timestamptz)/gm),
      ].map((match) => match[1]);
      const table = SYNC_TABLES.find((entry) => entry.table === name)!;
      expect(serverColumns.length).toBeGreaterThanOrEqual(7);
      for (const column of table.columns) expect(serverColumns, column).toContain(column);
    },
  );

  it('sends a meal’s items as JSON, which is what the server’s column is', () => {
    expect(SYNC_TABLES.find((entry) => entry.table === 'saved_meals')?.json).toEqual(['items']);
    expect(SERVER_SQL).toMatch(/items\s+jsonb NOT NULL/);
  });

  it('keeps within the bounds the server checks', () => {
    // The same numbers, in two files. If the server's are ever tightened and these are not,
    // rows start being refused; this is where that shows first.
    expect(SERVER_SQL).toContain('ml >= 1 AND ml <= 5000');
    expect(SERVER_SQL).toContain('BETWEEN 1 AND 80');
    expect(SERVER_SQL).toContain('BETWEEN 1 AND 30');
    expect([MAX_WATER_ML, MAX_MEAL_NAME, MAX_MEAL_ITEMS]).toEqual([5000, 80, 30]);
  });

  it('stamps new rows so that sync sends them', async () => {
    const water = await addWater(db, USER, newId, { drunkOn: TODAY, ml: 250 }, clock);
    const meal = await saveMeal(db, USER, newId, { name: 'בוקר', items: [EGGS] }, clock);
    for (const [table, id] of [
      ['water_entries', water],
      ['saved_meals', meal],
    ] as const) {
      const row = await db.get<{ updated_at: string | null; created_at: string }>(
        `SELECT updated_at, created_at FROM ${table} WHERE id = ?`,
        [id],
      );
      expect(row?.updated_at, table).toBe(row?.created_at);
    }
  });
});
