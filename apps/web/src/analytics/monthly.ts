/**
 * The monthly review, as a coach reads it: every exercise of a trainee's month judged once for
 * the whole month, and the month by part of the body — where they progress and where they are
 * stuck.
 *
 * The verdicts are not worked out here. They come from `@fit/shared/progress`, the same code the
 * trainee's phone runs on its Progress screen, so the coach and the trainee read one verdict. All
 * this file does is put the coach's copy of the workouts (`coach_get_sessions`) into the shape
 * the phone reads from its own database (`apps/mobile/src/db/monthlyReview.ts`): per exercise,
 * oldest first, working sets only, an exercise entered twice in one workout read as one session.
 *
 * One difference, by the server's choice: the coach sees finished workouts only (0012), so a
 * workout the trainee abandoned half way counts on the phone and not here.
 */

import type { CoachSession } from '@fit/shared/coaching';
import {
  monthBounds,
  monthOf,
  reviewByArea,
  reviewMonth,
  shiftMonth,
  LOOKBACK_DAYS,
  type AreaMonth,
  type MonthReview,
  type SessionSets,
} from '@fit/shared/progress';

/** A trainee's workouts per exercise, oldest first, warm-ups left out. */
export function sessionsByExercise(sessions: readonly CoachSession[]): Map<string, SessionSets[]> {
  const byExercise = new Map<string, SessionSets[]>();
  const oldestFirst = [...sessions].sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  for (const session of oldestFirst) {
    for (const exercise of session.exercises) {
      if (!exercise.exerciseKey) continue;
      const sets = exercise.sets
        .filter((set) => set.is_warmup !== 1)
        .map((set) => ({
          weightKg: set.weight_kg,
          reps: set.reps,
          durationSeconds: set.duration_seconds,
          distanceM: set.distance_m,
        }));
      if (sets.length === 0) continue;
      const line = byExercise.get(exercise.exerciseKey) ?? [];
      if (line.length === 0) byExercise.set(exercise.exerciseKey, line);
      const last = line.at(-1);
      if (last?.sessionId === session.id) last.sets.push(...sets);
      else line.push({ sessionId: session.id, startedAt: session.startedAt, sets });
    }
  }
  return byExercise;
}

/** Every month, `YYYY-MM` in local time, with at least one working set. */
export function trainingMonths(sessions: readonly CoachSession[]): string[] {
  const months = new Set<string>();
  for (const line of sessionsByExercise(sessions).values()) {
    for (const session of line) months.add(monthOf(new Date(session.startedAt)));
  }
  return [...months].sort();
}

export interface MonthlyProgress {
  review: MonthReview;
  areas: AreaMonth[];
}

export function monthlyProgress(sessions: readonly CoachSession[], month: string): MonthlyProgress {
  const history = sessionsByExercise(sessions);
  const review = reviewMonth(history, month);
  return { review, areas: reviewByArea(review, history) };
}

/**
 * How far back workouts must reach for these months to be judged: each month needs the month
 * before it (one of the tips reads its verdict) and LOOKBACK_DAYS before that.
 */
export function historyStart(earliestMonth: string): Date {
  const { start } = monthBounds(shiftMonth(earliestMonth, -1));
  return new Date(start.getTime() - LOOKBACK_DAYS * 86_400_000);
}
