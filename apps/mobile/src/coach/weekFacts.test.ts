import { describe, expect, it } from 'vitest';

import type { WeekSummary } from '../db/weekSummary.js';
import { weekFacts } from './weekFacts.js';

const week = (over: Partial<WeekSummary> = {}): WeekSummary => ({
  start: '2026-11-08',
  end: '2026-11-14',
  isCurrent: false,
  workouts: 4,
  previousWorkouts: 3,
  sets: 62,
  water: { reached: 5, counted: 7, goalMl: 3620 },
  satisfaction: 7.5,
  counts: { up: 2, same: 1, down: 1 },
  progressed: ['Squat', 'Row'],
  toPush: ['Leg Curl', 'Calf Raise'],
  records: [{ exerciseKey: 'Squat', weightKg: 110, reps: 4, previousKg: 100 }],
  food: { daysLogged: 5, caloriesPerDay: 2300, proteinPerDay: 160, calorieTarget: 2400, proteinTarget: 150 },
  weight: { latestKg: 80.6, changeKg: -0.8 },
  waterLitresPerDay: 2.9,
  ...over,
});

describe('the week’s numbers, for the coach', () => {
  it('gives the water goal and the days it was reached — the number the coach was missing', () => {
    expect(weekFacts(week())).toContain(
      'Water: the daily goal of 3.6 L was reached on 5 of 7 days; average 2.9 L a day.',
    );
  });

  it('gives the rest of what the summary screen shows', () => {
    const facts = weekFacts(week());
    expect(facts).toContain('Workouts: 4 (the week before: 3); working sets: 62.');
    expect(facts).toContain('Average satisfaction with the workouts: 7.5/10.');
    expect(facts).toContain('Personal records: Squat 110 kg x 4 (previous best 100 kg).');
    expect(facts).toContain('2 exercises progressed, 1 stayed the same, 1 went down.');
    expect(facts).toContain('Progressed: Squat, Row. Went down: Leg Curl. Stayed the same: Calf Raise.');
    expect(facts).toContain(
      'Food, average over the 5 logged days: 2300 kcal (target 2400 kcal), 160 g protein (target 150 g).',
    );
    expect(facts).toContain('Weight: 80.6 kg at the last weigh-in (-0.8 kg since the last weigh-in before the week).');
  });

  it('says plainly what was not logged, rather than leaving the coach to guess', () => {
    const facts = weekFacts(
      week({
        records: [],
        counts: { up: 0, same: 0, down: 0 },
        water: { reached: 0, counted: 7, goalMl: 3150 },
        waterLitresPerDay: null,
        food: { daysLogged: 0, caloriesPerDay: null, proteinPerDay: null, calorieTarget: null, proteinTarget: null },
        weight: { latestKg: null, changeKg: null },
        satisfaction: null,
      }),
    );
    expect(facts).toContain('Personal records: none this week.');
    expect(facts).toContain('no water was logged this week.');
    expect(facts).toContain('Food: nothing was logged this week.');
    expect(facts).toContain('Weight: no weigh-in this week.');
    expect(facts).not.toContain('progressed');
    expect(facts).not.toContain('satisfaction');
  });
});
