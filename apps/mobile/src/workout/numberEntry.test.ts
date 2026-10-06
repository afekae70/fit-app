/**
 * What a system keyboard can hand over, and what gets saved.
 *
 * The app's own pad could only ever produce a well-formed number, so there was little to check.
 * The phone's keyboard makes no such promise: the separator follows the language, a paste can
 * carry anything, and a field can be left half-typed. Each case here is something that reaches a
 * weight or a rep count in the database if it is read wrongly.
 */

import { describe, expect, it } from 'vitest';

import { entryMaxLength, entryText, parseEntry } from './numberEntry.js';

describe('parseEntry', () => {
  it('reads a whole number and a fraction', () => {
    expect(parseEntry('60')).toBe(60);
    expect(parseEntry('62.5')).toBe(62.5);
    expect(parseEntry('13.75')).toBe(13.75);
  });

  it('reads a comma as the decimal point it is on some keyboards', () => {
    expect(parseEntry('12,5')).toBe(12.5);
  });

  it('means nothing when nothing usable was typed', () => {
    // Null, not zero: a cleared field is a set with no weight, not a set with an empty bar.
    expect(parseEntry('')).toBeNull();
    expect(parseEntry('.')).toBeNull();
    expect(parseEntry('   ')).toBeNull();
    expect(parseEntry('-')).toBeNull();
  });

  it('keeps zero, which is a number', () => {
    expect(parseEntry('0')).toBe(0);
    expect(parseEntry('0.0')).toBe(0);
  });

  it('finishes a number left half-typed', () => {
    expect(parseEntry('7.')).toBe(7);
    expect(parseEntry('.5')).toBe(0.5);
  });

  it('cuts extra decimals off instead of rounding to a number nobody typed', () => {
    expect(parseEntry('13.756')).toBe(13.75);
    expect(parseEntry('13.759')).toBe(13.75);
  });

  it('treats a second point as a slip, not as the end of the number', () => {
    expect(parseEntry('12.5.5')).toBe(12.55);
    expect(parseEntry('1..5')).toBe(1.5);
  });

  it('drops the fraction where only whole numbers make sense', () => {
    expect(parseEntry('8', { decimals: false })).toBe(8);
    expect(parseEntry('8.7', { decimals: false })).toBe(8);
    expect(parseEntry('8,7', { decimals: false })).toBe(8);
  });

  it('ignores what is not part of a number', () => {
    expect(parseEntry(' 60 kg')).toBe(60);
    expect(parseEntry('-60')).toBe(60);
    expect(parseEntry('1 000')).toBe(1000);
  });
});

describe('entryText', () => {
  it('opens the field on what is already recorded', () => {
    expect(entryText(62.5)).toBe('62.5');
    expect(entryText(8)).toBe('8');
    expect(entryText(null)).toBe('');
  });

  it('survives a round trip', () => {
    for (const value of [0, 8, 62.5, 13.75, 100]) {
      expect(parseEntry(entryText(value))).toBe(value);
    }
  });
});

describe('entryMaxLength', () => {
  it('fits four digits, a point and two decimals', () => {
    expect(entryMaxLength()).toBe(7);
    expect('1234.56'.length).toBe(entryMaxLength());
  });

  it('fits four digits when there is no fraction', () => {
    expect(entryMaxLength({ decimals: false })).toBe(4);
  });
});
