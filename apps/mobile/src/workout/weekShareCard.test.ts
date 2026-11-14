import { describe, expect, it } from 'vitest';

import type { WeekSummary } from '../db/weekSummary.js';
import { weekShareModel, type WeekShareLabels } from './weekShareCard.js';

const plain = (text: string | undefined) => (text ?? '').replace(/[⁦⁩]/g, '');

const labels = (over: Partial<WeekShareLabels> = {}): WeekShareLabels => ({
  title: 'Weekly summary',
  range: '8–14 Nov',
  tip: 'Add one set of curls.',
  tipTitle: 'Tip for next week',
  workouts: 'workouts',
  records: 'records',
  waterDays: 'water days',
  weight: 'weight (kg)',
  lastWeek: (count) => `last week ${count}`,
  recordSet: (r) => `${r.weightKg}×${r.reps}`,
  weightChange: (kg) => `${kg > 0 ? '↑' : '↓'} ${Math.abs(kg)}`,
  weightValue: (kg) => String(kg),
  litres: (value) => `${value} L`,
  exercise: (key) => key.toLowerCase(),
  ...over,
});

const week = (over: Partial<WeekSummary> = {}): WeekSummary => ({
  start: '2026-11-08',
  end: '2026-11-14',
  isCurrent: true,
  workouts: 4,
  previousWorkouts: 3,
  sets: 62,
  water: { reached: 5, counted: 7, goalMl: 3600 },
  satisfaction: 7.5,
  counts: { up: 2, same: 1, down: 1 },
  progressed: ['Squat', 'Row'],
  toPush: ['Curl', 'Calf'],
  records: [
    { exerciseKey: 'Squat', weightKg: 110, reps: 4, previousKg: 100 },
    { exerciseKey: 'Row', weightKg: 70, reps: 8, previousKg: 65 },
  ],
  food: { daysLogged: 5, caloriesPerDay: 2300, proteinPerDay: 160, calorieTarget: 2400, proteinTarget: 150 },
  weight: { latestKg: 80.6, changeKg: -0.8 },
  waterLitresPerDay: 2.9,
  ...over,
});

describe('the week as a picture', () => {
  it('carries the coach’s tip for next week, and nothing else of the coach’s', () => {
    expect(weekShareModel(week(), labels()).tip).toEqual({
      title: 'Tip for next week',
      text: 'Add one set of curls.',
    });
    expect(weekShareModel(week(), labels({ tip: null })).tip).toBeNull();
    expect(weekShareModel(week(), labels({ tip: '  ' })).tip).toBeNull();
  });

  it('keeps four numbers: workouts, records (with the heaviest), water, weight', () => {
    const stats = weekShareModel(week(), labels()).stats;
    expect(stats.map((s) => [s.key, plain(s.value), plain(s.sub)])).toEqual([
      ['workouts', '4', 'last week 3'],
      ['records', '2', 'squat 110×4'],
      ['water', '5/7', '2.9 L'],
      ['weight', '80.6', '↓ 0.8'],
    ]);
  });

  it('has the counters but no lists of exercises — those stay on the screen', () => {
    const model = weekShareModel(week(), labels());
    expect(model.counts).toEqual({ up: 2, same: 1, down: 1 });
    expect(Object.keys(model).sort()).toEqual(['counts', 'stats', 'tip', 'title', 'when']);
  });

  it('leaves off what nobody wrote down, rather than drawing blanks', () => {
    const model = weekShareModel(
      week({
        records: [],
        water: { reached: 0, counted: 7, goalMl: 3600 },
        waterLitresPerDay: null,
        weight: { latestKg: null, changeKg: null },
        counts: { up: 0, same: 0, down: 0 },
      }),
      labels({ tip: null }),
    );
    expect(model.stats.map((s) => s.key)).toEqual(['workouts']);
    expect(model.counts).toBeNull();
    expect(model.tip).toBeNull();
  });
});
