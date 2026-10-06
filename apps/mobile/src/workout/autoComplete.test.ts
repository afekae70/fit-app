/**
 * The tick that types itself, and the times it must not.
 *
 * A tick starts the rest timer and counts toward the workout, so a wrong one is not cosmetic: it
 * starts someone resting before a set they have not done. Most of these cases are about that.
 */

import { describe, expect, it } from 'vitest';

import { isSetComplete, shouldAutoComplete, type AutoCompleteInput } from './autoComplete.js';

const empty = { weightKg: null, reps: null };

function entry(overrides: Partial<AutoCompleteInput>): AutoCompleteInput {
  return {
    done: false,
    field: 'reps',
    before: empty,
    after: empty,
    loadType: 'weight_reps',
    ...overrides,
  };
}

describe('isSetComplete', () => {
  it('wants both numbers for a lift', () => {
    expect(isSetComplete({ weightKg: 60, reps: 8 }, 'weight_reps')).toBe(true);
    expect(isSetComplete({ weightKg: null, reps: 8 }, 'weight_reps')).toBe(false);
    expect(isSetComplete({ weightKg: 60, reps: null }, 'weight_reps')).toBe(false);
  });

  it('does not count zero reps as a set', () => {
    expect(isSetComplete({ weightKg: 60, reps: 0 }, 'weight_reps')).toBe(false);
  });

  it('accepts an empty bar, which is a weight of nothing rather than no weight', () => {
    expect(isSetComplete({ weightKg: 0, reps: 10 }, 'weight_reps')).toBe(true);
  });

  it('wants only the reps where the weight is optional', () => {
    expect(isSetComplete({ weightKg: null, reps: 12 }, 'bodyweight')).toBe(true);
    expect(isSetComplete({ weightKg: null, reps: 12 }, 'bodyweight_plus')).toBe(true);
  });

  it('treats an exercise the catalogue does not describe as an ordinary lift', () => {
    expect(isSetComplete({ weightKg: null, reps: 8 }, undefined)).toBe(false);
    expect(isSetComplete({ weightKg: 40, reps: 8 }, undefined)).toBe(true);
  });
});

describe('shouldAutoComplete', () => {
  it('ticks an empty row when its last number goes in, weight first', () => {
    const weightIn = { weightKg: 60, reps: null };
    expect(shouldAutoComplete(entry({ field: 'weight', before: empty, after: weightIn }))).toBe(false);
    expect(
      shouldAutoComplete(entry({ field: 'reps', before: weightIn, after: { weightKg: 60, reps: 8 } })),
    ).toBe(true);
  });

  it('ticks an empty row when its last number goes in, reps first', () => {
    const repsIn = { weightKg: null, reps: 8 };
    expect(shouldAutoComplete(entry({ field: 'reps', before: empty, after: repsIn }))).toBe(false);
    expect(
      shouldAutoComplete(entry({ field: 'weight', before: repsIn, after: { weightKg: 60, reps: 8 } })),
    ).toBe(true);
  });

  it('ticks a copied row when the reps are changed', () => {
    // The common case: the row was born holding last set's numbers, and what you actually got
    // is one fewer.
    expect(
      shouldAutoComplete(
        entry({
          field: 'reps',
          before: { weightKg: 60, reps: 8 },
          after: { weightKg: 60, reps: 7 },
        }),
      ),
    ).toBe(true);
  });

  it('does not tick a copied row when only the weight is changed', () => {
    // Changing 60 to 62.5 is loading the bar. Ticking here would start the rest before the lift.
    expect(
      shouldAutoComplete(
        entry({
          field: 'weight',
          before: { weightKg: 60, reps: 8 },
          after: { weightKg: 62.5, reps: 8 },
        }),
      ),
    ).toBe(false);
  });

  it('ticks when the reps typed are the ones already there', () => {
    // Planned eight, did eight, typed eight. Nothing changed and the set is still done — the
    // field only ever commits what was typed, so this is somebody saying so.
    const same = { weightKg: 60, reps: 8 };
    expect(shouldAutoComplete(entry({ field: 'reps', before: same, after: same }))).toBe(true);
  });

  it('does not tick when the weight typed is the one already there', () => {
    const same = { weightKg: 60, reps: 8 };
    expect(shouldAutoComplete(entry({ field: 'weight', before: same, after: same }))).toBe(false);
  });

  it('does not tick a set that is already ticked', () => {
    expect(
      shouldAutoComplete(
        entry({
          done: true,
          field: 'reps',
          before: { weightKg: 60, reps: 8 },
          after: { weightKg: 60, reps: 9 },
        }),
      ),
    ).toBe(false);
  });

  it('does not tick when a number was cleared', () => {
    expect(
      shouldAutoComplete(
        entry({
          field: 'reps',
          before: { weightKg: 60, reps: 8 },
          after: { weightKg: 60, reps: null },
        }),
      ),
    ).toBe(false);
  });

  it('ticks a bodyweight set on its reps alone', () => {
    expect(
      shouldAutoComplete(
        entry({
          loadType: 'bodyweight',
          field: 'reps',
          before: empty,
          after: { weightKg: null, reps: 12 },
        }),
      ),
    ).toBe(true);
  });

  it('does not tick a bodyweight set for added weight alone', () => {
    // Clipping a plate to the belt is setting up, exactly as loading a bar is.
    expect(
      shouldAutoComplete(
        entry({
          loadType: 'bodyweight_plus',
          field: 'weight',
          before: { weightKg: null, reps: 8 },
          after: { weightKg: 10, reps: 8 },
        }),
      ),
    ).toBe(false);
  });
});
