/**
 * What the coaching screen has, and what it is in the middle of, as one value.
 *
 * It used to be five: `status`, `coaches`, `error`, `loading` and `pending`. A change in flight
 * with nothing read yet, a list of coaches for an account that is not an admin — nothing ruled
 * those out but the order the setters ran in. And that order had a fault of its own: a change
 * that failed set its error, read everything again, and the read — having worked — cleared the
 * error it had just been shown beside. "No such code" was on screen for as long as one request.
 *
 *   loading ──READ_FAILED──▶ unreachable ──READ_FAILED──▶ unreachable
 *      │                          │
 *      └────── STATUS_READ ───────┴──▶ ready { status, coaches, pending, error }
 *
 *   ready: ACTION_STARTED(a) ─▶ pending a ─(the change, then a read)─▶ ACTION_FINISHED(error?)
 *
 * In `ready` the status stays on screen through a read that fails: what was read last is still
 * the best there is, with a line above it saying it may be old.
 */

import type { AppointedCoach, CoachingError, CoachingStatus } from '@fit/shared/coaching';

/** Which change is in flight. A spinner belongs on the button that was pressed. */
export type CoachingAction = 'join' | 'leave' | 'appoint' | 'dismiss' | 'share';

export type CoachingScreenState =
  /** Nothing read yet. */
  | { kind: 'loading' }
  /** Nothing read, and why. */
  | { kind: 'unreachable'; error: CoachingError }
  | {
      kind: 'ready';
      status: CoachingStatus;
      /** The appointed coaches. Only ever held for an admin; null for one until they are read. */
      coaches: AppointedCoach[] | null;
      pending: CoachingAction | null;
      error: CoachingError | null;
    };

export type CoachingScreenEvent =
  | { type: 'STATUS_READ'; status: CoachingStatus }
  | { type: 'COACHES_READ'; coaches: AppointedCoach[] }
  | { type: 'READ_FAILED'; error: CoachingError }
  | { type: 'ACTION_STARTED'; action: CoachingAction }
  /** After the change and the read that follows it. `error` is the change's own, if it failed. */
  | { type: 'ACTION_FINISHED'; error: CoachingError | null };

export const INITIAL_COACHING_SCREEN: CoachingScreenState = { kind: 'loading' };

export function coachingScreenReducer(
  state: CoachingScreenState,
  event: CoachingScreenEvent,
): CoachingScreenState {
  switch (event.type) {
    case 'STATUS_READ':
      return {
        kind: 'ready',
        status: event.status,
        // The list belongs to an admin. For anyone else it goes, even if it was there.
        coaches: event.status.isAdmin && state.kind === 'ready' ? state.coaches : null,
        pending: state.kind === 'ready' ? state.pending : null,
        error: null,
      };

    case 'COACHES_READ':
      return state.kind === 'ready' && state.status.isAdmin
        ? { ...state, coaches: event.coaches }
        : state;

    case 'READ_FAILED':
      return state.kind === 'ready'
        ? { ...state, error: event.error }
        : { kind: 'unreachable', error: event.error };

    case 'ACTION_STARTED':
      // One change at a time, and only on something that has been read.
      return state.kind === 'ready' && state.pending === null
        ? { ...state, pending: event.action, error: null }
        : state;

    case 'ACTION_FINISHED':
      if (state.kind !== 'ready' || state.pending === null) return state;
      // The change's own error is the one to show; without one, whatever the read left.
      return { ...state, pending: null, error: event.error ?? state.error };
  }
}

/** The line at the top, if there is one to show. */
export function coachingErrorOf(state: CoachingScreenState): CoachingError | null {
  return state.kind === 'loading' ? null : state.error;
}
