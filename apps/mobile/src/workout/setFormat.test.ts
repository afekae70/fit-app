import { describe, expect, it } from 'vitest';

import { bestSetIndex, formatSet, type LoggedSet } from './setFormat.js';

const LABELS = { weight: 'ק״ג', distance: 'מ׳', seconds: 'שנ׳' };
const set = (over: Partial<LoggedSet> = {}): LoggedSet => ({
  weight_kg: null,
  reps: null,
  duration_seconds: null,
  distance_m: null,
  ...over,
});

describe('reading a set back', () => {
  it('says a weight and its reps as a pair', () => {
    expect(formatSet(set({ weight_kg: 82.5, reps: 8 }), LABELS)).toBe('82.5 ק״ג × 8');
  });

  it('says reps alone for a bodyweight set', () => {
    expect(formatSet(set({ reps: 12 }), LABELS)).toBe('× 12');
  });

  it('says a weight alone when the reps were never filled in', () => {
    expect(formatSet(set({ weight_kg: 60 }), LABELS)).toBe('60 ק״ג');
  });

  it('says seconds for a hold', () => {
    expect(formatSet(set({ duration_seconds: 45 }), LABELS)).toBe('45 שנ׳');
  });

  it('keeps both when a set was carried for a distance under load', () => {
    expect(formatSet(set({ weight_kg: 32, reps: 1, distance_m: 40 }), LABELS)).toBe(
      '32 ק״ג × 1 · 40 מ׳',
    );
  });

  it('shows an em-dash for a set with nothing recorded', () => {
    expect(formatSet(set(), LABELS)).toBe('—');
  });
});

describe('the best set of an exercise', () => {
  const working = (weight: number | null, reps: number | null) => ({
    ...set({ weight_kg: weight, reps }),
    is_warmup: 0,
  });
  const warmup = (weight: number, reps: number) => ({ ...working(weight, reps), is_warmup: 1 });

  it('is the heaviest', () => {
    expect(bestSetIndex([working(80, 8), working(85, 6), working(82.5, 7)])).toBe(1);
  });

  it('breaks a tie on reps', () => {
    expect(bestSetIndex([working(80, 8), working(80, 10), working(80, 9)])).toBe(1);
  });

  it('is never a warm-up, however heavy the working sets are not', () => {
    expect(bestSetIndex([warmup(100, 5), working(60, 8)])).toBe(1);
  });

  it('has no answer for an exercise with no weights, like a plank', () => {
    expect(bestSetIndex([{ ...set({ duration_seconds: 45 }), is_warmup: 0 }])).toBeNull();
    expect(bestSetIndex([])).toBeNull();
  });
});
