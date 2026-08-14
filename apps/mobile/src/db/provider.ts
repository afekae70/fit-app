/**
 * App-side wiring: the concrete expo-sqlite executor plus id and clock factories.
 *
 * This is the only module that knows about expo-sqlite. Keeping it out of executor.ts and
 * workouts.ts is what lets the repository — and the set-numbering logic in particular — run
 * under vitest against Node's built-in SQLite.
 */

import * as Crypto from 'expo-crypto';
import type { SQLiteDatabase, SQLiteBindParams } from 'expo-sqlite';

import type { SqlExecutor } from './executor.js';
import { getDb } from './index.js';

/** Adapt expo-sqlite's API to the executor interface the repository is written against. */
export function createExpoExecutor(db: SQLiteDatabase): SqlExecutor {
  return {
    async run(sql, params = []) {
      await db.runAsync(sql, params as SQLiteBindParams);
    },
    async all<T>(sql: string, params: unknown[] = []) {
      // The assertion is redundant to the compiler only because getAllAsync is typed `any[]`,
      // and `any[]` goes into `T[]` unchallenged. Deleting it (which is what
      // no-unnecessary-type-assertion will suggest) leaves `T` unused and this seam silently
      // untyped -- the rule is measuring the cast against a lie it was handed.
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
      return (await db.getAllAsync(sql, params as SQLiteBindParams)) as T[];
    },
    async get<T>(sql: string, params: unknown[] = []) {
      return ((await db.getFirstAsync(sql, params as SQLiteBindParams)) ?? null) as T | null;
    },
    async exec(sql) {
      await db.execAsync(sql);
    },
  };
}

let executorPromise: Promise<SqlExecutor> | null = null;

export function getExecutor(): Promise<SqlExecutor> {
  executorPromise ??= getDb().then(createExpoExecutor);
  return executorPromise;
}

/**
 * Client-generated row ids.
 *
 * Generated on device rather than by the server, because rows must exist and be referenceable
 * while offline — a set logged in a basement gym cannot wait for a round-trip to get an id.
 * UUIDv4 makes collisions a non-issue when the outbox eventually syncs from several devices.
 */
export const newId = (): string => Crypto.randomUUID();

export const now = (): string => new Date().toISOString();
