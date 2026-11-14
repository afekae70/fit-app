/**
 * One week of training in a few numbers: the weekly summary.
 *
 * Asked for by the owner (2026-11-14): the Saturday reminder should also say how the week went —
 * how many workouts, on how many days the water goal was reached, and where the training moved.
 * The reminder opens `app/week-summary.tsx`, which reads this; nothing here is stored.
 *
 * Not the coach's weekly review (`coach/weeklyReview.ts`), which is written by the model and
 * asked for. This is arithmetic over the phone's own database, read whenever the screen opens.
 *
 * ## What it counts
 *
 *  - **Workouts**: finished workouts started in the week, Sunday to Saturday as the calendar has
 *    it (`schedule.ts`), local time. And the week before, for comparison.
 *  - **Sets**: working sets ticked off in them — the number the rest of the app counts.
 *  - **Water**: days the day's aim was reached, out of the days of the week that have happened
 *    (`food/waterWeek.ts`, the same reading the water card's week uses).
 *  - **Satisfaction**: the mean of the ratings given to the week's workouts, when any were.
 *  - **Where it moved**: every exercise of the week's workouts, against the previous workout of
 *    the same name (`compareWithPreviousSameWorkout` — the share card's comparison). An exercise
 *    done in several of the week's workouts counts once, by its latest verdict: the week ends
 *    where it ends.
 */

import { waterWeeks } from '../food/waterWeek.js';
import type { Verdict } from '../progress/setBySet.js';
import type { SqlExecutor } from './executor.js';
import { listFoodDays } from './food.js';
import { computeTargets, getLatestWeight, getProfile, listBodyMetrics } from './metrics.js';
import { addDays, localDate, weekStart } from './schedule.js';
import { listWaterByDay } from './water.js';
import { compareWithPreviousSameWorkout } from './workoutProgress.js';

export interface WeekSummary {
  /** The Sunday the week starts on, and the Saturday it ends on. */
  start: string;
  end: string;
  /** The week holding today: still under way. */
  isCurrent: boolean;
  workouts: number;
  previousWorkouts: number;
  sets: number;
  /**
   * Days at the water goal, out of the days of the week that have happened, and the goal as it
   * stood on the last of them (it follows the weight, so it can move during a week).
   */
  water: { reached: number; counted: number; goalMl: number };
  /** Mean satisfaction of the week's rated workouts, to one decimal; null when none were rated. */
  satisfaction: number | null;
  /** Exercises by their latest verdict in the week. Exercises new this week are not counted. */
  counts: { up: number; same: number; down: number };
  /** Catalogue keys, most recently trained first. */
  progressed: string[];
  /** What to push next: what went down first, then what stood still. */
  toPush: string[];
  /** Personal records set in the week, heaviest-first by exercise. See `weekRecords`. */
  records: WeekRecord[];
  food: WeekFood;
  weight: WeekWeight;
  /** Mean litres a day over the days of the week that have happened; null with none logged. */
  waterLitresPerDay: number | null;
}

/** A set heavier than anything lifted on that exercise before the week. */
export interface WeekRecord {
  exerciseKey: string;
  weightKg: number;
  reps: number;
  /** The best before the week; null when the exercise had never been done. */
  previousKg: number | null;
}

export interface WeekFood {
  /** Days with anything written down. A day with nothing is not a day of eating nothing. */
  daysLogged: number;
  /** Means over the logged days only, for the same reason; null with none logged. */
  caloriesPerDay: number | null;
  proteinPerDay: number | null;
  /** Today's targets, from the profile and the latest weight; null while they cannot be worked out. */
  calorieTarget: number | null;
  proteinTarget: number | null;
}

export interface WeekWeight {
  /** The last weigh-in of the week; null when there was none. */
  latestKg: number | null;
  /** Against the last weigh-in before the week; null without one on either side. */
  changeKg: number | null;
}

/**
 * The week's personal records: for each exercise, the heaviest working set ticked off in the week,
 * when it is heavier than anything lifted on that exercise before the week began.
 *
 * The rule the home screen's week card counts by ("heavier than anything before this week"), per
 * exercise rather than per set — eight heavy singles are one record — and a first time counts,
 * as it does everywhere a record is told: there is nothing it failed to beat. Reported with the
 * reps of that heaviest set (the most reps at it, when there were several) and the best before.
 */
