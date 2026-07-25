/**
 * Drizzle database client.
 *
 * Two connection modes matter with Supabase:
 *  - The app should use the *pooler* (pgBouncer, port 6543) with `prepare: false`, because
 *    pgBouncer in transaction mode does not support prepared statements.
 *  - Migrations and seeds must use the *direct* connection (port 5432); DDL through the
 *    pooler is unreliable.
 *
 * Passing the wrong URL surfaces as confusing intermittent errors rather than a clear failure,
 * so `createDb` takes the mode explicitly instead of guessing.
 */

import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import * as schema from './schema.js';

export type DbMode = 'pooled' | 'direct';

export interface CreateDbOptions {
  url: string;
  mode?: DbMode;
  max?: number;
}

export function createDb({ url, mode = 'pooled', max }: CreateDbOptions) {
  if (!url) {
    throw new Error(
      'DATABASE_URL is empty. Set the Supabase pooler URL for the app, or the direct ' +
        'connection URL for migrations and seeds.',
    );
  }

  const client = postgres(url, {
    // pgBouncer transaction mode cannot hold prepared statements across a pooled connection.
    prepare: mode !== 'pooled',
    max: max ?? (mode === 'pooled' ? 10 : 1),
  });

  return { db: drizzle(client, { schema }), client };
}

export type Database = ReturnType<typeof createDb>['db'];
