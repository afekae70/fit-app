/**
 * The rest timer's pure half. The countdown itself is an interval reading `Date.now()` against
 * a deadline — a deliberate design choice (see RestTimer) rather than logic worth simulating.
 */

import { describe, expect, it } from 'vitest';

import { formatRest, restFraction } from './restTime.js';

describe('formatRest', () => {
  it('formats as m:ss with a padded seconds field', () => {
    expect(formatRest(90)).toBe('1:30');
    expect(formatRest(65)).toBe('1:05');
    expect(formatRest(9)).toBe('0:09');
  });

  it('rounds up, so a timer never shows a second it has not finished', () => {
    // 89.4s left is still "1:30" on screen: counting down to 1:29 while a second is still
    // running would make the last tick look like it was skipped.
    expect(formatRest(89.4)).toBe('1:30');
    expect(formatRest(0.2)).toBe('0:01');
  });

  it('floors at zero rather than going negative', () => {
    // The interval keeps firing for a moment after the deadline passes; without the clamp the
    // bar would flash "-0:01" on its way out.
    expect(formatRest(0)).toBe('0:00');
    expect(formatRest(-3)).toBe('0:00');
  });

  it('handles rests longer than a minute boundary', () => {
    expect(formatRest(120)).toBe('2:00');
    expect(formatRest(119.9)).toBe('2:00');
    expect(formatRest(600)).toBe('10:00');
  });
});

describe('restFraction', () => {
  it('reports the share of rest still left', () => {
    expect(restFraction(45, 90)).toBe(0.5);
    expect(restFraction(90, 90)).toBe(1);
    expect(restFraction(0, 90)).toBe(0);
  });

  it('clamps above 1, which a late "+30" would otherwise produce', () => {
    // Pressing +30 after the deadline passed leaves remaining > total for an instant; without
    // the clamp the ring would sweep backwards past full.
    expect(restFraction(120, 90)).toBe(1);
  });

  it('clamps below 0 once the deadline is past', () => {
    expect(restFraction(-5, 90)).toBe(0);
  });

  it('returns 0 rather than dividing by zero', () => {
    expect(restFraction(10, 0)).toBe(0);
  });
});
