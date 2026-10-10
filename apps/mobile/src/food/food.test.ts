/**
 * The food list and the arithmetic over it.
 *
 * The first half is about the data, because that is where a food log is wrong: eighty rows of
 * numbers typed by hand, any of which could have a digit dropped or two columns swapped, and
 * every one of which will be believed by whoever picks it.
 */

import { describe, expect, it } from 'vitest';

import { FOOD_BY_KEY, FOOD_SEED } from './foods.js';
import {
  macrosFor,
  MAX_GRAMS,
  parseAmount,
  parseOptional,
  progressTowards,
  searchFoods,
  sumDay,
} from './foodMath.js';

describe('the food list', () => {
  it('has a useful number of foods', () => {
    expect(FOOD_SEED.length).toBeGreaterThanOrEqual(70);
  });

  it.each(FOOD_SEED.map((food) => [food.key, food] as const))(
    '%s: the calories agree with the protein, carbohydrate and fat',
    (_key, food) => {
      // Four kilocalories a gram for protein and carbohydrate, nine for fat. Real foods stray
      // from that — fibre counts as carbohydrate and yields less — so the bound is loose. It is
      // not there to check the third digit; it is there to catch a row whose fat and carbs were
      // typed in each other's columns, which lands far outside it.
      const expected = 4 * food.protein + 4 * food.carbs + 9 * food.fat;
      const off = Math.abs(food.kcal - expected);
      expect([food.key, off <= 12 || off / food.kcal <= 0.16]).toEqual([food.key, true]);
    },
  );

  it('holds only numbers that 100 g of food can hold', () => {
    for (const food of FOOD_SEED) {
      expect(food.kcal).toBeGreaterThan(0);
      // Nothing is more than 900 kcal per 100 g: that is pure fat.
      expect(food.kcal).toBeLessThanOrEqual(900);
      for (const grams of [food.protein, food.carbs, food.fat]) {
        expect(grams).toBeGreaterThanOrEqual(0);
        expect(grams).toBeLessThanOrEqual(100);
      }
      expect(food.protein + food.carbs + food.fat).toBeLessThanOrEqual(100.5);
    }
  });

  it('names every food in both languages, and no two alike', () => {
    for (const food of FOOD_SEED) {
      expect(food.he.trim()).not.toBe('');
      expect(food.en.trim()).not.toBe('');
      expect(food.key).toMatch(/^[a-z0-9_]+$/);
    }
    expect(new Set(FOOD_SEED.map((food) => food.key)).size).toBe(FOOD_SEED.length);
    expect(new Set(FOOD_SEED.map((food) => food.he)).size).toBe(FOOD_SEED.length);
    expect(new Set(FOOD_SEED.map((food) => food.en)).size).toBe(FOOD_SEED.length);
    expect(FOOD_BY_KEY.size).toBe(FOOD_SEED.length);
  });

  it('gives a natural unit a weight a person would recognise, named in both languages', () => {
    for (const food of FOOD_SEED) {
      if (!food.serving) continue;
      expect(food.serving.grams).toBeGreaterThanOrEqual(3);
      expect(food.serving.grams).toBeLessThanOrEqual(400);
      expect(food.serving.he.trim()).not.toBe('');
      expect(food.serving.en.trim()).not.toBe('');
    }
  });

  it('gets a few things right that everybody knows', () => {
    // Anchors. If the list ever disagrees with these, the list is wrong.
    const egg = macrosFor(FOOD_BY_KEY.get('egg')!, 50);
    expect(egg.calories).toBeGreaterThanOrEqual(65);
    expect(egg.calories).toBeLessThanOrEqual(80);
    expect(egg.proteinG).toBeGreaterThanOrEqual(6);

    const chicken = macrosFor(FOOD_BY_KEY.get('chicken_breast')!, 100);
    expect(chicken.proteinG).toBeGreaterThanOrEqual(28);

    const oil = macrosFor(FOOD_BY_KEY.get('olive_oil')!, 14);
    expect(oil.calories).toBeGreaterThanOrEqual(115);
    expect(oil.calories).toBeLessThanOrEqual(130);
  });
});

describe('what an amount of a food holds', () => {
  const rice = FOOD_BY_KEY.get('rice_white')!;

  it('scales with the amount', () => {
    expect(macrosFor(rice, 100)).toEqual({ calories: 130, proteinG: 2.7, carbsG: 28, fatG: 0.3 });
    expect(macrosFor(rice, 250)).toEqual({ calories: 325, proteinG: 6.8, carbsG: 70, fatG: 0.8 });
  });

  it('is nothing for nothing', () => {
    expect(macrosFor(rice, 0)).toEqual({ calories: 0, proteinG: 0, carbsG: 0, fatG: 0 });
  });

  it('keeps calories whole and grams to a tenth', () => {
    const { calories, proteinG } = macrosFor(FOOD_BY_KEY.get('egg')!, 33);
    expect(Number.isInteger(calories)).toBe(true);
    expect(Math.round(proteinG * 10) / 10).toBe(proteinG);
  });
});

