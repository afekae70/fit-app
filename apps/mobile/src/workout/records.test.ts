import { describe, expect, it } from 'vitest';

import { beats, recordSetIndex, type Lifted } from './records.js';

const set = (
  weightKg: number | null,
  reps: number | null,
  extra: Partial<Lifted> = {},
): Lifted => ({
  weightKg,
  reps,
  done: true,
  isWarmup: false,
  ...extra,
});

const BEST = { weightKg: 100, reps: 5 };

describe('beating a best', () => {
  it('is more weight, or the same weight for more reps', () => {
    expect(beats({ weightKg: 102.5, reps: 1 }, BEST)).toBe(true);
    expect(beats({ weightKg: 100, reps: 6 }, BEST)).toBe(true);
  });

  it('is not matching it, nor more reps at less weight', () => {
    expect(beats({ weightKg: 100, reps: 5 }, BEST)).toBe(false);
    expect(beats({ weightKg: 97.5, reps: 12 }, BEST)).toBe(false);
    expect(beats({ weightKg: 100, reps: 4 }, BEST)).toBe(false);
  });

  it('is anything at all the first time', () => {
    expect(beats({ weightKg: 20, reps: 1 }, null)).toBe(true);
  });
});

describe('which set holds the record', () => {
  it('is the set that beat the best', () => {
    expect(recordSetIndex([set(95, 5), set(102.5, 3), set(95, 5)], BEST)).toBe(1);
  });

  it('is none when nothing beat it', () => {
    expect(recordSetIndex([set(95, 5), set(100, 5), set(100, 4)], BEST)).toBeNull();
    expect(recordSetIndex([], BEST)).toBeNull();
  });

  it('is one set, the heaviest, when several beat it', () => {
    expect(recordSetIndex([set(102.5, 5), set(105, 3), set(102.5, 6)], BEST)).toBe(1);
  });

  it('is the first of two equal sets, which was the record when it was done', () => {
    expect(recordSetIndex([set(105, 3), set(105, 3)], BEST)).toBe(0);
  });

  it('prefers more reps at the same top weight', () => {
    expect(recordSetIndex([set(105, 3), set(105, 4)], BEST)).toBe(1);
  });

  it('does not count a set that has not been ticked', () => {
    // A number in a row is an intention. The record is earned when the set is done.
    expect(recordSetIndex([set(120, 5, { done: false })], BEST)).toBeNull();
    expect(recordSetIndex([set(120, 5, { done: false }), set(101, 5)], BEST)).toBe(1);
  });

  it('never marks a warm-up', () => {
    expect(recordSetIndex([set(120, 5, { isWarmup: true })], BEST)).toBeNull();
  });

  it('ignores rows with no weight or no reps: a walk, a plank, an empty row', () => {
    expect(recordSetIndex([set(null, 10), set(100, null), set(110, 0)], BEST)).toBeNull();
  });

  it('marks the best set of a first time, since there was nothing to beat', () => {
    expect(recordSetIndex([set(40, 10), set(45, 8), set(40, 10)], null)).toBe(1);
  });

  it('marks nothing while the history is still being read', () => {
    // Unknown is not "no history". Marking on a guess would flash a trophy on every row of a
    // lift someone has done for years, for the moment before the answer arrived.
    expect(recordSetIndex([set(45, 8)], undefined)).toBeNull();
  });
});
