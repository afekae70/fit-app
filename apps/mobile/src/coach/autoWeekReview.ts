/**
 * The coach writes each week's review by itself, on Saturday at 19:00.
 *
 * Asked for by the owner (2026-11-14): "the AI coach should write, every week on Saturday at
 * seven, a new summary of the week that was — not the same summary every time". This replaces,
 * for the weekly summary, the button the review used to wait for (`weeklyReview.ts` explains why
 * it waited: it sends the week's digest to a model run by someone else). The owner has asked for
 * exactly that to happen every week, and it is his own data going to his own coach.
 *
 * ## When
 *
 * A week, Sunday to Saturday, is due at 19:00 on its Saturday — the moment the Saturday reminder
 * fires. A phone cannot be relied on to wake an app at a set minute, so the review is written the
 * first time the app is open at or after that moment: tapping the reminder opens the summary, and
 * the summary writes it. Opened later — Sunday, Wednesday — the week just ended is still the one
 * due, and its review still covers that week: the request is dated to its Saturday at 19:00.
 * Only the latest due week is ever written; a backlog of old weeks is not caught up on.
 *
 * ## Once
 *
 * One review per week (`requestWeeklyReview` with `week`), and one request in flight per week on
 * this phone: the summary screen and the app's own start-up may both ask at once, and both get the
 * same answer. A failure — offline, the server down — is tried again the next time.
 */

import {
  deleteWeeklyReviews,
  getWeeklyReviewBetween,
  type WeeklyReview,
} from '../db/coachBriefs.js';
import type { SqlExecutor } from '../db/executor.js';
import { addDays, localDate, parseLocalDate, weekStart } from '../db/schedule.js';
import type { IdFactory } from '../db/workouts.js';
import { loadWeekSummary } from '../db/weekSummary.js';
import { weekFacts } from './weekFacts.js';
import { requestWeeklyReview, weekReviewDays, type ReviewOutcome } from './weeklyReview.js';

/** Saturday, seven in the evening: when the reminder fires and the week's review is due. */
export const REVIEW_HOUR = 19;

/** The moment a week's review is due: its Saturday at 19:00, local time. */
export function reviewDueAt(start: string): Date {
  const saturday = parseLocalDate(addDays(start, 6));
  saturday.setHours(REVIEW_HOUR, 0, 0, 0);
  return saturday;
}

/** The latest week whose review is due by `now`: this week from Saturday 19:00, else the last. */
export function dueWeek(now: Date): { start: string; end: string } {
  const thisWeek = weekStart(localDate(now));
  const start = now >= reviewDueAt(thisWeek) ? thisWeek : addDays(thisWeek, -7);
  return { start, end: addDays(start, 6) };
}

export interface EnsureOptions {
  db: SqlExecutor;
  userId: string;
  newId: IdFactory;
  locale: 'he' | 'en';
  baseUrl: string;
  accessToken: string;
  now?: Date;
}

export type EnsureOutcome =
  | { kind: 'ready'; review: WeeklyReview }
  | { kind: 'failed'; code: string | undefined };

const inFlight = new Map<string, Promise<EnsureOutcome>>();

/**
 * The due week's review: the one already written, or a new one asked for now. Never throws.
 * Concurrent calls for the same week share one request.
 */
export function ensureDueWeekReview(options: EnsureOptions): Promise<EnsureOutcome> {
  const week = dueWeek(options.now ?? new Date());
  const key = `${options.userId}:${week.start}`;
  const running = inFlight.get(key);
  if (running) return running;

  const task = (async (): Promise<EnsureOutcome> => {
    try {
      const existing = await getWeeklyReviewBetween(
        options.db,
        options.userId,
        ...weekReviewDays(week.end),
      );
      if (existing) return { kind: 'ready', review: existing };

      const outcome: ReviewOutcome = await requestWeeklyReview({
        db: options.db,
        userId: options.userId,
        newId: options.newId,
        locale: options.locale,
        baseUrl: options.baseUrl,
        accessToken: options.accessToken,
        today: reviewDueAt(week.start),
        week,
        // The numbers on the summary screen for that week, so the review agrees with them.
        facts: weekFacts(
          await loadWeekSummary(options.db, options.userId, week.start, localDate(reviewDueAt(week.start))),
        ),
      });
      return outcome.ok
        ? { kind: 'ready', review: outcome.review }
        : { kind: 'failed', code: outcome.code };
    } catch {
      return { kind: 'failed', code: undefined };
    } finally {
      inFlight.delete(key);
    }
  })();
  inFlight.set(key, task);
  return task;
}

/**
 * Write the due week's review again: the one there is removed, and a new one asked for.
 *
 * For a review the person wants rewritten — one from before the review's format changed, or one
 * written from numbers since corrected. Only the due week, which is the only week a review is
 * ever written for. If a request for it is already running, that one is the answer.
 */
export async function rewriteDueWeekReview(options: EnsureOptions): Promise<EnsureOutcome> {
  const week = dueWeek(options.now ?? new Date());
  const running = inFlight.get(`${options.userId}:${week.start}`);
  if (running) return running;
  await deleteWeeklyReviews(options.db, options.userId, weekReviewDays(week.end));
  return ensureDueWeekReview(options);
}
