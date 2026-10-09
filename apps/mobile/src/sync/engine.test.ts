/**
 * Sync tests against a real SQLite database and a fake server.
 *
 * The fake is a plain Map per table, not a mock with recorded expectations — it enforces the
 * things the real server enforces that the engine could get wrong (the server stamps its own
 * `updated_at`, it refuses a child whose parent it has not seen, and it holds every ordered
 * table to one row per position), and is otherwise honest storage. A test that asserts "we called upsert with these arguments" would pass just as
 * happily against an engine that syncs the wrong rows.
 */

import { beforeEach, describe, expect, it } from 'vitest';

import type { SqlExecutor } from '../db/executor.js';
import { MIGRATIONS } from '../db/schema.js';
import { createTestExecutor } from '../db/testUtils.js';
import {
  addExerciseToSession,
  addSet,
  deleteSession,
  removeExerciseFromSession,
  removeSet,
  startSession,
} from '../db/workouts.js';
import { runSync, type RowRejection, type SyncTransport } from './engine.js';
import { isRowRefusal, type Row } from './rows.js';
import { SYNC_TABLES, SYNC_TABLE_BY_NAME } from './tables.js';

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
  /** The next upsert fails as a request, not as a row: no network, an expired session. */
  failNextUpsert: boolean;
  /** Ids the server refuses outright, with the code it gives — a check constraint, say. */
  refuse: Map<string, string>;
  /** Every call that reached the server, for the tests that are about how many there were. */
  calls: { op: 'upsert' | 'patch' | 'fetchByIds'; table: string; ids: string[] }[];
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

  /**
   * Why the server will not take this row, or null if it will.
   *
   * Checked in the order Postgres checks: row-level security against the proposed row, then
   * the constraints of the tuple, then the unique index as the row is written.
   */
  const objection = (
    name: string,
    payload: Row,
    row: Row,
  ): { code: string; message: string } | null => {
    const forced = server.refuse.get(row.id as string);
    if (forced) return { code: forced, message: `refused by the test with ${forced}` };

    /*
     * A child's ownership is proved through its parent, and a parent the server does not have
     * proves nothing.
     *
     * The real policy is `EXISTS (SELECT 1 FROM workout_sessions ws WHERE ws.id = session_id
     * AND ws.user_id = auth.uid())`, and it runs before the foreign key is ever looked at —
     * which is why a missing parent reads as 42501 on a real phone and not as 23503.
     */
    const scope = SYNC_TABLE_BY_NAME.get(name)?.scope;
    if (scope?.kind === 'parent') {
      const parentId = row[scope.column];
      if (typeof parentId === 'string' && !table(scope.table).has(parentId)) {
        return {
          code: '42501',
          message: `new row violates row-level security policy for table "${name}"`,
        };
      }
    }

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
      if (payload[column] === undefined || payload[column] === null) {
        return {
          code: '23502',
          message: `null value in column "${column}" of relation "${name}" violates not-null constraint`,
        };
      }
    }

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
          other.id !== row.id &&
          other[unique.parent] === row[unique.parent] &&
          other[unique.index] === row[unique.index],
      );
      if (clash) {
        return {
          code: '23505',
          message: `duplicate key value violates unique constraint "${name}_${unique.index}_unique"`,
        };
      }
    }
    return null;
  };

  const server: FakeServer = {
    now,
    failNextUpsert: false,
    refuse: new Map(),
    calls: [],
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
      server.calls.push({ op: 'upsert', table: name, ids: rows.map((row) => row.id as string) });

      /*
       * What the transport hands back after its own retry: the rows the server would not take,
       * with every other row written.
       *
       * The real statement is all or nothing, and the real transport answers a failed batch by
       * resending it a row at a time. Row by row in the same order reaches the same end state,
       * because Postgres checks a unique index as each row lands rather than once at the end.
       */
      /*
       * One statement, one timestamp.
       *
       * The trigger stamps `now()`, and in Postgres that is the time the transaction began —
       * so every row in a batch carries the same `updated_at`, to the microsecond. This fake
       * used to tick its clock per row, which gave each one a stamp of its own and made paging
       * by timestamp look sound when it was not. Two hundred rows that tie are the normal case,
       * not a coincidence.
       */
      const stamp = now();
      const rejections: RowRejection[] = [];
      for (const row of rows) {
        const previous = table(name).get(row.id as string) ?? {};
        // The real server stamps updated_at by trigger and ignores what the client sent. Modelling
        // that is the point of this fake: it is what makes the two-clock design testable.
        const merged: Row = { ...previous, ...row, updated_at: stamp };

        const why = objection(name, row, merged);
        if (why) {
          rejections.push({ id: row.id as string, ...why });
          continue;
        }
        table(name).set(row.id as string, merged);
      }
      return rejections;
    },


    async patch(name, rows) {
      server.calls.push({ op: 'patch', table: name, ids: rows.map((row) => row.id as string) });
      const rejections: RowRejection[] = [];
      for (const row of rows) {
        // A patch touches only the columns it carries, and a row the server does not have is
        // not an error — PostgREST matches nothing and reports success.
        const previous = table(name).get(row.id as string);
        if (!previous) continue;
        const forced = server.refuse.get(row.id as string);
        if (forced) {
          rejections.push({ id: row.id as string, code: forced, message: `refused with ${forced}` });
          continue;
        }
        table(name).set(row.id as string, { ...previous, ...row, updated_at: now() });
      }
      return rejections;
    },


    async fetchByIds(name, ids) {
      server.calls.push({ op: 'fetchByIds', table: name, ids: [...ids] });
      return ids.flatMap((id) => {
        const row = table(name).get(id);
        return row ? [{ ...row }] : [];
      });
    },


    async changedSince(name, since, limit, afterId = null) {
      const stamp = (row: Row) => Date.parse(row.updated_at as string);
      const from = since === null ? null : Date.parse(since);
      return [...table(name).values()]
        .filter((row) => {
          if (from === null) return true;
          if (stamp(row) > from) return true;
          // The rest of a run of equal timestamps, picked up from where the last page stopped.
          return afterId !== null && stamp(row) === from && (row.id as string) > afterId;
        })
        .sort((a, b) => stamp(a) - stamp(b) || (a.id as string).localeCompare(b.id as string))
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

describe('pulling a reorder into a unique index', () => {
  /*
   * The mirror of the push problem, and the error the phone reached once the push was fixed:
   *
   *   UNIQUE constraint failed: plan_days.plan_id, plan_days.day_index
   *
   * Incoming rows are written one at a time, so a permutation means the first to land wants a
   * position its neighbour has not given up yet. SQLite refuses it and the run dies — leaving
   * the push permanently ahead of the pull.
   */
  const PLAN = 'dddddddd-0000-4000-8000-00000000000a';
  const DAY_A = 'eeeeeeee-0000-4000-8000-00000000000a';
  const DAY_B = 'eeeeeeee-0000-4000-8000-00000000000b';

  async function seedLocalPlan(at: string) {
    await db.run(
      `INSERT INTO plans (id, user_id, name, is_active, created_at, updated_at)
         VALUES (?, ?, 'PPL', 1, ?, ?)`,
      [PLAN, USER, at, at],
    );
    for (const [id, index, name] of [
      [DAY_A, 1, 'Push'],
      [DAY_B, 2, 'Pull'],
    ] as const) {
      await db.run(
        `INSERT INTO plan_days (id, plan_id, day_index, name, updated_at) VALUES (?, ?, ?, ?, ?)`,
        [id, PLAN, index, name, at],
      );
    }
  }

  it('accepts a swap made on another device', async () => {
    const at = '2026-02-01T10:00:00.000Z';
    await seedLocalPlan(at);
    const server = createFakeServer();
    await runSync(db, server, USER, localClock('2026-02-01T11:00:00.000Z'));

    // The other phone swapped them. The server holds the finished arrangement; this device
    // still has the old one, and both rows arrive in the same batch.
    server.seed('plan_days', { id: DAY_A, plan_id: PLAN, day_index: 2, name: 'Push', deleted_at: null });
    server.seed('plan_days', { id: DAY_B, plan_id: PLAN, day_index: 1, name: 'Pull', deleted_at: null });

    await runSync(db, server, USER, localClock('2026-02-01T13:00:00.000Z'));

    const local = await db.all<{ id: string; day_index: number }>(
      `SELECT id, day_index FROM plan_days WHERE plan_id = ? ORDER BY day_index`,
      [PLAN],
    );
    expect(local.map((row) => row.id)).toEqual([DAY_B, DAY_A]);
    expect(local.map((row) => row.day_index)).toEqual([1, 2]);
  });

  it('leaves no row stranded at a negative index', async () => {
    // Parking uses the same -rowid sentinel a soft delete does. A live row left sitting on one
    // would sort ahead of everything and read as the plan having reordered itself.
    const at = '2026-02-01T10:00:00.000Z';
    await seedLocalPlan(at);
    const server = createFakeServer();
    await runSync(db, server, USER, localClock('2026-02-01T11:00:00.000Z'));

    server.seed('plan_days', { id: DAY_A, plan_id: PLAN, day_index: 2, name: 'Push', deleted_at: null });
    server.seed('plan_days', { id: DAY_B, plan_id: PLAN, day_index: 1, name: 'Pull', deleted_at: null });
    await runSync(db, server, USER, localClock('2026-02-01T13:00:00.000Z'));

    const parked = await db.all<{ id: string }>(
      `SELECT id FROM plan_days WHERE day_index < 1 AND deleted_at IS NULL`,
    );
    expect(parked).toEqual([]);
  });
});

/* -------------------------------------------------------------------------- */
/* The repository and the engine together                                      */
/* -------------------------------------------------------------------------- */

/**
 * Everything above writes, by hand, the rows a repository function is *supposed* to leave
 * behind. That is how a real fault got past this file: the test for a removed exercise stamped
 * the survivor with a new `updated_at`, "exactly as `renumberExercises` does" — and
 * `renumberExercises` did no such thing. The test agreed with the comment, the code agreed with
 * neither, and a phone spent an unknown number of days syncing nothing.
 *
 * So these call the functions the screens call.
 */
describe('a workout edited the way the app edits it', () => {
  let counter = 0;
  const newId = () => `f0000000-0000-4000-8000-${String(++counter).padStart(12, '0')}`;
  const at = (time: string) => localClock(`2026-02-01T${time}.000Z`);

  beforeEach(() => {
    counter = 0;
  });

  const liveOnServer = (server: FakeServer, table: string, index: string) =>
    server
      .rows(table)
      .filter((row) => row.deleted_at === null || row.deleted_at === undefined)
      .sort((a, b) => (a[index] as number) - (b[index] as number))
      .map((row) => [row.id, row[index]]);

  it('syncs an exercise added after another one was removed', async () => {
    /*
     * The failure on the phone:
     *
     *   upsert of row a23c5875-… on session_exercises failed: duplicate key value violates
     *   unique constraint "session_exercises_session_order_unique"  (23505)
     *
     * Remove the first of three and the other two move up — on the phone. Unless they are
     * marked as changed the server keeps them where they were, and the exercise added next
     * takes position 3: free here, still occupied there.
     */
    const server = createFakeServer();
    const session = await startSession(db, USER, newId, {}, at('10:00:00'));
    const bench = await addExerciseToSession(db, newId, session, 'Bench Press', at('10:00:01'));
    const row = await addExerciseToSession(db, newId, session, 'Barbell Row', at('10:00:02'));
    const squat = await addExerciseToSession(db, newId, session, 'Squat', at('10:00:03'));
    await runSync(db, server, USER, at('10:05:00'));

    await removeExerciseFromSession(db, bench, at('10:10:00'));
    await runSync(db, server, USER, at('10:15:00'));
    const deadlift = await addExerciseToSession(db, newId, session, 'Deadlift', at('10:20:00'));
    const result = await runSync(db, server, USER, at('10:25:00'));

    expect(result.refused).toEqual([]);
    expect(liveOnServer(server, 'session_exercises', 'order_index')).toEqual([
      [row, 1],
      [squat, 2],
      [deadlift, 3],
    ]);
  });

  it('syncs a set added after another one was removed', async () => {
    const server = createFakeServer();
    const session = await startSession(db, USER, newId, {}, at('10:00:00'));
    const bench = await addExerciseToSession(db, newId, session, 'Bench Press', at('10:00:01'));
    const first = await addSet(db, newId, bench, { weightKg: 60, reps: 8 }, at('10:00:02'));
    const second = await addSet(db, newId, bench, { weightKg: 60, reps: 8 }, at('10:00:03'));
    const third = await addSet(db, newId, bench, { weightKg: 60, reps: 7 }, at('10:00:04'));
    await runSync(db, server, USER, at('10:05:00'));

    await removeSet(db, first, at('10:10:00'));
    await runSync(db, server, USER, at('10:15:00'));
    const fourth = await addSet(db, newId, bench, { weightKg: 60, reps: 6 }, at('10:20:00'));
    const result = await runSync(db, server, USER, at('10:25:00'));

    expect(result.refused).toEqual([]);
    expect(liveOnServer(server, 'sets', 'set_index')).toEqual([
      [second, 1],
      [third, 2],
      [fourth, 3],
    ]);
  });

  it('marks as changed only the rows a removal actually moved', async () => {
    // Removing the last set moves nobody. Stamping the others anyway would send the whole
    // exercise up again every time one row was touched.
    const session = await startSession(db, USER, newId, {}, at('10:00:00'));
    const bench = await addExerciseToSession(db, newId, session, 'Bench Press', at('10:00:01'));
    const first = await addSet(db, newId, bench, { weightKg: 60, reps: 8 }, at('10:00:02'));
    const second = await addSet(db, newId, bench, { weightKg: 60, reps: 8 }, at('10:00:03'));
    const third = await addSet(db, newId, bench, { weightKg: 60, reps: 7 }, at('10:00:04'));

    const live = () =>
      db.all<{ id: string; set_index: number; updated_at: string }>(
        `SELECT id, set_index, updated_at FROM sets WHERE deleted_at IS NULL ORDER BY set_index`,
      );

    await removeSet(db, third, at('10:10:00'));
    expect(await live()).toEqual([
      { id: first, set_index: 1, updated_at: '2026-02-01T10:00:02.000Z' },
      { id: second, set_index: 2, updated_at: '2026-02-01T10:00:03.000Z' },
    ]);

    await removeSet(db, first, at('10:20:00'));
    expect(await live()).toEqual([
      { id: second, set_index: 1, updated_at: '2026-02-01T10:20:00.000Z' },
    ]);
  });

  it('sends a deletion for a row whose own push was never confirmed', async () => {
    /*
     * The row goes up, and the run dies before the pull that would have recorded the fact. The
     * phone has no `remote_updated_at` for it, which used to be read as "the server never had
     * this" — so when the exercise was removed, its deletion was held back for good, and the
     * row lived on in the cloud on the position its replacement was about to need.
     */
    const server = createFakeServer();
    const session = await startSession(db, USER, newId, {}, at('10:00:00'));
    const bench = await addExerciseToSession(db, newId, session, 'Bench Press', at('10:00:01'));

    const dropsDuringPull: SyncTransport = {
      ...server,
      changedSince: async () => {
        throw new Error('Network request failed');
      },
    };
    await expect(runSync(db, dropsDuringPull, USER, at('10:05:00'))).rejects.toThrow();
    expect(liveOnServer(server, 'session_exercises', 'order_index')).toEqual([[bench, 1]]);

    await removeExerciseFromSession(db, bench, at('10:10:00'));
    const curl = await addExerciseToSession(db, newId, session, 'Barbell Curl', at('10:11:00'));
    const result = await runSync(db, server, USER, at('10:15:00'));

    expect(result.refused).toEqual([]);
    expect(liveOnServer(server, 'session_exercises', 'order_index')).toEqual([[curl, 1]]);
    // And the pull that follows does not bring the deleted one back to life here.
    const local = await db.get<{ deleted_at: string | null }>(
      `SELECT deleted_at FROM session_exercises WHERE id = ?`,
      [bench],
    );
    expect(local?.deleted_at).toBe('2026-02-01T10:10:00.000Z');
  });

  it('asks once about a discarded workout instead of deleting it row by row', async () => {
    // Started and thrown away before any sync: a session, two exercises, four sets, and the
    // server has none of them. Nothing to delete, and it should not take seven requests to
    // establish that.
    const server = createFakeServer();
    const session = await startSession(db, USER, newId, {}, at('10:00:00'));
    for (const key of ['Bench Press', 'Barbell Row']) {
      const exercise = await addExerciseToSession(db, newId, session, key, at('10:00:01'));
      await addSet(db, newId, exercise, { weightKg: 60, reps: 8 }, at('10:00:02'));
      await addSet(db, newId, exercise, { weightKg: 60, reps: 8 }, at('10:00:03'));
    }
    await deleteSession(db, USER, session, at('10:01:00'));

    const result = await runSync(db, server, USER, at('10:05:00'));

    expect(result.pushed).toBe(0);
    expect(server.calls.filter((call) => call.op === 'patch')).toEqual([]);
    expect(server.calls.filter((call) => call.op === 'upsert')).toEqual([]);
    expect(server.calls.filter((call) => call.op === 'fetchByIds').map((call) => call.table)).toEqual([
      'workout_sessions',
      'session_exercises',
      'sets',
    ]);
    expect(server.rows('workout_sessions')).toEqual([]);
  });
});

describe('a deleted row the server still keeps on a live position', () => {
  it('is moved out of the way when its deletion is offered again', async () => {
    /*
     * Deletions sent before the tombstone band existed kept their index on the server. The row
     * is deleted there and still occupies position 1 — and the unique constraint does not care
     * that it is deleted.
     */
    const at = '2026-02-01T10:00:00.000Z';
    const sessionId = await seedSession(at);
    const { exerciseId } = await seedExerciseWithSet(sessionId, at);
    const server = createFakeServer();
    await runSync(db, server, USER, localClock('2026-02-01T11:00:00.000Z'));

    const deletedAt = '2026-02-01T12:00:00.000Z';
    await db.run(
      `UPDATE session_exercises SET deleted_at = ?, updated_at = ?, order_index = -rowid WHERE id = ?`,
      [deletedAt, deletedAt, exerciseId],
    );
    // What the old engine left behind: deleted, and still on its real position.
    server.seed('session_exercises', {
      ...server.rows('session_exercises')[0],
      deleted_at: deletedAt,
      order_index: 1,
    });

    await runSync(db, server, USER, localClock('2026-02-01T13:00:00.000Z'));

    expect(server.rows('session_exercises')[0]?.order_index as number).toBeGreaterThan(1_000_000);
  });

  it('is left alone once it is out of the way', async () => {
    const at = '2026-02-01T10:00:00.000Z';
    const sessionId = await seedSession(at);
    const { exerciseId } = await seedExerciseWithSet(sessionId, at);
    const server = createFakeServer();
    await runSync(db, server, USER, localClock('2026-02-01T11:00:00.000Z'));

    const deletedAt = '2026-02-01T12:00:00.000Z';
    await db.run(
      `UPDATE session_exercises SET deleted_at = ?, updated_at = ?, order_index = -rowid WHERE id = ?`,
      [deletedAt, deletedAt, exerciseId],
    );
    await runSync(db, server, USER, localClock('2026-02-01T13:00:00.000Z'));

    // Offered again — as it would be after the repair in migration 18 — with nothing to do.
    await db.run(`UPDATE sync_state SET last_synced_at = NULL`);
    server.calls.length = 0;
    await runSync(db, server, USER, localClock('2026-02-01T14:00:00.000Z'));

    expect(server.calls.filter((call) => call.op === 'patch')).toEqual([]);
  });
});

describe('a row the server refuses', () => {
  const SESSION = 'aaaaaaaa-0000-4000-8000-000000000001';
  const EXERCISE = 'bbbbbbbb-0000-4000-8000-000000000001';
  const SET = 'cccccccc-0000-4000-8000-000000000001';
  const WEIGH_IN = 'dddddddd-0000-4000-8000-000000000001';

  async function seedWorkoutAndWeighIn(at: string) {
    const sessionId = await seedSession(at);
    await seedExerciseWithSet(sessionId, at);
    await db.run(
      `INSERT INTO body_metrics (id, user_id, measured_at, weight_kg, source, updated_at)
         VALUES (?, ?, ?, 80.5, 'manual', ?)`,
      [WEIGH_IN, USER, at, at],
    );
  }

  it('does not stop the rows behind it', async () => {
    /*
     * The whole reason for this section. Tables go up in order, body_metrics last, so a single
     * exercise the server would not take used to mean that no weigh-in reached the cloud
     * either — on that run and on every run after it.
     */
    await seedWorkoutAndWeighIn('2026-02-01T10:00:00.000Z');
    const server = createFakeServer();
    server.refuse.set(EXERCISE, '23514');

    const result = await runSync(db, server, USER, localClock('2026-02-01T11:00:00.000Z'));

    expect(server.rows('workout_sessions').map((row) => row.id)).toEqual([SESSION]);
    expect(server.rows('body_metrics').map((row) => row.id)).toEqual([WEIGH_IN]);
    expect(result.refused.map((row) => [row.table, row.id, row.code])).toEqual([
      ['session_exercises', EXERCISE, '23514'],
    ]);
    // The session and the weigh-in, and not the exercise or the set under it.
    expect(result.pushed).toBe(2);
  });

  it('holds its children back rather than offering them to be refused too', async () => {
    await seedWorkoutAndWeighIn('2026-02-01T10:00:00.000Z');
    const server = createFakeServer();
    server.refuse.set(EXERCISE, '23514');

    const result = await runSync(db, server, USER, localClock('2026-02-01T11:00:00.000Z'));

    expect(server.calls.filter((call) => call.table === 'sets')).toEqual([]);
    // One refusal reported, not one per row that was waiting on it.
    expect(result.refused).toHaveLength(1);
  });

  it('goes up with everything under it once the server will take it', async () => {
    await seedWorkoutAndWeighIn('2026-02-01T10:00:00.000Z');
    const server = createFakeServer();
    server.refuse.set(EXERCISE, '23514');
    await runSync(db, server, USER, localClock('2026-02-01T11:00:00.000Z'));

    server.refuse.clear();
    const retry = await runSync(db, server, USER, localClock('2026-02-01T12:00:00.000Z'));

    expect(retry.refused).toEqual([]);
    expect(server.rows('session_exercises').map((row) => row.id)).toEqual([EXERCISE]);
    expect(server.rows('sets').map((row) => row.id)).toEqual([SET]);
    // Only what was left behind — the session and the weigh-in are not sent a second time.
    expect(retry.pushed).toBe(2);
  });

  it('keeps being offered for as long as it is refused, and nothing else is', async () => {
    await seedWorkoutAndWeighIn('2026-02-01T10:00:00.000Z');
    const server = createFakeServer();
    server.refuse.set(EXERCISE, '23514');
    await runSync(db, server, USER, localClock('2026-02-01T11:00:00.000Z'));
    await runSync(db, server, USER, localClock('2026-02-01T12:00:00.000Z'));

    server.calls.length = 0;
    const third = await runSync(db, server, USER, localClock('2026-02-01T13:00:00.000Z'));

    expect(third.refused.map((row) => row.id)).toEqual([EXERCISE]);
    expect(server.calls.filter((call) => call.op === 'upsert')).toEqual([
      { op: 'upsert', table: 'session_exercises', ids: [EXERCISE] },
    ]);
  });

  it('is not overwritten by the copy the server does have', async () => {
    /*
     * The server holds an older version of the row and refuses the newer one. The pull that
     * follows the push must not conclude that the server's copy is the one to keep: the edit on
     * this device is the only copy of it there is.
     */
    await seedWorkoutAndWeighIn('2026-02-01T10:00:00.000Z');
    const server = createFakeServer();
    await runSync(db, server, USER, localClock('2026-02-01T11:00:00.000Z'));

    await db.run(`UPDATE sets SET reps = 12, updated_at = ? WHERE id = ?`, [
      '2026-02-01T12:00:00.000Z',
      SET,
    ]);
    // Another device touched the same set, so the server's copy is newer than the last one
    // this phone saw — and then the server refuses what this phone sends.
    server.seed('sets', { ...server.rows('sets')[0], reps: 5, updated_at: undefined });
    server.refuse.set(SET, '23514');

    const result = await runSync(db, server, USER, localClock('2026-02-01T13:00:00.000Z'));

    expect(result.refused.map((row) => row.id)).toEqual([SET]);
    const local = await db.get<{ reps: number }>(`SELECT reps FROM sets WHERE id = ?`, [SET]);
    expect(local?.reps).toBe(12);
  });

  it('still stops the run when the failure is not about a row', async () => {
    // No network, an expired session: nothing after it would work either, and nothing may be
    // treated as sent.
    await seedWorkoutAndWeighIn('2026-02-01T10:00:00.000Z');
    const server = createFakeServer();
    server.failNextUpsert = true;

    await expect(runSync(db, server, USER, localClock('2026-02-01T11:00:00.000Z'))).rejects.toThrow();

    const retry = await runSync(db, server, USER, localClock('2026-02-01T12:00:00.000Z'));
    expect(retry.pushed).toBe(4);
  });

  it('is refused for a missing parent the way the real server refuses it', async () => {
    // A child whose session never reached the server. Row-level security answers before the
    // foreign key is looked at, which is why the phone logged 42501 and not 23503.
    const at = '2026-02-01T10:00:00.000Z';
    const sessionId = await seedSession(at);
    await seedExerciseWithSet(sessionId, at);
    await runSync(db, createFakeServer(), USER, localClock('2026-02-01T11:00:00.000Z'));

    // The phone believes the session went up. This server never received it — and only the
    // exercise has changed since, so only the exercise is offered.
    const withoutTheSession = createFakeServer();
    await db.run(`UPDATE session_exercises SET notes = 'slow', updated_at = ? WHERE id = ?`, [
      '2026-02-01T12:00:00.000Z',
      EXERCISE,
    ]);

    const result = await runSync(
      db,
      withoutTheSession,
      USER,
      localClock('2026-02-01T13:00:00.000Z'),
    );

    expect(result.refused.map((row) => [row.table, row.code])).toEqual([
      ['session_exercises', '42501'],
    ]);
  });
});

describe('something left parked by a run that died half way', () => {
  it('does not keep a sibling from being placed', async () => {
    /*
     * A run parks a session's exercises and never gets to the second pass, so on the server
     * they sit at 100001, 100002 and 100003. The phone then swaps the last two. Each now wants
     * to wait on the value the other is still parked on — a clash both ways round, which no
     * amount of retrying the first pass can undo.
     *
     * It does not need undoing. The positions they are actually going to, 2 and 3, are free,
     * and a clash in the parking band must never be taken to mean the row itself was refused.
     */
    const at = '2026-02-01T10:00:00.000Z';
    const sessionId = await seedSession(at);
    const first = 'bbbbbbbb-0000-4000-8000-000000000001';
    const second = 'bbbbbbbb-0000-4000-8000-000000000002';
    const third = 'bbbbbbbb-0000-4000-8000-000000000003';
    for (const [id, index] of [
      [first, 1],
      [second, 2],
      [third, 3],
    ] as const) {
      await db.run(
        `INSERT INTO session_exercises (id, session_id, exercise_key, order_index, updated_at)
           VALUES (?, ?, 'Bench Press', ?, ?)`,
        [id, sessionId, index, at],
      );
    }
    const server = createFakeServer();
    await runSync(db, server, USER, localClock('2026-02-01T11:00:00.000Z'));

    // The state a dead run leaves: everything parked, nothing placed.
    for (const row of server.rows('session_exercises')) {
      server.seed('session_exercises', {
        ...row,
        order_index: (row.order_index as number) + 100_000,
      });
    }

    // Swap the last two on the phone, by way of a spare position: SQLite holds the same
    // unique index the server does.
    await db.run(`UPDATE session_exercises SET order_index = 100, updated_at = ? WHERE id = ?`, [
      '2026-02-01T12:00:00.000Z',
      second,
    ]);
    await db.run(`UPDATE session_exercises SET order_index = 2, updated_at = ? WHERE id = ?`, [
      '2026-02-01T12:00:00.000Z',
      third,
    ]);
    await db.run(`UPDATE session_exercises SET order_index = 3, updated_at = ? WHERE id = ?`, [
      '2026-02-01T12:00:01.000Z',
      second,
    ]);

    const result = await runSync(db, server, USER, localClock('2026-02-01T13:00:00.000Z'));

    expect(result.refused).toEqual([]);
    const placed = server
      .rows('session_exercises')
      .filter((row) => (row.order_index as number) < 100_000)
      .sort((a, b) => (a.order_index as number) - (b.order_index as number))
      .map((row) => [row.id, row.order_index]);
    expect(placed).toEqual([
      [third, 2],
      [second, 3],
    ]);
  });
});

describe('a row edited while the sync was running', () => {
  it('is not put back to what was sent a moment earlier', async () => {
    /*
     * Sync runs when the app comes back to the foreground — which, mid-workout, is the moment
     * someone is about to type. The set goes up with 8 reps, the reps are corrected to 10 while
     * the request is in flight, and the pull hands the 8 straight back. Writing it would undo
     * the correction and mark the row as synced, with nothing left to show it was ever made.
     */
    const at = '2026-02-01T10:00:00.000Z';
    const sessionId = await seedSession(at);
    const { setId } = await seedExerciseWithSet(sessionId, at);
    const server = createFakeServer();

    let typed = false;
    const typesDuringTheRun: SyncTransport = {
      ...server,
      changedSince: async (table, since, limit) => {
        if (!typed) {
          typed = true;
          await db.run(`UPDATE sets SET reps = 10, updated_at = ? WHERE id = ?`, [
            '2026-02-01T11:00:02.000Z',
            setId,
          ]);
        }
        return server.changedSince(table, since, limit);
      },
    };

    await runSync(db, typesDuringTheRun, USER, localClock('2026-02-01T11:00:00.000Z'));

    const local = await db.get<{ reps: number }>(`SELECT reps FROM sets WHERE id = ?`, [setId]);
    expect(local?.reps).toBe(10);

    // And the correction is still on its way: the next run sends it.
    await runSync(db, server, USER, localClock('2026-02-01T11:05:00.000Z'));
    expect(server.rows('sets')[0]?.reps).toBe(10);
  });
});

describe('telling a refused row from a failed request', () => {
  it.each([
    ['23505', 'a position another row holds'],
    ['23503', 'a parent that is not there'],
    ['23502', 'a required value left out'],
    ['23514', 'a check constraint'],
    ['22P02', 'a value the column cannot hold'],
    ['42501', 'row-level security'],
  ])('treats %s (%s) as being about the row', (code) => {
    expect(isRowRefusal(code)).toBe(true);
  });

  it.each([
    ['PGRST301', 'an expired session'],
    ['PGRST204', 'a column the server does not know'],
    ['', 'a request that never got an answer'],
    ['57014', 'a statement that timed out'],
  ])('treats %s (%s) as being about the whole run', (code) => {
    expect(isRowRefusal(code)).toBe(false);
  });

  it('treats a missing code the same way', () => {
    expect(isRowRefusal(null)).toBe(false);
    expect(isRowRefusal(undefined)).toBe(false);
  });
});

describe('the repair: migration 18, then one sync', () => {
  /*
   * A phone and a server that have drifted apart in each of the ways the old code allowed, all
   * at once, in one workout. Nothing on the phone is marked as changed except the newest row —
   * the one the server refuses, and which used to stop everything behind it.
   *
   * The repair is not clever. It forgets how far the push had got, so the next sync offers the
   * server everything, and the engine's ordinary rules do the rest.
   */
  const SESSION = 'aaaaaaaa-0000-4000-8000-000000000001';
  const id = (n: number) => `bbbbbbbb-0000-4000-8000-00000000000${n}`;
  const SYNCED = '2026-02-01T10:00:00.000Z';

  async function driftApart(server: FakeServer) {
    await seedSession(SYNCED);
    // Seven exercises, as first synced.
    for (let n = 1; n <= 7; n++) {
      await db.run(
        `INSERT INTO session_exercises (id, session_id, exercise_key, order_index, updated_at)
           VALUES (?, ?, ?, ?, ?)`,
        [id(n), SESSION, `Exercise ${n}`, n, SYNCED],
      );
    }
    await runSync(db, server, USER, localClock('2026-02-01T11:00:00.000Z'));

    const later = '2026-02-01T12:00:00.000Z';
    const park = (n: number) =>
      db.run(`UPDATE session_exercises SET deleted_at = ?, order_index = -rowid WHERE id = ?`, [
        later,
        id(n),
      ]);

    // 1. Removed here, and the server was told while tombstones still kept their index: it
    //    holds a deleted row on position 1. The pull then wrote that position back over the
    //    sentinel, so the phone has it on a real slot too.
    await park(1);
    server.seed('session_exercises', { ...serverRow(server, id(1)), deleted_at: later });
    await db.run(`UPDATE session_exercises SET order_index = 50 WHERE id = ?`, [id(1)]);

    // 2. Removed here, and the server never told at all: it still has the row alive.
    await park(2);

    // 3. The survivors moved up to close the gaps — and were not marked as changed.
    for (const [n, position] of [
      [3, 1],
      [4, 2],
      [5, 3],
      [6, 4],
      [7, 5],
    ] as const) {
      await db.run(`UPDATE session_exercises SET order_index = ? WHERE id = ?`, [position, id(n)]);
    }

    // 4. A run died between its two passes and left two rows parked on the server.
    for (const n of [3, 4]) {
      const row = serverRow(server, id(n));
      server.seed('session_exercises', { ...row, order_index: (row.order_index as number) + 100_000 });
    }

    // 5. And a new exercise, added at the next free position — free on the phone.
    await db.run(
      `INSERT INTO session_exercises (id, session_id, exercise_key, order_index, updated_at)
         VALUES (?, ?, 'Exercise 8', 6, ?)`,
      [id(8), SESSION, later],
    );
    await db.run(
      `INSERT INTO sets (id, session_exercise_id, set_index, weight_kg, reps, is_warmup, to_failure, completed_at, updated_at)
         VALUES ('cccccccc-0000-4000-8000-000000000008', ?, 1, 40, 10, 0, 0, ?, ?)`,
      [id(8), later, later],
    );
  }

  const serverRow = (server: FakeServer, rowId: string): Row => {
    const row = server.rows('session_exercises').find((candidate) => candidate.id === rowId);
    if (!row) throw new Error(`the server has no ${rowId}`);
    return row;
  };

  const migrate = async (version: number) => {
    for (const statement of (MIGRATIONS[version] ?? '').split(';')) {
      if (statement.trim()) await db.exec(`${statement};`);
    }
  };

  const liveHere = () =>
    db.all<{ id: string; order_index: number }>(
      `SELECT id, order_index FROM session_exercises WHERE deleted_at IS NULL ORDER BY order_index`,
    );

  const liveThere = (server: FakeServer) =>
    server
      .rows('session_exercises')
      .filter((row) => row.deleted_at === null || row.deleted_at === undefined)
      .map((row) => ({ id: row.id, order_index: row.order_index }))
      .sort((a, b) => (a.order_index as number) - (b.order_index as number));

  it('is the state the old code could not get out of', async () => {
    // Without the repair the new exercise is refused: position 6 is where the server still
    // has one of the rows that moved. The engine now reports that instead of stopping — which
    // is better, and not enough, because nothing would ever send the rows in its way.
    const server = createFakeServer();
    await driftApart(server);

    const result = await runSync(db, server, USER, localClock('2026-02-01T13:00:00.000Z'));

    expect(result.refused.map((row) => [row.id, row.code])).toEqual([[id(8), '23505']]);
  });

  it('brings the server into line with the phone, with nothing refused', async () => {
    const server = createFakeServer();
    await driftApart(server);
    const before = await liveHere();

    await migrate(18);
    const result = await runSync(db, server, USER, localClock('2026-02-01T13:00:00.000Z'));

    expect(result.refused).toEqual([]);
    expect(liveThere(server)).toEqual(before);
    // The set under the new exercise, which had been waiting behind it.
    expect(server.rows('sets').map((row) => row.session_exercise_id)).toContain(id(8));
  });

  it('changes nothing on the phone that the user would see', async () => {
    const server = createFakeServer();
    await driftApart(server);
    const before = await liveHere();

    await migrate(18);
    await runSync(db, server, USER, localClock('2026-02-01T13:00:00.000Z'));

    expect(await liveHere()).toEqual(before);
    const deleted = await db.all<{ id: string }>(
      `SELECT id FROM session_exercises WHERE deleted_at IS NOT NULL ORDER BY id`,
    );
    expect(deleted.map((row) => row.id)).toEqual([id(1), id(2)]);
  });

  it('leaves no deleted row on the server holding a position a live one could want', async () => {
    const server = createFakeServer();
    await driftApart(server);

    await migrate(18);
    await runSync(db, server, USER, localClock('2026-02-01T13:00:00.000Z'));

    const tombstones = server
      .rows('session_exercises')
      .filter((row) => row.deleted_at !== null && row.deleted_at !== undefined);
    expect(tombstones.map((row) => row.id).sort()).toEqual([id(1), id(2)]);
    for (const row of tombstones) expect(row.order_index as number).toBeGreaterThan(1_000_000);
  });

  it('settles: the sync after that has nothing left to send', async () => {
    const server = createFakeServer();
    await driftApart(server);
    await migrate(18);
    await runSync(db, server, USER, localClock('2026-02-01T13:00:00.000Z'));

    const next = await runSync(db, server, USER, localClock('2026-02-01T14:00:00.000Z'));

    expect(next.pushed).toBe(0);
    expect(next.refused).toEqual([]);
  });
});

describe('a new phone signing in to an account with history', () => {
  /*
   * The pull pages through each table two hundred rows at a time, in order of `updated_at`.
   * Rows written by one request share one timestamp — so a page can end part way through a
   * group of rows that tie, and "everything after the last timestamp I saw" then steps over
   * the rest of that group. Nothing fails. The new phone is simply missing some sets, and has
   * no way to know.
   */
  const SESSION = 'aaaaaaaa-0000-4000-8000-000000000001';
  const EXERCISE = 'bbbbbbbb-0000-4000-8000-000000000001';
  const setId = (n: number) => `cccccccc-0000-4000-8000-${String(n).padStart(12, '0')}`;

  async function logSets(from: number, to: number, at: string) {
    for (let n = from; n <= to; n++) {
      await db.run(
        `INSERT INTO sets (id, session_exercise_id, set_index, weight_kg, reps, is_warmup, to_failure, completed_at, updated_at)
           VALUES (?, ?, ?, 60, 8, 0, 0, ?, ?)`,
        [setId(n), EXERCISE, n, at, at],
      );
    }
  }

  it('receives every row, wherever the page boundaries fall', async () => {
    const server = createFakeServer();
    await seedSession('2026-02-01T10:00:00.000Z');
    await db.run(
      `INSERT INTO session_exercises (id, session_id, exercise_key, order_index, updated_at)
         VALUES (?, ?, 'Bench Press', 1, ?)`,
      [EXERCISE, SESSION, '2026-02-01T10:00:00.000Z'],
    );
    // Two syncs, 150 sets each: two groups of rows that tie. The first page of 200 takes all
    // of the first group and 50 of the second.
    await logSets(1, 150, '2026-02-01T10:00:00.000Z');
    await runSync(db, server, USER, localClock('2026-02-01T11:00:00.000Z'));
    await logSets(151, 300, '2026-02-01T12:00:00.000Z');
    await runSync(db, server, USER, localClock('2026-02-01T13:00:00.000Z'));
    expect(server.rows('sets')).toHaveLength(300);

    const newPhone = createTestExecutor();
    const result = await runSync(newPhone, server, USER, localClock('2026-02-02T09:00:00.000Z'));

    const arrived = await newPhone.get<{ n: number }>(`SELECT COUNT(*) AS n FROM sets`);
    expect(arrived?.n).toBe(300);
    expect(result.pulled).toBe(302);
    newPhone.close();
  });

  it('receives every row when more of them tie than fit on one page', async () => {
    // A first sync of a long history: 450 sets, sent 200 at a time.
    const server = createFakeServer();
    await seedSession('2026-02-01T10:00:00.000Z');
    await db.run(
      `INSERT INTO session_exercises (id, session_id, exercise_key, order_index, updated_at)
         VALUES (?, ?, 'Bench Press', 1, ?)`,
      [EXERCISE, SESSION, '2026-02-01T10:00:00.000Z'],
    );
    await logSets(1, 450, '2026-02-01T10:00:00.000Z');
    await runSync(db, server, USER, localClock('2026-02-01T11:00:00.000Z'));
    // And then a long one more, so the groups no longer line up with the pages.
    await logSets(451, 620, '2026-02-01T12:00:00.000Z');
    await runSync(db, server, USER, localClock('2026-02-01T13:00:00.000Z'));

    const newPhone = createTestExecutor();
    await runSync(newPhone, server, USER, localClock('2026-02-02T09:00:00.000Z'));

    const arrived = await newPhone.get<{ n: number }>(`SELECT COUNT(*) AS n FROM sets`);
    expect(arrived?.n).toBe(620);
    newPhone.close();
  });
});

describe('a row arriving on a position this device has already given to another', () => {
  /*
   * A workout with one exercise, on both sides. Somebody else — a coach, a second phone — adds
   * an exercise to it, and so does this phone, offline. Each asks for position 2.
   *
   * The server refuses this phone's row, since the other got there first. That is handled. What
   * was not: the pull then brings the other row down onto position 2, where this phone's own
   * unsent exercise is sitting, and SQLite refuses it. The run used to die there, on every
   * attempt, with a row it could neither send nor make room for.
   */
  const PLAN = 'dddddddd-0000-4000-8000-00000000000a';
  const DAY = 'eeeeeeee-0000-4000-8000-00000000000a';
  const FIRST = 'ffffffff-0000-4000-8000-000000000001';
  const MINE = 'ffffffff-0000-4000-8000-000000000002';
  const THEIRS = 'ffffffff-0000-4000-8000-000000000003';

  async function workoutOnBothSides(server: FakeServer) {
    const at = '2026-02-01T10:00:00.000Z';
    await db.run(
      `INSERT INTO plans (id, user_id, name, is_active, created_at, updated_at)
         VALUES (?, ?, 'Gym', 1, ?, ?)`,
      [PLAN, USER, at, at],
    );
    await db.run(
      `INSERT INTO plan_days (id, plan_id, day_index, name, updated_at) VALUES (?, ?, 1, 'Push', ?)`,
      [DAY, PLAN, at],
    );
    await db.run(
      `INSERT INTO plan_day_exercises (id, plan_day_id, exercise_key, order_index, updated_at)
         VALUES (?, ?, 'Bench Press', 1, ?)`,
      [FIRST, DAY, at],
    );
    await runSync(db, server, USER, localClock('2026-02-01T11:00:00.000Z'));

    // Theirs reaches the server; mine exists only here.
    server.seed('plan_day_exercises', {
      id: THEIRS,
      plan_day_id: DAY,
      exercise_key: 'Overhead Press',
      order_index: 2,
      deleted_at: null,
    });
    await db.run(
      `INSERT INTO plan_day_exercises (id, plan_day_id, exercise_key, order_index, updated_at)
         VALUES (?, ?, 'Barbell Row', 2, ?)`,
      [MINE, DAY, '2026-02-01T12:00:00.000Z'],
    );
  }

  const here = () =>
    db.all<{ id: string; order_index: number }>(
      `SELECT id, order_index FROM plan_day_exercises
        WHERE plan_day_id = ? AND deleted_at IS NULL ORDER BY order_index`,
      [DAY],
    );

  it('does not end the run', async () => {
    const server = createFakeServer();
    await workoutOnBothSides(server);

    await expect(
      runSync(db, server, USER, localClock('2026-02-01T13:00:00.000Z')),
    ).resolves.toBeDefined();
  });

  it('keeps both exercises, with the unsent one after the one already agreed', async () => {
    const server = createFakeServer();
    await workoutOnBothSides(server);

    await runSync(db, server, USER, localClock('2026-02-01T13:00:00.000Z'));

    expect(await here()).toEqual([
      { id: FIRST, order_index: 1 },
      { id: THEIRS, order_index: 2 },
      { id: MINE, order_index: 3 },
    ]);
  });

  it('sends the moved exercise on the next run, to a position the server now accepts', async () => {
    const server = createFakeServer();
    await workoutOnBothSides(server);
    await runSync(db, server, USER, localClock('2026-02-01T13:00:00.000Z'));

    const next = await runSync(db, server, USER, localClock('2026-02-01T14:00:00.000Z'));

    expect(next.refused).toEqual([]);
    const there = server
      .rows('plan_day_exercises')
      .map((row) => [row.id, row.order_index])
      .sort((a, b) => (a[1] as number) - (b[1] as number));
    expect(there).toEqual([
      [FIRST, 1],
      [THEIRS, 2],
      [MINE, 3],
    ]);
  });

  it('then settles', async () => {
    const server = createFakeServer();
    await workoutOnBothSides(server);
    await runSync(db, server, USER, localClock('2026-02-01T13:00:00.000Z'));
    await runSync(db, server, USER, localClock('2026-02-01T14:00:00.000Z'));

    const third = await runSync(db, server, USER, localClock('2026-02-01T15:00:00.000Z'));

    expect(third.pushed).toBe(0);
    expect(third.refused).toEqual([]);
    expect(await here()).toHaveLength(3);
  });
});
