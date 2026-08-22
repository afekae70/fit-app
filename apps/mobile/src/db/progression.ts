/**
 * Strength progression analysis over locally logged workouts.
 *
 * The SQL here computes per-session bests; the *judgement* (is this stalling?) comes from
 * `assessStall` in `@fit/shared`, which the API and the AI coach also use. Keeping the
 * analysis identical on both sides is the point: the coach must reason about the same numbers
 * the user is looking at, not its own recomputation.
 *
 * This is deliberately not something the LLM is asked to do later. Working out an e1RM trend
 * across hundreds of set rows is exact arithmetic — cheap and reliable in SQL, expensive and
 * unreliable in a model.
 */

import {
  assessStall,
  type SessionStrengthPoint,
  type StallAssessment,
} from '@fit/shared/calculations';

import type { SqlExecutor } from './executor.js';
import { sameTypeClause, type SessionType } from './sessionType.js';

/** One session's best effort on one exercise. */
export interface ExerciseSessionBest {
  session_id: string;
  started_at: string;
  best_e1rm_kg: number;
  total_volume_load: number;
  working_sets: number;
  top_weight_kg: number;
  top_reps: number;
}

/**
 * Per-session bests for one exercise, oldest first.
 *
 * Filters match the shared `epley1RM` contract exactly: warmups excluded, and reps capped at
 * 12 because Epley degrades badly above that — a 20-rep set would otherwise produce an
 * inflated "personal best" that never happened.
 */
export async function getExerciseProgression(
  db: SqlExecutor,
  userId: string,
  exerciseKey: string,
  limit = 30,
  /**
   * A session to leave out — in practice the one being logged right now.
   *
   * Without it, sets being typed this minute join the history they are about to be compared
   * against, and the stall verdict shifts under the user as they fill the screen in.
   */
  excludeSessionId?: string,
  /**
   * Restrict the history to sessions of this kind — see `sessionType.ts`.
   *
   * A rate of progress read across two gyms is not a rate of progress. The same lift on another
   * gym's machine is a different number, and the sawtooth that produces is exactly the shape
   * `assessStall` is watching for, so it reports plateaus that are only a change of address.
   */
  sameType?: SessionType | null,
): Promise<ExerciseSessionBest[]> {
  const type = sameTypeClause('ws', sameType);
  const rows = await db.all<ExerciseSessionBest>(
    `SELECT
       ws.id                AS session_id,
       ws.started_at        AS started_at,
       MAX(CASE WHEN s.reps = 1
                THEN s.weight_kg
                ELSE s.weight_kg * (1 + s.reps / 30.0) END) AS best_e1rm_kg,
       SUM(s.weight_kg * s.reps)                            AS total_volume_load,
       COUNT(*)                                             AS working_sets,
       MAX(s.weight_kg)                                     AS top_weight_kg,
       MAX(s.reps)                                          AS top_reps
     FROM sets s
     JOIN session_exercises se ON se.id = s.session_exercise_id AND se.deleted_at IS NULL
     JOIN workout_sessions ws  ON ws.id = se.session_id AND ws.deleted_at IS NULL
     WHERE ws.user_id = ?
       AND se.exercise_key = ?
       AND s.is_warmup = 0
       AND s.deleted_at IS NULL
       AND s.weight_kg IS NOT NULL
       AND s.reps IS NOT NULL
       AND s.reps BETWEEN 1 AND 12
       AND (? IS NULL OR ws.id <> ?)
       AND ${type.sql}
     GROUP BY ws.id
     ORDER BY ws.started_at DESC
     LIMIT ?`,
    [userId, exerciseKey, excludeSessionId ?? null, excludeSessionId ?? null, ...type.params, limit],
  );

  // Query newest-first so LIMIT keeps the most RECENT sessions, then flip: the trend maths
  // needs chronological order. Ordering ascending in SQL would have kept the oldest instead.
  return rows.reverse();
}

