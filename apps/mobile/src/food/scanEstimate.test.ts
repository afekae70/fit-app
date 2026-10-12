import { FOOD_SCAN_LIMITS, type FoodScanItem } from '@fit/shared/schemas';
import { describe, expect, it } from 'vitest';

import { en } from '../i18n/locales/en.js';
import { he } from '../i18n/locales/he.js';
import {
  SCAN_FAILURES,
  readScanResponse,
  scanTotals,
  toFoodEntries,
  withGrams,
} from './scanEstimate.js';

const rice: FoodScanItem = {
  name: 'אורז לבן',
  grams: 180,
  calories: 234,
  proteinG: 4.4,
  carbsG: 51.2,
  fatG: 0.6,
};
const chicken: FoodScanItem = {
  name: 'חזה עוף',
  grams: 150,
  calories: 248,
  proteinG: 46.5,
  carbsG: 0,
  fatG: 5.4,
};

describe('reading the server’s reply', () => {
  it('is the result when the reply is one', () => {
    const outcome = readScanResponse(200, { items: [rice, chicken], confidence: 'medium' });
    expect(outcome).toEqual({ ok: true, result: { items: [rice, chicken], confidence: 'medium' } });
  });

  it('accepts a photo with no food in it as an empty result, not a failure', () => {
    expect(readScanResponse(200, { items: [], confidence: 'high' })).toEqual({
      ok: true,
      result: { items: [], confidence: 'high' },
    });
  });

  it('refuses a reply that is not the agreed shape', () => {
    const bad = [
      null,
      'ok',
      { items: [rice] },
      { items: 'rice', confidence: 'high' },
      { items: [{ ...rice, calories: 'many' }], confidence: 'high' },
      { items: [{ ...rice, grams: 0 }], confidence: 'high' },
      { items: [{ ...rice, proteinG: -1 }], confidence: 'high' },
      { items: [{ ...rice, calories: Number.NaN }], confidence: 'high' },
      { items: [rice], confidence: 'certain' },
    ];
    for (const body of bad) {
      expect(readScanResponse(200, body), JSON.stringify(body)).toEqual({
        ok: false,
        error: 'not_readable',
      });
    }
  });

  it('refuses more items than a plate holds', () => {
    const items = Array.from({ length: FOOD_SCAN_LIMITS.maxItems + 1 }, () => rice);
    expect(readScanResponse(200, { items, confidence: 'low' })).toEqual({
      ok: false,
      error: 'not_readable',
    });
  });

  it('passes on the reason the function gave', () => {
    expect(readScanResponse(429, { error: 'daily_limit' })).toEqual({
      ok: false,
      error: 'daily_limit',
    });
    expect(readScanResponse(503, { error: 'not_set_up' })).toEqual({
      ok: false,
      error: 'not_set_up',
    });
    expect(readScanResponse(503, { error: 'ai_busy' })).toEqual({ ok: false, error: 'ai_busy' });
  });

  it('reads a 404 from in front of the function as the function not being there', () => {
    // What Supabase answers when no function of that name has been deployed.
    expect(
      readScanResponse(404, { code: 'NOT_FOUND', message: 'Requested function was not found' }),
    ).toEqual({ ok: false, error: 'not_set_up' });
  });

  it('gives every other unexplained status a reason of its own', () => {
    expect(readScanResponse(401, { message: 'Invalid JWT' })).toEqual({
      ok: false,
      error: 'sign_in_required',
    });
    expect(readScanResponse(413, '')).toEqual({ ok: false, error: 'image_too_large' });
    expect(readScanResponse(429, {})).toEqual({ ok: false, error: 'ai_busy' });
    expect(readScanResponse(500, 'boom')).toEqual({ ok: false, error: 'server_error' });
  });

  it('does not take an error it has never heard of at its word', () => {
    expect(readScanResponse(500, { error: 'drop_tables' })).toEqual({
      ok: false,
      error: 'server_error',
    });
  });
});

describe('correcting a portion', () => {
  it('rescales everything that followed from the weight', () => {
    expect(withGrams(rice, 90)).toEqual({
      name: 'אורז לבן',
      grams: 90,
      calories: 117,
      proteinG: 2.2,
      carbsG: 25.6,
      fatG: 0.3,
    });
  });

  it('is the same item at the same weight', () => {
    expect(withGrams(rice, 180)).toEqual(rice);
  });

  it('leaves the item alone for a weight that is not one', () => {
    expect(withGrams(rice, 0)).toBe(rice);
    expect(withGrams(rice, -20)).toBe(rice);
    expect(withGrams(rice, Number.NaN)).toBe(rice);
  });

  it('holds a huge weight to the most the log accepts', () => {
    const big = withGrams(chicken, 999999);
    expect(big.grams).toBe(FOOD_SCAN_LIMITS.grams);
    expect(big.calories).toBeLessThanOrEqual(FOOD_SCAN_LIMITS.calories);
    expect(big.proteinG).toBeLessThanOrEqual(FOOD_SCAN_LIMITS.macroGrams);
  });

  it('can be corrected again from the corrected value', () => {
    // Halved and doubled is where it started, to the rounding of one decimal.
    const back = withGrams(withGrams(chicken, 75), 150);
    expect(back.grams).toBe(150);
    expect(back.calories).toBe(248);
    expect(back.proteinG).toBeCloseTo(46.5, 0);
  });
});

describe('what the list comes to', () => {
  it('adds the items up', () => {
    expect(scanTotals([rice, chicken])).toEqual({
      calories: 482,
      proteinG: 50.9,
      carbsG: 51.2,
      fatG: 6,
    });
  });

  it('is nothing for an empty list', () => {
    expect(scanTotals([])).toEqual({ calories: 0, proteinG: 0, carbsG: 0, fatG: 0 });
  });
});

describe('saving what was confirmed', () => {
  it('writes one entry per item, on the day asked for', () => {
    expect(toFoodEntries([rice, chicken], '2026-10-12')).toEqual([
      {
        eatenOn: '2026-10-12',
        name: 'אורז לבן',
        foodKey: null,
        grams: 180,
        calories: 234,
        proteinG: 4.4,
        carbsG: 51.2,
        fatG: 0.6,
      },
      {
        eatenOn: '2026-10-12',
        name: 'חזה עוף',
        foodKey: null,
        grams: 150,
        calories: 248,
        proteinG: 46.5,
        carbsG: 0,
        fatG: 5.4,
      },
    ]);
  });

  it('writes nothing for nothing', () => {
    expect(toFoodEntries([], '2026-10-12')).toEqual([]);
  });
});

describe('every way a scan can fail has something to say', () => {
  it.each(SCAN_FAILURES)('%s, in both languages', (failure) => {
    // A failure with no sentence shows as a blank line under a photo, which reads as a hang.
    expect(he.foodScan.errors[failure]).toBeTruthy();
    expect(en.foodScan.errors[failure]).toBeTruthy();
  });
});
