import { describe, expect, it } from 'vitest';

import { loadRatio, SESSION_EFFORT_CHOICES, sessionLoad } from './sessionLoad.js';

describe('sessionLoad', () => {
  it('multiplies effort by minutes', () => {
    expect(sessionLoad(8, 60)).toBe(480);
  });

  it('rounds to a whole number', () => {
    expect(sessionLoad(7, 52.5)).toBe(368);
  });

  it('is null when the session was never rated', () => {
    // Null, not 0. An unrated session has an unknown cost, and a zero would drag a weekly
    // average down as though the training had been free.
    expect(sessionLoad(null, 60)).toBeNull();
    expect(sessionLoad(undefined, 60)).toBeNull();
  });

  it('is null when the duration is missing or nonsense', () => {
    expect(sessionLoad(8, null)).toBeNull();
    expect(sessionLoad(8, 0)).toBeNull();
    expect(sessionLoad(8, Number.NaN)).toBeNull();
  });

  it('offers five anchored points rather than ten', () => {
    // A number given while catching your breath is not precise to one point in ten.
    expect(SESSION_EFFORT_CHOICES).toHaveLength(5);
    expect(SESSION_EFFORT_CHOICES.every((n) => n >= 1 && n <= 10)).toBe(true);
  });
});

describe('loadRatio', () => {
  it('compares this week against the recent average', () => {
    expect(loadRatio(1200, [800, 800, 800])).toBe(1.5);
  });

  it('is null without a history to compare against', () => {
    expect(loadRatio(1200, [])).toBeNull();
    expect(loadRatio(1200, [0, 0])).toBeNull();
  });

  it('is null for a week with no load of its own', () => {
    expect(loadRatio(0, [800])).toBeNull();
  });

  it('ignores weeks that were never rated', () => {
    // A zero week here means "nothing recorded", not "trained and it was free".
    expect(loadRatio(900, [900, 0, Number.NaN])).toBe(1);
  });
});