/**
 * Is this exercise stalling, judged on history alone?
 *
 * Split out from `summariseExerciseProgress` because the workout screen needs one boolean per
 * exercise while a session is open, and needs that session left out of the reckoning.
 *
 * Returns false rather than null when there is too little history: `assessStall` needs several
 * sessions before a stall means anything, and "not stalling" is the right thing to tell a
 * screen that would otherwise suggest backing off from a lift with two entries.
 */
export async function isExerciseStalling(
  db: SqlExecutor,
  userId: string,
  exerciseKey: string,
  excludeSessionId?: string,
  sameType?: SessionType | null,
): Promise<boolean> {
  const sessions = await getExerciseProgression(
    db,
    userId,
    exerciseKey,
    30,
    excludeSessionId,
    sameType,
  );
  if (sessions.length < 4) return false;

  return assessStall(
    sessions.map((s) => ({
      date: new Date(s.started_at),
      bestE1rmKg: s.best_e1rm_kg,
      totalVolumeLoad: s.total_volume_load,
    })),
  ).isStalling;
}

export interface ExerciseProgressSummary {
  exerciseKey: string;
  sessionCount: number;
  latestE1rm: number | null;
  bestE1rm: number | null;
  lastPerformedAt: string;
  assessment: StallAssessment;
}

/** Every exercise with logged history, most recently performed first. */
export async function listTrainedExercises(
  db: SqlExecutor,
  userId: string,
  limit = 60,
): Promise<{ exercise_key: string; session_count: number; last_performed_at: string }[]> {
  return db.all(
    `SELECT
       se.exercise_key                AS exercise_key,
       COUNT(DISTINCT ws.id)          AS session_count,
       MAX(ws.started_at)             AS last_performed_at
     FROM session_exercises se
     JOIN workout_sessions ws ON ws.id = se.session_id AND ws.deleted_at IS NULL
     JOIN sets s              ON s.session_exercise_id = se.id AND s.deleted_at IS NULL
     WHERE ws.user_id = ?
       AND se.deleted_at IS NULL
       AND s.is_warmup = 0
       AND s.weight_kg IS NOT NULL
       AND s.reps IS NOT NULL
     GROUP BY se.exercise_key
     ORDER BY last_performed_at DESC
     LIMIT ?`,
    [userId, limit],
  );
}

/**
 * Full progression summary for one exercise.
 *
 * Returns null when there is no usable history rather than an empty summary, so the caller
 * shows nothing instead of a confident-looking "0 kg, not stalling".
 */
export async function summariseExerciseProgress(
  db: SqlExecutor,
  userId: string,
  exerciseKey: string,
): Promise<ExerciseProgressSummary | null> {
  const sessions = await getExerciseProgression(db, userId, exerciseKey);
  if (sessions.length === 0) return null;

  const points: SessionStrengthPoint[] = sessions.map((s) => ({
    date: new Date(s.started_at),
    bestE1rmKg: s.best_e1rm_kg,
    totalVolumeLoad: s.total_volume_load,
  }));

  const assessment = assessStall(points);
  const last = sessions[sessions.length - 1];

  return {
    exerciseKey,
    sessionCount: sessions.length,
    latestE1rm: last?.best_e1rm_kg ?? null,
    bestE1rm: assessment.bestE1rmKg,
    lastPerformedAt: last?.started_at ?? '',
    assessment,
  };
}

/**
 * Progress summaries across every trained exercise.
 *
 * Exercises performed fewer than `minSessions` times are skipped: two data points cannot
 * distinguish progress from noise, and flagging a stall on that basis would be wrong far more
 * often than right.
 */
export async function summariseAllProgress(
  db: SqlExecutor,
  userId: string,
  { minSessions = 2 } = {},
): Promise<ExerciseProgressSummary[]> {
  const trained = await listTrainedExercises(db, userId);
  const summaries: ExerciseProgressSummary[] = [];

  for (const entry of trained) {
    if (entry.session_count < minSessions) continue;
    const summary = await summariseExerciseProgress(db, userId, entry.exercise_key);
    if (summary) summaries.push(summary);
  }

  return summaries;
}

