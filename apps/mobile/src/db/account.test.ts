/**
 * Deleting one person's data from the device, against a real database.
 *
 * Two things can go wrong, and they pull in opposite directions: leaving something of theirs
 * behind, and taking something of somebody else's. So every test here has two users in the
 * database, and checks both halves.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { purgeUserData, PURGED_TABLES } from './account.js';
import type { SqlExecutor } from './executor.js';
import { createTestExecutor } from './testUtils.js';

const ALICE = 'user-alice';
const BOB = 'user-bob';
const NOW = '2026-10-08T10:00:00.000Z';

let db: SqlExecutor & { close: () => void };

beforeEach(() => {
  db = createTestExecutor();
});

afterEach(() => {
  db.close();
});

/** One row in every table that can hold a user's data, for one user. */
async function seed(userId: string): Promise<void> {
  const id = (name: string) => `${userId}-${name}`;

  await db.run(`INSERT INTO profile (user_id, updated_at) VALUES (?, ?)`, [userId, NOW]);
  await db.run(
    `INSERT INTO body_metrics (id, user_id, measured_at, weight_kg, source) VALUES (?, ?, ?, 80, 'manual')`,
    [id('metric'), userId, NOW],
  );
  await db.run(
    `INSERT INTO nutrition_targets
       (id, user_id, effective_from, weight_kg_snapshot, goal, computed_by, created_at)
     VALUES (?, ?, '2026-10-01', 80, 'maintain', 'manual', ?)`,
    [id('target'), userId, NOW],
  );
  await db.run(`INSERT INTO locations (id, user_id, name) VALUES (?, ?, 'Gym')`, [
    id('gym'),
    userId,
  ]);

  await db.run(
    `INSERT INTO workout_sessions (id, user_id, started_at, created_at) VALUES (?, ?, ?, ?)`,
    [id('session'), userId, NOW, NOW],
  );
  await db.run(
    `INSERT INTO session_exercises (id, session_id, exercise_key, order_index)
     VALUES (?, ?, 'Barbell Bench Press', 0)`,
    [id('exercise'), id('session')],
  );
  await db.run(
    `INSERT INTO sets (id, session_exercise_id, set_index, weight_kg, reps, completed_at)
     VALUES (?, ?, 0, 60, 8, ?)`,
    [id('set'), id('exercise'), NOW],
  );

  await db.run(`INSERT INTO plans (id, user_id, name, created_at) VALUES (?, ?, 'Plan', ?)`, [
    id('plan'),
    userId,
    NOW,
  ]);
  await db.run(`INSERT INTO plan_days (id, plan_id, day_index) VALUES (?, ?, 0)`, [
    id('day'),
    id('plan'),
  ]);
  await db.run(
    `INSERT INTO plan_day_exercises (id, plan_day_id, exercise_key, order_index)
     VALUES (?, ?, 'Barbell Bench Press', 0)`,
    [id('planned'), id('day')],
  );

  await db.run(
    `INSERT INTO scheduled_days (id, user_id, scheduled_on, plan_day_id) VALUES (?, ?, '2026-10-09', ?)`,
    [id('scheduled'), userId, id('day')],
  );
  await db.run(
    `INSERT INTO coach_briefs (id, user_id, brief_date, text, created_at) VALUES (?, ?, '2026-10-08', 'x', ?)`,
    [id('brief'), userId, NOW],
  );
  await db.run(`INSERT INTO sync_state (user_id, last_pulled_at) VALUES (?, ?)`, [userId, NOW]);
  await db.run(
    `INSERT INTO outbox (user_id, entity, entity_id, op, created_at) VALUES (?, 'body_metric', ?, 'insert', ?)`,
    [userId, id('metric'), NOW],
  );
}

