/**
 * What a trainee shares beyond training, as the server sends it (0018): read forgivingly, and
 * asked for with exactly the arguments the functions take.
 */

import { describe, expect, it } from 'vitest';

import { createCoachingApi, parseStatus } from './api.js';
import {
  NOTHING_SHARED,
  parseMeasurements,
  parseNutrition,
  parsePhotos,
  parseSharing,
  parseTargets,
  photoObjectPath,
} from './sharedDocument.js';

describe('the switches', () => {
  it('reads each one as on only when it says true', () => {
    expect(parseSharing({ body: true, nutrition: false, photos: true })).toEqual({
      body: true,
      nutrition: false,
      photos: true,
    });
    expect(parseSharing({ body: 'yes', nutrition: 1, photos: null })).toEqual(NOTHING_SHARED);
    expect(parseSharing(undefined)).toEqual(NOTHING_SHARED);
  });

  it('gives a coach and each trainee their switches, and nothing shared when a server sends none', () => {
    const status = parseStatus({
      role: 'coach',
      code: 'ABC123',
      coach: { id: 'c1', email: 'c@x.com', sharing: { body: true, nutrition: true, photos: false } },
      trainees: [
        { id: 't1', email: 't1@x.com', sharing: { photos: true } },
        // A server from before 0018.
        { id: 't2', email: 't2@x.com' },
      ],
    });
    expect(status.coach?.sharing).toEqual({ body: true, nutrition: true, photos: false });
    expect(status.trainees.map((t) => t.sharing)).toEqual([
      { body: false, nutrition: false, photos: true },
      NOTHING_SHARED,
    ]);
  });
});

describe('weigh-ins', () => {
  it('reads them newest first, numbers that came as text included', () => {
    expect(
      parseMeasurements([
        { measured_at: '2026-10-01T07:00:00Z', weight_kg: '72.4', body_fat_pct: null },
        { measured_at: '2026-10-05T07:00:00Z', weight_kg: 72.1, body_fat_pct: 21.5, muscle_mass_kg: 30 },
      ]),
    ).toEqual([
      {
        measuredAt: '2026-10-05T07:00:00Z',
        weightKg: 72.1,
        bodyFatPct: 21.5,
        muscleMassKg: 30,
        waterPct: null,
      },
      {
        measuredAt: '2026-10-01T07:00:00Z',
        weightKg: 72.4,
        bodyFatPct: null,
        muscleMassKg: null,
        waterPct: null,
      },
    ]);
  });

  it('leaves out a row with no moment or no reading', () => {
    expect(
      parseMeasurements([
        { weight_kg: 70 },
        { measured_at: 'yesterday', weight_kg: 70 },
        { measured_at: '2026-10-01T07:00:00Z', water_pct: 55 },
        'nonsense',
      ]),
    ).toEqual([]);
    expect(parseMeasurements(null)).toEqual([]);
  });
});

describe('food and water', () => {
  it('reads the log, the water by day and the targets', () => {
    const nutrition = parseNutrition({
      targets: { calorieTarget: 2000, proteinG: '140', carbsG: 200, fatG: 70, goal: 'cut' },
      entries: [
        { date: '2026-10-05', name: 'חביתה', grams: 120, calories: 180, protein_g: 12, carbs_g: null, fat_g: 14 },
      ],
      water: [
        { date: '2026-10-05', ml: 2500 },
        { date: '2026-10-04', ml: '1750' },
      ],
    });
    expect(nutrition.targets).toEqual({
      calorieTarget: 2000,
      proteinG: 140,
      carbsG: 200,
      fatG: 70,
      goal: 'cut',
    });
    expect(nutrition.entries).toEqual([
      {
        date: '2026-10-05',
        name: 'חביתה',
        grams: 120,
        calories: 180,
        proteinG: 12,
        carbsG: null,
        fatG: 14,
      },
    ]);
    expect(nutrition.water).toEqual([
      { date: '2026-10-04', ml: 1750 },
      { date: '2026-10-05', ml: 2500 },
    ]);
  });

  it('leaves out what cannot be read, and has no targets rather than half of them', () => {
    const nutrition = parseNutrition({
      targets: { calorieTarget: 2000 },
      entries: [{ date: '5/10', name: 'x', calories: 1 }, { date: '2026-10-05', calories: 1 }, { date: '2026-10-05', name: 'x' }],
      water: [{ date: '2026-10-05', ml: -5 }],
    });
    expect(nutrition).toEqual({ targets: null, entries: [], water: [] });
    expect(parseNutrition(undefined)).toEqual({ targets: null, entries: [], water: [] });
    expect(parseTargets({ calorieTarget: 1, proteinG: 1, carbsG: 1, fatG: 1, goal: 'shred' })?.goal).toBeNull();
  });
});

describe('progress photos', () => {
  it('reads each with its day, pose and note', () => {
    expect(
      parsePhotos([
        { id: 'p1', taken_on: '2026-10-05', pose: 'side', note: 'בוקר' },
        { id: 'p2', taken_on: '2026-09-21', pose: 'upside-down', note: '' },
        { id: 'p3', taken_on: 'soon' },
        { taken_on: '2026-09-01' },
      ]),
    ).toEqual([
      { id: 'p1', takenOn: '2026-10-05', pose: 'side', note: 'בוקר' },
      { id: 'p2', takenOn: '2026-09-21', pose: null, note: null },
    ]);
  });

  it('keeps each account’s pictures in its own folder', () => {
    expect(photoObjectPath('user-1', 'photo-9')).toBe('user-1/photo-9.jpg');
  });
});

describe('asking the server', () => {
  function server(data: unknown = null) {
    const calls: { fn: string; args: Record<string, unknown> | undefined }[] = [];
    const api = createCoachingApi({
      rpc: async (fn, args) => {
        calls.push({ fn, args });
        return { data, error: null };
      },
    });
    return { api, calls };
  }

  const targets = { calorieTarget: 2000, proteinG: 140, carbsG: 200, fatG: 70, goal: 'cut' as const };

  it('sends all three switches, and the targets only while nutrition is shared', async () => {
    const { api, calls } = server({ role: 'trainee', trainees: [] });
    await api.setSharing({ body: true, nutrition: true, photos: false }, targets);
    await api.setSharing({ body: true, nutrition: false, photos: false }, targets);
    expect(calls).toEqual([
      {
        fn: 'coach_set_sharing',
        args: { p_body: true, p_nutrition: true, p_photos: false, p_targets: targets },
      },
      {
        fn: 'coach_set_sharing',
        args: { p_body: true, p_nutrition: false, p_photos: false, p_targets: null },
      },
    ]);
  });

  it('asks for each kind with the trainee and the span', async () => {
    const { api, calls } = server([]);
    await api.body('t1', '2026-01-01T00:00:00Z', '2026-10-17T00:00:00Z');
    await api.nutrition('t1', '2026-09-01', '2026-10-17');
    await api.photos('t1');
    expect(calls).toEqual([
      {
        fn: 'coach_get_body',
        args: { p_trainee: 't1', p_from: '2026-01-01T00:00:00Z', p_to: '2026-10-17T00:00:00Z' },
      },
      { fn: 'coach_get_nutrition', args: { p_trainee: 't1', p_from: '2026-09-01', p_to: '2026-10-17' } },
      { fn: 'coach_get_photos', args: { p_trainee: 't1' } },
    ]);
  });

  it('says plainly when something was not shared', async () => {
    const api = createCoachingApi({
      rpc: async () => ({ data: null, error: { code: '42501', message: 'not_shared' } }),
    });
    expect(await api.photos('t1')).toEqual({ ok: false, error: 'not_shared' });
  });
});
