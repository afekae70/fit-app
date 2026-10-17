import type { CoachMeasurement, CoachNutrition } from '@fit/shared/coaching';
import { describe, expect, it } from 'vitest';

import { bodyDays, bodySummary, weeklyAverage, weeklyRate } from './body.js';
import { nutritionDays, nutritionSummary } from './nutrition.js';

const at = (day: string, hour = 7) => new Date(`${day}T0${hour}:00:00`).toISOString();
const reading = (day: string, weightKg: number | null, bodyFatPct: number | null = null) =>
  ({ measuredAt: at(day), weightKg, bodyFatPct, muscleMassKg: null, waterPct: null }) as CoachMeasurement;

describe('weigh-ins', () => {
  it('makes one figure a day, oldest first, inside the period', () => {
    const days = bodyDays(
      [reading('2026-10-03', 72), reading('2026-10-01', 73), { ...reading('2026-10-01', 74), measuredAt: at('2026-10-01', 9) }, reading('2026-09-01', 80)],
      '2026-09-28',
      '2026-10-17',
    );
    expect(days.map((d) => [d.date, d.weightKg])).toEqual([
      ['2026-10-01', 73.5],
      ['2026-10-03', 72],
    ]);
  });

  it('averages the trend over the seven days ending on each weigh-in', () => {
    const days = bodyDays(
      [reading('2026-10-01', 74), reading('2026-10-04', 72), reading('2026-10-10', 71)],
      '2026-10-01',
      '2026-10-17',
    );
    expect(weeklyAverage(days)).toEqual([
      { date: '2026-10-01', weightKg: 74 },
      { date: '2026-10-04', weightKg: 73 },
      { date: '2026-10-10', weightKg: 71.5 },
    ]);
  });

  it('gives the rate as the slope through every day, per week', () => {
    // Half a kilo down a week, exactly, one reading every other day.
    const readings = Array.from({ length: 15 }, (_, i) => {
      const day = new Date(2026, 8, 1 + i * 2);
      const iso = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
      return reading(iso, 80 - (0.5 / 7) * i * 2);
    });
    const rate = weeklyRate(bodyDays(readings, '2026-09-01', '2026-10-17'));
    expect(rate).toBeCloseTo(-0.5, 6);
  });

  it('calls no direction from too little', () => {
    expect(weeklyRate(bodyDays([reading('2026-10-01', 74), reading('2026-10-10', 72)], '2026-10-01', '2026-10-17'))).toBeNull();
    expect(
      weeklyRate(bodyDays([reading('2026-10-01', 74), reading('2026-10-02', 73), reading('2026-10-03', 72)], '2026-10-01', '2026-10-17')),
    ).toBeNull();
  });

  it('sums up the latest weight, the change and body fat', () => {
    const summary = bodySummary(
      bodyDays(
        [reading('2026-09-01', 80, 22), reading('2026-09-20', 78), reading('2026-10-15', 76, 20.5), reading('2026-10-16', null, 20)],
        '2026-09-01',
        '2026-10-17',
      ),
    );
    expect(summary.latest).toEqual({ date: '2026-10-15', weightKg: 76 });
    expect(summary.changeKg).toBe(-4);
    expect(summary.latestBodyFat).toBe(20);
    expect(summary.bodyFatChange).toBe(-2);
    expect(summary.weighIns).toBe(3);
  });

  it('is empty without readings', () => {
    expect(bodySummary([])).toEqual({
      latest: null,
      changeKg: null,
      weeklyRateKg: null,
      latestBodyFat: null,
      bodyFatChange: null,
      weighIns: 0,
    });
  });
});

describe('eating and drinking', () => {
  const food = (date: string, calories: number, proteinG: number | null = null) => ({
    date,
    name: 'אוכל',
    grams: null,
    calories,
    proteinG,
    carbsG: null,
    fatG: null,
  });
  const NUTRITION: CoachNutrition = {
    targets: { calorieTarget: 2000, proteinG: 140, carbsG: 200, fatG: 70, goal: 'cut' },
    entries: [
      food('2026-10-14', 1200, 60),
      food('2026-10-14', 750, 50),
      food('2026-10-15', 2600, 120),
      food('2026-10-17', 400, 30),
      food('2026-09-01', 9999),
    ],
    water: [
      { date: '2026-10-14', ml: 2500 },
      { date: '2026-10-16', ml: 1500 },
    ],
  };

  it('lists every day in the period, the empty ones too', () => {
    const days = nutritionDays(NUTRITION, '2026-10-14', '2026-10-17');
    expect(days.map((d) => [d.date, d.calories, d.proteinG, d.waterMl, d.entries.length])).toEqual([
      ['2026-10-14', 1950, 110, 2500, 2],
      ['2026-10-15', 2600, 120, 0, 1],
      ['2026-10-16', 0, 0, 1500, 0],
      ['2026-10-17', 400, 30, 0, 1],
    ]);
  });

  it('averages over logged, finished days only', () => {
    const days = nutritionDays(NUTRITION, '2026-10-14', '2026-10-17');
    const summary = nutritionSummary(days, NUTRITION.targets, '2026-10-17');
    expect(summary.days).toBe(3);
    expect(summary.loggedDays).toBe(2);
    expect(summary.avgCalories).toBe(2275);
    expect(summary.avgProteinG).toBe(115);
    // 1950 is within a tenth of 2000; 2600 is not.
    expect(summary.onTargetDays).toBe(1);
    expect(summary.avgWaterMl).toBe(2000);
    expect(summary.waterDays).toBe(2);
  });

  it('has no target count without targets, and no averages without a log', () => {
    const days = nutritionDays({ targets: null, entries: [], water: [] }, '2026-10-14', '2026-10-17');
    const summary = nutritionSummary(days, null, '2026-10-17');
    expect(summary.onTargetDays).toBeNull();
    expect(summary.avgCalories).toBeNull();
    expect(summary.avgWaterMl).toBeNull();
  });
});
