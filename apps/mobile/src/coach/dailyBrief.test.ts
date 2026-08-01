/**
 * Only the pure surface and the cached fast-path are covered here. The network branch goes
 * through `streamCoachChat`, which is XMLHttpRequest-based and — like the rest of that module —
 * is exercised manually against a real device rather than under vitest (see stream.test.ts,
 * which only covers the pure `parseSseChunk` for the same reason).
 */

import type { CoachContextPayload } from '@fit/shared/schemas';
import { beforeEach, describe, expect, it } from 'vitest';

import { getDailyBrief, hasUsableContext, localDateString } from './dailyBrief.js';
import { saveCoachBrief } from '../db/coachBriefs.js';
import type { SqlExecutor } from '../db/executor.js';
import { createTestExecutor } from '../db/testUtils.js';

const EMPTY_CONTEXT: CoachContextPayload = {
  locale: 'en',
  profile: { ageYears: null, sex: null, heightCm: null, weightKg: null, activityLevel: null, goal: null },
  targets: {
    bmi: null,
    bmrKcal: null,
    tdeeKcal: null,
    calorieTarget: null,
    proteinG: null,
    carbsG: null,
    fatG: null,
  },
  weightTrend: { currentKg: null, kgPerWeek: null, isReliable: false, measurementCount: 0 },
  exercises: [],
  adherence: [],
  availableEquipment: [],
  planName: null,
};

describe('localDateString', () => {
  it('formats as YYYY-MM-DD', () => {
    expect(localDateString(new Date(2026, 6, 31, 23, 59))).toBe('2026-07-31');
    expect(localDateString(new Date(2026, 0, 5, 0, 0))).toBe('2026-01-05');
  });
});

describe('hasUsableContext', () => {
  it('is false with no exercises, weight history, or targets', () => {
    expect(hasUsableContext(EMPTY_CONTEXT)).toBe(false);
  });

  it('is true once any single signal is present', () => {
    expect(hasUsableContext({ ...EMPTY_CONTEXT, targets: { ...EMPTY_CONTEXT.targets, tdeeKcal: 2200 } })).toBe(
      true,
    );
    expect(
      hasUsableContext({
        ...EMPTY_CONTEXT,
        weightTrend: { ...EMPTY_CONTEXT.weightTrend, measurementCount: 1 },
      }),
    ).toBe(true);
  });
});

describe('getDailyBrief — cached path', () => {
  let db: SqlExecutor;
  let counter = 0;
  const newId = () => `id-${String(++counter).padStart(3, '0')}`;
  const USER = 'user-1';

  beforeEach(() => {
    db = createTestExecutor();
    counter = 0;
  });

  it('returns the cached brief without touching the network', async () => {
    await saveCoachBrief(db, USER, newId, '2026-07-31', 'Cached note.', () => '2026-07-31T09:00:00.000Z');

    const text = await getDailyBrief({
      db,
      userId: USER,
      newId,
      locale: 'en',
      baseUrl: 'https://example.invalid',
      accessToken: 'token',
      today: new Date(2026, 6, 31, 12, 0),
    });

    expect(text).toBe('Cached note.');
  });

  it('returns null with no cache and no usable context, without touching the network', async () => {
    const text = await getDailyBrief({
      db,
      userId: USER,
      newId,
      locale: 'en',
      baseUrl: 'https://example.invalid',
      accessToken: 'token',
      today: new Date(2026, 6, 31, 12, 0),
    });

    expect(text).toBeNull();
  });
});
