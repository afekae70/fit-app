import { describe, expect, it } from 'vitest';

import { parseTyped, valueOrClearToCommit, valueToCommit } from './typedEntry.js';

describe('reading a typed number', () => {
  it('accepts whole and decimal numbers, with either decimal mark', () => {
    expect(parseTyped('12')).toBe(12);
    expect(parseTyped('82.5')).toBe(82.5);
    expect(parseTyped('82,5')).toBe(82.5);
    expect(parseTyped(' 8 ')).toBe(8);
  });

  it('treats an empty field or nonsense as nothing typed', () => {
    expect(parseTyped('')).toBeNull();
    expect(parseTyped('abc')).toBeNull();
    expect(parseTyped('-3')).toBeNull();
  });
});

describe('what a set row still has to save', () => {
  it('saves reps typed into the last set before it is ticked', () => {
    // The bug: 10 typed over 8, the tick moved focus mode on, and 8 was what stayed saved.
    expect(valueToCommit('10', 8, Math.round)).toBe(10);
  });

  it('saves into an empty set', () => {
    expect(valueToCommit('12', null, Math.round)).toBe(12);
  });

  it('has nothing to save when nothing was typed', () => {
    expect(valueToCommit(null, 8, Math.round)).toBeNull();
  });

  it('has nothing to save when the typed value is already the saved one', () => {
    expect(valueToCommit('8', 8, Math.round)).toBeNull();
  });

  it('does not wipe a saved value because the field was cleared or mistyped', () => {
    expect(valueToCommit('', 8, Math.round)).toBeNull();
    expect(valueToCommit('x', 8, Math.round)).toBeNull();
  });

  it('compares a weight in the stored unit, not the typed one', () => {
    const lbToKg = (lb: number) => Math.round(lb * 0.45359237 * 100) / 100;
    // 176.37 lb is the 80 kg already saved — nothing to write.
    expect(valueToCommit('176.37', 80, lbToKg)).toBeNull();
    expect(valueToCommit('180', 80, lbToKg)).toBe(81.65);
  });

  it('rounds reps typed with a fraction to a whole number', () => {
    expect(valueToCommit('9.6', 8, Math.round)).toBe(10);
  });
});

describe('a field where clearing means something', () => {
  it('saves a typed value', () => {
    expect(valueOrClearToCommit('4', 3, Math.round)).toBe(4);
  });

  it('clears the saved value when the field was emptied', () => {
    // A plan target removed on purpose, unlike a set weight that was never meant to be blank.
    expect(valueOrClearToCommit('', 3, Math.round)).toBeNull();
  });

  it('does nothing when nothing was typed, or the value is unchanged', () => {
    expect(valueOrClearToCommit(null, 3, Math.round)).toBeUndefined();
    expect(valueOrClearToCommit('3', 3, Math.round)).toBeUndefined();
    expect(valueOrClearToCommit('', null, Math.round)).toBeUndefined();
  });
});
