/**
 * Shared test executor: real SQL against a real SQLite engine (`node:sqlite`), not a mock.
 * expo-sqlite is a native module and cannot load under vitest, which is exactly why the
 * repository is written against the `SqlExecutor` seam — this wraps `node:sqlite` in the same
 * interface expo-sqlite is wrapped in on device (see `db/provider.ts`).
 */

import { createRequire } from 'node:module';

// Loaded through createRequire rather than a static import: Vite's import analysis does not yet
// recognise `node:sqlite` (new in Node 22) and rewrites it to a bare "sqlite" specifier, which
// then fails to resolve. createRequire hands the specifier straight to Node.
const nodeRequire = createRequire(import.meta.url);
const { DatabaseSync } = nodeRequire('node:sqlite') as {
  DatabaseSync: new (path: string) => {
    exec(sql: string): void;
    prepare(sql: string): {
      run(...params: never[]): unknown;
      all(...params: never[]): unknown[];
      get(...params: never[]): unknown;
    };
    close(): void;
  };
};

import type { SqlExecutor } from './executor.js';
import { CREATE_SCHEMA_SQL } from './schema.js';

export function createTestExecutor(): SqlExecutor & { close: () => void } {
  const db = new DatabaseSync(':memory:');
  // WAL is meaningless for :memory: and node:sqlite rejects the pragma statement form used on
  // device, so strip it here. Foreign keys matter and are kept.
  db.exec(CREATE_SCHEMA_SQL.replace(/PRAGMA journal_mode = WAL;/, ''));
  db.exec('PRAGMA foreign_keys = ON;');

  return {
     
    async run(sql, params = []) {
      db.prepare(sql).run(...(params as never[]));
    },
     
    async all<T>(sql: string, params: unknown[] = []) {
      return db.prepare(sql).all(...(params as never[])) as T[];
    },
     
    async get<T>(sql: string, params: unknown[] = []) {
      return (db.prepare(sql).get(...(params as never[])) ?? null) as T | null;
    },
     
    async exec(sql) {
      db.exec(sql);
    },
    close: () => db.close(),
  };
}
