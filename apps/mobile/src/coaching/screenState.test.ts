import type { AppointedCoach, CoachingStatus } from '@fit/shared/coaching';
import { describe, expect, it } from 'vitest';

import {
  coachingErrorOf,
  coachingScreenReducer,
  INITIAL_COACHING_SCREEN,
  type CoachingScreenEvent,
  type CoachingScreenState,
} from './screenState.js';

const trainee: CoachingStatus = {
  role: 'trainee',
  code: null,
  isAdmin: false,
  coach: null,
  trainees: [],
};
const admin: CoachingStatus = { ...trainee, role: 'coach', code: 'ABC234', isAdmin: true };
const list: AppointedCoach[] = [
  { id: 'c1', email: 'coach@example.com', name: null, code: 'ABC234', trainees: 2 },
];

const run = (events: CoachingScreenEvent[], from: CoachingScreenState = INITIAL_COACHING_SCREEN) =>
  events.reduce(coachingScreenReducer, from);
const ready = (status: CoachingStatus = trainee) => run([{ type: 'STATUS_READ', status }]);

describe('reading the coaching status', () => {
  it('opens on what was read', () => {
    expect(ready()).toEqual({
      kind: 'ready',
      status: trainee,
      coaches: null,
      pending: null,
      error: null,
    });
  });

  it('says why when nothing could be read, and recovers on the next read', () => {
    const down = run([{ type: 'READ_FAILED', error: 'offline' }]);
    expect(down).toEqual({ kind: 'unreachable', error: 'offline' });
    expect(coachingErrorOf(down)).toBe('offline');
    expect(run([{ type: 'STATUS_READ', status: trainee }], down).kind).toBe('ready');
  });

  it('keeps what was read last through a read that fails, and says so', () => {
    const stale = run([{ type: 'READ_FAILED', error: 'offline' }], ready());
    expect(stale).toMatchObject({ kind: 'ready', status: trainee, error: 'offline' });
    // And the next read that works takes the line away.
    expect(coachingErrorOf(run([{ type: 'STATUS_READ', status: trainee }], stale))).toBeNull();
  });

  it('holds the list of coaches for an admin only', () => {
    const withList = run([{ type: 'COACHES_READ', coaches: list }], ready(admin));
    expect(withList).toMatchObject({ coaches: list });
    // Kept across the admin's own re-reads, so the list does not blink.
    expect(run([{ type: 'STATUS_READ', status: admin }], withList)).toMatchObject({
      coaches: list,
    });
    // Gone the moment the server says this account is not one.
    expect(run([{ type: 'STATUS_READ', status: trainee }], withList)).toMatchObject({
      coaches: null,
    });
    expect(run([{ type: 'COACHES_READ', coaches: list }], ready(trainee))).toMatchObject({
      coaches: null,
    });
  });
});

describe('a change in flight', () => {
  const joining = run([{ type: 'ACTION_STARTED', action: 'join' }], ready());

  it('is one at a time', () => {
    expect(joining).toMatchObject({ pending: 'join' });
    expect(run([{ type: 'ACTION_STARTED', action: 'leave' }], joining)).toBe(joining);
  });

  it('needs something read first', () => {
    expect(run([{ type: 'ACTION_STARTED', action: 'join' }])).toBe(INITIAL_COACHING_SCREEN);
  });

  it('stays in flight through the read that follows it', () => {
    expect(run([{ type: 'STATUS_READ', status: trainee }], joining)).toMatchObject({
      pending: 'join',
    });
  });

  it('keeps its own error after the read that follows it has worked', () => {
    // The fault this replaced: the read cleared the error the change had just set.
    const failed = run(
      [
        { type: 'STATUS_READ', status: trainee },
        { type: 'ACTION_FINISHED', error: 'no_such_code' },
      ],
      joining,
    );
    expect(failed).toMatchObject({ pending: null, error: 'no_such_code' });
  });

  it('clears the last error when the next change starts', () => {
    const failed = run([{ type: 'ACTION_FINISHED', error: 'no_such_code' }], joining);
    expect(coachingErrorOf(run([{ type: 'ACTION_STARTED', action: 'join' }], failed))).toBeNull();
  });

  it('shows the read’s error when the change worked but the read after it did not', () => {
    expect(
      run(
        [
          { type: 'READ_FAILED', error: 'offline' },
          { type: 'ACTION_FINISHED', error: null },
        ],
        joining,
      ),
    ).toMatchObject({ pending: null, error: 'offline' });
  });

  it('cannot finish a change that was never started', () => {
    const idle = ready();
    expect(run([{ type: 'ACTION_FINISHED', error: 'gone' }], idle)).toBe(idle);
  });
});
