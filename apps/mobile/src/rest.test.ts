/**
 * Rest countdown arithmetic.
 *
 * The bug this design exists to avoid is a timer that stops ticking while the phone is in a
 * pocket and comes back claiming rest remains after it is long over — so the tests move "now"
 * around rather than waiting on real time.
 */

import { describe, expect, it } from 'vitest';

import { formatCountdown, remainingSeconds } from './rest.js';

describe('remainingSeconds', () => {
  const start = Date.UTC(2026, 6, 25, 10, 0, 0);
  const endsAt = start + 120_000;

  it('counts down from the deadline', () => {
    expect(remainingSeconds(endsAt, start)).toBe(120);
    expect(remainingSeconds(endsAt, start + 30_000)).toBe(90);
  });

  it('never goes negative once the deadline has passed', () => {
    expect(remainingSeconds(endsAt, endsAt)).toBe(0);
    expect(remainingSeconds(endsAt, endsAt + 60_000)).toBe(0);
  });

  it('reads correctly after a gap with no ticks at all', () => {
    // The backgrounded case: no interval fired for four minutes. Because the value is derived
    // from the clock rather than decremented, the answer is still right.
    expect(remainingSeconds(endsAt, start + 240_000)).toBe(0);
  });

  it('rounds up, so a running timer never displays zero', () => {
    expect(remainingSeconds(endsAt, start + 119_500)).toBe(1);
    expect(remainingSeconds(endsAt, start + 119_999)).toBe(1);
  });
});

describe('formatCountdown', () => {
  it('pads the seconds field', () => {
    expect(formatCountdown(0)).toBe('0:00');
    expect(formatCountdown(9)).toBe('0:09');
    expect(formatCountdown(60)).toBe('1:00');
    expect(formatCountdown(90)).toBe('1:30');
    expect(formatCountdown(185)).toBe('3:05');
  });
});
