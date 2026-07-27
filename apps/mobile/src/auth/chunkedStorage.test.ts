/**
 * The failure mode this guards against is silent: a session just over the chunk boundary
 * persists, reloads as corrupt JSON, and the user is signed out with no error pointing at why.
 */

import { describe, expect, it } from 'vitest';

import { chunkKeys, joinChunks, metaKey, splitIntoChunks } from './chunkedStorage.js';

describe('splitIntoChunks / joinChunks round-trip', () => {
  it('round-trips a short value as a single chunk', () => {
    const { chunks, count } = splitIntoChunks('hello');
    expect(count).toBe(1);
    expect(joinChunks(chunks)).toBe('hello');
  });

  it('round-trips an empty string without losing it to "no chunks"', () => {
    // An empty session value and a missing key must be distinguishable — collapsing both to
    // zero chunks would make "signed out" and "signed in with an empty token" look identical.
    const { chunks, count } = splitIntoChunks('');
    expect(count).toBe(1);
    expect(joinChunks(chunks)).toBe('');
  });

  it('splits a value larger than the SecureStore Android limit', () => {
    // 2048 bytes is where SecureStore.setItemAsync throws on Android; a real Supabase session
    // (access token + refresh token + user object) routinely exceeds it.
    const big = 'x'.repeat(5000);
    const { chunks, count } = splitIntoChunks(big);
    expect(count).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(1800);
    }
    expect(joinChunks(chunks)).toBe(big);
  });

  it('round-trips a realistic Supabase-session-shaped JSON payload', () => {
    const session = JSON.stringify({
      access_token: 'eyJ' + 'a'.repeat(600),
      refresh_token: 'v1.' + 'b'.repeat(200),
      user: { id: 'uuid-1234', email: 'user@example.com', app_metadata: {}, user_metadata: {} },
      expires_at: 1234567890,
    });
    const { chunks } = splitIntoChunks(session);
    expect(joinChunks(chunks)).toBe(session);
  });

  it('preserves multi-byte characters at a chunk boundary', () => {
    // Hebrew text in a user's profile could end up in the session payload indirectly; a naive
    // byte-oriented split could sever a UTF-16 surrogate pair. slice() on a JS string operates
    // on UTF-16 code units, so this asserts the boundary itself does not corrupt the text.
    const value = 'א'.repeat(3000) + '🏋️'.repeat(50);
    const { chunks } = splitIntoChunks(value);
    expect(joinChunks(chunks)).toBe(value);
  });
});

describe('joinChunks', () => {
  it('returns null when a chunk is missing rather than joining a partial value', () => {
    // A missing chunk must never silently become a truncated-but-parseable string — that is
    // handed straight to JSON.parse as a corrupt session.
    expect(joinChunks(['first', null, 'third'])).toBeNull();
  });

  it('returns null when every chunk is missing', () => {
    expect(joinChunks([null, null])).toBeNull();
  });
});

describe('chunkKeys / metaKey', () => {
  it('generates one distinct key per chunk, in order', () => {
    expect(chunkKeys('session', 3)).toEqual(['session__0', 'session__1', 'session__2']);
  });

  it('derives the meta key deterministically from the base key', () => {
    expect(metaKey('session')).toBe('session__chunks');
  });

  it('does not collide chunk keys with the meta key', () => {
    const keys = [...chunkKeys('session', 5), metaKey('session')];
    expect(new Set(keys).size).toBe(keys.length);
  });
});
