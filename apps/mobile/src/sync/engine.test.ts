/**
 * Sync tests against a real SQLite database and a fake server.
 *
 * The fake is a plain Map per table, not a mock with recorded expectations — it enforces the two
 * things the real server enforces that the engine could get wrong (the server stamps its own
 * `updated_at`, and it rejects a child whose parent it has not seen), and is otherwise honest
 * storage. A test that asserts "we called upsert with these arguments" would pass just as
 * happily against an engine that syncs the wrong rows.
 */

import { beforeEach, describe, expect, it } from 'vitest';

import type { SqlExecutor } from '../db/executor.js';
import { createTestExecutor } from '../db/testUtils.js';
import { runSync, type SyncTransport } from './engine.js';
import type { Row } from './rows.js';
import { SYNC_TABLES } from './tables.js';

const USER = '11111111-1111-4111-8111-111111111111';
const OTHER_USER = '22222222-2222-4222-8222-222222222222';

/* -------------------------------------------------------------------------- */
/* A fake Postgres                                                             */
/* -------------------------------------------------------------------------- */

/**
 * The NOT NULL columns of the real Supabase tables, as far as the sync engine touches them.
 *
 * Mirrors the local schema, where the same columns are NOT NULL — the ordering columns above
 * all, since those are the ones `toRemote` has a reason to leave out.
 */
const REQUIRED_COLUMNS: Record<string, string[]> = {
  plans: ['id', 'user_id', 'name'],
  plan_days: ['id', 'plan_id', 'day_index'],
  plan_day_exercises: ['id', 'plan_day_id', 'exercise_key', 'order_index'],
  workout_sessions: ['id', 'user_id', 'started_at'],
  session_exercises: ['id', 'session_id', 'exercise_key', 'order_index'],
  sets: ['id', 'session_exercise_id', 'set_index'],
  body_metrics: ['id', 'user_id', 'measured_at', 'source'],
};

/**
 * The ordered tables, and what an index is unique within.
 *
 * The real tables carry a UNIQUE (parent, index) constraint — `plan_day_exercises_day_order_unique`
 * and its siblings. Soft-deleted rows are assumed to keep occupying their slot, which is the
 * pessimistic reading and the one that catches more.
 */
const UNIQUE_ORDER: Record<string, { parent: string; index: string }> = {
  plan_days: { parent: 'plan_id', index: 'day_index' },
  plan_day_exercises: { parent: 'plan_day_id', index: 'order_index' },
  session_exercises: { parent: 'session_id', index: 'order_index' },
  sets: { parent: 'session_exercise_id', index: 'set_index' },
};

interface FakeServer extends SyncTransport {
  rows(table: string): Row[];
  seed(table: string, row: Row): void;
  /** Server clock, deliberately offset from the phone's — see the clock-skew test. */
  now: () => string;
  failNextUpsert: boolean;
}

function createFakeServer(startAt = Date.parse('2026-03-01T00:00:00.000Z')): FakeServer {
  const tables = new Map<string, Map<string, Row>>();
  let tick = startAt;
  const now = () => new Date((tick += 1000)).toISOString();

  const table = (name: string): Map<string, Row> => {
    let t = tables.get(name);
    if (!t) tables.set(name, (t = new Map()));
    return t;
  };

  const server: FakeServer = {
    now,
    failNextUpsert: false,
    rows: (name) => [...table(name).values()],
    seed(name, row) {
      table(name).set(row.id as string, { ...row, updated_at: row.updated_at ?? now() });
    },

     
    async ensureProfile() {
      /* the real one guards a foreign key the fake does not model */
    },

     
    async upsert(name, rows) {
      if (server.failNextUpsert) {
        server.failNextUpsert = false;
        throw new Error('server rejected the batch');
      }
      for (const row of rows) {
        /*
         * NOT NULL is checked against the payload, even when the row already exists.
         *
         * This fake used to merge the payload over the stored row and conclude that an omitted
         * column simply kept the server's value. Postgres does not work that way: an upsert is
         * `INSERT ... ON CONFLICT DO UPDATE`, and the proposed insert tuple is checked against
         * the table's constraints before the conflict is ever detected. Omitting a NOT NULL
         * column therefore fails outright.
         *
         * Modelling the merge instead of the constraint is how a real bug shipped past this
         * file: the fake agreed with the code rather than with the database, which is the one
         * thing a fake must never do.
         */
        for (const column of REQUIRED_COLUMNS[name] ?? []) {
          if (row[column] === undefined || row[column] === null) {
            throw new Error(
              `null value in column "${column}" of relation "${name}" violates not-null constraint`,
            );
          }
        }
        const previous = table(name).get(row.id as string) ?? {};
        const merged: Row = { ...previous, ...row, updated_at: now() };

        /*
         * UNIQUE (parent, index), checked per row within the statement.
         *
         * `onConflict: 'id'` resolves a clash on the primary key and nothing else, so a row
         * moving into a slot a sibling has not vacated yet is a plain constraint violation —
         * which is exactly what a reorder produces, and what this fake previously let through.
         */
        const unique = UNIQUE_ORDER[name];
        if (unique) {
          const clash = [...table(name).values()].find(
            (other) =>
              other.id !== merged.id &&
              other[unique.parent] === merged[unique.parent] &&
              other[unique.index] === merged[unique.index],
          );
          if (clash) {
            throw new Error(
              `duplicate key value violates unique constraint "${name}_${unique.index}_unique"`,
            );
          }
        }

        // The real server stamps updated_at by trigger and ignores what the client sent. Modelling
        // that is the point of this fake: it is what makes the two-clock design testable.
        table(name).set(row.id as string, merged);
      }
    },


    async patch(name, rows) {
      for (const row of rows) {
        // A patch touches only the columns it carries, and a row the server does not have is
        // not an error — PostgREST matches nothing and reports success.
        const previous = table(name).get(row.id as string);
        if (!previous) continue;
        table(name).set(row.id as string, { ...previous, ...row, updated_at: now() });
      }
    },

     
    async changedSince(name, since, limit) {
      return [...table(name).values()]
        .filter((r) => since === null || Date.parse(r.updated_at as string) > Date.parse(since))
        .sort((a, b) => Date.parse(a.updated_at as string) - Date.parse(b.updated_at as string))
        .slice(0, limit);
    },

     
    async fetchById(name, id) {
      return table(name).get(id) ?? null;
    },
  };
  return server;
}

