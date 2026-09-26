/**
 * What the Today screen shows: the workout that is up next, the last seven days, and three
 * numbers for the current week.
 *
 * Gathered here rather than in the screen so the arithmetic — which day counts as trained, where
 * a week starts, what a "personal record" is — can be tested against a real database instead of
 * being re-derived inside a component nothing can render under vitest.
 */

import { EXERCISE_SEED, movingAverage } from '@fit/shared';

import type { SqlExecutor } from './executor.js';
import {
  computeTargets,
  getLatestWeight,
  getProfile,
  listBodyMetrics,
  summariseTrend,
  type TargetsResult,
} from './metrics.js';
import {
  getActivePlan,
  listPlanDayExercises,
  listPlanDays,
  listUserPlanDays,
  type PlanDayRow,
} from './plans.js';
import { addDays, localDate, monthKey, scheduledFor, weekStart, weeksOfMonth } from './schedule.js';

/**
 * What counts as having trained on a day.
 *
 * Opening a workout is not training it. Starting a session from the plan inserts a row dated
 * today with its sets already laid out and none of them ticked — and until this predicate
 * existed, that row alone was enough to increment the week's workout count, light up the streak
 * strip, and convince the rotation that today's slot had been used. Pressing "Start" therefore
 * reported the workout as done before a single rep.
 *
 * A session counts when it was finished, or when at least one set was actually ticked off. The
 * second half matters as much as the first: a session still in progress with real sets logged is
 * genuinely training, and waiting for the finish sheet would make the strip lie the other way.
 *
 * Abandoned sessions now never count, which is correct on its own terms — that was always a bug,
 * it simply had no way to happen from the home screen before.
 */
const TRAINED = `(
  ws.ended_at IS NOT NULL
  OR EXISTS (
    SELECT 1 FROM session_exercises se
      JOIN sets s ON s.session_exercise_id = se.id AND s.deleted_at IS NULL
     WHERE se.session_id = ws.id AND se.deleted_at IS NULL AND s.done_at IS NOT NULL
  )
)`;

/** Minutes allowed per working set, for the "~52 min" estimate. Sets are ~40s plus 90s rest. */
const MINUTES_PER_SET = 2.2;
/** Sets assumed for a plan exercise that does not specify a target. */
const DEFAULT_SETS = 3;

export interface TrainedToday {
  sessionId: string;
  name: string | null;
  /** Working sets ticked off. Warm-ups are a ramp, not the work the card is reporting. */
  setCount: number;
  volumeKg: number;
  /** Null while the session is still open — it has a start but no end to measure against. */
  minutes: number | null;
  /** False while it is still running, which the card says rather than calling it finished. */
  finished: boolean;
}

/**
 * Today's training, if any happened.
 *
 * The gap this fills: `getTodayWorkout` computes which workout today calls for and never asks
 * whether it was already done, so the card went on offering to start a session that had just
 * been finished. The rotation had the same blind spot from the other side — training today
 * leaves `elapsed` at zero, which correctly keeps the position on today's slot, and the screen
 * then read that as "still to do".
 *
 * Uses the same `TRAINED` predicate as the streak strip and the week count, so the three cannot
 * disagree about whether today counts.
 */
export async function getTrainedToday(
  db: SqlExecutor,
  userId: string,
  now = new Date(),
): Promise<TrainedToday | null> {
  const today = localDate(now);

  const row = await db.get<{
    id: string;
    name: string | null;
    started_at: string;
    ended_at: string | null;
  }>(
    `SELECT ws.id, ws.name, ws.started_at, ws.ended_at
       FROM workout_sessions ws
      WHERE ws.user_id = ?
        AND ws.deleted_at IS NULL
        AND date(ws.started_at, 'localtime') = ?
        AND ${TRAINED}
      ORDER BY ws.started_at DESC
      LIMIT 1`,
    [userId, today],
  );
  if (!row) return null;

  const totals = await db.get<{ sets: number; volume: number | null }>(
    `SELECT COUNT(*) AS sets,
            SUM(COALESCE(s.weight_kg, 0) * COALESCE(s.reps, 0)) AS volume
       FROM sets s
       JOIN session_exercises se ON se.id = s.session_exercise_id AND se.deleted_at IS NULL
      WHERE se.session_id = ?
        AND s.deleted_at IS NULL
        AND s.is_warmup = 0
        AND s.done_at IS NOT NULL`,
    [row.id],
  );

  return {
    sessionId: row.id,
    name: row.name,
    setCount: totals?.sets ?? 0,
    volumeKg: Math.round(totals?.volume ?? 0),
    minutes: row.ended_at
      ? Math.max(1, Math.round((Date.parse(row.ended_at) - Date.parse(row.started_at)) / 60000))
      : null,
    finished: row.ended_at !== null,
  };
}

