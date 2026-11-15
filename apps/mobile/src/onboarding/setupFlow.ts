/**
 * Where the first-run setup is, as one value.
 *
 * It used to be three: the step `index`, `saving` and `failed`, with every move clearing `failed`
 * by hand. Saving only ever happens on the last step, and a failed save only ever shows there,
 * so those are stages of their own rather than flags that could be set on any step.
 *
 *   answering(0) ⇄ answering(1) ⇄ … ⇄ answering(last) ──SAVE──▶ saving ──▶ (setup closes)
 *                                        ▲      ▲                  │
 *                                        │ BACK └──── SAVE ◀─ saveFailed ◀─ SAVE_FAILED
 *                                 answering(last − 1)
 */

import { SETUP_STEPS } from './profileSetup.js';

const LAST = SETUP_STEPS.length - 1;

export type SetupFlowState =
  | { kind: 'answering'; index: number }
  /** On the last step, with the answers being written. */
  | { kind: 'saving' }
  /** On the last step still: every answer intact, the button live again, and a line saying so. */
  | { kind: 'saveFailed' };

export type SetupFlowEvent =
  { type: 'NEXT' } | { type: 'BACK' } | { type: 'SAVE' } | { type: 'SAVE_FAILED' };

export const INITIAL_SETUP_FLOW: SetupFlowState = { kind: 'answering', index: 0 };

export function setupFlowReducer(state: SetupFlowState, event: SetupFlowEvent): SetupFlowState {
  switch (event.type) {
    case 'NEXT':
      return state.kind === 'answering' && state.index < LAST
        ? { kind: 'answering', index: state.index + 1 }
        : state;

    case 'BACK':
      // Not while saving: the answers on screen are the ones being written.
      if (state.kind === 'saving') return state;
      if (state.kind === 'saveFailed') return { kind: 'answering', index: LAST - 1 };
      return state.index > 0 ? { kind: 'answering', index: state.index - 1 } : state;

    case 'SAVE':
      // Only from the last step, and only once: a second tap while the first is writing is
      // already `saving` and changes nothing.
      return state.kind === 'saveFailed' || (state.kind === 'answering' && state.index === LAST)
        ? { kind: 'saving' }
        : state;

    case 'SAVE_FAILED':
      return state.kind === 'saving' ? { kind: 'saveFailed' } : state;
  }
}

/** The step on screen: saving and its failure both happen on the last one. */
export function setupStepIndex(state: SetupFlowState): number {
  return state.kind === 'answering' ? state.index : LAST;
}
