/**
 * One line per trainee, for the coach's front page: where each of them stands, and who needs
 * a word.
 *
 * The flags are the point of the page. A coach with twenty trainees does not read twenty
 * dashboards on a Monday; they read the names with something next to them. Each flag is a
 * plain rule over data the coach can already see — no score, no weighting — so that when one
 * appears, the coach can tell why from the flag's own name.
 */

import type { CoachCalendar, CoachPlan, CoachSession } from '@fit/shared/coaching';

import { addDays, daysApart, localDate } from './dates.js';
import { exerciseSummaries } from './lifts.js';
import { adherenceOver, adherenceRate, sessionsWithin, periodTotals } from './training.js';

export type Flag =
  /** No finished workout in the last seven days — or ever. */
  | 'inactive'
  /** Two or more planned workouts missed in the last fourteen days. */
  | 'missing'
  /** Nothing on the calendar for the next seven days. */
  | 'unplanned'
  /** One of the lifts done most often has not beaten its best in three workouts or more. */
  | 'stalling';

export const FLAG_ORDER: readonly Flag[] = ['inactive', 'missing', 'stalling', 'unplanned'];

export interface TraineeOverview {
  lastWorkoutAt: string | null;
  /** Whole days since the last workout's day; null with none. */
  daysSinceLast: number | null;
  workouts7: number;
  workouts28: number;
  volume28: number;
  /** Planned-and-done over the last fourteen days that are over; null when none was planned. */
  adherence14: number | null;
  /** Volume over the last fourteen days against the fourteen before, as a percentage change. */
  volumeTrend: number | null;
  /** The next planned day with workouts on it, in the next fourteen days. */
  next: { date: string; names: string[] } | null;
  /** The lifts done most often that are stalling. */
  stalling: string[];
  flags: Flag[];
}

/** The name a planned workout goes by, for the "next" line. */
function dayNames(plans: readonly CoachPlan[]): Map<string, string> {
  const names = new Map<string, string>();
  for (const plan of plans) {
    plan.days.forEach((day, index) => {
      names.set(day.id, day.name?.trim() || `${plan.name} ${index + 1}`);
    });
  }
  return names;
}

/**
 * A trainee's line, from their last eight weeks of workouts, their calendar from two weeks
 * back to two weeks ahead, and their plans (for the names on the calendar).
 */
export function traineeOverview(input: {
  sessions: readonly CoachSession[];
  calendar: CoachCalendar;
  plans: readonly CoachPlan[];
  today: string;
}): TraineeOverview {
  const { sessions, calendar, plans, today } = input;
  const newest = sessions.reduce<string | null>(
    (latest, session) =>
      latest === null || session.startedAt > latest ? session.startedAt : latest,
    null,
  );
  const daysSinceLast = newest === null ? null : daysApart(localDate(new Date(newest)), today);

  const last7 = sessionsWithin(sessions, addDays(today, -6), today);
  const last28 = sessionsWithin(sessions, addDays(today, -27), today);
  const recent = periodTotals(sessionsWithin(sessions, addDays(today, -13), today)).volumeKg;
  const before = periodTotals(
    sessionsWithin(sessions, addDays(today, -27), addDays(today, -14)),
  ).volumeKg;

  // Yesterday is the last day that is over; today's plan cannot have been missed yet.
  const counts = adherenceOver(sessions, calendar, addDays(today, -14), addDays(today, -1), today);

  let next: TraineeOverview['next'] = null;
  const names = dayNames(plans);
  for (let offset = 0; offset < 14 && next === null; offset += 1) {
    const date = addDays(today, offset);
    const planned = calendar.get(date);
    if (Array.isArray(planned) && planned.length > 0) {
      next = { date, names: planned.map((id) => names.get(id) ?? '—') };
    }
  }

  // The three lifts done most often in the eight weeks: the ones a programme is built on.
  const stalling = exerciseSummaries(sessions)
    .slice(0, 3)
    .filter((summary) => summary.stall.isStalling)
    .map((summary) => summary.exerciseKey);

  const flags: Flag[] = [];
  if (daysSinceLast === null || daysSinceLast >= 7) flags.push('inactive');
  if (counts.missed >= 2) flags.push('missing');
  if (stalling.length > 0) flags.push('stalling');
  let plannedAhead = false;
  for (let offset = 0; offset < 7; offset += 1) {
    const planned = calendar.get(addDays(today, offset));
    if (Array.isArray(planned) && planned.length > 0) plannedAhead = true;
  }
  if (!plannedAhead) flags.push('unplanned');

  return {
    lastWorkoutAt: newest,
    daysSinceLast,
    workouts7: last7.length,
    workouts28: last28.length,
    volume28: periodTotals(last28).volumeKg,
    adherence14: adherenceRate(counts),
    volumeTrend: before > 0 ? Math.round(((recent - before) / before) * 100) : null,
    next,
    stalling,
    flags: FLAG_ORDER.filter((flag) => flags.includes(flag)),
  };
}
