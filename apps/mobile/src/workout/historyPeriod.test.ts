import { describe, expect, it } from 'vitest';

import { HISTORY_PERIODS, periodStart } from './historyPeriod.js';

/** Local calendar date and time of a Date, so the assertions do not depend on the machine's zone. */
const local = (date: Date | null) =>
  date === null
    ? null
    : `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
        date.getDate(),
      ).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(
        date.getMinutes(),
      ).padStart(2, '0')}`;

const WEDNESDAY_MORNING = new Date(2026, 8, 17, 9, 30);

describe('where each history period starts', () => {
  it('reaches back a week to midnight, so last Wednesday evening is included', () => {
    expect(local(periodStart('week', WEDNESDAY_MORNING))).toBe('2026-09-10 00:00');
  });

  it('reaches back one calendar month', () => {
    expect(local(periodStart('month', WEDNESDAY_MORNING))).toBe('2026-08-17 00:00');
  });

  it('reaches back six months, across the year boundary', () => {
    expect(local(periodStart('halfYear', new Date(2026, 1, 10, 12)))).toBe('2025-08-10 00:00');
  });

  it('reaches back a whole year', () => {
    expect(local(periodStart('year', WEDNESDAY_MORNING))).toBe('2025-09-17 00:00');
  });

  it('clamps to the end of a shorter month instead of spilling into the next', () => {
    // A month before March 31st is February 28th — not March 3rd.
    expect(local(periodStart('month', new Date(2026, 2, 31, 8)))).toBe('2026-02-28 00:00');
    expect(local(periodStart('halfYear', new Date(2026, 7, 31, 8)))).toBe('2026-02-28 00:00');
  });

  it('lands on February 29th only in a leap year', () => {
    expect(local(periodStart('year', new Date(2029, 1, 28)))).toBe('2028-02-28 00:00');
    expect(local(periodStart('month', new Date(2028, 2, 30)))).toBe('2028-02-29 00:00');
  });

  it('has no start for all of history', () => {
    expect(periodStart('all', WEDNESDAY_MORNING)).toBeNull();
  });

  it('offers the periods nearest first, with everything last', () => {
    expect(HISTORY_PERIODS).toEqual(['week', 'month', 'halfYear', 'year', 'all']);
  });

  it('gives each longer period an earlier start than the one before it', () => {
    const starts = HISTORY_PERIODS.slice(0, 4).map((p) => periodStart(p, WEDNESDAY_MORNING)!.getTime());
    for (let i = 1; i < starts.length; i += 1) expect(starts[i]).toBeLessThan(starts[i - 1]!);
  });
});
