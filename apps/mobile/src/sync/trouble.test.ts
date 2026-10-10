import { describe, expect, it } from 'vitest';

import { syncTroubleOf } from './trouble.js';

describe('when sync has something to say', () => {
  it('says nothing after a sync that worked', () => {
    expect(syncTroubleOf({ kind: 'idle', lastSyncedAt: '2026-10-10T10:00:00.000Z' })).toBeNull();
    expect(syncTroubleOf({ kind: 'idle', lastSyncedAt: null })).toBeNull();
  });

  it('says nothing while one is running', () => {
    // The warning must not flash off and on again around every retry.
    expect(syncTroubleOf({ kind: 'syncing' })).toBeNull();
  });

  it('says nothing about having no signal', () => {
    // Routine, and nothing the user can act on: it goes again the next time the app is opened.
    expect(syncTroubleOf({ kind: 'offline', lastSyncedAt: null })).toBeNull();
  });

  it('says nothing in a build with no server at all', () => {
    expect(syncTroubleOf({ kind: 'unconfigured' })).toBeNull();
  });

  it('warns when the server answered and the run failed', () => {
    expect(
      syncTroubleOf({ kind: 'error', message: 'duplicate key value', lastSyncedAt: null }),
    ).toEqual({ kind: 'failed' });
  });

  it('warns, with the count, when some rows were refused', () => {
    expect(syncTroubleOf({ kind: 'partial', refused: 3, lastSyncedAt: null })).toEqual({
      kind: 'refused',
      count: 3,
    });
  });

  it('never shows the server’s own words', () => {
    // A Postgres message is for a log. On screen it is noise at best, and at worst a table
    // name and a row id shown to someone who can do nothing with either.
    const trouble = syncTroubleOf({
      kind: 'error',
      message: 'sync: upsert on sets failed: violates check constraint',
      lastSyncedAt: null,
    });
    expect(JSON.stringify(trouble)).not.toContain('sets');
  });
});
