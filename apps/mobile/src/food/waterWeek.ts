/**
 * Water week by week: on how many days of each week the day's aim was reached.
 *
 * Asked for by the owner (2026-11-12): the water card only ever showed one day, and the question
 * worth asking is the habit — "how many times each week do I reach my water goal".
 *
 * ## A day's aim
 *
 * The same rule as the card (`water.ts`): 45 ml per kilogram — but of the weight the person had
 * *on that day*, the latest weighing on or before it. Judging last month by today's weight would
 * move old weeks every time the scale moved: a week of hitting 3.6 litres at 80 kg must not turn
 * into a week of misses because the person now weighs 85. Before the first weighing, the earliest
 * one stands in; with no weighing at all, the card's own stand-in aim.
 *
 * ## Which days count
 *
 * A week has seven days, but not all of them can have been reached yet: this week's days still to
 * come are `future` and are counted neither way. A past day with nothing logged is a day the aim
 * was not reached — that is what the count is for — and is marked `logged: false` so the screen
 * can tell "drank too little" from "wrote nothing down".
 *
 * Weeks start on Sunday, as the calendar does (`db/schedule.ts`).
 *
 * Pure. The rows come from `listWaterByDay` and `listBodyMetrics`.
 */

import { addDays, parseLocalDate, weekDates, weekStart } from '../db/schedule.js';
import { waterGoalMl } from './water.js';

export interface WaterDay {
  /** `YYYY-MM-DD`, local. */
  day: string;
  ml: number;
  /** The aim for that day, from the weight on that day. */
  goalMl: number;
  reached: boolean;
  /** Anything written down for the day at all. */
  logged: boolean;
  /** After today: not yet a day that could be reached or missed. */
  future: boolean;
}

export interface WaterWeek {
  /** The Sunday it starts on. */
  start: string;
  /** Sunday first, always seven. */
  days: WaterDay[];
  /** Days the aim was reached. */
  reached: number;
  /** Days that have happened: seven for a past week, fewer for this one. */
  counted: number;
}

/** A weighing, as `listBodyMetrics` returns it. */
export interface Weighing {
  measured_at: string;
  weight_kg: number | null;
}

/**
 * The weight to judge each day by: the latest weighing on or before the end of that day, or the
 * earliest weighing when the day is older than all of them. Null with no weighing at all.
 */
export function weightOn(day: string, weighings: readonly Weighing[]): number | null {
  const sorted = weighings
    .filter((w) => w.weight_kg !== null && Number.isFinite(w.weight_kg))
    .map((w) => ({ at: new Date(w.measured_at).getTime(), kg: w.weight_kg as number }))
    .sort((a, b) => a.at - b.at);
  if (sorted.length === 0) return null;
  const endOfDay = parseLocalDate(addDays(day, 1)).getTime();
  let found: number | null = null;
  for (const w of sorted) {
    if (w.at < endOfDay) found = w.kg;
    else break;
  }
  return found ?? sorted[0]!.kg;
}

/**
 * The last `weeks` weeks ending with the one containing `today`, oldest first.
 *
 * `daily` is millilitres per local day; days missing from it drank nothing that was logged.
 */
export function waterWeeks(
  daily: readonly { day: string; ml: number }[],
  weighings: readonly Weighing[],
  today: string,
  weeks = 8,
): WaterWeek[] {
  const byDay = new Map(daily.map((row) => [row.day, row.ml]));
  const current = weekStart(today);
  const out: WaterWeek[] = [];

  for (let back = weeks - 1; back >= 0; back--) {
    const start = addDays(current, -7 * back);
    const days = weekDates(start).map((day): WaterDay => {
      const ml = byDay.get(day) ?? 0;
      const goalMl = waterGoalMl(weightOn(day, weighings));
      const future = day > today;
      return { day, ml, goalMl, reached: !future && ml >= goalMl, logged: ml > 0, future };
    });
    out.push({
      start,
      days,
      reached: days.filter((d) => d.reached).length,
      counted: days.filter((d) => !d.future).length,
    });
  }
  return out;
}

/** The first day `waterWeeks` reads, for the query that feeds it. */
export function waterWeeksFrom(today: string, weeks = 8): string {
  return addDays(weekStart(today), -7 * (weeks - 1));
}
