import { describe, expect, it } from 'vitest';

import {
  foodAddReducer,
  INITIAL_FOOD_ADD_STATE,
  type FoodAddEvent,
  type FoodAddState,
} from './addFoodState.js';
import type { FoodSeed } from './foods.js';

const egg: FoodSeed = {
  key: 'egg',
  he: 'ביצה',
  en: 'Egg',
  kcal: 155,
  protein: 13,
  carbs: 1,
  fat: 11,
  serving: { grams: 50, he: 'ביצה', en: 'egg' },
};
const rice: FoodSeed = {
  key: 'rice',
  he: 'אורז',
  en: 'Rice',
  kcal: 130,
  protein: 3,
  carbs: 28,
  fat: 0,
};

const run = (events: FoodAddEvent[], from: FoodAddState = INITIAL_FOOD_ADD_STATE) =>
  events.reduce(foodAddReducer, from);

describe('the three ways to add a food', () => {
  it('opens a picked food on one serving, or on 100 g when it has none', () => {
    expect(run([{ type: 'PICKED', food: egg }]).mode).toEqual({
      kind: 'picked',
      food: egg,
      gramsRaw: '50',
    });
    expect(run([{ type: 'PICKED', food: rice }]).mode).toMatchObject({ gramsRaw: '100' });
  });

  it('keeps the amount as typed, and starts over for another food', () => {
    const typed = run([
      { type: 'PICKED', food: egg },
      { type: 'GRAMS_TYPED', raw: '120' },
    ]);
    expect(typed.mode).toMatchObject({ food: egg, gramsRaw: '120' });
    // The egg's 120 g is not the rice's.
    expect(run([{ type: 'PICKED', food: rice }], typed).mode).toMatchObject({
      food: rice,
      gramsRaw: '100',
    });
  });

  it('is one way at a time: by hand puts the picked food away, and picking closes by hand', () => {
    const byHand = run([{ type: 'PICKED', food: egg }, { type: 'BY_HAND_OPENED' }]);
    expect(byHand.mode).toEqual({ kind: 'byHand' });
    expect(run([{ type: 'PICKED', food: rice }], byHand).mode.kind).toBe('picked');
  });

  it('has no amount to type without a picked food', () => {
    expect(run([{ type: 'GRAMS_TYPED', raw: '80' }])).toBe(INITIAL_FOOD_ADD_STATE);
  });
});

describe('saving', () => {
  const picked = run([{ type: 'PICKED', food: egg }]);
  const saving = run([{ type: 'SAVE_STARTED' }], picked);

  it('can start from any of the three, the list included', () => {
    expect(run([{ type: 'SAVE_STARTED' }]).saving).toBe(true);
    expect(saving).toEqual({ ...picked, saving: true });
  });

  it('changes nothing else while an entry is being written', () => {
    expect(run([{ type: 'SAVE_STARTED' }], saving)).toBe(saving);
    expect(run([{ type: 'PICKED', food: rice }], saving)).toBe(saving);
    expect(run([{ type: 'GRAMS_TYPED', raw: '1' }], saving)).toBe(saving);
    expect(run([{ type: 'BY_HAND_OPENED' }], saving)).toBe(saving);
  });

  it('comes back as it was when nothing was written', () => {
    expect(run([{ type: 'SAVE_FAILED' }], saving)).toEqual(picked);
    expect(run([{ type: 'SAVE_FAILED' }], picked)).toBe(picked);
  });
});
