/**
 * coach_briefs repository tests — real SQL against a real SQLite engine, same approach as
 * workouts.test.ts.
 */

import { beforeEach, describe, expect, it } from 'vitest';

import type { SqlExecutor } from './executor.js';
import { getCoachBrief, saveCoachBrief } from './coachBriefs.js';
import { createTestExecutor } from './testUtils.js';

let db: SqlExecutor;
let counter = 0;
const newId = () => `id-${String(++counter).padStart(3, '0')}`;
const clock = () => '2026-07-31T09:00:00.000Z';
const USER = 'user-1';

beforeEach(() => {
  db = createTestExecutor();
  counter = 0;
});

describe('coach briefs', () => {
  it('returns null when nothing is cached for the day', async () => {
    expect(await getCoachBrief(db, USER, '2026-07-31')).toBeNull();
  });

  it('saves and reads back a brief for a given day', async () => {
    await saveCoachBrief(db, USER, newId, '2026-07-31', 'Great week — keep pushing squats.', clock);

    const row = await getCoachBrief(db, USER, '2026-07-31');
    expect(row?.text).toBe('Great week — keep pushing squats.');
    expect(row?.user_id).toBe(USER);
    expect(row?.brief_date).toBe('2026-07-31');
  });

  it('overwrites the same day rather than duplicating a row', async () => {
    await saveCoachBrief(db, USER, newId, '2026-07-31', 'First draft.', clock);
    await saveCoachBrief(db, USER, newId, '2026-07-31', 'Final version.', clock);

    const rows = await db.all('SELECT * FROM coach_briefs WHERE user_id = ?', [USER]);
    expect(rows).toHaveLength(1);
    expect(await getCoachBrief(db, USER, '2026-07-31')).toMatchObject({ text: 'Final version.' });
  });

  it('keeps different users and different days separate', async () => {
    await saveCoachBrief(db, USER, newId, '2026-07-30', 'Yesterday.', clock);
    await saveCoachBrief(db, USER, newId, '2026-07-31', 'Today.', clock);
    await saveCoachBrief(db, 'user-2', newId, '2026-07-31', 'Someone else.', clock);

    expect(await getCoachBrief(db, USER, '2026-07-30')).toMatchObject({ text: 'Yesterday.' });
    expect(await getCoachBrief(db, USER, '2026-07-31')).toMatchObject({ text: 'Today.' });
    expect(await getCoachBrief(db, 'user-2', '2026-07-31')).toMatchObject({ text: 'Someone else.' });
  });
});