/**
 * Compact digest for the AI coach.
 *
 * Roughly 30 lines of JSON rather than hundreds of set rows — the model gets exact numbers it
 * did not have to compute, and the request stays small enough to keep prompt-caching useful.
 */
export function toCoachDigest(summaries: readonly ExerciseProgressSummary[]) {
  return summaries.map((s) => ({
    exercise: s.exerciseKey,
    sessions: s.sessionCount,
    currentE1rmKg: s.latestE1rm === null ? null : Number(s.latestE1rm.toFixed(1)),
    bestE1rmKg: s.bestE1rm === null ? null : Number(s.bestE1rm.toFixed(1)),
    changeKg: s.assessment.e1rmDeltaKg === null ? null : Number(s.assessment.e1rmDeltaKg.toFixed(1)),
    volumeTrendPerSession:
      s.assessment.volumeSlopePerSession === null
        ? null
        : Number(s.assessment.volumeSlopePerSession.toFixed(0)),
    stalling: s.assessment.isStalling,
    sessionsSinceBest: s.assessment.sessionsSinceBest,
    lastPerformed: s.lastPerformedAt.slice(0, 10),
  }));
}

/** `YYYY-MM-DD` in the device's local calendar — matches SQLite's `date(x,'localtime')`. */
function localDay(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/* -------------------------------------------------------------------------- */
/* Progress screen aggregates                                                  */
/* -------------------------------------------------------------------------- */

export interface WeeklyVolume {
  /** Monday of the week, `YYYY-MM-DD` in local time. */
  weekStart: string;
  volumeKg: number;
}

/**
 * Working-set volume per week, oldest first, with empty weeks included.
 *
 * The gaps are the point. Dropping weeks you did not train would slide the remaining bars
 * together and turn a fortnight off into a flat, healthy-looking line — which is exactly the
 * thing the chart exists to expose.
 */
export async function weeklyVolume(
  db: SqlExecutor,
  userId: string,
  weeks = 8,
  today = new Date(),
): Promise<WeeklyVolume[]> {
  const rows = await db.all<{ week: string; volume: number }>(
    `SELECT date(ws.started_at, 'localtime', 'weekday 1', '-7 days') AS week,
            SUM(COALESCE(s.weight_kg, 0) * COALESCE(s.reps, 0))     AS volume
       FROM sets s
       JOIN session_exercises se ON se.id = s.session_exercise_id AND se.deleted_at IS NULL
       JOIN workout_sessions ws  ON ws.id = se.session_id AND ws.deleted_at IS NULL
      WHERE ws.user_id = ? AND s.is_warmup = 0 AND s.deleted_at IS NULL
      GROUP BY week`,
    [userId],
  );
  const byWeek = new Map(rows.map((r) => [r.week, r.volume]));

  // Walk back from this week's Monday so the series always ends on the current week, trained
  // or not — a chart that stops at the last workout hides that you have not trained since.
  const monday = new Date(today);
  monday.setHours(0, 0, 0, 0);
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));

  const out: WeeklyVolume[] = [];
  for (let i = weeks - 1; i >= 0; i--) {
    const d = new Date(monday);
    d.setDate(d.getDate() - i * 7);
    const key = localDay(d);
    out.push({ weekStart: key, volumeKg: byWeek.get(key) ?? 0 });
  }
  return out;
}

export interface TrainingDay {
  /** `YYYY-MM-DD`, local. */
  day: string;
  /** 0 = untrained, 1..4 = increasing volume. Bucketed, not raw, so one huge day cannot flatten the rest. */
  level: number;
}

/**
 * A day-per-cell consistency grid, oldest first, covering whole weeks back from today.
 *
 * Levels are quartiles of the days actually trained rather than fractions of the maximum: one
 * exceptional session would otherwise push every ordinary day into the palest bucket and make a
 * consistent block of training look like a near-empty grid.
 */
