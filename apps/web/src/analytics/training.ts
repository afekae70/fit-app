/**
 * What a period of training amounted to: week by week, against the calendar, and by muscle.
 *
 * The sums are the app's own (`sessionVolumeKg`, `workingSetCount`, `sessionMinutes`, `tally`,
 * `setsPerMuscle`), applied to a longer stretch than a phone screen shows. Nothing is estimated
 * that the app does not estimate too.
 */

import { setsPerMuscle, type MuscleWork } from '@fit/shared/calculations';
import {
  sessionMinutes,
  sessionsByDay,
  sessionVolumeKg,
  tally,
  workingSetCount,
  type CoachCalendar,
  type CoachSession,
  type Tally,
} from '@fit/shared/coaching';

import { addDays, daysBetween, localDate, weekStart } from './dates.js';

/** The workouts that started on or after `from` and on or before `to` (local days). */
export function sessionsWithin(
  sessions: readonly CoachSession[],
  from: string,
  to: string,
): CoachSession[] {
  return sessions.filter((session) => {
    const day = localDate(new Date(session.startedAt));
    return day >= from && day <= to;
  });
}

export interface WeekBucket {
  /** The Sunday the week starts on. */
  weekStart: string;
  workouts: number;
  volumeKg: number;
  workingSets: number;
  minutes: number;
}

/** One bucket per week asked for, in that order — weeks with nothing in them included, as zeros. */
export function weeklyBuckets(
  sessions: readonly CoachSession[],
  weekStarts: readonly string[],
): WeekBucket[] {
  const buckets = new Map<string, WeekBucket>(
    weekStarts.map((week) => [
      week,
      { weekStart: week, workouts: 0, volumeKg: 0, workingSets: 0, minutes: 0 },
    ]),
  );
  for (const session of sessions) {
    const bucket = buckets.get(weekStart(localDate(new Date(session.startedAt))));
    if (!bucket) continue;
    bucket.workouts += 1;
    bucket.volumeKg += sessionVolumeKg(session);
    bucket.workingSets += workingSetCount(session);
    bucket.minutes += sessionMinutes(session) ?? 0;
  }
  return weekStarts.map((week) => {
    const bucket = buckets.get(week)!;
    return { ...bucket, volumeKg: Math.round(bucket.volumeKg) };
  });
}

export interface PeriodTotals {
  workouts: number;
  volumeKg: number;
  workingSets: number;
  /** Mean minutes of the workouts that have an end; null when none does. */
  averageMinutes: number | null;
  /** Mean of the effort ratings given; null when none was. */
  averageRpe: number | null;
  /** Distinct days trained. */
  trainingDays: number;
}

export function periodTotals(sessions: readonly CoachSession[]): PeriodTotals {
  let volume = 0;
  let sets = 0;
  let minutes = 0;
  let timed = 0;
  let effort = 0;
  let rated = 0;
  const days = new Set<string>();
  for (const session of sessions) {
    volume += sessionVolumeKg(session);
    sets += workingSetCount(session);
    const length = sessionMinutes(session);
    if (length !== null) {
      minutes += length;
      timed += 1;
    }
    if (session.rpe !== null) {
      effort += session.rpe;
      rated += 1;
    }
    days.add(localDate(new Date(session.startedAt)));
  }
  return {
    workouts: sessions.length,
    volumeKg: Math.round(volume),
    workingSets: sets,
    averageMinutes: timed > 0 ? Math.round(minutes / timed) : null,
    averageRpe: rated > 0 ? Math.round((effort / rated) * 10) / 10 : null,
    trainingDays: days.size,
  };
}

/**
 * The share of planned workouts that happened, among days that are over: done ÷ (done + missed).
 *
 * Null when nothing was planned on a day that is over — not zero. A trainee whose coach has not
 * filled the calendar has not failed to follow it.
 */
export function adherenceRate(counts: Pick<Tally, 'done' | 'missed'>): number | null {
  const due = counts.done + counts.missed;
  return due > 0 ? counts.done / due : null;
}

/** The calendar against what was done, over `from`…`to`. */
export function adherenceOver(
  sessions: readonly CoachSession[],
  calendar: CoachCalendar,
  from: string,
  to: string,
  today: string,
): Tally {
  return tally(daysBetween(from, to), calendar, sessionsByDay(sessions), today);
}

/**
 * Working sets per muscle across a period, divided by its weeks — sets a week, the figure
 * training guidance is written in.
 */
export function muscleSetsPerWeek(sessions: readonly CoachSession[], weeks: number): MuscleWork[] {
  const counts = new Map<string, number>();
  for (const session of sessions) {
    for (const exercise of session.exercises) {
      if (!exercise.exerciseKey) continue;
      const working = exercise.sets.filter((set) => set.is_warmup === 0).length;
      if (working > 0)
        counts.set(exercise.exerciseKey, (counts.get(exercise.exerciseKey) ?? 0) + working);
    }
  }
  const perWeek = Math.max(1, weeks);
  return setsPerMuscle(
    [...counts].map(([exerciseKey, sets]) => ({ exerciseKey, sets: sets / perWeek })),
  );
}

/** The weeks in a row, ending with this one or the last, that had at least one workout. */
export function weekStreak(sessions: readonly CoachSession[], today: string): number {
  const trained = new Set(
    sessions.map((session) => weekStart(localDate(new Date(session.startedAt)))),
  );
  let week = weekStart(today);
  // This week not trained yet is not a broken streak: it is not over.
  if (!trained.has(week)) week = addDays(week, -7);
  let streak = 0;
  while (trained.has(week)) {
    streak += 1;
    week = addDays(week, -7);
  }
  return streak;
}
