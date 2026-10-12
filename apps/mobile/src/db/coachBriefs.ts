/**
 * Cache for the Today screen's daily coach brief — one row per user per calendar day.
 *
 * The brief is a paid model call, so it is generated once per day and read from here on every
 * later screen visit that same day, rather than re-requested on each mount.
 */

import type { SqlExecutor } from './executor.js';
import type { Clock, IdFactory } from './workouts.js';

const defaultClock: Clock = () => new Date().toISOString();

export interface CoachBriefRow {
  id: string;
  user_id: string;
  brief_date: string;
  text: string;
  created_at: string;
}

export async function getCoachBrief(
  db: SqlExecutor,
  userId: string,
  briefDate: string,
): Promise<CoachBriefRow | null> {
  return db.get<CoachBriefRow>('SELECT * FROM coach_briefs WHERE user_id = ? AND brief_date = ?', [
    userId,
    briefDate,
  ]);
}

export async function saveCoachBrief(
  db: SqlExecutor,
  userId: string,
  newId: IdFactory,
  briefDate: string,
  text: string,
  clock: Clock = defaultClock,
): Promise<void> {
  await db.run(
    `INSERT INTO coach_briefs (id, user_id, brief_date, text, created_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (user_id, brief_date) DO UPDATE SET text = excluded.text`,
    [newId(), userId, briefDate, text, clock()],
  );
}

/*
 * The weekly review.
 *
 * Kept in the same table as the daily note, under a key the daily note can never have: a
 * calendar day is `2026-10-12`, and a review is `week:2026-10-12` — the day it was written.
 * `brief_date` is text and is only ever matched whole, so the two cannot be mistaken for each
 * other, and a second table with the same four columns would be a migration for nothing.
 *
 * Several are kept, one per time it was asked for, so the latest is always the one to show
 * and an older one is still there to look back at.
 */
const WEEKLY_PREFIX = 'week:';

export interface WeeklyReview {
  /** The local day it was written, `YYYY-MM-DD`. */
  writtenOn: string;
  text: string;
}

/** The most recent weekly review, or null if there has never been one. */
export async function getLatestWeeklyReview(
  db: SqlExecutor,
  userId: string,
): Promise<WeeklyReview | null> {
  const row = await db.get<{ brief_date: string; text: string }>(
    // The keys sort as dates do, because the dates inside them do.
    `SELECT brief_date, text FROM coach_briefs
      WHERE user_id = ? AND brief_date LIKE '${WEEKLY_PREFIX}%'
      ORDER BY brief_date DESC
      LIMIT 1`,
    [userId],
  );
  return row ? { writtenOn: row.brief_date.slice(WEEKLY_PREFIX.length), text: row.text } : null;
}

export async function saveWeeklyReview(
  db: SqlExecutor,
  userId: string,
  newId: IdFactory,
  writtenOn: string,
  text: string,
  clock: Clock = defaultClock,
): Promise<void> {
  await saveCoachBrief(db, userId, newId, `${WEEKLY_PREFIX}${writtenOn}`, text, clock);
}