describe('a typed amount', () => {
  it('reads a whole number and a decimal', () => {
    expect(parseAmount('150')).toBe(150);
    expect(parseAmount(' 62.5 ')).toBe(62.5);
  });

  it('takes a comma for a decimal point', () => {
    expect(parseAmount('1,5')).toBe(1.5);
  });

  it('refuses what is not an amount', () => {
    for (const raw of ['', '0', '-5', 'abc', '12g', '1.2.3', '1e3', String(MAX_GRAMS + 1)]) {
      expect([raw, parseAmount(raw)]).toEqual([raw, null]);
    }
  });

  it('tells an empty optional field from a wrong one', () => {
    expect(parseOptional('', 500)).toBeNull();
    expect(parseOptional('0', 500)).toBe(0);
    expect(parseOptional('12,5', 500)).toBe(12.5);
    expect(parseOptional('x', 500)).toBeUndefined();
    expect(parseOptional('501', 500)).toBeUndefined();
  });
});

describe('searching the list', () => {
  const keys = (query: string) => searchFoods(query).map((food) => food.key);

  it('is the whole list, in its own order, for an empty search', () => {
    expect(keys('')).toEqual(FOOD_SEED.map((food) => food.key));
    expect(keys('   ')).toHaveLength(FOOD_SEED.length);
  });

  it('finds a food by its Hebrew name or its English one', () => {
    // The two that start with the word, then the rice cake, which only contains it.
    expect(keys('אורז')).toEqual(['rice_white', 'rice_brown', 'rice_cake']);
    expect(keys('rice')).toEqual(expect.arrayContaining(['rice_white', 'rice_brown', 'rice_cake']));
  });

  it('does not care about capitals, or the order of the words', () => {
    expect(keys('RICE brown')).toEqual(['rice_brown']);
    expect(keys('brown rice')).toEqual(['rice_brown']);
    expect(keys('מלא אורז')).toEqual(['rice_brown']);
  });

  it('puts a name that starts with what was typed before one that only contains it', () => {
    // "חזה עוף" starts with "חזה"; nothing else should be ahead of the two breasts.
    expect(keys('חזה').slice(0, 2)).toEqual(['chicken_breast', 'turkey_breast']);
    // "Bread roll" starts with it; "White bread" and "Whole-wheat bread" only contain it.
    expect(keys('bread')).toEqual(['roll', 'bread_white', 'bread_whole']);
    expect(keys('egg')[0]).toBe('egg');
  });

  it('finds nothing for nonsense', () => {
    expect(keys('zzzqqq')).toEqual([]);
  });
});

describe('what a day adds up to', () => {
  it('adds the entries', () => {
    expect(
      sumDay([
        { calories: 325, protein_g: 6.8, carbs_g: 70, fat_g: 0.8 },
        { calories: 165, protein_g: 31, carbs_g: 0, fat_g: 3.6 },
      ]),
    ).toEqual({ calories: 490, proteinG: 37.8, carbsG: 70, fatG: 4.4, partial: false });
  });

  it('is nothing for an empty day', () => {
    expect(sumDay([])).toEqual({ calories: 0, proteinG: 0, carbsG: 0, fatG: 0, partial: false });
  });

  it('counts an unknown macro as none, and says the total has a gap in it', () => {
    const total = sumDay([
      { calories: 500, protein_g: null, carbs_g: null, fat_g: null },
      { calories: 165, protein_g: 31, carbs_g: 0, fat_g: 3.6 },
    ]);
    expect(total.calories).toBe(665);
    expect(total.proteinG).toBe(31);
    expect(total.partial).toBe(true);
  });

  it('does not drift when many small amounts are added', () => {
    const tenth = { calories: 10, protein_g: 0.1, carbs_g: 0.1, fat_g: 0.1 };
    expect(sumDay(Array.from({ length: 30 }, () => tenth)).proteinG).toBe(3);
  });
});

describe('how far along a target the day is', () => {
  it('is a share of the target', () => {
    expect(progressTowards(500, 2000)).toBe(0.25);
  });

  it('stops at full, however far over', () => {
    expect(progressTowards(2600, 2000)).toBe(1);
  });

  it('is nothing when there is no target to be along', () => {
    expect(progressTowards(500, null)).toBe(0);
    expect(progressTowards(500, 0)).toBe(0);
    expect(progressTowards(500, undefined)).toBe(0);
  });
});
