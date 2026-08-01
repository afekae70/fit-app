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
  return db.get<CoachBriefRow>(
    'SELECT * FROM coach_briefs WHERE user_id = ? AND brief_date = ?',
    [userId, briefDate],
  );
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
