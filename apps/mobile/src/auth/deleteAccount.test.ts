/**
 * Deleting an account, with the one property that matters most checked first: the phone gives up
 * nothing until the server has said the account is gone.
 *
 * The database is real. The server is a stand-in that answers the way Supabase does.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { SqlExecutor } from '../db/executor.js';
import { createTestExecutor } from '../db/testUtils.js';
import { deleteAccount, interpretDeletionError, type DeletionClient } from './deleteAccount.js';

const USER = 'user-1';
const NOW = '2026-10-08T10:00:00.000Z';

let db: SqlExecutor & { close: () => void };

beforeEach(async () => {
  db = createTestExecutor();
  await db.run(`INSERT INTO profile (user_id, updated_at) VALUES (?, ?)`, [USER, NOW]);
  await db.run(
    `INSERT INTO workout_sessions (id, user_id, started_at, created_at) VALUES ('s1', ?, ?, ?)`,
    [USER, NOW, NOW],
  );
});

afterEach(() => {
  db.close();
});

/** A server that answers `rpc` with the given error, and records what it was asked. */
function server(error: { code?: string; message?: string } | null | 'throws') {
  const calls: string[] = [];
  const client: DeletionClient = {
    rpc: async (fn) => {
      calls.push(`rpc:${fn}`);
      if (error === 'throws') throw new TypeError('Network request failed');
      return { error };
    },
    auth: {
      signOut: async (options) => {
        calls.push(`signOut:${options.scope}`);
      },
    },
  };
  return { client, calls };
}

async function localRows(): Promise<number> {
  const row = await db.get<{ n: number }>(
    `SELECT (SELECT COUNT(*) FROM profile) + (SELECT COUNT(*) FROM workout_sessions) AS n`,
  );
  return row?.n ?? 0;
}

describe('deleteAccount', () => {
  it('deletes on the server, then the device, then signs out locally', async () => {
    const { client, calls } = server(null);
    const cleared: string[] = [];

    const outcome = await deleteAccount({
      client,
      db,
      userId: USER,
      clearDeviceState: async (userId) => {
        cleared.push(userId);
      },
    });

    expect(outcome).toEqual({ status: 'deleted' });
    expect(calls).toEqual(['rpc:delete_my_account', 'signOut:local']);
    expect(cleared).toEqual([USER]);
    expect(await localRows()).toBe(0);
  });

  it('touches nothing on the phone when the server refuses', async () => {
    // The state to avoid at all costs: an account still on the server, and a phone that has
    // thrown away both the data and the session that could have asked again.
    const { client, calls } = server({ code: '42501', message: 'permission denied' });

    const outcome = await deleteAccount({ client, db, userId: USER });

    expect(outcome).toEqual({ status: 'failed', message: 'permission denied' });
    expect(calls).toEqual(['rpc:delete_my_account']);
    expect(await localRows()).toBe(2);
  });

  it('touches nothing on the phone when the request never arrives', async () => {
    const { client, calls } = server('throws');

    const outcome = await deleteAccount({ client, db, userId: USER });

    expect(outcome).toEqual({ status: 'offline' });
    expect(calls).toEqual(['rpc:delete_my_account']);
    expect(await localRows()).toBe(2);
  });

  it('still reports a deletion that happened, even if cleaning up after it fails', async () => {
    // The account is gone by then. Saying "failed" would be untrue, and would send someone
    // back to delete an account that no longer exists.
    const { client } = server(null);

    const outcome = await deleteAccount({
      client,
      db,
      userId: USER,
      clearDeviceState: async () => {
        throw new Error('disk');
      },
    });

    expect(outcome).toEqual({ status: 'deleted' });
    expect(await localRows()).toBe(0);
  });
});

describe('interpretDeletionError', () => {
  it('knows a server that has not been given the function yet', () => {
    expect(
      interpretDeletionError({
        code: 'PGRST202',
        message: 'Could not find the function public.delete_my_account in the schema cache',
      }),
    ).toEqual({ status: 'not_available' });
  });

  it('knows a session that is no longer one', () => {
    expect(interpretDeletionError({ code: '28000', message: 'Not signed in' })).toEqual({
      status: 'not_signed_in',
    });
    expect(interpretDeletionError({ code: 'PGRST301', message: 'JWT expired' })).toEqual({
      status: 'not_signed_in',
    });
  });

  it('knows a request that got no answer', () => {
    expect(interpretDeletionError({ message: 'TypeError: Network request failed' })).toEqual({
      status: 'offline',
    });
  });

  it('passes anything else on as it was said', () => {
    expect(interpretDeletionError({ code: 'P0001', message: 'something else' })).toEqual({
      status: 'failed',
      message: 'something else',
    });
  });

  it('does not mistake a database error that mentions a network for being offline', () => {
    // Offline is "no code at all". A Postgres error has one, whatever its text says.
    expect(interpretDeletionError({ code: '08006', message: 'network connection failure' })).toEqual({
      status: 'failed',
      message: 'network connection failure',
    });
  });
});
