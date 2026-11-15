/**
 * A coach editing one day of a trainee's plan, as one value.
 *
 * It used to be four: `saved`, `draft`, `error` and `saving`. "Loading" was spelled "no draft
 * and no error", one `saving` stood for both saving and deleting — so deleting a workout spun
 * the Save button — and a draft could be edited from code while it was being written.
 *
 *   loading ──LOAD_FAILED──▶ unreachable
 *      │
 *      └──LOADED──▶ editing { saved, draft, work }
 *
 *   work:  idle ──SAVE_STARTED──▶ saving ──SAVED──▶ idle (and `saved` is now the draft)
 *            │                       └──WORK_FAILED──▶ failed(error)
 *            └──DELETE_STARTED──▶ deleting ──WORK_FAILED──▶ failed(error)
 *          failed(error): still editable, the line stays until the next attempt.
 *
 * A save or a delete that works leaves the screen, so neither has a state after it.
 */

import type { CoachingError } from '@fit/shared/coaching';

import { sameDay, type CoachDay } from './planDocument.js';

export type DayEditorWork =
  | { kind: 'idle' }
  | { kind: 'saving' }
  | { kind: 'deleting' }
  /** The last attempt did not go through. Nothing was changed on the server. */
  | { kind: 'failed'; error: CoachingError };

export type DayEditorState =
  | { kind: 'loading' }
  /** The plan could not be read, so there is nothing to edit. */
  | { kind: 'unreachable'; error: CoachingError }
  | {
      kind: 'editing';
      /** What the server has; null for a workout that does not exist yet. */
      saved: CoachDay | null;
      draft: CoachDay;
      work: DayEditorWork;
    };

export type DayEditorEvent =
  /** `saved` is the day as found, or null when it is new and `blank` is what to start from. */
  | { type: 'LOADED'; saved: CoachDay | null; blank: CoachDay }
  | { type: 'LOAD_FAILED'; error: CoachingError }
  /** One edit, as a function of the draft as it is now rather than as it was when drawn. */
  | { type: 'EDITED'; edit: (draft: CoachDay) => CoachDay }
  | { type: 'SAVE_STARTED' }
  | { type: 'SAVED' }
  | { type: 'DELETE_STARTED' }
  | { type: 'WORK_FAILED'; error: CoachingError };

export const INITIAL_DAY_EDITOR: DayEditorState = { kind: 'loading' };

const busy = (work: DayEditorWork) => work.kind === 'saving' || work.kind === 'deleting';

export function dayEditorReducer(state: DayEditorState, event: DayEditorEvent): DayEditorState {
  switch (event.type) {
    case 'LOADED':
      return state.kind === 'loading'
        ? {
            kind: 'editing',
            saved: event.saved,
            draft: event.saved ?? event.blank,
            work: { kind: 'idle' },
          }
        : state;

    case 'LOAD_FAILED':
      return state.kind === 'loading' ? { kind: 'unreachable', error: event.error } : state;

    case 'EDITED':
      // Not while it is being written: what is on screen is what was sent.
      if (state.kind !== 'editing' || busy(state.work)) return state;
      return { ...state, draft: event.edit(state.draft) };

    case 'SAVE_STARTED':
      return state.kind === 'editing' && !busy(state.work)
        ? { ...state, work: { kind: 'saving' } }
        : state;

    case 'SAVED':
      return state.kind === 'editing' && state.work.kind === 'saving'
        ? { ...state, saved: state.draft, work: { kind: 'idle' } }
        : state;

    case 'DELETE_STARTED':
      // Only a workout the server has can be deleted from it.
      return state.kind === 'editing' && state.saved !== null && !busy(state.work)
        ? { ...state, work: { kind: 'deleting' } }
        : state;

    case 'WORK_FAILED':
      return state.kind === 'editing' && busy(state.work)
        ? { ...state, work: { kind: 'failed', error: event.error } }
        : state;
  }
}

/** Saving or deleting: every control is held still until it is over. */
export function dayEditorBusy(state: DayEditorState): boolean {
  return state.kind === 'editing' && busy(state.work);
}

/** The line at the top, if there is one. */
export function dayEditorError(state: DayEditorState): CoachingError | null {
  if (state.kind === 'unreachable') return state.error;
  return state.kind === 'editing' && state.work.kind === 'failed' ? state.work.error : null;
}

/**
 * Whether there is anything to save. A new workout has something once it has a name or an
 * exercise; an existing one, once it differs from what the server has.
 */
export function dayEditorDirty(state: DayEditorState): boolean {
  if (state.kind !== 'editing') return false;
  const { saved, draft } = state;
  return saved === null
    ? draft.exercises.length > 0 || Boolean(draft.name?.trim())
    : !sameDay(saved, draft);
}
