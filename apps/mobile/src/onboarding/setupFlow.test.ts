import { describe, expect, it } from 'vitest';

import { SETUP_STEPS } from './profileSetup.js';
import {
  INITIAL_SETUP_FLOW,
  setupFlowReducer,
  setupStepIndex,
  type SetupFlowEvent,
  type SetupFlowState,
} from './setupFlow.js';

const LAST = SETUP_STEPS.length - 1;
const run = (events: SetupFlowEvent[], from: SetupFlowState = INITIAL_SETUP_FLOW) =>
  events.reduce(setupFlowReducer, from);
const atLast: SetupFlowState = { kind: 'answering', index: LAST };

describe('the first-run setup, step to step', () => {
  it('walks forward to the last step and stops there', () => {
    const next = Array.from({ length: LAST + 3 }, (): SetupFlowEvent => ({ type: 'NEXT' }));
    expect(run(next)).toEqual(atLast);
    expect(SETUP_STEPS[setupStepIndex(run(next))]).toBe('done');
  });

  it('walks back, and not past the first step', () => {
    expect(run([{ type: 'NEXT' }, { type: 'NEXT' }, { type: 'BACK' }])).toEqual({
      kind: 'answering',
      index: 1,
    });
    expect(run([{ type: 'BACK' }])).toBe(INITIAL_SETUP_FLOW);
  });

  it('saves from the last step only', () => {
    expect(run([{ type: 'SAVE' }], atLast)).toEqual({ kind: 'saving' });
    expect(run([{ type: 'SAVE' }])).toBe(INITIAL_SETUP_FLOW);
  });

  it('stays on the last step while saving and after a failed save', () => {
    expect(setupStepIndex({ kind: 'saving' })).toBe(LAST);
    expect(setupStepIndex({ kind: 'saveFailed' })).toBe(LAST);
  });
});

describe('saving', () => {
  const saving: SetupFlowState = { kind: 'saving' };
  const failed: SetupFlowState = { kind: 'saveFailed' };

  it('ignores a second tap, and going back or forward, while the answers are being written', () => {
    expect(run([{ type: 'SAVE' }], saving)).toBe(saving);
    expect(run([{ type: 'BACK' }], saving)).toBe(saving);
    expect(run([{ type: 'NEXT' }], saving)).toBe(saving);
  });

  it('says a save failed, and can be tried again', () => {
    expect(run([{ type: 'SAVE_FAILED' }], saving)).toEqual(failed);
    expect(run([{ type: 'SAVE' }], failed)).toEqual(saving);
  });

  it('drops the failure when going back to change an answer', () => {
    const back = run([{ type: 'BACK' }], failed);
    expect(back).toEqual({ kind: 'answering', index: LAST - 1 });
    // Forward again is a clean last step, not one still saying the save failed.
    expect(run([{ type: 'NEXT' }], back)).toEqual(atLast);
  });

  it('cannot fail a save that is not running', () => {
    expect(run([{ type: 'SAVE_FAILED' }], atLast)).toBe(atLast);
  });
});