/* -------------------------------------------------------------------------- */
/* Local fixtures                                                              */
/* -------------------------------------------------------------------------- */

let db: SqlExecutor & { close: () => void };

beforeEach(() => {
  db = createTestExecutor();
});

async function seedSession(
  at: string,
  { id = 'aaaaaaaa-0000-4000-8000-000000000001', user = USER, name = 'Push day' } = {},
): Promise<string> {
  await db.run(
    `INSERT INTO workout_sessions (id, user_id, name, started_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    [id, user, name, at, at, at],
  );
  return id;
}

async function seedExerciseWithSet(
  sessionId: string,
  at: string,
  { exerciseId = 'bbbbbbbb-0000-4000-8000-000000000001', setId = 'cccccccc-0000-4000-8000-000000000001' } = {},
): Promise<{ exerciseId: string; setId: string }> {
  await db.run(
    `INSERT INTO session_exercises (id, session_id, exercise_key, order_index, updated_at)
       VALUES (?, ?, 'Bench Press', 1, ?)`,
    [exerciseId, sessionId, at],
  );
  await db.run(
    `INSERT INTO sets (id, session_exercise_id, set_index, weight_kg, reps, is_warmup, to_failure, completed_at, updated_at)
       VALUES (?, ?, 1, 60, 8, 0, 1, ?, ?)`,
    [setId, exerciseId, at, at],
  );
  return { exerciseId, setId };
}

const localClock = (iso: string) => () => iso;

/* -------------------------------------------------------------------------- */

describe('push', () => {
  it('sends a workout and its children to the server', async () => {
    const at = '2026-02-01T10:00:00.000Z';
    const sessionId = await seedSession(at);
    await seedExerciseWithSet(sessionId, at);
    const server = createFakeServer();

    const result = await runSync(db, server, USER, localClock('2026-02-01T11:00:00.000Z'));

    expect(result.pushed).toBe(3);
    expect(server.rows('workout_sessions')).toHaveLength(1);
    expect(server.rows('session_exercises')).toHaveLength(1);
    expect(server.rows('sets')).toHaveLength(1);
  });

  it('converts SQLite 0/1 into real booleans', async () => {
    const at = '2026-02-01T10:00:00.000Z';
    const sessionId = await seedSession(at);
    await seedExerciseWithSet(sessionId, at);
    const server = createFakeServer();

    await runSync(db, server, USER, localClock('2026-02-01T11:00:00.000Z'));

    const [set] = server.rows('sets');
    expect(set?.is_warmup).toBe(false);
    expect(set?.to_failure).toBe(true);
  });

  it('never sends another user\'s rows, including through a parent join', async () => {
    const at = '2026-02-01T10:00:00.000Z';
    const mine = await seedSession(at);
    const theirs = await seedSession(at, {
      id: 'aaaaaaaa-0000-4000-8000-000000000002',
      user: OTHER_USER,
    });
    await seedExerciseWithSet(mine, at);
    await seedExerciseWithSet(theirs, at, {
      exerciseId: 'bbbbbbbb-0000-4000-8000-000000000002',
      setId: 'cccccccc-0000-4000-8000-000000000002',
    });
    const server = createFakeServer();

    await runSync(db, server, USER, localClock('2026-02-01T11:00:00.000Z'));

    // `sets` has no user_id at all — its ownership is two joins away, which is exactly the case
    // most likely to be got wrong and the one that leaks another user's data if it is.
    expect(server.rows('sets').map((r) => r.id)).toEqual(['cccccccc-0000-4000-8000-000000000001']);
    expect(server.rows('workout_sessions')).toHaveLength(1);
  });

  it('sends only what changed since the last push', async () => {
    await seedSession('2026-02-01T10:00:00.000Z');
    const server = createFakeServer();
    await runSync(db, server, USER, localClock('2026-02-01T11:00:00.000Z'));

    const second = await runSync(db, server, USER, localClock('2026-02-01T12:00:00.000Z'));
    expect(second.pushed).toBe(0);

    await db.run(`UPDATE workout_sessions SET name = ?, updated_at = ? WHERE id = ?`, [
      'Renamed',
      '2026-02-01T13:00:00.000Z',
      'aaaaaaaa-0000-4000-8000-000000000001',
    ]);
    const third = await runSync(db, server, USER, localClock('2026-02-01T14:00:00.000Z'));
    expect(third.pushed).toBe(1);
    expect(server.rows('workout_sessions')[0]?.name).toBe('Renamed');
  });

  it('pushes a soft delete so the other device learns about it', async () => {
    const at = '2026-02-01T10:00:00.000Z';
    await seedSession(at);
    const server = createFakeServer();
    await runSync(db, server, USER, localClock('2026-02-01T11:00:00.000Z'));

    await db.run(`UPDATE workout_sessions SET deleted_at = ?, updated_at = ? WHERE id = ?`, [
      '2026-02-01T12:00:00.000Z',
      '2026-02-01T12:00:00.000Z',
      'aaaaaaaa-0000-4000-8000-000000000001',
    ]);
    await runSync(db, server, USER, localClock('2026-02-01T13:00:00.000Z'));

    expect(server.rows('workout_sessions')[0]?.deleted_at).toBe('2026-02-01T12:00:00.000Z');
  });

  it('does not advance the cursor when the push fails', async () => {
    await seedSession('2026-02-01T10:00:00.000Z');
    const server = createFakeServer();
    server.failNextUpsert = true;

    await expect(runSync(db, server, USER, localClock('2026-02-01T11:00:00.000Z'))).rejects.toThrow();

    // The row must still be considered dirty. Treating a failed send as sent is how a workout
    // disappears: it never reaches the server and is never offered again.
    server.failNextUpsert = false;
    const retry = await runSync(db, server, USER, localClock('2026-02-01T12:00:00.000Z'));
    expect(retry.pushed).toBe(1);
  });
});

describe('pull', () => {
  it('writes a remote workout into the local database', async () => {
    const server = createFakeServer();
    server.seed('workout_sessions', {
      id: 'dddddddd-0000-4000-8000-000000000001',
      user_id: USER,
      name: 'From the other phone',
      started_at: '2026-03-01T08:00:00+00:00',
      created_at: '2026-03-01T08:00:00+00:00',
      deleted_at: null,
    });

    const result = await runSync(db, server, USER, localClock('2026-03-02T00:00:00.000Z'));

    expect(result.pulled).toBe(1);
    const row = await db.get<{ name: string; started_at: string }>(
      `SELECT name, started_at FROM workout_sessions WHERE id = ?`,
      ['dddddddd-0000-4000-8000-000000000001'],
    );
    expect(row?.name).toBe('From the other phone');
    // Rewritten into the format every other row uses. Stored verbatim as '+00:00', this row would
    // sort below every local row and fall out of every date-range query in the app.
    expect(row?.started_at).toBe('2026-03-01T08:00:00.000Z');
  });

  it('turns Postgres booleans back into 0/1', async () => {
    const server = createFakeServer();
    server.seed('workout_sessions', {
      id: 'dddddddd-0000-4000-8000-000000000001',
      user_id: USER,
      started_at: '2026-03-01T08:00:00+00:00',
      created_at: '2026-03-01T08:00:00+00:00',
    });
    server.seed('session_exercises', {
      id: 'eeeeeeee-0000-4000-8000-000000000001',
      session_id: 'dddddddd-0000-4000-8000-000000000001',
      exercise_key: 'Bench Press',
      order_index: 1,
    });
    server.seed('sets', {
      id: 'ffffffff-0000-4000-8000-000000000001',
      session_exercise_id: 'eeeeeeee-0000-4000-8000-000000000001',
      set_index: 1,
      weight_kg: '62.5',
      reps: 8,
      is_warmup: true,
      to_failure: false,
      completed_at: '2026-03-01T08:10:00+00:00',
    });

    await runSync(db, server, USER, localClock('2026-03-02T00:00:00.000Z'));

    const set = await db.get<{ is_warmup: number; to_failure: number; weight_kg: number }>(
      `SELECT is_warmup, to_failure, weight_kg FROM sets WHERE id = ?`,
      ['ffffffff-0000-4000-8000-000000000001'],
    );
    expect(set?.is_warmup).toBe(1);
    expect(set?.to_failure).toBe(0);
    // numeric arrives as a string from PostgREST; REAL affinity has to have converted it.
    expect(set?.weight_kg).toBe(62.5);
  });

  it('applies a remote delete locally', async () => {
    const at = '2026-02-01T10:00:00.000Z';
    await seedSession(at);
    const server = createFakeServer();
    await runSync(db, server, USER, localClock('2026-02-01T11:00:00.000Z'));

    const remote = server.rows('workout_sessions')[0];
    server.seed('workout_sessions', {
      ...remote,
      deleted_at: '2026-03-05T00:00:00+00:00',
      updated_at: '2026-03-05T00:00:00+00:00',
    });

    await runSync(db, server, USER, localClock('2026-03-06T00:00:00.000Z'));

    const row = await db.get<{ deleted_at: string | null }>(
      `SELECT deleted_at FROM workout_sessions WHERE id = ?`,
      ['aaaaaaaa-0000-4000-8000-000000000001'],
    );
    expect(row?.deleted_at).toBe('2026-03-05T00:00:00.000Z');
  });
});

describe('conflicts', () => {
  it('keeps the newer edit when the local copy is newer', async () => {
    const at = '2026-02-01T10:00:00.000Z';
    await seedSession(at);
    const server = createFakeServer();
    await runSync(db, server, USER, localClock('2026-02-01T11:00:00.000Z'));

    // The server's copy changed, but this device changed the same row later still.
    const remote = server.rows('workout_sessions')[0];
    server.seed('workout_sessions', {
      ...remote,
      name: 'Server name',
      updated_at: '2026-03-01T00:00:00+00:00',
    });
    await db.run(`UPDATE workout_sessions SET name = ?, updated_at = ? WHERE id = ?`, [
      'Local name',
      '2026-04-01T00:00:00.000Z',
      'aaaaaaaa-0000-4000-8000-000000000001',
    ]);

    await runSync(db, server, USER, localClock('2026-04-02T00:00:00.000Z'));

    const row = await db.get<{ name: string }>(
      `SELECT name FROM workout_sessions WHERE id = ?`,
      ['aaaaaaaa-0000-4000-8000-000000000001'],
    );
    expect(row?.name).toBe('Local name');
  });

  it('takes the remote edit when it is the newer one', async () => {
    const at = '2026-02-01T10:00:00.000Z';
    await seedSession(at);
    const server = createFakeServer();
    await runSync(db, server, USER, localClock('2026-02-01T11:00:00.000Z'));

    const remote = server.rows('workout_sessions')[0];
    server.seed('workout_sessions', {
      ...remote,
      name: 'Server name',
      updated_at: '2026-05-01T00:00:00+00:00',
    });

    await runSync(db, server, USER, localClock('2026-04-02T00:00:00.000Z'));

    const row = await db.get<{ name: string }>(
      `SELECT name FROM workout_sessions WHERE id = ?`,
      ['aaaaaaaa-0000-4000-8000-000000000001'],
    );
    expect(row?.name).toBe('Server name');
  });

  it('is not fooled by a phone whose clock is a year fast', async () => {
    // The local cursor is compared only against local timestamps and the pull cursor only against
    // server ones, so a wrong device clock cannot make this device win every conflict or cause it
    // to skip incoming rows. This is the whole reason there are two cursors.
    const at = '2027-09-09T10:00:00.000Z'; // a year in the future
    await seedSession(at);
    const server = createFakeServer();

    await runSync(db, server, USER, localClock('2027-09-09T11:00:00.000Z'));
    expect(server.rows('workout_sessions')).toHaveLength(1);

    const remote = server.rows('workout_sessions')[0];
    server.seed('workout_sessions', {
      ...remote,
      name: 'Written by the other device',
      updated_at: server.now(),
    });

    const second = await runSync(db, server, USER, localClock('2027-09-09T12:00:00.000Z'));

    // Server time is 2026 and the local row claims 2027. Compared naively the local row would
    // look newer and this change would be discarded.
    expect(second.pulled).toBe(1);
    const row = await db.get<{ name: string }>(
      `SELECT name FROM workout_sessions WHERE id = ?`,
      ['aaaaaaaa-0000-4000-8000-000000000001'],
    );
    expect(row?.name).toBe('Written by the other device');
  });
});

describe('orphans', () => {
  it('fetches a missing parent rather than dropping the child', async () => {
    const server = createFakeServer();
    // The parent is old enough to sit behind any cursor the child's delta would use, so ordering
    // the pull parents-first does not save us here: it has to be fetched by id.
    server.seed('workout_sessions', {
      id: 'dddddddd-0000-4000-8000-000000000001',
      user_id: USER,
      started_at: '2020-01-01T00:00:00+00:00',
      created_at: '2020-01-01T00:00:00+00:00',
      updated_at: '2020-01-01T00:00:00+00:00',
    });
    server.seed('session_exercises', {
      id: 'eeeeeeee-0000-4000-8000-000000000001',
      session_id: 'dddddddd-0000-4000-8000-000000000001',
      exercise_key: 'Bench Press',
      order_index: 1,
      updated_at: '2026-06-01T00:00:00+00:00',
    });

    // Start from a cursor after the parent's timestamp but before the child's.
    await db.run(
      `INSERT INTO sync_state (user_id, last_pulled_at, last_synced_at) VALUES (?, ?, ?)`,
      [USER, '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z'],
    );

    const result = await runSync(db, server, USER, localClock('2026-06-02T00:00:00.000Z'));

    expect(result.deferred).toBe(0);
    const parent = await db.get(`SELECT id FROM workout_sessions WHERE id = ?`, [
      'dddddddd-0000-4000-8000-000000000001',
    ]);
    expect(parent).not.toBeNull();
    const child = await db.get(`SELECT id FROM session_exercises WHERE id = ?`, [
      'eeeeeeee-0000-4000-8000-000000000001',
    ]);
    expect(child).not.toBeNull();
  });

  it('holds the cursor back when a parent cannot be found at all', async () => {
    const server = createFakeServer();
    server.seed('session_exercises', {
      id: 'eeeeeeee-0000-4000-8000-000000000001',
      session_id: 'dddddddd-0000-4000-8000-0000000000ff', // no such session anywhere
      exercise_key: 'Bench Press',
      order_index: 1,
      updated_at: '2026-06-01T00:00:00+00:00',
    });

    const first = await runSync(db, server, USER, localClock('2026-06-02T00:00:00.000Z'));
    expect(first.deferred).toBe(1);
    expect(first.pulled).toBe(0);

    // The row must be offered again next time. If the cursor had advanced past it, this set would
    // be gone from this device for good.
    const second = await runSync(db, server, USER, localClock('2026-06-03T00:00:00.000Z'));
    expect(second.deferred).toBe(1);
  });

  it('still delivers a later row once its parent shows up', async () => {
    const server = createFakeServer();
    server.seed('session_exercises', {
      id: 'eeeeeeee-0000-4000-8000-000000000001',
      session_id: 'dddddddd-0000-4000-8000-000000000001',
      exercise_key: 'Bench Press',
      order_index: 1,
      updated_at: '2026-06-01T00:00:00+00:00',
    });

    expect((await runSync(db, server, USER, localClock('2026-06-02T00:00:00.000Z'))).deferred).toBe(1);

    server.seed('workout_sessions', {
      id: 'dddddddd-0000-4000-8000-000000000001',
      user_id: USER,
      started_at: '2026-06-01T00:00:00+00:00',
      created_at: '2026-06-01T00:00:00+00:00',
      updated_at: '2026-06-02T00:00:00+00:00',
    });

    const second = await runSync(db, server, USER, localClock('2026-06-03T00:00:00.000Z'));
    expect(second.deferred).toBe(0);
    const child = await db.get(`SELECT id FROM session_exercises WHERE id = ?`, [
      'eeeeeeee-0000-4000-8000-000000000001',
    ]);
    expect(child).not.toBeNull();
  });
});

describe('round trip', () => {
  it('converges two devices onto the same rows', async () => {
    const server = createFakeServer();
    const phoneA = db;
    const phoneB = createTestExecutor();

    await seedSession('2026-02-01T10:00:00.000Z');
    await seedExerciseWithSet('aaaaaaaa-0000-4000-8000-000000000001', '2026-02-01T10:00:00.000Z');
    await runSync(phoneA, server, USER, localClock('2026-02-01T11:00:00.000Z'));

    await runSync(phoneB, server, USER, localClock('2026-02-01T12:00:00.000Z'));

    for (const table of ['workout_sessions', 'session_exercises', 'sets']) {
      const a = await phoneA.all<{ id: string }>(`SELECT id FROM ${table} ORDER BY id`);
      const b = await phoneB.all<{ id: string }>(`SELECT id FROM ${table} ORDER BY id`);
      expect(b).toEqual(a);
    }
    phoneB.close();
  });

  it('reaches a fixed point — a second sync with nothing new moves nothing', async () => {
    await seedSession('2026-02-01T10:00:00.000Z');
    await seedExerciseWithSet('aaaaaaaa-0000-4000-8000-000000000001', '2026-02-01T10:00:00.000Z');
    const server = createFakeServer();

    await runSync(db, server, USER, localClock('2026-02-01T11:00:00.000Z'));
    await runSync(db, server, USER, localClock('2026-02-01T12:00:00.000Z'));
    const third = await runSync(db, server, USER, localClock('2026-02-01T13:00:00.000Z'));

    // Without this the app would re-upload the user's entire history on every foreground.
    expect(third.pushed).toBe(0);
    expect(third.pulled).toBe(0);
  });
});

describe('table descriptors', () => {
  it('lists every parent before its children', async () => {
    const seen = new Set<string>();
    for (const table of SYNC_TABLES) {
      if (table.scope.kind === 'parent') {
        expect(seen, `${table.table} is synced before its parent ${table.scope.table}`).toContain(
          table.scope.table,
        );
      }
      seen.add(table.table);
    }
    await Promise.resolve();
  });

  it('only names columns that exist locally', async () => {
    for (const table of SYNC_TABLES) {
      const info = await db.all<{ name: string }>(`PRAGMA table_info(${table.table})`);
      const local = new Set(info.map((c) => c.name));
      for (const column of table.columns) {
        expect(local, `${table.table}.${column}`).toContain(column);
      }
    }
  });

  it('carries updated_at everywhere, since every merge decision depends on it', () => {
    for (const table of SYNC_TABLES) {
      expect(table.columns, table.table).toContain('updated_at');
      expect(table.columns, table.table).toContain('id');
    }
  });
});

describe('blank sets', () => {
  async function seedBlankSet(sessionId: string, at: string): Promise<string> {
    const exerciseId = 'bbbbbbbb-0000-4000-8000-00000000000b';
    const setId = 'cccccccc-0000-4000-8000-00000000000b';
    await db.run(
      `INSERT INTO session_exercises (id, session_id, exercise_key, order_index, updated_at)
         VALUES (?, ?, 'Bench Press', 9, ?)`,
      [exerciseId, sessionId, at],
    );
    // No reps, no duration, no distance: the placeholder row the UI creates the moment an
    // exercise is added, before anything has been typed into it.
    await db.run(
      `INSERT INTO sets (id, session_exercise_id, set_index, completed_at, updated_at)
         VALUES (?, ?, 1, ?, ?)`,
      [setId, exerciseId, at, at],
    );
    return setId;
  }

  it('does not send a set with nothing recorded in it', async () => {
    const at = '2026-02-01T10:00:00.000Z';
    const sessionId = await seedSession(at);
    await seedBlankSet(sessionId, at);
    const server = createFakeServer();

    await runSync(db, server, USER, localClock('2026-02-01T11:00:00.000Z'));

    // The real server rejects it, and a rejected row fails its whole batch and stops sync for
    // every table — so this is the difference between sync working and sync not working at all.
    expect(server.rows('sets')).toHaveLength(0);
  });

  it('sends it as soon as reps are entered', async () => {
    const at = '2026-02-01T10:00:00.000Z';
    const sessionId = await seedSession(at);
    const setId = await seedBlankSet(sessionId, at);
    const server = createFakeServer();
    await runSync(db, server, USER, localClock('2026-02-01T11:00:00.000Z'));

    await db.run(`UPDATE sets SET reps = 8, weight_kg = 60, updated_at = ? WHERE id = ?`, [
      '2026-02-01T12:00:00.000Z',
      setId,
    ]);
    await runSync(db, server, USER, localClock('2026-02-01T13:00:00.000Z'));

    expect(server.rows('sets').map((r) => r.id)).toEqual([setId]);
  });

  it('does not bother deleting a blank set the server never received', async () => {
    const at = '2026-02-01T10:00:00.000Z';
    const sessionId = await seedSession(at);
    const setId = await seedBlankSet(sessionId, at);
    const server = createFakeServer();
    await runSync(db, server, USER, localClock('2026-02-01T11:00:00.000Z'));

    await db.run(`UPDATE sets SET deleted_at = ?, updated_at = ? WHERE id = ?`, [
      '2026-02-01T12:00:00.000Z',
      '2026-02-01T12:00:00.000Z',
      setId,
    ]);
    const result = await runSync(db, server, USER, localClock('2026-02-01T13:00:00.000Z'));

    // A blank set never reaches the server, so there is nothing there to delete. The tombstone
    // rule catches this before the emptiness rule has to: no row was ever sent, none comes back,
    // and the other device is already in the state this delete was trying to produce.
    expect(result.pushed).toBe(0);
    expect(server.rows('sets')).toHaveLength(0);
  });
});

describe('parked indexes on deleted rows', () => {
  it('never sends the negative index a soft delete parks', async () => {
    const at = '2026-02-01T10:00:00.000Z';
    const sessionId = await seedSession(at);
    const { setId } = await seedExerciseWithSet(sessionId, at);
    const server = createFakeServer();
    await runSync(db, server, USER, localClock('2026-02-01T11:00:00.000Z'));

    // Exactly what deleteSession does: park the index so surviving rows can renumber past it.
    await db.run(`UPDATE sets SET deleted_at = ?, updated_at = ?, set_index = -rowid WHERE id = ?`, [
      '2026-02-01T12:00:00.000Z',
      '2026-02-01T12:00:00.000Z',
      setId,
    ]);
    await runSync(db, server, USER, localClock('2026-02-01T13:00:00.000Z'));

    const remote = server.rows('sets')[0];
    expect(remote?.deleted_at).toBe('2026-02-01T12:00:00.000Z');
    // The server checks set_index >= 1, so the negative sentinel itself can never travel. What
    // goes instead is its reflection into the tombstone band: high, positive, and unique per
    // row, which frees the slot on the server exactly as -rowid frees it in SQLite.
    expect(remote?.set_index as number).toBeGreaterThan(1_000_000);
  });

  it('frees the slot so a surviving sibling can move into it', async () => {
    /*
     * The failure seen on a real phone, twice:
     *
     *   upsert of row 2ae9db53-… on plan_day_exercises failed: duplicate key value violates
     *   unique constraint "plan_day_exercises_day_order_unique"  (23505)
     *
     * A deleted row that keeps its index on the server occupies that position for ever. The
     * sibling renumbered into it is refused, and since one rejected row aborts the push, every
     * table stops syncing — which is how a single deleted exercise took the whole backup down.
     */
    const at = '2026-02-01T10:00:00.000Z';
    const sessionId = await seedSession(at);
    const { exerciseId } = await seedExerciseWithSet(sessionId, at);
    const second = 'bbbbbbbb-0000-4000-8000-000000000002';
    await db.run(
      `INSERT INTO session_exercises (id, session_id, exercise_key, order_index, updated_at)
         VALUES (?, ?, 'Barbell Row', 2, ?)`,
      [second, sessionId, at],
    );
    const server = createFakeServer();
    await runSync(db, server, USER, localClock('2026-02-01T11:00:00.000Z'));

    // Delete the first, then renumber the second down into the slot it left — exactly what
    // removeExerciseFromSession followed by renumberExercises does.
    const deletedAt = '2026-02-01T12:00:00.000Z';
    await db.run(
      `UPDATE session_exercises SET deleted_at = ?, updated_at = ?, order_index = -rowid WHERE id = ?`,
      [deletedAt, deletedAt, exerciseId],
    );
    await db.run(`UPDATE session_exercises SET order_index = 1, updated_at = ? WHERE id = ?`, [
      deletedAt,
      second,
    ]);

    await runSync(db, server, USER, localClock('2026-02-01T13:00:00.000Z'));

    const survivor = server.rows('session_exercises').find((row) => row.id === second);
    expect(survivor?.order_index).toBe(1);
    expect(survivor?.deleted_at ?? null).toBeNull();
  });

  it('keeps sending the index while the row is alive', async () => {
    const at = '2026-02-01T10:00:00.000Z';
    const sessionId = await seedSession(at);
    await seedExerciseWithSet(sessionId, at);
    const server = createFakeServer();
    await runSync(db, server, USER, localClock('2026-02-01T11:00:00.000Z'));

    expect(server.rows('sets')[0]?.set_index).toBe(1);
    expect(server.rows('session_exercises')[0]?.order_index).toBe(1);
  });

  it('does not send a tombstone for a row the server never had', async () => {
    const at = '2026-02-01T10:00:00.000Z';
    const sessionId = await seedSession(at);
    const { setId } = await seedExerciseWithSet(sessionId, at);
    // Created and deleted before any sync ran.
    await db.run(`UPDATE sets SET deleted_at = ?, updated_at = ?, set_index = -rowid WHERE id = ?`, [
      '2026-02-01T10:30:00.000Z',
      '2026-02-01T10:30:00.000Z',
      setId,
    ]);
    const server = createFakeServer();

    await runSync(db, server, USER, localClock('2026-02-01T11:00:00.000Z'));

    // Inserting a tombstone for a row nobody has is pure noise — and it would have to be inserted
    // without an index, which the server requires on insert.
    expect(server.rows('sets')).toHaveLength(0);
  });
});

describe('reordering, which permutes a unique index', () => {
  /*
   * The case that broke syncing on a real phone, after drag-to-reorder shipped:
   *
   *   upsert of row 2ae9db53-… on plan_day_exercises failed: duplicate key value
   *   violates unique constraint "plan_day_exercises_day_order_unique"  (23505)
   *
   * `onConflict: 'id'` resolves a clash on the primary key and nothing else. Two exercises
   * trading places means one of them arrives at a slot the other has not left yet, and the
   * server refuses it — which aborts the whole push, for every table.
   */
  const PLAN = 'dddddddd-0000-4000-8000-000000000001';
  const DAY = 'eeeeeeee-0000-4000-8000-000000000001';
  const FIRST = 'ffffffff-0000-4000-8000-000000000001';
  const SECOND = 'ffffffff-0000-4000-8000-000000000002';

  async function seedTwoExercises(at: string) {
    await db.run(
      `INSERT INTO plans (id, user_id, name, is_active, created_at, updated_at)
         VALUES (?, ?, 'PPL', 1, ?, ?)`,
      [PLAN, USER, at, at],
    );
    await db.run(
      `INSERT INTO plan_days (id, plan_id, day_index, name, updated_at) VALUES (?, ?, 1, 'Push', ?)`,
      [DAY, PLAN, at],
    );
    for (const [id, index, key] of [
      [FIRST, 1, 'Bench Press'],
      [SECOND, 2, 'Barbell Row'],
    ] as const) {
      await db.run(
        `INSERT INTO plan_day_exercises (id, plan_day_id, exercise_key, order_index, updated_at)
           VALUES (?, ?, ?, ?, ?)`,
        [id, DAY, key, index, at],
      );
    }
  }

  /** Exactly what `reorderPlanDayExercise` does locally: park, then renumber. */
  async function swapThem(at: string) {
    const PARK = 100000;
    await db.run(`UPDATE plan_day_exercises SET order_index = ? WHERE id = ?`, [PARK, FIRST]);
    await db.run(`UPDATE plan_day_exercises SET order_index = ? WHERE id = ?`, [PARK + 1, SECOND]);
    await db.run(`UPDATE plan_day_exercises SET order_index = 1, updated_at = ? WHERE id = ?`, [at, SECOND]);
    await db.run(`UPDATE plan_day_exercises SET order_index = 2, updated_at = ? WHERE id = ?`, [at, FIRST]);
  }

  it('syncs a swap without tripping the unique index', async () => {
    await seedTwoExercises('2026-02-01T10:00:00.000Z');
    const server = createFakeServer();
    await runSync(db, server, USER, localClock('2026-02-01T11:00:00.000Z'));

    await swapThem('2026-02-01T12:00:00.000Z');
    await runSync(db, server, USER, localClock('2026-02-01T13:00:00.000Z'));

    const indexOf = (id: string) =>
      server.rows('plan_day_exercises').find((row) => row.id === id)?.order_index;
    expect(indexOf(SECOND)).toBe(1);
    expect(indexOf(FIRST)).toBe(2);
  });

  it('leaves nothing parked behind on the server', async () => {
    // The two-pass push moves rows out of the way before setting their real positions. If the
    // second pass were ever skipped, the server would keep a five-figure index that the app
    // would then read back as the exercise order.
    await seedTwoExercises('2026-02-01T10:00:00.000Z');
    const server = createFakeServer();
    await runSync(db, server, USER, localClock('2026-02-01T11:00:00.000Z'));
    await swapThem('2026-02-01T12:00:00.000Z');
    await runSync(db, server, USER, localClock('2026-02-01T13:00:00.000Z'));

    for (const row of server.rows('plan_day_exercises')) {
      expect(row.order_index as number).toBeLessThan(10);
    }
  });

  it('still sends a single row without the extra pass', async () => {
    // Nothing to permute with one row, and the common sync is one row or none.
    await seedTwoExercises('2026-02-01T10:00:00.000Z');
    await db.run(`DELETE FROM plan_day_exercises WHERE id = ?`, [SECOND]);
    const server = createFakeServer();

    await runSync(db, server, USER, localClock('2026-02-01T11:00:00.000Z'));

    expect(server.rows('plan_day_exercises')).toHaveLength(1);
    expect(server.rows('plan_day_exercises')[0]?.order_index).toBe(1);
  });
});
