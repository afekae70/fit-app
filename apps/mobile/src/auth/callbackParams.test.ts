/**
 * `classifyCallbackParams` is the only thing standing between a real recovery link and a stray
 * or malformed deep link.
 *
 * The first case is the shape GoTrue actually sends with PKCE: a code and nothing else. Until
 * 2026-11-07 this file asserted that such a link was invalid, which is how every real reset
 * link came to be refused.
 */

import { describe, expect, it } from 'vitest';

import { authLinkParams, classifyCallbackParams } from './callbackParams.js';

describe('classifyCallbackParams', () => {
  it('accepts the PKCE redirect as GoTrue sends it: a code and no type', () => {
    expect(classifyCallbackParams({ code: 'abc123' })).toEqual({ kind: 'code', code: 'abc123' });
  });

  it('accepts a link that does say it is a recovery', () => {
    expect(classifyCallbackParams({ code: 'xyz789', type: 'recovery' })).toEqual({
      kind: 'code',
      code: 'xyz789',
    });
  });

  it('no longer completes a sign-up confirmation link', () => {
    // Signing up signs you in now. A link like this is left over from when it did not.
    expect(classifyCallbackParams({ code: 'abc123', type: 'signup' })).toEqual({ kind: 'invalid' });
  });

  it('does not complete an email-change or magic link, which the app has no feature for', () => {
    expect(classifyCallbackParams({ code: 'abc123', type: 'email_change' })).toEqual({
      kind: 'invalid',
    });
    expect(classifyCallbackParams({ code: 'abc123', type: 'magiclink' })).toEqual({
      kind: 'invalid',
    });
  });

  it('tells a link GoTrue refused as expired', () => {
    expect(
      classifyCallbackParams({ error: 'access_denied', error_code: 'otp_expired' }),
    ).toEqual({ kind: 'expired' });
  });

  it('is invalid with no code at all', () => {
    expect(classifyCallbackParams({ type: 'recovery' })).toEqual({ kind: 'invalid' });
    expect(classifyCallbackParams({})).toEqual({ kind: 'invalid' });
  });
});

describe('reading the link itself, as the sign-in screen does', () => {
  it('reads the code from the link GoTrue redirects to', () => {
    expect(authLinkParams('fitapp://auth/callback?code=f15e-83d4')).toEqual({
      code: 'f15e-83d4',
      type: undefined,
      error_code: undefined,
      error: undefined,
    });
  });

  it('reads an error from the query or the fragment, decoded', () => {
    expect(
      authLinkParams('fitapp://auth/callback#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid'),
    ).toMatchObject({ error: 'access_denied', error_code: 'otp_expired' });
    expect(authLinkParams('fitapp://auth/callback/?error=server%20error')).toMatchObject({
      error: 'server error',
    });
  });

  it('ignores every other link', () => {
    expect(authLinkParams('fitapp://exercise/Bench%20Press')).toBeNull();
    expect(authLinkParams('https://example.com/auth/callback?code=x')).toBeNull();
    expect(authLinkParams('not a url')).toBeNull();
    expect(authLinkParams('fitapp://auth/callbacks?code=x')).toBeNull();
  });
});
