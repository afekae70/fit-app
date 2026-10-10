import { describe, expect, it } from 'vitest';

import {
  appLockKey,
  interpretUnlockError,
  lockGreetingName,
  locksOnOpen,
  locksOnReturn,
  parseLockSetting,
  RELOCK_AFTER_MS,
  serialiseLockSetting,
} from './lockPolicy.js';

const READY = { enabled: true, available: true, workoutInProgress: false };

describe('opening the app', () => {
  it('asks someone who was already signed in', () => {
    expect(locksOnOpen({ ...READY, signedInJustNow: false })).toBe(true);
  });

  it('does not ask someone who has just typed their password', () => {
    expect(locksOnOpen({ ...READY, signedInJustNow: true })).toBe(false);
  });

  it('does not ask on a phone with no fingerprint to ask for', () => {
    // Otherwise the screen would be a door with no handle: a button that can only fail.
    expect(locksOnOpen({ ...READY, available: false, signedInJustNow: false })).toBe(false);
  });

  it('does not ask an account that turned it off', () => {
    expect(locksOnOpen({ ...READY, enabled: false, signedInJustNow: false })).toBe(false);
  });

  it('does not stand between someone and the workout they are in the middle of', () => {
    expect(locksOnOpen({ ...READY, workoutInProgress: true, signedInJustNow: false })).toBe(false);
  });
});

describe('coming back to the app', () => {
  it('asks again after it has been out of sight for a while', () => {
    expect(locksOnReturn({ ...READY, awayMs: RELOCK_AFTER_MS })).toBe(true);
    expect(locksOnReturn({ ...READY, awayMs: 60 * 60 * 1000 })).toBe(true);
  });

  it('does not ask after a moment away', () => {
    // The photo picker, a notification pulled down, the fingerprint prompt itself: each takes
    // the app out of the foreground for seconds. Asking after those would ask in a loop.
    expect(locksOnReturn({ ...READY, awayMs: 0 })).toBe(false);
    expect(locksOnReturn({ ...READY, awayMs: 4000 })).toBe(false);
    expect(locksOnReturn({ ...READY, awayMs: RELOCK_AFTER_MS - 1 })).toBe(false);
  });

  it('never asks during a workout, however long the rest', () => {
    expect(locksOnReturn({ ...READY, workoutInProgress: true, awayMs: 60 * 60 * 1000 })).toBe(
      false,
    );
  });

  it('does not ask when it is off, or cannot work', () => {
    expect(locksOnReturn({ ...READY, enabled: false, awayMs: 60 * 60 * 1000 })).toBe(false);
    expect(locksOnReturn({ ...READY, available: false, awayMs: 60 * 60 * 1000 })).toBe(false);
  });
});

describe('the stored choice', () => {
  it('is on for an account that has never chosen', () => {
    expect(parseLockSetting(null)).toBe(true);
    expect(parseLockSetting(undefined)).toBe(true);
    expect(parseLockSetting('')).toBe(true);
  });

  it('reads back what was stored', () => {
    expect(parseLockSetting(serialiseLockSetting(true))).toBe(true);
    expect(parseLockSetting(serialiseLockSetting(false))).toBe(false);
  });

  it('is kept apart for each account, under a key the store accepts', () => {
    expect(appLockKey('11111111-1111-4111-8111-111111111111')).not.toBe(
      appLockKey('22222222-2222-4222-8222-222222222222'),
    );
    expect(appLockKey('a b/c@d')).toMatch(/^[A-Za-z0-9._-]+$/);
  });
});

describe('a prompt that did not unlock', () => {
  it('knows the user closing it from something going wrong', () => {
    // The sentences the library actually produces.
    expect(
      interpretUnlockError(
        'Could not Authenticate the user: User canceled the authentication. Fingerprint operation cancelled by user.',
      ),
    ).toBe('cancelled');
    expect(
      interpretUnlockError(
        'Could not Authenticate the user: Lockout. Too many attempts. Try again later.',
      ),
    ).toBe('locked_out');
    expect(
      interpretUnlockError(
        'Could not Authenticate the user: Lockout permanent. Fingerprint sensor disabled.',
      ),
    ).toBe('locked_out');
    expect(interpretUnlockError('Could not Authenticate the user: Hardware unavailable.')).toBe(
      'failed',
    );
    expect(interpretUnlockError('')).toBe('failed');
  });
});

describe('the name under the greeting', () => {
  it('is the name they gave', () => {
    expect(lockGreetingName('אפק', 'someone@example.com')).toBe('אפק');
  });

  it('falls back to the start of their address, as the home screen does', () => {
    expect(lockGreetingName(null, 'someone@example.com')).toBe('someone');
    expect(lockGreetingName('   ', 'someone@example.com')).toBe('someone');
  });

  it('is empty rather than wrong when there is neither', () => {
    expect(lockGreetingName(null, null)).toBe('');
  });
});
