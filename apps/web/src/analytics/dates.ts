/**
 * Calendar dates as the app counts them: local `YYYY-MM-DD`, weeks from Sunday.
 *
 * The dashboard groups workouts into days and weeks and lines them up against a calendar the
 * trainee's phone keeps in the same terms, so it uses the same rules — `localDate` and
 * `weekOf` from the shared coaching code, Sunday first, as the app's calendars are drawn.
 */

import { localDate, weekOf } from '@fit/shared/coaching';

export { localDate };

/** Local midnight of a `YYYY-MM-DD`. */
export function parseDay(day: string): Date {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1);
}

export function addDays(day: string, days: number): string {
  const date = parseDay(day);
  date.setDate(date.getDate() + days);
  return localDate(date);
}

/** The Sunday that starts the week `day` is in. */
export function weekStart(day: string): string {
  return weekOf(day)[0] ?? day;
}

/** Every date from `from` to `to`, inclusive. Empty if `to` comes first. */
export function daysBetween(from: string, to: string): string[] {
  const days: string[] = [];
  for (let day = from; day <= to; day = addDays(day, 1)) days.push(day);
  return days;
}

/** The Sundays of the weeks from `from`'s week to `to`'s, inclusive. */
export function weeksBetween(from: string, to: string): string[] {
  const weeks: string[] = [];
  for (let week = weekStart(from); week <= to; week = addDays(week, 7)) weeks.push(week);
  return weeks;
}

/** Whole days from `earlier` to `later`. */
export function daysApart(earlier: string, later: string): number {
  return Math.round((parseDay(later).getTime() - parseDay(earlier).getTime()) / 86_400_000);
}

export type RangeKey = '4w' | '12w' | '26w' | '52w';

/** The periods a coach can look back over, in weeks. */
export const RANGE_WEEKS: Readonly<Record<RangeKey, number>> = {
  '4w': 4,
  '12w': 12,
  '26w': 26,
  '52w': 52,
};

/**
 * The first day of a period that ends today: the Sunday `weeks - 1` weeks before this week's.
 *
 * Whole weeks, so a weekly chart never starts with a part-week that looks like a slump.
 */
export function rangeStart(range: RangeKey, today: string): string {
  return addDays(weekStart(today), -7 * (RANGE_WEEKS[range] - 1));
}
