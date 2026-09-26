import { describe, expect, it } from 'vitest';

import { caloriesBurned, cardioKind, cardioMet } from './calories.js';

describe('which family a cardio exercise belongs to', () => {
  it('reads the catalogue key', () => {
    expect(cardioKind('Walk')).toBe('walk');
    expect(cardioKind('Incline Walk')).toBe('walk');
    expect(cardioKind('Hike')).toBe('walk');
    expect(cardioKind('Outdoor Run')).toBe('run');
    expect(cardioKind('Outdoor Cycling')).toBe('cycle');
    expect(cardioKind('Stationary Bike')).toBe('cycle');
    expect(cardioKind('Swim')).toBe('swim');
    expect(cardioKind('Rowing Machine')).toBe('row');
    expect(cardioKind('Jumping Jacks')).toBe('other');
  });
});

describe('the effort a speed represents', () => {
  it('rises with speed within a family', () => {
    expect(cardioMet('walk', 3)).toBeLessThan(cardioMet('walk', 5.5));
    expect(cardioMet('walk', 5.5)).toBeLessThan(cardioMet('walk', 8));
    expect(cardioMet('run', 9)).toBeLessThan(cardioMet('run', 14));
  });

  it('interpolates between the bands, so one more kilometre never jumps', () => {
    const at5 = cardioMet('walk', 5);
    expect(at5).toBeGreaterThan(cardioMet('walk', 4.5));
    expect(at5).toBeLessThan(cardioMet('walk', 5.5));
  });

  it('holds at the ends rather than running away', () => {
    expect(cardioMet('walk', 0.5)).toBe(cardioMet('walk', 1));
    expect(cardioMet('run', 25)).toBe(cardioMet('run', 40));
  });

  it('falls back to the family default with no speed to go on', () => {
    expect(cardioMet('cycle', null)).toBe(7.5);
    expect(cardioMet('walk', 0)).toBe(3.5);
  });
});

describe('calories burned', () => {
  it('follows the compendium formula', () => {
    // 3.5 MET, 80 kg, an hour: 3.5 × 3.5 × 80 / 200 × 60 ≈ 294.
    expect(caloriesBurned(3.5, 80, 3600)).toBe(294);
  });

  it('scales with time and with weight', () => {
    expect(caloriesBurned(7, 80, 1800)).toBe(caloriesBurned(7, 80, 3600)! / 2);
    expect(caloriesBurned(7, 100, 1800)).toBeGreaterThan(caloriesBurned(7, 70, 1800)!);
  });

  it('says nothing rather than guessing a body weight', () => {
    expect(caloriesBurned(7, null, 3600)).toBeNull();
    expect(caloriesBurned(7, 0, 3600)).toBeNull();
    expect(caloriesBurned(7, 80, 0)).toBeNull();
  });
});
