/**
 * The water buttons each person sets for themselves: what is kept, what is refused, and that a
 * typed amount on a button is still told apart from an amount of one's own.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { SqlExecutor } from '../db/executor.js';
import { createTestExecutor } from '../db/testUtils.js';
import { addWater, getLastCustomWater, MAX_WATER_ML } from '../db/water.js';
import {
  buttonAmount,
  DEFAULT_WATER_BUTTONS,
  isDefault,
  MIN_BUTTON_ML,
  readWaterButtons,
  serialiseWaterButtons,
  waterButtonsKey,
} from './waterButtons.js';

describe('the two water buttons', () => {
  it('start as a glass and a small bottle', () => {
    expect(DEFAULT_WATER_BUTTONS).toEqual([250, 500]);
    expect(isDefault(DEFAULT_WATER_BUTTONS)).toBe(true);
  });

  it('come back exactly as they were kept', () => {
    expect(readWaterButtons(serialiseWaterButtons([330, 750]))).toEqual([330, 750]);
    expect(isDefault([330, 750])).toBe(false);
  });

  it('fall back to the defaults for anything that is not two sensible amounts', () => {
    for (const raw of [
      null,
      '',
      'not json',
      '[330]',
      '[330, 750, 1000]',
      '["330", 750]',
      '[5, 750]',
      `[330, ${MAX_WATER_ML + 1}]`,
      '[330.5, 750]',
      '{"a": 1}',
    ]) {
      expect(readWaterButtons(raw), String(raw)).toEqual(DEFAULT_WATER_BUTTONS);
    }
  });

  it('are kept per account, under a key the store accepts', () => {
    expect(waterButtonsKey('3f6c1e0a-1111-4abc-8def-000000000001')).toBe(
      'water-buttons-3f6c1e0a-1111-4abc-8def-000000000001',
    );
    expect(waterButtonsKey('local')).not.toBe(waterButtonsKey('someone-else'));
    // SecureStore takes letters, digits, '.', '-' and '_' only.
    expect(waterButtonsKey('a@b.c d')).toMatch(/^[A-Za-z0-9._-]+$/);
  });
});

describe('typing an amount for a button', () => {
  it('takes whole millilitres within the bounds', () => {
    expect(buttonAmount('330')).toBe(330);
    expect(buttonAmount(' 750 ')).toBe(750);
    expect(buttonAmount(String(MIN_BUTTON_ML))).toBe(MIN_BUTTON_ML);
    expect(buttonAmount(String(MAX_WATER_ML))).toBe(MAX_WATER_ML);
  });

  it('refuses what is not one', () => {
    for (const text of ['', ' ', '0', '5', '0.33', '330ml', '-200', '99999', 'abc']) {
      expect(buttonAmount(text), text).toBeNull();
    }
  });
});

describe('an amount of one’s own, beside buttons set to other amounts', () => {
  let db: SqlExecutor & { close: () => void };
  let counter = 0;
  const newId = () => `w-${++counter}`;
  let tick = Date.parse('2026-10-20T08:00:00.000Z');
  const clock = () => new Date((tick += 1000)).toISOString();
  beforeEach(() => {
    db = createTestExecutor();
  });
  afterEach(() => db.close());

  it('is not offered again when it was only a press of one of the buttons', async () => {
    await addWater(db, 'u', newId, { drunkOn: '2026-10-20', ml: 400 }, clock);
    await addWater(db, 'u', newId, { drunkOn: '2026-10-20', ml: 330 }, clock);
    // With the buttons at 330 and 750, the 330 was a button and the 400 was typed.
    expect(await getLastCustomWater(db, 'u', [330, 750])).toBe(400);
  });
});