export interface TodayWorkout {
  planDayId: string;
  planName: string;
  dayName: string;
  exerciseCount: number;
  setCount: number;
  estimatedMinutes: number;
  /** Every exercise name in order — the screen shows the first two and counts the rest. */
  exerciseNames: string[];
  /**
   * Which of today's workouts this is, and how many there are. 1 of 1 on an ordinary day; the
   * card only mentions it when there is more than one, so a second workout is not a surprise.
   */
  slot: number;
  slots: number;
  /**
   * The day that was scheduled yesterday and not trained, if there was one.
   *
   * Reported rather than rescheduled. The plan has already moved on; this only says what was
   * missed, so the screen can note it without turning it into a debt.
   */
  missedYesterday: string | null;
}

/**
 * The next workout still to do today, or null when there is none — no active plan, a rest day,
 * or everything scheduled for today already trained.
 *
 * With several workouts on one date this walks them in order and skips the ones trained today,
 * so finishing the morning session turns the card into the evening one. A day counts as done
 * once there have been as many trained sessions as scheduled workouts, whichever workouts those
 * sessions were: a single planned workout replaced by a freestyle session is still a trained
 * day, exactly as it was before a date could hold more than one.
 *
 * **The rotation follows the calendar, not completion.** Each day advances one position through
 * the plan whether or not the previous one was trained. Miss Monday and Tuesday is still
 * Tuesday's workout — Monday's is simply recorded as missed.
 *
 * This replaced a queue, where the most overdue day stayed at the front until it was done. The
 * queue never loses work, which sounds better and is worse to live with: skip one session and
 * every day afterwards shows the wrong workout, drifting further behind the split you actually
 * train, until the plan is describing a week you are not having. A calendar rotation is always
 * telling the truth about today, and the cost is that a missed day stays missed — which is also
 * the truth.
 *
 * Anchored on the last session actually trained from this plan, so the rotation stays in step
 * with reality rather than with a start date you have long since drifted from.
 */
export async function getTodayWorkout(
  db: SqlExecutor,
  userId: string,
  now = new Date(),
): Promise<TodayWorkout | null> {
  // The active plan drives the rotation; the calendar can hold a workout from any plan.
  const plan = await getActivePlan(db, userId);
  const days = plan ? await listPlanDays(db, plan.id) : [];
  const everyDay = await listUserPlanDays(db, userId);
  if (everyDay.length === 0) return null;
  const planNameOf = new Map(everyDay.map((d) => [d.id, d.plan_name]));

  /*
   * The weekly calendar outranks the rotation, but only where a decision exists.
   *
   *   a plan day  -> that workout, regardless of where the rotation had drifted to
   *   null        -> a rest day the user chose; today has no workout
   *   undefined   -> nothing decided, so the rotation below still owns the date
   *
   * Which is why `scheduledFor` distinguishes null from undefined: folding them together would
   * either refill a rest day or ignore the calendar entirely.
   */
  const today = localDate(now);
  const committed = await scheduledFor(db, userId, today);
  if (committed === null) return null;

  let candidates: PlanDayRow[] = [];
  let missedPosition: number | null = null;

  if (committed !== undefined) {
    // Committed days that have since been deleted drop out here. Looked up across every plan:
    // the calendar schedules workouts from all of the user's groups, not only the active one.
    candidates = committed
      .map((id) => everyDay.find((d) => d.id === id))
      .filter((d): d is (typeof everyDay)[number] => d !== undefined);
  }
  if (candidates.length === 0 && plan && days.length > 0) {
    // Nothing decided, or every committed day was deleted from the plan. Fall back to the
    // rotation rather than showing nothing, which would read as "no plan".
    const rotated = await rotate(db, userId, plan.id, days.length, now);
    const rotatedDay = days[rotated.position];
    candidates = rotatedDay ? [rotatedDay] : [];
    missedPosition = rotated.missedPosition;
  }

  const trainedToday = await db.all<{ plan_day_id: string | null }>(
    `SELECT ws.plan_day_id FROM workout_sessions ws
      WHERE ws.user_id = ?
        AND ws.deleted_at IS NULL
        AND date(ws.started_at, 'localtime') = ?
        AND ${TRAINED}`,
    [userId, today],
  );
  if (trainedToday.length >= candidates.length) return null;

  const doneIds = new Set(trainedToday.map((row) => row.plan_day_id));
  const slotIndex = candidates.findIndex((d) => !doneIds.has(d.id));
  const day = candidates[slotIndex] ?? null;
  if (!day) return null;

  const exercises = await listPlanDayExercises(db, day.id);
  if (exercises.length === 0) return null;

  const setCount = exercises.reduce((sum, e) => sum + (e.target_sets ?? DEFAULT_SETS), 0);
  const missed = missedPosition === null ? null : days[missedPosition] ?? null;

  return {
    planDayId: day.id,
    planName: planNameOf.get(day.id) ?? plan?.name ?? '',
    dayName: dayLabel(day),
    exerciseCount: exercises.length,
    setCount,
    estimatedMinutes: Math.round(setCount * MINUTES_PER_SET),
    exerciseNames: exercises.map((e) => displayName(e.exercise_key)),
    slot: slotIndex + 1,
    slots: candidates.length,
    missedYesterday: missed ? dayLabel(missed) : null,
  };
}

