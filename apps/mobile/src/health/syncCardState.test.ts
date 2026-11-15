import { describe, expect, it } from 'vitest';

import {
  healthCardReducer,
  INITIAL_HEALTH_CARD_STATE,
  type HealthCardEvent,
  type HealthCardState,
} from './syncCardState.js';

const run = (events: HealthCardEvent[], from: HealthCardState = INITIAL_HEALTH_CARD_STATE) =>
  events.reduce(healthCardReducer, from);

const available = { available: true } as const;

describe('the Health Connect card', () => {
  it('opens on what the phone has and what was saved', () => {
    expect(run([{ type: 'CHECKED', availability: available, enabled: true }])).toEqual({
      kind: 'on',
      exporting: 'idle',
    });
    expect(run([{ type: 'CHECKED', availability: available, enabled: false }])).toEqual({
      kind: 'off',
    });
    // Saved as on means nothing on a phone that cannot do it.
    expect(
      run([
        {
          type: 'CHECKED',
          availability: { available: false, reason: 'not_installed' },
          enabled: true,
        },
      ]),
    ).toEqual({ kind: 'unavailable', reason: 'not_installed' });
  });

  it('turns on through the permission screen, then sends the history', () => {
    const on = run([{ type: 'ASKED' }, { type: 'ANSWERED', granted: true }], { kind: 'off' });
    expect(on).toEqual({ kind: 'on', exporting: 'idle' });

    const done = run(
      [{ type: 'EXPORT_STARTED' }, { type: 'EXPORT_DONE', counts: { sent: 4, failed: 0 } }],
      on,
    );
    expect(done).toEqual({ kind: 'on', exporting: { sent: 4, failed: 0 } });
    // And again from the button: the old result goes while the new one runs.
    expect(run([{ type: 'EXPORT_STARTED' }], done)).toEqual({ kind: 'on', exporting: 'running' });
  });

  it('stays off and says so when the permission is refused, and can ask again', () => {
    const denied = run([{ type: 'ASKED' }, { type: 'ANSWERED', granted: false }], { kind: 'off' });
    expect(denied).toEqual({ kind: 'denied' });
    expect(run([{ type: 'ASKED' }], denied)).toEqual({ kind: 'asking' });
    expect(run([{ type: 'TURNED_OFF' }], denied)).toEqual({ kind: 'off' });
  });

  it('goes back to the button when the export itself fails', () => {
    expect(
      run([{ type: 'EXPORT_STARTED' }, { type: 'EXPORT_DONE', counts: null }], {
        kind: 'on',
        exporting: 'idle',
      }),
    ).toEqual({ kind: 'on', exporting: 'idle' });
  });
});

describe('events that do not belong to the state change nothing', () => {
  const asking: HealthCardState = { kind: 'asking' };
  const running: HealthCardState = { kind: 'on', exporting: 'running' };

  it('ignores the switch while the permission screen is up', () => {
    expect(run([{ type: 'ASKED' }], asking)).toBe(asking);
    expect(run([{ type: 'TURNED_OFF' }], asking)).toBe(asking);
  });

  it('does not start a second export over a running one', () => {
    expect(run([{ type: 'EXPORT_STARTED' }], running)).toBe(running);
  });

  it('drops the result of an export that finishes after the switch went off', () => {
    const off = run([{ type: 'TURNED_OFF' }], running);
    expect(off).toEqual({ kind: 'off' });
    expect(run([{ type: 'EXPORT_DONE', counts: { sent: 2, failed: 0 } }], off)).toBe(off);
    // Nor does it come back when turned on again.
    expect(
      run(
        [
          { type: 'ASKED' },
          { type: 'ANSWERED', granted: true },
          { type: 'EXPORT_DONE', counts: { sent: 2, failed: 0 } },
        ],
        off,
      ),
    ).toEqual({ kind: 'on', exporting: 'idle' });
  });

  it('offers nothing on a phone without Health Connect', () => {
    const none: HealthCardState = { kind: 'unavailable', reason: 'no_native_module' };
    expect(run([{ type: 'ASKED' }, { type: 'EXPORT_STARTED' }], none)).toBe(none);
  });

  it('reads the phone once', () => {
    const on: HealthCardState = { kind: 'on', exporting: 'idle' };
    expect(run([{ type: 'CHECKED', availability: available, enabled: false }], on)).toBe(on);
  });
});