/** Rows a user has left, table by table — through the parent for tables with no user column. */
async function remaining(userId: string): Promise<Record<string, number>> {
  const count = async (sql: string) => (await db.get<{ n: number }>(sql, [userId]))?.n ?? 0;
  const own = async (table: string) =>
    count(`SELECT COUNT(*) AS n FROM ${table} WHERE user_id = ?`);

  return {
    profile: await own('profile'),
    body_metrics: await own('body_metrics'),
    nutrition_targets: await own('nutrition_targets'),
    locations: await own('locations'),
    workout_sessions: await own('workout_sessions'),
    session_exercises: await count(
      `SELECT COUNT(*) AS n FROM session_exercises WHERE id LIKE ? || '-%'`,
    ),
    sets: await count(`SELECT COUNT(*) AS n FROM sets WHERE id LIKE ? || '-%'`),
    plans: await own('plans'),
    plan_days: await count(`SELECT COUNT(*) AS n FROM plan_days WHERE id LIKE ? || '-%'`),
    plan_day_exercises: await count(
      `SELECT COUNT(*) AS n FROM plan_day_exercises WHERE id LIKE ? || '-%'`,
    ),
    scheduled_days: await own('scheduled_days'),
    coach_briefs: await own('coach_briefs'),
    sync_state: await own('sync_state'),
    outbox: await own('outbox'),
  };
}

const total = (rows: Record<string, number>) => Object.values(rows).reduce((a, b) => a + b, 0);

describe('purgeUserData', () => {
  it('removes everything the user had on the device', async () => {
    await seed(ALICE);
    expect(total(await remaining(ALICE))).toBe(14);

    await purgeUserData(db, ALICE);

    expect(await remaining(ALICE)).toEqual({
      profile: 0,
      body_metrics: 0,
      nutrition_targets: 0,
      locations: 0,
      workout_sessions: 0,
      session_exercises: 0,
      sets: 0,
      plans: 0,
      plan_days: 0,
      plan_day_exercises: 0,
      scheduled_days: 0,
      coach_briefs: 0,
      sync_state: 0,
      outbox: 0,
    });
  });

  it('leaves another person on the same phone exactly as they were', async () => {
    await seed(ALICE);
    await seed(BOB);
    const before = await remaining(BOB);

    await purgeUserData(db, ALICE);

    expect(await remaining(BOB)).toEqual(before);
    expect(total(before)).toBe(14);
  });

  it('does not depend on foreign-key cascades being switched on', async () => {
    // `PRAGMA foreign_keys` is per connection and off by default. With it off, a purge that
    // leaned on ON DELETE CASCADE would remove the sessions and strand every set under them.
    await db.exec('PRAGMA foreign_keys = OFF;');
    await seed(ALICE);

    await purgeUserData(db, ALICE);

    const orphans = await db.get<{ n: number }>(
      `SELECT (SELECT COUNT(*) FROM sets) + (SELECT COUNT(*) FROM session_exercises)
            + (SELECT COUNT(*) FROM plan_days) + (SELECT COUNT(*) FROM plan_day_exercises) AS n`,
    );
    expect(orphans?.n).toBe(0);
  });

  it('clears the unattributed queue too', async () => {
    // Workout writes are queued without a user. Nothing reads the queue, but its rows name
    // sessions and carry their payloads: left behind, they are a log of what was deleted.
    await seed(ALICE);
    await db.run(
      `INSERT INTO outbox (entity, entity_id, op, payload, created_at)
       VALUES ('workout_session', 'user-alice-session', 'insert', '{}', ?)`,
      [NOW],
    );

    await purgeUserData(db, ALICE);

    const left = await db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM outbox`);
    expect(left?.n).toBe(0);
  });

  it('is harmless for a user with nothing here', async () => {
    await seed(BOB);
    await expect(purgeUserData(db, 'nobody')).resolves.toBeUndefined();
    expect(total(await remaining(BOB))).toBe(14);
  });
});

describe('the list of tables it covers', () => {
  it('includes every table that has a user_id column', async () => {
    // The guard for the future. A table added next month with a user_id column and no line in
    // purgeUserData is a table that survives "delete my account" — and nothing but this test
    // would notice.
    const tables = await db.all<{ name: string }>(
      `SELECT m.name FROM sqlite_master m
        WHERE m.type = 'table' AND m.name NOT LIKE 'sqlite_%'
          AND EXISTS (SELECT 1 FROM pragma_table_info(m.name) WHERE name = 'user_id')
        ORDER BY m.name`,
    );

    expect(tables.map((t) => t.name)).toEqual([...PURGED_TABLES].sort());
  });
});
