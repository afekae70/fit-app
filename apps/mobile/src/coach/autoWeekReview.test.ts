/**
 * The coach's weekly review, written by itself on Saturday at 19:00. 2026-11-14 is a Saturday, so
 * its week runs Sunday 8 to Saturday 14.
 */

import { beforeEach, describe, expect, it } from 'vitest';

import { getWeeklyReviewBetween, saveWeeklyReview } from '../db/coachBriefs.js';
import type { SqlExecutor } from '../db/executor.js';
import { createTestExecutor } from '../db/testUtils.js';
import { dueWeek, ensureDueWeekReview, reviewDueAt, rewriteDueWeekReview } from './autoWeekReview.js';
import { requestWeeklyReview, weekReviewDays } from './weeklyReview.js';

const USER = 'user-1';
let db: SqlExecutor;
let counter = 0;
const newId = () => `id-${String(++counter).padStart(3, '0')}`;
const at = (day: number, hour: number, minute = 0) => new Date(2026, 10, day, hour, minute);

beforeEach(() => {
  db = createTestExecutor();
  counter = 0;
});

describe('when a week’s review is due', () => {
  it('is its Saturday at 19:00', () => {
    expect(reviewDueAt('2026-11-08')).toEqual(at(14, 19));
  });

  it('is this week from Saturday 19:00, and the week just ended before that', () => {
    expect(dueWeek(at(14, 19))).toEqual({ start: '2026-11-08', end: '2026-11-14' });
    expect(dueWeek(at(14, 23, 30))).toEqual({ start: '2026-11-08', end: '2026-11-14' });
    expect(dueWeek(at(14, 18, 59))).toEqual({ start: '2026-11-01', end: '2026-11-07' });
    // Opened on Wednesday: the week that ended on Saturday is still the one due.
    expect(dueWeek(at(18, 9))).toEqual({ start: '2026-11-08', end: '2026-11-14' });
  });

  it('counts only a review written on the week’s Saturday or the Sunday after', () => {
    expect(weekReviewDays('2026-11-14')).toEqual(['2026-11-14', '2026-11-15']);
  });
});

describe('writing the due week’s review', () => {
  const options = (now: Date) => ({
    db,
    userId: USER,
    newId,
    locale: 'he' as const,
    baseUrl: 'https://coach.test',
    accessToken: 'token',
    now,
  });

  it('hands back the week’s review when it already has one, asking for nothing', async () => {
    await saveWeeklyReview(db, USER, newId, '2026-11-14', 'TRAINING: Good.\nTIP: Rest.');
    expect(await ensureDueWeekReview(options(at(15, 10)))).toEqual({
      kind: 'ready',
      review: { writtenOn: '2026-11-14', text: 'TRAINING: Good.\nTIP: Rest.' },
    });
  });

  it('is not held back by a review asked for earlier in the week', async () => {
    // Written on Thursday, before the week was over: not that week's review.
    await saveWeeklyReview(db, USER, newId, '2026-11-12', 'An old paragraph.');
    const outcome = await ensureDueWeekReview(options(at(14, 19, 5)));
    // Nothing logged on this phone, so it stops before sending — but it did try for this week.
    expect(outcome).toEqual({ kind: 'failed', code: 'insufficient_context' });
  });

  it('shares one attempt between calls made at the same time', async () => {
    const first = ensureDueWeekReview(options(at(14, 19, 5)));
    const second = ensureDueWeekReview(options(at(14, 19, 5)));
    expect(second).toBe(first);
    await first;
  });

  it('never writes a second review for a week that has one', async () => {
    await saveWeeklyReview(db, USER, newId, '2026-11-15', 'Written on Sunday.');
    const outcome = await requestWeeklyReview({
      db,
      userId: USER,
      newId,
      locale: 'he',
      baseUrl: 'https://coach.test',
      accessToken: 'token',
      today: reviewDueAt('2026-11-08'),
      week: { start: '2026-11-08', end: '2026-11-14' },
    });
    expect(outcome).toMatchObject({ ok: false, code: 'too_soon' });
  });

  it('rewrites the due week’s review: the one there is goes, and a new one is asked for', async () => {
    await saveWeeklyReview(db, USER, newId, '2026-11-14', 'The short old one.');
    const outcome = await rewriteDueWeekReview(options(at(14, 20)));
    expect(await getWeeklyReviewBetween(db, USER, '2026-11-14', '2026-11-15')).toBeNull();
    // Nothing logged on this phone, so the new one stops before sending.
    expect(outcome).toEqual({ kind: 'failed', code: 'insufficient_context' });
  });

  it('leaves other weeks’ reviews alone when rewriting', async () => {
    await saveWeeklyReview(db, USER, newId, '2026-11-07', 'The week before.');
    await rewriteDueWeekReview(options(at(14, 20)));
    expect(await getWeeklyReviewBetween(db, USER, '2026-11-07', '2026-11-08')).toMatchObject({
      text: 'The week before.',
    });
  });
});
