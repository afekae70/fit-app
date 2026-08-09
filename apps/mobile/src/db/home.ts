/**
 * What the Today screen shows: the workout that is up next, the last seven days, and three
 * numbers for the current week.
 *
 * Gathered here rather than in the screen so the arithmetic — which day counts as trained, where
 * a week starts, what a "personal record" is — can be tested against a real database instead of
 * being re-derived inside a component nothing can render under vitest.
 */

import { EXERCISE_SEED } from '@fit/shared';

import type { SqlExecutor } from './executor.js';
import { getNextPlanDay, getActivePlan, listPlanDayExercises } from './plans.js';

/** Minutes allowed per working set, for the "~52 min" estimate. Sets are ~40s plus 90s rest. */
const MINUTES_PER_SET = 2.2;
/** Sets assumed for a plan exercise that does not specify a target. */
const DEFAULT_SETS = 3;

export interface TodayWorkout {
  planDayId: string;
  planName: string;
  dayName: string;
  exerciseCount: number;
  setCount: number;
  estimatedMinutes: number;
  /** Every exercise name in order — the screen shows the first two and counts the rest. */
  exerciseNames: string[];
}

/**
 * The workout to offer on the home screen, or null when there is no active plan.
 *
 * "Next" is whichever day is most overdue, not whichever matches today's weekday — see
 * `getNextPlanDay`. A four-day split does not line up with a seven-day week.
 */
export async function getTodayWorkout(
  db: SqlExecutor,
  userId: string,
): Promise<TodayWorkout | null> {
  const plan = await getActivePlan(db, userId);
  if (!plan) return null;

  const day = await getNextPlanDay(db, userId, plan.id);
  if (!day) return null;

  const exercises = await listPlanDayExercises(db, day.id);
  if (exercises.length === 0) return null;

  const setCount = exercises.reduce((sum, e) => sum + (e.target_sets ?? DEFAULT_SETS), 0);

  return {
    planDayId: day.id,
    planName: plan.name,
    dayName: day.name ?? `יום ${day.day_index}`,
    exerciseCount: exercises.length,
    setCount,
    estimatedMinutes: Math.round(setCount * MINUTES_PER_SET),
    exerciseNames: exercises.map((e) => displayName(e.exercise_key)),
  };
}

const HEBREW_BY_KEY = new Map(EXERCISE_SEED.map((e) => [e.nameEn, e.nameHe]));

/** The catalogue's Hebrew name, falling back to the key itself for anything not in it. */
function displayName(exerciseKey: string): string {
  return HEBREW_BY_KEY.get(exerciseKey) ?? exerciseKey;
}

/* -------------------------------------------------------------------------- */
/* The seven-day strip                                                         */
/* -------------------------------------------------------------------------- */

export type DayState = 'trained' | 'today' | 'rest';

export interface StripDay {
  /** `YYYY-MM-DD`, local calendar. */
  date: string;
  state: DayState;
}

/**
 * The last seven days, oldest first.
 *
 * Oldest first in the data, even though the strip reads right-to-left on screen: the array is
 * chronological and RTL layout reverses it visually on its own. Reversing it here as well would
 * cancel out, and would put the ordering in two places at once.
 *
 * `today` wins over `trained` when both apply, so a day trained today shows as today — the strip
 * marks where you are, and the streak count beside it already says whether you have trained.
 */
export async function weekStrip(db: SqlExecutor, userId: string, now = new Date()): Promise<StripDay[]> {
  const today = localDay(now);
  const start = new Date(now);
  start.setDate(start.getDate() - 6);

  const rows = await db.all<{ day: string }>(
    `SELECT DISTINCT date(started_at, 'localtime') AS day
       FROM workout_sessions
      WHERE user_id = ? AND deleted_at IS NULL
        AND date(started_at, 'localtime') >= ?`,
    [userId, localDay(start)],
  );
  const trained = new Set(rows.map((r) => r.day));

  const days: StripDay[] = [];
  for (let offset = 6; offset >= 0; offset -= 1) {
    const d = new Date(now);
    d.setDate(d.getDate() - offset);
    const date = localDay(d);
    days.push({ date, state: date === today ? 'today' : trained.has(date) ? 'trained' : 'rest' });
  }
  return days;
}

/* -------------------------------------------------------------------------- */
/* This week's three numbers                                                   */
/* -------------------------------------------------------------------------- */

export interface WeekSummary {
  workouts: number;
  /** Total kg lifted, as tonnes — the unit the card shows. */
  volumeTonnes: number;
  personalRecords: number;
}

/**
 * Workouts, volume and personal records since the start of the current week.
 *
 * The week starts on Sunday, matching the strip above and the Hebrew calendar the app is written
 * for. A "personal record" here is a set this week that is heavier than anything ever lifted on
 * that exercise before this week — counted per exercise, not per set, so eight heavy singles are
 * one record rather than eight.
 */
export async function weekSummary(
  db: SqlExecutor,
  userId: string,
  now = new Date(),
): Promise<WeekSummary> {
  const start = new Date(now);
  start.setDate(start.getDate() - start.getDay());
  const from = localDay(start);

  const totals = await db.get<{ workouts: number; volume: number | null }>(
    `SELECT COUNT(DISTINCT ws.id) AS workouts,
            SUM(COALESCE(s.weight_kg, 0) * COALESCE(s.reps, 0)) AS volume
       FROM workout_sessions ws
       LEFT JOIN session_exercises se ON se.session_id = ws.id AND se.deleted_at IS NULL
       LEFT JOIN sets s ON s.session_exercise_id = se.id AND s.deleted_at IS NULL
      WHERE ws.user_id = ? AND ws.deleted_at IS NULL
        AND date(ws.started_at, 'localtime') >= ?`,
    [userId, from],
  );

  const records = await db.get<{ n: number }>(
    `SELECT COUNT(*) AS n FROM (
       SELECT se.exercise_key
         FROM workout_sessions ws
         JOIN session_exercises se ON se.session_id = ws.id AND se.deleted_at IS NULL
         JOIN sets s ON s.session_exercise_id = se.id AND s.deleted_at IS NULL
        WHERE ws.user_id = ? AND ws.deleted_at IS NULL
          AND date(ws.started_at, 'localtime') >= ?
          AND s.weight_kg IS NOT NULL
        GROUP BY se.exercise_key
       HAVING MAX(s.weight_kg) > COALESCE((
         SELECT MAX(s2.weight_kg)
           FROM workout_sessions ws2
           JOIN session_exercises se2 ON se2.session_id = ws2.id AND se2.deleted_at IS NULL
           JOIN sets s2 ON s2.session_exercise_id = se2.id AND s2.deleted_at IS NULL
          WHERE ws2.user_id = ws.user_id AND ws2.deleted_at IS NULL
            AND se2.exercise_key = se.exercise_key
            AND date(ws2.started_at, 'localtime') < ?
       ), 0)
     )`,
    [userId, from, from],
  );

  return {
    workouts: totals?.workouts ?? 0,
    volumeTonnes: Math.round(((totals?.volume ?? 0) / 1000) * 10) / 10,
    personalRecords: records?.n ?? 0,
  };
}

/** `YYYY-MM-DD` in the device's own calendar — the same shape `date(x, 'localtime')` returns. */
function localDay(d: Date): string {
  const month = `${d.getMonth() + 1}`.padStart(2, '0');
  const day = `${d.getDate()}`.padStart(2, '0');
  return `${d.getFullYear()}-${month}-${day}`;
}
