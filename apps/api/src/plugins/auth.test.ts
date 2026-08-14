/**
 * Signs real JWTs against a local key pair rather than mocking `jwtVerify`, so these tests
 * exercise the actual verification path — including the failure modes that matter for
 * security (wrong key, expired token, anon-role token) rather than a mock that always agrees
 * with the code under test. `createLocalJWKSet` stands in for `createRemoteJWKSet` — same
 * verification code path, no network fetch.
 *
 * ES256, matching how this project's real Supabase instance signs access tokens (confirmed by
 * fetching its JWKS endpoint) — not HS256, which the auth plugin used to assume incorrectly.
 */

import Fastify from 'fastify';
import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair } from 'jose';
import { beforeAll, describe, expect, it } from 'vitest';

import authPlugin from './auth.js';

const KID = 'test-key-1';

async function buildTestApp() {
  const { publicKey, privateKey } = await generateKeyPair('ES256', { extractable: true });
  const publicJwk = await exportJWK(publicKey);
  const jwks = createLocalJWKSet({ keys: [{ ...publicJwk, kid: KID, alg: 'ES256' }] });

  async function signToken(claims: Record<string, unknown>, expiresIn = '1h') {
    return new SignJWT(claims)
      .setProtectedHeader({ alg: 'ES256', kid: KID })
      .setIssuedAt()
      .setExpirationTime(expiresIn)
      .sign(privateKey);
  }

  const app = Fastify({ logger: false });
  await app.register(authPlugin, { jwks });
  app.get('/protected', { preHandler: app.authenticate }, async (request) => ({
    userId: request.userId,
  }));
  await app.ready();
  return { app, signToken };
}

describe('auth plugin', () => {
  let app: Awaited<ReturnType<typeof buildTestApp>>['app'];
  let signToken: Awaited<ReturnType<typeof buildTestApp>>['signToken'];

  beforeAll(async () => {
    ({ app, signToken } = await buildTestApp());
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

  it('rejects a token signed with a different key', async () => {
    const { privateKey: wrongKey } = await generateKeyPair('ES256');
    const token = await new SignJWT({ sub: 'user-abc-123', role: 'authenticated' })
      .setProtectedHeader({ alg: 'ES256', kid: KID })
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
