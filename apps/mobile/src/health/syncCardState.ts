/**
 * What the Health Connect card is showing, as one value.
 *
 * It used to be five: `availability`, `enabled`, `denied`, `busy` and `result`. "Connected" and
 * "permission denied" could both be drawn at once, and were kept apart only by every handler
 * setting both flags together; one `busy` stood for two different waits; and a result from one
 * export was still there after the switch had been turned off and on again.
 *
 *   checking ──CHECKED──▶ unavailable
 *       │
 *       ├──────────────▶ off ◀──────── TURNED_OFF ────────┐
 *       │                 │ ASKED          ▲               │
 *       │                 ▼                │ (refused)     │
 *       │               asking ──ANSWERED──┴──▶ denied     │
 *       │                 │ (granted)            │ ASKED   │
 *       ▼                 ▼                      ▼         │
 *       └──────────────▶ on { exporting: idle → running → done } ──┘
 */

import type { HealthAvailability } from './adapter.js';

/** How the last export of history went, for the line under the button. */
export interface ExportCounts {
  sent: number;
  failed: number;
}

export type HealthCardState =
  /** Before the phone has been asked what it has. */
  | { kind: 'checking' }
  | { kind: 'unavailable'; reason: 'not_android' | 'no_native_module' | 'not_installed' }
  | { kind: 'off' }
  /** Health Connect's own permission screen is up. */
  | { kind: 'asking' }
  /** It came back without the permission: off, and saying why. */
  | { kind: 'denied' }
  | { kind: 'on'; exporting: 'idle' | 'running' | ExportCounts };

export type HealthCardEvent =
  /** `enabled` is the saved switch and the permission together: both, or it is off. */
  | { type: 'CHECKED'; availability: HealthAvailability; enabled: boolean }
  | { type: 'ASKED' }
  | { type: 'ANSWERED'; granted: boolean }
  | { type: 'TURNED_OFF' }
  | { type: 'EXPORT_STARTED' }
  /** Null when the export itself threw: back to the button, with nothing to report. */
  | { type: 'EXPORT_DONE'; counts: ExportCounts | null };

export const INITIAL_HEALTH_CARD_STATE: HealthCardState = { kind: 'checking' };

export function healthCardReducer(state: HealthCardState, event: HealthCardEvent): HealthCardState {
  switch (event.type) {
    case 'CHECKED':
      if (state.kind !== 'checking') return state;
      if (!event.availability.available) {
        return { kind: 'unavailable', reason: event.availability.reason };
      }
      return event.enabled ? { kind: 'on', exporting: 'idle' } : { kind: 'off' };

    case 'ASKED':
      return state.kind === 'off' || state.kind === 'denied' ? { kind: 'asking' } : state;

    case 'ANSWERED':
      if (state.kind !== 'asking') return state;
      return event.granted ? { kind: 'on', exporting: 'idle' } : { kind: 'denied' };

    case 'TURNED_OFF':
      return state.kind === 'on' || state.kind === 'denied' ? { kind: 'off' } : state;

    case 'EXPORT_STARTED':
      return state.kind === 'on' && state.exporting !== 'running'
        ? { kind: 'on', exporting: 'running' }
        : state;

    case 'EXPORT_DONE':
      // Only an export that is still wanted: one that finishes after the switch went off has
      // nothing to say, and must not come back when it is turned on again.
      return state.kind === 'on' && state.exporting === 'running'
        ? { kind: 'on', exporting: event.counts ?? 'idle' }
        : state;
  }
}