/**
 * Whether today is a rest day the user deliberately scheduled.
 *
 * Separate from `getTodayWorkout` returning null, which also covers "no plan at all" and "the
 * plan has no days". The screen needs to tell those apart: one deserves "rest day", the other
 * an invitation to build a plan.
 */
export async function isScheduledRestDay(
  db: SqlExecutor,
  userId: string,
  now = new Date(),
): Promise<boolean> {
  return (await scheduledFor(db, userId, localDate(now))) === null;
}

const dayLabel = (day: { day_index: number; name: string | null }): string =>
  day.name ?? `יום ${day.day_index}`;

/**
 * Where in the rotation today sits, and whether yesterday's slot went untrained.
 *
 * With no history at all the plan starts at its first day — a brand-new plan should open on day
 * one, not on whatever position an arbitrary anchor date happens to land on.
 */
async function rotate(
  db: SqlExecutor,
  userId: string,
  planId: string,
  length: number,
  now: Date,
): Promise<{ position: number; missedPosition: number | null }> {
  const last = await db.get<{ day: string; plan_day_id: string }>(
    `SELECT date(ws.started_at, 'localtime') AS day, ws.plan_day_id
       FROM workout_sessions ws
       JOIN plan_days pd ON pd.id = ws.plan_day_id
      WHERE ws.user_id = ? AND ws.deleted_at IS NULL AND pd.plan_id = ?
        AND ${TRAINED}
      ORDER BY ws.started_at DESC
      LIMIT 1`,
    [userId, planId],
  );
  if (!last) return { position: 0, missedPosition: null };

  const days = await listPlanDays(db, planId);
  const trainedPosition = days.findIndex((d) => d.id === last.plan_day_id);
  if (trainedPosition < 0) return { position: 0, missedPosition: null };

  const elapsed = daysBetween(last.day, localDay(now));
  // Trained today already: today's slot is the one just done, and nothing was missed.
  if (elapsed <= 0) return { position: trainedPosition, missedPosition: null };

  const position = (trainedPosition + elapsed) % length;
  // Only the immediately preceding slot is reported. A week away would otherwise produce a list
  // of misses, which is a scolding rather than a note — and the streak strip already shows the
  // shape of a gap that size.
  const missedPosition = elapsed > 1 ? (trainedPosition + elapsed - 1) % length : null;
  return { position, missedPosition };
}

