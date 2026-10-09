/**
 * `classifyCallbackParams` is the only thing standing between a real recovery link and a stray
 * or malformed deep link. Recovery is the one kind the app completes: taking any other for it
 * would put someone on a "set your password" form they never asked for.
 */

import { describe, expect, it } from 'vitest';

import { classifyCallbackParams } from './callbackParams.js';

describe('classifyCallbackParams', () => {
  it('no longer completes a sign-up confirmation link', () => {
    // Signing up signs you in now. A link like this is left over from when it did not.
    expect(classifyCallbackParams({ code: 'abc123', type: 'signup' })).toEqual({ kind: 'invalid' });
  });

  it('does not complete an email-change link, which the app has no feature for', () => {
    expect(classifyCallbackParams({ code: 'abc123', type: 'email_change' })).toEqual({
      kind: 'invalid',
    });
  });

  it('classifies a password-recovery link', () => {
    expect(classifyCallbackParams({ code: 'xyz789', type: 'recovery' })).toEqual({
      kind: 'recovery',
      code: 'xyz789',
    });
  });

  it('is invalid with no code at all', () => {
    expect(classifyCallbackParams({ type: 'recovery' })).toEqual({ kind: 'invalid' });
  });

  it('is invalid with an unrecognised type', () => {
    expect(classifyCallbackParams({ code: 'abc123', type: 'magiclink' })).toEqual({
      kind: 'invalid',
    });
  });

  it('is invalid with no type at all', () => {
    expect(classifyCallbackParams({ code: 'abc123' })).toEqual({ kind: 'invalid' });
  });

  it('is invalid with neither param', () => {
    expect(classifyCallbackParams({})).toEqual({ kind: 'invalid' });
  });
});
