/**
 * How far back the workout history reaches: the last week, month, half year or year — or all
 * of it.
 *
 * Every period starts at local midnight, not at this moment on that date. "The last week" read
 * on Wednesday morning means from last Wednesday, and a session done last Wednesday evening is
 * in it; cutting at 09:00 a week ago would drop it for being eight hours too old, which nobody
 * reading a history would call last week.
 *
 * Months are calendar months, clamped at the end: a month before March 31st is February 28th,
 * not March 3rd, which is where `Date.setMonth` would land.
 */

export type HistoryPeriod = 'week' | 'month' | 'halfYear' | 'year' | 'all';

/** In the order the chips are shown: nearest first, and everything last. */
export const HISTORY_PERIODS: readonly HistoryPeriod[] = ['week', 'month', 'halfYear', 'year', 'all'];

/**
 * A month rather than a week. A week is often empty — a rest week, a trip — and an empty list
 * on opening reads as history lost, where a month nearly always shows something.
 */
export const DEFAULT_HISTORY_PERIOD: HistoryPeriod = 'month';

/** Local midnight at the start of the period, or null for all of history. */
export function periodStart(period: HistoryPeriod, now: Date): Date | null {
  const year = now.getFullYear();
  const month = now.getMonth();
  const day = now.getDate();

  switch (period) {
    case 'week':
      return new Date(year, month, day - 7);
    case 'month':
      return monthsBefore(year, month, day, 1);
    case 'halfYear':
      return monthsBefore(year, month, day, 6);
    case 'year':
      return monthsBefore(year, month, day, 12);
    case 'all':
      return null;
  }
}

function monthsBefore(year: number, month: number, day: number, months: number): Date {
  const target = new Date(year, month - months, 1);
  const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  return new Date(target.getFullYear(), target.getMonth(), Math.min(day, lastDay));
}
