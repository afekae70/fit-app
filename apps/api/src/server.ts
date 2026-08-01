/**
 * Process entry point: read env, build the app, listen, and shut down cleanly on signal.
 * All actual wiring lives in app.ts, which is what tests exercise instead of this file.
 */

// Loads apps/api/.env into process.env — local-dev-only. A real deployment (Railway/Fly/etc.)
// injects env vars directly and has no .env file to find, so this is a harmless no-op there.
import 'dotenv/config';

import { buildApp } from './app.js';
import { EnvValidationError, loadEnv } from './config/env.js';

async function main(): Promise<void> {
  let env;
  try {
    env = loadEnv();
  } catch (error) {
    if (error instanceof EnvValidationError) {
      // Fails before binding a port — a misconfigured deploy should never come up half-
      // working and fail requests one at a time instead.
      console.error(error.message);
      process.exit(1);
    }
    throw error;
  }

  const app = await buildApp({ env });

  const shutdown = (signal: string) => {
    app.log.info({ signal }, 'received shutdown signal');
    app
      .close()
      .then(() => process.exit(0))
      .catch((error: unknown) => {
        app.log.error(error, 'error during shutdown');
        process.exit(1);
      });
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  try {
    await app.listen({ port: env.PORT, host: '0.0.0.0' });
  } catch (error) {
    app.log.error(error);
    process.exit(1);
  }
}

void main();
