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
): Promise<ExerciseSessionBest[]> {
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
     JOIN session_exercises se ON se.id = s.session_exercise_id
     JOIN workout_sessions ws  ON ws.id = se.session_id
     WHERE ws.user_id = ?
       AND se.exercise_key = ?
       AND s.is_warmup = 0
       AND s.weight_kg IS NOT NULL
       AND s.reps IS NOT NULL
       AND s.reps BETWEEN 1 AND 12
     GROUP BY ws.id
     ORDER BY ws.started_at DESC
     LIMIT ?`,
    [userId, exerciseKey, limit],
  );

  // Query newest-first so LIMIT keeps the most RECENT sessions, then flip: the trend maths
  // needs chronological order. Ordering ascending in SQL would have kept the oldest instead.
  return rows.reverse();
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
     JOIN workout_sessions ws ON ws.id = se.session_id
     JOIN sets s              ON s.session_exercise_id = se.id
     WHERE ws.user_id = ?
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
