/**
 * `friendlyAuthError` is the only thing standing between raw GoTrue error text and a message the
 * user can actually act on — a wrong mapping here means either a confusing raw string on screen,
 * or a real error silently rendered as "unknown".
 */

import { describe, expect, it } from 'vitest';

import { friendlyAuthError } from './friendlyAuthError.js';

describe('friendlyAuthError', () => {
  it('maps wrong credentials', () => {
    expect(friendlyAuthError('Invalid login credentials')).toBe('invalid_credentials');
  });

  it('maps an already-registered email', () => {
    expect(friendlyAuthError('User already registered')).toBe('already_registered');
  });

  it('maps a too-short password', () => {
    expect(friendlyAuthError('Password should be at least 6 characters')).toBe('weak_password');
  });

  it('maps an unconfirmed email on sign-in', () => {
    expect(friendlyAuthError('Email not confirmed')).toBe('email_not_confirmed');
  });

  it('maps the daily email send-volume limit', () => {
    expect(friendlyAuthError('Email rate limit exceeded')).toBe('rate_limited');
  });

  it('maps the per-request cooldown, a distinct message with the same remedy', () => {
    expect(
      friendlyAuthError('For security purposes, you can only request this after 42 seconds'),
    ).toBe('rate_limited');
  });

  it('maps reusing the same password on update', () => {
    expect(friendlyAuthError('New password should be different from the old password')).toBe(
      'same_password',
    );
  });

  it('maps a missing code verifier — the wrong-device PKCE failure', () => {
    expect(friendlyAuthError('invalid request: both auth code and code verifier should be non-empty')).toBe(
      'link_expired',
    );
  });

  it('maps an invalid or already-used code', () => {
    expect(friendlyAuthError('invalid grant: code has expired')).toBe('link_expired');
  });

  it('falls back to unknown for anything unrecognised', () => {
    expect(friendlyAuthError('the server exploded')).toBe('unknown');
  });
});