async function weekRecords(
  db: SqlExecutor,
  userId: string,
  from: string,
  to: string,
): Promise<WeekRecord[]> {
  const rows = await db.all<{
    exercise_key: string;
    weight_kg: number;
    reps: number | null;
    previous_kg: number | null;
  }>(
    `WITH week AS (
       SELECT se.exercise_key, s.weight_kg, s.reps
         FROM sets s
         JOIN session_exercises se ON se.id = s.session_exercise_id AND se.deleted_at IS NULL
         JOIN workout_sessions ws  ON ws.id = se.session_id AND ws.deleted_at IS NULL
        WHERE ws.user_id = ? AND date(ws.started_at, 'localtime') BETWEEN ? AND ?
          AND s.deleted_at IS NULL AND s.done_at IS NOT NULL AND s.is_warmup = 0
          AND s.weight_kg IS NOT NULL AND s.weight_kg > 0
     ),
     best AS (SELECT exercise_key, MAX(weight_kg) AS weight_kg FROM week GROUP BY exercise_key),
     before AS (
       SELECT se.exercise_key, MAX(s.weight_kg) AS weight_kg
         FROM sets s
         JOIN session_exercises se ON se.id = s.session_exercise_id AND se.deleted_at IS NULL
         JOIN workout_sessions ws  ON ws.id = se.session_id AND ws.deleted_at IS NULL
        WHERE ws.user_id = ? AND date(ws.started_at, 'localtime') < ?
          AND s.deleted_at IS NULL AND s.done_at IS NOT NULL AND s.is_warmup = 0
        GROUP BY se.exercise_key
     )
     SELECT b.exercise_key, b.weight_kg,
            (SELECT MAX(w.reps) FROM week w
              WHERE w.exercise_key = b.exercise_key AND w.weight_kg = b.weight_kg) AS reps,
            p.weight_kg AS previous_kg
       FROM best b
       LEFT JOIN before p ON p.exercise_key = b.exercise_key
      WHERE p.weight_kg IS NULL OR b.weight_kg > p.weight_kg
      ORDER BY b.weight_kg DESC, b.exercise_key`,
    [userId, from, to, userId, from],
  );
  return rows.map((row) => ({
    exerciseKey: row.exercise_key,
    weightKg: row.weight_kg,
    reps: row.reps ?? 0,
    previousKg: row.previous_kg,
  }));
}

/** Finished workouts started on these local days, oldest first. */
async function weekSessions(
  db: SqlExecutor,
  userId: string,
  from: string,
  to: string,
): Promise<{ id: string; satisfaction: number | null }[]> {
  return db.all(
    `SELECT id, satisfaction FROM workout_sessions
      WHERE user_id = ? AND deleted_at IS NULL AND ended_at IS NOT NULL
        AND date(started_at, 'localtime') BETWEEN ? AND ?
      ORDER BY started_at, id`,
    [userId, from, to],
  );
}