export async function consistencyHeat(
  db: SqlExecutor,
  userId: string,
  weeks = 16,
  today = new Date(),
): Promise<TrainingDay[]> {
  const rows = await db.all<{ day: string; volume: number }>(
    `SELECT date(ws.started_at, 'localtime')                    AS day,
            SUM(COALESCE(s.weight_kg, 0) * COALESCE(s.reps, 0)) AS volume
       FROM workout_sessions ws
       LEFT JOIN session_exercises se ON se.session_id = ws.id AND se.deleted_at IS NULL
       LEFT JOIN sets s ON s.session_exercise_id = se.id AND s.deleted_at IS NULL
                        AND s.is_warmup = 0
      WHERE ws.user_id = ? AND ws.deleted_at IS NULL
      GROUP BY day`,
    [userId],
  );
  const byDay = new Map(rows.map((r) => [r.day, r.volume]));

  const trained = [...byDay.values()].filter((v) => v > 0).sort((a, b) => a - b);
  const quartile = (q: number) =>
    trained.length === 0 ? 0 : (trained[Math.floor((trained.length - 1) * q)] ?? 0);
  const q1 = quartile(0.25);
  const q2 = quartile(0.5);
  const q3 = quartile(0.75);

  const end = new Date(today);
  end.setHours(0, 0, 0, 0);
  // Finish the current week so the grid is rectangular; leading cells are simply untrained.
  end.setDate(end.getDate() + (7 - ((end.getDay() + 6) % 7) - 1));

  const out: TrainingDay[] = [];
  for (let i = weeks * 7 - 1; i >= 0; i--) {
    const d = new Date(end);
    d.setDate(d.getDate() - i);
    const key = localDay(d);
    const volume = byDay.get(key) ?? 0;
    // A logged session with no working sets still counts as showing up.
    let level = 0;
    if (byDay.has(key)) level = 1;
    if (volume > q1) level = 2;
    if (volume > q2) level = 3;
    if (volume > q3) level = 4;
    out.push({ day: key, level });
  }
  return out;
}

export interface PersonalRecord {
  exerciseKey: string;
  weightKg: number;
  reps: number;
  achievedAt: string;
}

/**
 * The heaviest working set ever logged per exercise, heaviest first.
 *
 * Ties break on reps: 100×8 beats 100×5, which is what a lifter would call the better record.
 */
export async function personalRecords(
  db: SqlExecutor,
  userId: string,
  limit = 20,
): Promise<PersonalRecord[]> {
  return db.all<PersonalRecord>(
    `SELECT se.exercise_key AS exerciseKey,
            s.weight_kg     AS weightKg,
            s.reps          AS reps,
            ws.started_at   AS achievedAt
       FROM sets s
       JOIN session_exercises se ON se.id = s.session_exercise_id AND se.deleted_at IS NULL
       JOIN workout_sessions ws  ON ws.id = se.session_id AND ws.deleted_at IS NULL
      WHERE ws.user_id = ?
        AND s.is_warmup = 0 AND s.deleted_at IS NULL
        AND s.weight_kg IS NOT NULL AND s.reps IS NOT NULL
        AND s.weight_kg = (
          SELECT MAX(b.weight_kg)
            FROM sets b
            JOIN session_exercises bse ON bse.id = b.session_exercise_id AND bse.deleted_at IS NULL
            JOIN workout_sessions bws  ON bws.id = bse.session_id AND bws.deleted_at IS NULL
           WHERE bws.user_id = ? AND bse.exercise_key = se.exercise_key
             AND b.is_warmup = 0 AND b.deleted_at IS NULL
        )
      GROUP BY se.exercise_key
      HAVING s.reps = MAX(s.reps)
      ORDER BY s.weight_kg DESC
      LIMIT ?`,
    [userId, userId, limit],
  );
}
