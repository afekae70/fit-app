/**
 * `classifyCallbackParams` is the only thing standing between a real confirmation/recovery link
 * and a stray or malformed deep link — misclassifying a recovery link as "enter the app" would
 * skip the new-password screen entirely, and misclassifying a signup link as recovery would
 * strand a brand-new user on a "set your password" form they never asked for.
 */

import { describe, expect, it } from 'vitest';

import { classifyCallbackParams } from './callbackParams.js';

describe('classifyCallbackParams', () => {
  it('classifies a signup confirmation link', () => {
    expect(classifyCallbackParams({ code: 'abc123', type: 'signup' })).toEqual({
      kind: 'signup',
      code: 'abc123',
    });
  });

  it('classifies an email-change confirmation the same way as signup', () => {
    // No dedicated email-change feature exists yet — both should just complete the exchange and
    // land the user in the app, which is what the 'signup' branch already does.
    expect(classifyCallbackParams({ code: 'abc123', type: 'email_change' })).toEqual({
      kind: 'signup',
      code: 'abc123',
    });
  });

  it('classifies a password-recovery link', () => {
    expect(classifyCallbackParams({ code: 'xyz789', type: 'recovery' })).toEqual({
      kind: 'recovery',
      code: 'xyz789',
    });
  });

  it('is invalid with no code at all', () => {
    expect(classifyCallbackParams({ type: 'signup' })).toEqual({ kind: 'invalid' });
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