/** Whole local days from one `YYYY-MM-DD` to another. */
function daysBetween(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00`);
  const b = Date.parse(`${to}T00:00:00`);
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.round((b - a) / 86_400_000);
}

const HEBREW_BY_KEY = new Map(EXERCISE_SEED.map((e) => [e.nameEn, e.nameHe]));

/** The catalogue's Hebrew name, falling back to the key itself for anything not in it. */
function displayName(exerciseKey: string): string {
  return HEBREW_BY_KEY.get(exerciseKey) ?? exerciseKey;
}

/* -------------------------------------------------------------------------- */
/* The seven-day strip                                                         */
/* -------------------------------------------------------------------------- */

export interface StripDay {
  /** `YYYY-MM-DD`, local calendar. */
  date: string;
  /** Whether this day counts as trained, by the same rule the streak and week count use. */
  trained: boolean;
  isToday: boolean;
}

/**
 * The last seven days, oldest first.
 *
 * Oldest first in the data, even though the strip reads right-to-left on screen: the array is
 * chronological and RTL layout reverses it visually on its own. Reversing it here as well would
 * cancel out, and would put the ordering in two places at once.
 *
 * Each day reports both facts rather than one merged state. They used to be a single value where
 * "today" outranked "trained", on the reasoning that the strip marks where you are and the streak
 * beside it already says whether you trained. In practice that meant training today showed as a
 * plain dot and the tick only appeared the next morning — so the strip looked like a missed day
 * while the streak next to it counted the workout.
 */
export async function weekStrip(db: SqlExecutor, userId: string, now = new Date()): Promise<StripDay[]> {
  const today = localDay(now);
  const start = new Date(now);
  start.setDate(start.getDate() - 6);

  const rows = await db.all<{ day: string }>(
    `SELECT DISTINCT date(ws.started_at, 'localtime') AS day
       FROM workout_sessions ws
      WHERE ws.user_id = ? AND ws.deleted_at IS NULL
        AND date(ws.started_at, 'localtime') >= ?
        AND ${TRAINED}`,
    [userId, localDay(start)],
  );
  const trained = new Set(rows.map((r) => r.day));

  const days: StripDay[] = [];
  for (let offset = 6; offset >= 0; offset -= 1) {
    const d = new Date(now);
    d.setDate(d.getDate() - offset);
    const date = localDay(d);
    // Two facts, kept apart. They were one merged `state` where "today" outranked "trained",
    // so training today showed as a dot and the tick only appeared the next morning — the strip
    // disagreed with the streak count sitting next to it.
    days.push({ date, trained: trained.has(date), isToday: date === today });
  }
  return days;
}

/* -------------------------------------------------------------------------- */
/* Full weeks this month                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Sessions a week counts against when nothing is planned for it. The calendar replaces it for
 * any week that has workouts committed.
 */
export const DEFAULT_WEEKLY_TARGET = 4;

export interface WeekProgress {
  /** Sunday, `YYYY-MM-DD`. */
  start: string;
  trained: number;
  /** Workouts planned on the calendar for the week, or the default when none are. */
  target: number;
  complete: boolean;
}

export interface MonthWeeks {
  /** `YYYY-MM` — the month the current week belongs to, which is not always today's month. */
  month: string;
  /** How many weeks the month owns: four or five. */
  weeks: number;
  /** Of those, the ones already complete. A week still under way counts the moment it is. */
  completed: number;
  thisWeek: WeekProgress;
}

/**
 * How many of the month's weeks had every workout done.
 *
 * This replaced a "streak of N weeks" that was consecutive trained *days* divided by seven. It
 * could only move after training seven days running, so for anyone with a rest day in their week
 * it read zero, permanently — the one number on the home screen that never changed.
 *
 * A week is complete when it has had as many trained sessions as workouts planned for it on the
 * calendar — the same counting rule as today's card, so two sessions on one day count as two, and
 * a planned workout swapped for another still counts. A week with nothing planned is measured
 * against DEFAULT_WEEKLY_TARGET instead, so an unplanned month is not a month of zeroes.
 *
 * The month shown is the one the current week belongs to (see `weeksOfMonth`). On Friday October
 * 2nd that is still September, because this week started on September 27th; it becomes October
 * on the Sunday. The week under way is always part of the tally on screen.
 *
 * `thisWeek` is exposed for the line beside the tally, so "5 of 7 this week" and the month's
 * count use the same target and cannot disagree about whether this week is done.
 */
export async function monthWeeks(db: SqlExecutor, userId: string, now = new Date()): Promise<MonthWeeks> {
  const currentWeek = weekStart(localDate(now));
  const month = monthKey(currentWeek);
  const starts = weeksOfMonth(month);

  const progress = async (start: string): Promise<WeekProgress> => {
    const end = addDays(start, 6);
    const trained = await db.get<{ n: number }>(
      `SELECT COUNT(*) AS n FROM workout_sessions ws
        WHERE ws.user_id = ? AND ws.deleted_at IS NULL
          AND date(ws.started_at, 'localtime') BETWEEN ? AND ?
          AND ${TRAINED}`,
      [userId, start, end],
    );
    /*
     * How many workouts the week asks for.
     *
     * Counted through the workouts themselves, not from the calendar rows alone. A row whose
     * workout has since been deleted is a leftover, not a session anybody can do, and counting
     * it made the week ask for one more than it holds — "6 of 7" on a week with six workouts in
     * it. Distinct, too: the same workout written twice onto one date is one thing to do.
     */
    const planned = await db.get<{ n: number }>(
      `SELECT COUNT(DISTINCT sd.scheduled_on || '|' || sd.plan_day_id) AS n
         FROM scheduled_days sd
         JOIN plan_days pd ON pd.id = sd.plan_day_id AND pd.deleted_at IS NULL
         JOIN plans p ON p.id = pd.plan_id AND p.deleted_at IS NULL AND p.user_id = sd.user_id
        WHERE sd.user_id = ? AND sd.deleted_at IS NULL AND sd.plan_day_id IS NOT NULL
          AND sd.scheduled_on BETWEEN ? AND ?`,
      [userId, start, end],
    );
    const target = (planned?.n ?? 0) > 0 ? (planned?.n ?? 0) : DEFAULT_WEEKLY_TARGET;
    const done = trained?.n ?? 0;
    return { start, trained: done, target, complete: done >= target };
  };

  let completed = 0;
  let thisWeek: WeekProgress | null = null;
  for (const start of starts) {
    // Weeks still to come cannot have been completed; they count only toward the total.
    if (start > currentWeek) break;
    const week = await progress(start);
    if (week.complete) completed += 1;
    if (start === currentWeek) thisWeek = week;
  }

  return {
    month,
    weeks: starts.length,
    completed,
    thisWeek: thisWeek ?? (await progress(currentWeek)),
  };
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
        AND date(ws.started_at, 'localtime') >= ?
        AND ${TRAINED}`,
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

/* -------------------------------------------------------------------------- */
/* Nutrition and bodyweight                                                    */
/* -------------------------------------------------------------------------- */

export interface HomeNutrition {
  /** Calories and macros, or the one missing profile field that prevents computing them. */
  targets: TargetsResult;
  /**
   * The 7-day moving average, oldest first — what the trend line plots.
   *
   * Smoothed rather than raw for the reason WeightSparkline's header gives: scale weight swings
   * 1-2 kg on water and food alone, and a raw line makes a steady loss look like noise.
   */
  weightPoints: { date: Date; weightKg: number }[];
  /** The most recent weigh-in, unsmoothed — the number the user actually saw on the scale. */
  latestKg: number | null;
  /** kg per week, only when there is enough spread for the trend to mean anything. */
  ratePerWeek: number | null;
}

/**
 * Everything the home screen's weight and nutrition cards need, in one pass.
 *
 * Gathered here rather than in the screen for the same reason as the rest of this module: the
 * arithmetic is testable against a real database, and the screen stays a view.
 *
 * The targets are recomputed from the CURRENT weight rather than read from the last snapshot in
 * `nutrition_targets`. Those snapshots exist so the coach can see what a target *was* in a given
 * week; the home screen is answering "what should I eat today", and after a weigh-in that answer
 * has already changed.
 */
export async function getHomeNutrition(
  db: SqlExecutor,
  userId: string,
): Promise<HomeNutrition> {
  const [profile, latest, metrics] = await Promise.all([
    getProfile(db, userId),
    getLatestWeight(db, userId),
    listBodyMetrics(db, userId),
  ]);

  // listBodyMetrics returns newest-first; the trend maths expects oldest-first.
  const { points, rate } = summariseTrend([...metrics].reverse());

  return {
    targets: computeTargets(profile, latest?.weight_kg ?? null),
    weightPoints: movingAverage(points, 7),
    latestKg: latest?.weight_kg ?? null,
    // An unreliable rate is reported as none at all. A confident "+0.4 kg/week" drawn from two
    // weigh-ins three days apart is worse than silence — it invites a diet change based on noise.
    ratePerWeek: rate && rate.isReliable ? rate.kgPerWeek : null,
  };
}

/**
 * Each macro's share of the day's calories.
 *
 * Protein and carbs are 4 kcal/g, fat is 9 — so grams alone misrepresent the split badly, and a
 * bar drawn from grams would show fat as a third of what it actually contributes.
 *
 * These are shares of the TARGET, not progress against an intake: there is no food log here, so
 * the three numbers are the plan, not a comparison.
 */
export function macroShares(targets: {
  proteinG: number;
  carbsG: number;
  fatG: number;
}): { protein: number; carbs: number; fat: number } {
  const protein = targets.proteinG * 4;
  const carbs = targets.carbsG * 4;
  const fat = targets.fatG * 9;
  const total = protein + carbs + fat;
  if (total <= 0) return { protein: 0, carbs: 0, fat: 0 };
  return { protein: protein / total, carbs: carbs / total, fat: fat / total };
}
