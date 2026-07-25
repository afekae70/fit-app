/**
 * Signs real JWTs against a test secret rather than mocking `jwtVerify`, so these tests
 * exercise the actual verification path — including the failure modes that matter for
 * security (wrong secret, expired token, anon-role token) rather than a mock that always
 * agrees with the code under test.
 */

import Fastify from 'fastify';
import { SignJWT } from 'jose';
import { beforeAll, describe, expect, it } from 'vitest';

import authPlugin from './auth.js';

const TEST_SECRET = 'test-jwt-secret-at-least-32-bytes-long';
const secretKey = new TextEncoder().encode(TEST_SECRET);

async function signToken(claims: Record<string, unknown>, expiresIn = '1h') {
  return new SignJWT(claims)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(expiresIn)
    .sign(secretKey);
}

async function buildTestApp() {
  const app = Fastify({ logger: false });
  await app.register(authPlugin, { jwtSecret: TEST_SECRET });
  app.get('/protected', { preHandler: app.authenticate }, async (request) => ({
    userId: request.userId,
  }));
  await app.ready();
  return app;
}

describe('auth plugin', () => {
  let app: Awaited<ReturnType<typeof buildTestApp>>;

  beforeAll(async () => {
    app = await buildTestApp();
  });

  it('rejects a request with no Authorization header', async () => {
    const res = await app.inject({ method: 'GET', url: '/protected' });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({ error: 'unauthorized' });
  });

  it('rejects a header that is not the Bearer scheme', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/protected',
      headers: { authorization: 'Basic dXNlcjpwYXNz' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('accepts a validly signed token and attaches userId from the sub claim', async () => {
    const token = await signToken({ sub: 'user-abc-123', role: 'authenticated' });
    const res = await app.inject({
      method: 'GET',
      url: '/protected',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ userId: 'user-abc-123' });
  });

  it('rejects a token signed with a different secret', async () => {
    const wrongKey = new TextEncoder().encode('a-completely-different-secret-value');
    const token = await new SignJWT({ sub: 'user-abc-123', role: 'authenticated' })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(wrongKey);

    const res = await app.inject({
      method: 'GET',
      url: '/protected',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(401);
  });

  it('rejects an expired token with a specific message', async () => {
    const token = await signToken({ sub: 'user-abc-123', role: 'authenticated' }, '-1s');
    const res = await app.inject({
      method: 'GET',
      url: '/protected',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({ message: 'Token expired' });
  });

  it('rejects a token whose role is "anon" rather than "authenticated"', async () => {
    // A client accidentally forwarding the Supabase anon key as a bearer token must not
    // be treated as an authenticated user — it carries no user identity at all.
    const token = await signToken({ sub: 'anon', role: 'anon' });
    const res = await app.inject({
      method: 'GET',
      url: '/protected',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(401);
  });

  it('rejects a token with no sub claim', async () => {
    const token = await signToken({ role: 'authenticated' });
    const res = await app.inject({
      method: 'GET',
      url: '/protected',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(401);
  });

  it('rejects garbage in the Authorization header without throwing an unhandled error', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/protected',
      headers: { authorization: 'Bearer not-a-real-jwt' },
    });
    expect(res.statusCode).toBe(401);
  });
});
