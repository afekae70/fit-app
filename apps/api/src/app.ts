/**
 * Builds a Fastify instance without starting it.
 *
 * Split from server.ts so tests can construct the app and use `.inject()` against it
 * without binding a real port — and so `server.ts` stays a thin entry point responsible
 * only for reading env, listening, and handling shutdown signals.
 */

import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyInstance } from 'fastify';

import { createCoachProvider } from './ai/factory.js';
import type { CoachProvider } from './ai/provider.js';
import type { Env } from './config/env.js';
import { createDb, type Database } from './db/client.js';
import authPlugin from './plugins/auth.js';
import coachRoutes from './routes/coach.js';
import healthRoutes from './routes/health.js';

declare module 'fastify' {
  interface FastifyInstance {
    db: Database;
    coachProvider: CoachProvider;
  }
}

export interface BuildAppOptions {
  env: Env;
}

export async function buildApp({ env }: BuildAppOptions): Promise<FastifyInstance> {
  const app = Fastify({
    logger: { level: env.LOG_LEVEL },
  });

  await app.register(cors, {
    // Mobile clients don't enforce CORS at all — this only matters for browser-based
    // tooling during development (Expo web, an eventual admin dashboard).
    origin: env.NODE_ENV !== 'production',
  });

  await app.register(rateLimit, {
    max: 100,
    timeWindow: '1 minute',
  });

  await app.register(authPlugin, { jwtSecret: env.SUPABASE_JWT_SECRET });

  // postgres.js connects lazily — this does not open a socket until the first query, so
  // buildApp() succeeds even when nothing is listening at DATABASE_URL yet (as in tests).
  const { db, client } = createDb({ url: env.DATABASE_URL, mode: 'pooled' });
  app.decorate('db', db);
  app.addHook('onClose', async () => {
    await client.end();
  });

  app.decorate('coachProvider', createCoachProvider(env));

  await app.register(healthRoutes);
  await app.register(coachRoutes);

  return app;
}
