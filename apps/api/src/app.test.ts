/**
 * End-to-end test of the assembled app via `.inject()` — no real port, no real Supabase
 * project. DATABASE_URL points at an address nothing is listening on; this must not matter,
 * because postgres.js connects lazily and neither route below issues a query.
 */

import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair } from 'jose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildApp } from './app.js';
import type { Env } from './config/env.js';

const KID = 'app-test-key-1';

const testEnv: Env = {
  NODE_ENV: 'test',
  PORT: 0,
  LOG_LEVEL: 'fatal',
  SUPABASE_URL: 'https://test-project.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'service-role-key-placeholder-value',
  // Deliberately unreachable — proves no route on the health/auth path needs a live DB.
  DATABASE_URL: 'postgresql://user:pass@127.0.0.1:1/nonexistent',
  AI_PROVIDER: 'claude',
  ANTHROPIC_API_KEY: 'sk-ant-test-placeholder',
  ANTHROPIC_MODEL: 'claude-opus-5',
  OPENAI_MODEL: 'gpt-4o',
  GEMINI_MODEL: 'gemini-2.5-flash',
};

describe('buildApp', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  let signToken: (claims: Record<string, unknown>) => Promise<string>;

  beforeAll(async () => {
    // Injects a local JWKS (see auth.test.ts) instead of letting buildApp construct a
    // `createRemoteJWKSet` against the fake SUPABASE_URL above, which would try a real fetch.
    const { publicKey, privateKey } = await generateKeyPair('ES256', { extractable: true });
    const publicJwk = await exportJWK(publicKey);
    const jwks = createLocalJWKSet({ keys: [{ ...publicJwk, kid: KID, alg: 'ES256' }] });
    signToken = (claims) =>
      new SignJWT(claims)
        .setProtectedHeader({ alg: 'ES256', kid: KID })
        .setIssuedAt()
        .setExpirationTime('1h')
        .sign(privateKey);

    app = await buildApp({ env: testEnv, jwks });
  });

  afterAll(async () => {
    await app.close();
  });

  it('answers /health without authentication and without touching the database', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: 'ok' });
  });

  it('rejects /health/me without a token', async () => {
    const res = await app.inject({ method: 'GET', url: '/health/me' });
    expect(res.statusCode).toBe(401);
  });

  it('accepts /health/me with a valid token and echoes the user id', async () => {
    const token = await signToken({ sub: 'user-e2e-test', role: 'authenticated' });

    const res = await app.inject({
      method: 'GET',
      url: '/health/me',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ userId: 'user-e2e-test' });
  });

  it('exposes the AI provider selected by AI_PROVIDER on the app instance', () => {
    expect(app.coachProvider.name).toBe('claude');
  });

  it('rejects /coach/chat without a token', async () => {
    // The route that actually spends money on every call must never be reachable by an
    // anonymous caller who merely has the deployed URL.
    const res = await app.inject({
      method: 'POST',
      url: '/coach/chat',
      payload: { context: {}, messages: [] },
    });
    expect(res.statusCode).toBe(401);
  });

  it('rejects /coach/chat with a valid token but a malformed body, before touching the provider', async () => {
    const token = await signToken({ sub: 'user-e2e-test', role: 'authenticated' });

    const res = await app.inject({
      method: 'POST',
      url: '/coach/chat',
      headers: { authorization: `Bearer ${token}` },
      payload: { context: {}, messages: [] },
    });
    // Confirms auth passed (not 401) and validation caught the malformed context (not 500) —
    // together they pin that authenticate runs before the body schema check, in that order.
    expect(res.statusCode).toBe(400);
  });

  it('exposes a db handle without having connected to it', () => {
    expect(app.db).toBeDefined();
  });
});