export async function loadWeekSummary(
  db: SqlExecutor,
  userId: string,
  /** Any day of the week to sum up, `YYYY-MM-DD` local. */
  day: string,
  /** Today, `YYYY-MM-DD` local — where a week still under way stops. */
  today: string,
): Promise<WeekSummary> {
  const start = weekStart(day);
  const end = addDays(start, 6);
  const isCurrent = today >= start && today <= end;

  const sessions = await weekSessions(db, userId, start, end);
  const previous = await weekSessions(db, userId, addDays(start, -7), addDays(start, -1));

  const ids = sessions.map((s) => s.id);
  const setRow =
    ids.length === 0
      ? { n: 0 }
      : await db.get<{ n: number }>(
          `SELECT COUNT(*) AS n
             FROM sets s
             JOIN session_exercises se ON se.id = s.session_exercise_id AND se.deleted_at IS NULL
            WHERE se.session_id IN (${ids.map(() => '?').join(', ')})
              AND s.deleted_at IS NULL AND s.done_at IS NOT NULL AND s.is_warmup = 0`,
          ids,
        );

  // The water week, read up to today for the week under way and to its Saturday otherwise.
  const lastDay = isCurrent ? today : end;
  const [daily, weighings] = await Promise.all([
    listWaterByDay(db, userId, start, lastDay),
    listBodyMetrics(db, userId, 400),
  ]);
  const water = waterWeeks(daily, weighings, lastDay, 1)[0]!;
  const waterMl = daily.reduce((sum, row) => sum + row.ml, 0);
  const waterLitresPerDay =
    waterMl === 0 || water.counted === 0
      ? null
      : Math.round((waterMl / water.counted / 1000) * 10) / 10;

  // Food: means over the days something was written down, against today's targets.
  const foodDays = await listFoodDays(db, userId, start, lastDay);
  const mean = (values: number[]) =>
    values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length;
  const calories = mean(foodDays.map((d) => d.calories));
  const protein = mean(foodDays.map((d) => d.proteinG));
  const [profile, latestWeight] = await Promise.all([
    getProfile(db, userId),
    getLatestWeight(db, userId),
  ]);
  const targets = computeTargets(profile, latestWeight?.weight_kg ?? null);
  const food: WeekFood = {
    daysLogged: foodDays.length,
    caloriesPerDay: calories === null ? null : Math.round(calories),
    proteinPerDay: protein === null ? null : Math.round(protein),
    calorieTarget: targets.ok ? targets.targets.calorieTarget : null,
    proteinTarget: targets.ok ? targets.targets.proteinG : null,
  };

  // Weight: the week's last weigh-in, against the last one before the week. `listBodyMetrics`
  // is newest first; the day of a weigh-in is its local day, as everywhere else.
  const weighed = weighings
    .filter((w) => w.weight_kg !== null)
    .map((w) => ({ day: localDate(new Date(w.measured_at)), kg: w.weight_kg as number }));
  const inWeek = weighed.find((w) => w.day >= start && w.day <= lastDay) ?? null;
  const beforeWeek = weighed.find((w) => w.day < start) ?? null;
  const weight: WeekWeight = {
    latestKg: inWeek?.kg ?? null,
    changeKg:
      inWeek && beforeWeek ? Math.round((inWeek.kg - beforeWeek.kg) * 10) / 10 : null,
  };

  const records = await weekRecords(db, userId, start, end);

  const rated = sessions.flatMap((s) => (s.satisfaction === null ? [] : [s.satisfaction]));
  const satisfaction =
    rated.length === 0
      ? null
      : Math.round((rated.reduce((sum, value) => sum + value, 0) / rated.length) * 10) / 10;

  // Each exercise's latest verdict in the week: later workouts overwrite earlier ones.
  const latest = new Map<string, Verdict>();
  for (const session of sessions) {
    const comparison = await compareWithPreviousSameWorkout(db, userId, session.id);
    if (!comparison) continue;
    for (const change of comparison.changes) {
      if (change.verdict === 'new') continue;
      latest.delete(change.exerciseKey);
      latest.set(change.exerciseKey, change.verdict);
    }
  }
  // Most recently trained first: the map holds them in the order last set.
  const ordered = [...latest].reverse();
  const progressed = ordered.filter(([, v]) => v === 'up').map(([key]) => key);
  const down = ordered.filter(([, v]) => v === 'down').map(([key]) => key);
  const same = ordered.filter(([, v]) => v === 'same' || v === 'mixed').map(([key]) => key);

  return {
    start,
    end,
    isCurrent,
    workouts: sessions.length,
    previousWorkouts: previous.length,
    sets: setRow?.n ?? 0,
    water: {
      reached: water.reached,
      counted: water.counted,
      goalMl: water.days.filter((d) => !d.future).at(-1)?.goalMl ?? water.days[0]!.goalMl,
    },
    satisfaction,
    counts: { up: progressed.length, same: same.length, down: down.length },
    progressed,
    toPush: [...down, ...same],
    records,
    food,
    weight,
    waterLitresPerDay,
  };
}
