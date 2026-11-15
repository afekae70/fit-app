import { describe, expect, it } from 'vitest';

import {
  dayEditorBusy,
  dayEditorDirty,
  dayEditorError,
  dayEditorReducer,
  INITIAL_DAY_EDITOR,
  type DayEditorEvent,
  type DayEditorState,
} from './dayEditorState.js';
import { addExercise, newExercise, NO_TIMING, type CoachDay } from './planDocument.js';

const blank: CoachDay = { id: 'd1', name: null, ...NO_TIMING, exercises: [] };
const pushDay: CoachDay = addExercise({ ...blank, name: 'Push' }, newExercise('e1', 'Bench Press'));

const run = (events: DayEditorEvent[], from: DayEditorState = INITIAL_DAY_EDITOR) =>
  events.reduce(dayEditorReducer, from);
const opened = (saved: CoachDay | null = pushDay) => run([{ type: 'LOADED', saved, blank }]);
const rename = (name: string): DayEditorEvent => ({
  type: 'EDITED',
  edit: (draft) => ({ ...draft, name }),
});

describe('opening a day', () => {
  it('starts from what the server has, with nothing to save', () => {
    const state = opened();
    expect(state).toMatchObject({ kind: 'editing', saved: pushDay, draft: pushDay });
    expect(dayEditorDirty(state)).toBe(false);
  });

  it('starts a new workout blank, and it is worth saving once it has a name or an exercise', () => {
    const fresh = opened(null);
    expect(fresh).toMatchObject({ saved: null, draft: blank });
    expect(dayEditorDirty(fresh)).toBe(false);
    expect(dayEditorDirty(run([rename('  ')], fresh))).toBe(false);
    expect(dayEditorDirty(run([rename('Legs')], fresh))).toBe(true);
    expect(
      dayEditorDirty(
        run([{ type: 'EDITED', edit: (d) => addExercise(d, newExercise('e2', 'Squat')) }], fresh),
      ),
    ).toBe(true);
  });

  it('says why when the plan could not be read', () => {
    const down = run([{ type: 'LOAD_FAILED', error: 'offline' }]);
    expect(down).toEqual({ kind: 'unreachable', error: 'offline' });
    expect(dayEditorError(down)).toBe('offline');
    // Nothing to edit, nothing to save.
    expect(run([rename('x'), { type: 'SAVE_STARTED' }], down)).toBe(down);
  });
});

describe('editing and saving', () => {
  const edited = run([rename('Push A')], opened());

  it('is dirty once it differs, and clean again when put back', () => {
    expect(dayEditorDirty(edited)).toBe(true);
    expect(dayEditorDirty(run([rename('Push')], edited))).toBe(false);
  });

  it('holds the draft still while it is being written', () => {
    const saving = run([{ type: 'SAVE_STARTED' }], edited);
    expect(dayEditorBusy(saving)).toBe(true);
    expect(run([rename('other')], saving)).toBe(saving);
    expect(run([{ type: 'SAVE_STARTED' }], saving)).toBe(saving);
    expect(run([{ type: 'DELETE_STARTED' }], saving)).toBe(saving);
  });

  it('is clean after a save: what was sent is what the server has', () => {
    const done = run([{ type: 'SAVE_STARTED' }, { type: 'SAVED' }], edited);
    expect(done).toMatchObject({ saved: { name: 'Push A' }, work: { kind: 'idle' } });
    expect(dayEditorDirty(done)).toBe(false);
  });

  it('keeps every edit after a save that failed, says so, and can try again', () => {
    const failed = run(
      [{ type: 'SAVE_STARTED' }, { type: 'WORK_FAILED', error: 'offline' }],
      edited,
    );
    expect(dayEditorError(failed)).toBe('offline');
    expect(dayEditorBusy(failed)).toBe(false);
    expect(dayEditorDirty(failed)).toBe(true);
    // Still editable, with the line still up.
    expect(dayEditorError(run([rename('Push B')], failed))).toBe('offline');
    // And the next attempt takes it down.
    expect(dayEditorError(run([{ type: 'SAVE_STARTED' }], failed))).toBeNull();
  });
});

describe('deleting', () => {
  it('is its own kind of busy, not a save', () => {
    const deleting = run([{ type: 'DELETE_STARTED' }], opened());
    expect(deleting).toMatchObject({ work: { kind: 'deleting' } });
    expect(dayEditorBusy(deleting)).toBe(true);
    expect(run([{ type: 'SAVED' }], deleting)).toBe(deleting);
  });

  it('is not offered for a workout the server does not have', () => {
    const fresh = opened(null);
    expect(run([{ type: 'DELETE_STARTED' }], fresh)).toBe(fresh);
  });

  it('says why when it did not go through', () => {
    expect(
      dayEditorError(
        run([{ type: 'DELETE_STARTED' }, { type: 'WORK_FAILED', error: 'gone' }], opened()),
      ),
    ).toBe('gone');
  });
});

describe('events out of place', () => {
  it('reads the plan once', () => {
    const state = run([rename('Mine')], opened());
    expect(run([{ type: 'LOADED', saved: pushDay, blank }], state)).toBe(state);
  });

  it('cannot fail or finish work that is not running', () => {
    const idle = opened();
    expect(run([{ type: 'WORK_FAILED', error: 'offline' }], idle)).toBe(idle);
    expect(run([{ type: 'SAVED' }], idle)).toBe(idle);
  });
});
