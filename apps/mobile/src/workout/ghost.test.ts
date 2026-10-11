import { describe, expect, it } from 'vitest';

import {
  adoptGhost,
  ghostsFor,
  happened,
  openingRows,
  type GhostSource,
  type RowKind,
} from './ghost.js';

const work = (weightKg: number | null, reps: number | null): GhostSource => ({
  weightKg,
  reps,
  isWarmup: false,
});
const warm = (weightKg: number | null, reps: number | null): GhostSource => ({
  weightKg,
  reps,
  isWarmup: true,
});
const rows = (...kinds: ('w' | 'u')[]) => kinds.map((kind) => ({ isWarmup: kind === 'u' }));

describe('what an empty set shows', () => {
  it('is what the same set was last time', () => {
    expect(ghostsFor(rows('w', 'w', 'w'), [work(100, 8), work(100, 7), work(95, 8)])).toEqual([
      { weightKg: 100, reps: 8 },
      { weightKg: 100, reps: 7 },
      { weightKg: 95, reps: 8 },
    ]);
  });

  it('lines working sets up with working sets, whatever warm-ups came before either', () => {
    // Last time: two warm-ups, then the work. Today: one warm-up. The first working set must
    // show last time's first working set, not its second warm-up.
    const ghosts = ghostsFor(rows('u', 'w', 'w'), [
      warm(40, 10),
      warm(60, 5),
      work(100, 8),
      work(100, 7),
    ]);
    expect(ghosts).toEqual([
      { weightKg: 40, reps: 10 },
      { weightKg: 100, reps: 8 },
      { weightKg: 100, reps: 7 },
    ]);
  });

  it('shows nothing for a warm-up when last time had none', () => {
    expect(ghostsFor(rows('u', 'w'), [work(100, 8)])).toEqual([null, { weightKg: 100, reps: 8 }]);
  });

  it('shows nothing for a set last time did not have', () => {
    expect(ghostsFor(rows('w', 'w', 'w'), [work(100, 8), work(100, 7)])[2]).toBeNull();
  });

  it('shows nothing at all the first time', () => {
    expect(ghostsFor(rows('w', 'w'), null)).toEqual([null, null]);
    expect(ghostsFor(rows('w', 'w'), [])).toEqual([null, null]);
    expect(ghostsFor(rows('w'), undefined)).toEqual([null]);
  });

  it('shows the reps alone for an exercise done without weight', () => {
    expect(ghostsFor(rows('w'), [work(null, 15)])).toEqual([{ weightKg: null, reps: 15 }]);
  });

  it('does not count a set left blank last time as a set that was there', () => {
    // A blank row is a set that did not happen. It takes no place in the line, so the first
    // row today shows the first set that was actually done.
    expect(ghostsFor(rows('w', 'w'), [work(null, null), work(100, 8)])).toEqual([
      { weightKg: 100, reps: 8 },
      null,
    ]);
  });

  it('shows a warm-up row the warm-up that was done, past one that was skipped', () => {
    // The case a workout that opens with last time's warm-up rows depends on: it adds one
    // row per warm-up that held something, and that row has to be the one that shows it.
    expect(ghostsFor(rows('u', 'w'), [warm(null, null), warm(40, 10), work(100, 8)])).toEqual([
      { weightKg: 40, reps: 10 },
      { weightKg: 100, reps: 8 },
    ]);
  });

  it('shows nothing when everything last time was left blank', () => {
    expect(ghostsFor(rows('u', 'w'), [warm(null, null), work(null, null)])).toEqual([null, null]);
  });

  it('has an answer for every row, and no more', () => {
    expect(ghostsFor(rows('w'), [work(100, 8), work(100, 7), work(95, 8)])).toHaveLength(1);
    expect(ghostsFor([], [work(100, 8)])).toEqual([]);
  });
});

describe('ticking a set that still shows the watermark', () => {
  const ghost = { weightKg: 100, reps: 8 };

  it('writes last time’s numbers into an empty set', () => {
    expect(adoptGhost({ weightKg: null, reps: null }, ghost)).toEqual({ weightKg: 100, reps: 8 });
  });

  it('fills only what is still empty', () => {
    // The weight was changed by hand; the reps were left as they were shown.
    expect(adoptGhost({ weightKg: 102.5, reps: null }, ghost)).toEqual({ reps: 8 });
    expect(adoptGhost({ weightKg: null, reps: 6 }, ghost)).toEqual({ weightKg: 100 });
  });

  it('writes nothing over a set that was filled in', () => {
    expect(adoptGhost({ weightKg: 102.5, reps: 6 }, ghost)).toBeNull();
  });

  it('writes nothing when there was no watermark', () => {
    expect(adoptGhost({ weightKg: null, reps: null }, null)).toBeNull();
    expect(adoptGhost({ weightKg: null, reps: null }, undefined)).toBeNull();
  });

  it('does not invent a weight for an exercise that has none', () => {
    expect(adoptGhost({ weightKg: null, reps: null }, { weightKg: null, reps: 15 })).toEqual({
      reps: 15,
    });
  });

  it('treats zero as a number that was entered, not as empty', () => {
    expect(adoptGhost({ weightKg: 0, reps: 0 }, ghost)).toBeNull();
  });
});

describe('a set that happened', () => {
  it('is one that held anything at all', () => {
    expect(happened({ weightKg: 100, reps: null })).toBe(true);
    expect(happened({ weightKg: null, reps: 12 })).toBe(true);
    expect(happened({ weightKg: null, reps: null, durationSeconds: 40 })).toBe(true);
    expect(happened({ weightKg: null, reps: null, distanceM: 1500 })).toBe(true);
    // Zero is a number somebody entered.
    expect(happened({ weightKg: 0, reps: null })).toBe(true);
  });

  it('is not a row left blank', () => {
    expect(happened({ weightKg: null, reps: null })).toBe(false);
    expect(happened({ weightKg: null, reps: null, durationSeconds: null, distanceM: null })).toBe(
      false,
    );
  });

  it('keeps its place in the line even with no weight to show', () => {
    // Held for forty seconds last time: it was a set, so the set after it is still second.
    const timed: GhostSource = { weightKg: null, reps: null, durationSeconds: 40, isWarmup: false };
    expect(ghostsFor(rows('w', 'w'), [timed, work(100, 8)])).toEqual([
      null,
      { weightKg: 100, reps: 8 },
    ]);
  });
});

describe('the rows an exercise opens with', () => {
  const U: RowKind = { isWarmup: true, isDrop: false };
  const W: RowKind = { isWarmup: false, isDrop: false };
  const D: RowKind = { isWarmup: false, isDrop: true };
  const kinds = (made: readonly RowKind[]) =>
    made.map((row) => (row.isWarmup ? 'u' : row.isDrop ? 'd' : 'w')).join('');

  it('are the plan’s sets when there is no last time', () => {
    expect(kinds(openingRows([], 4))).toBe('wwww');
  });

  it('are one set when there is neither a last time nor a plan', () => {
    expect(kinds(openingRows([]))).toBe('w');
    expect(kinds(openingRows([], null))).toBe('w');
    expect(kinds(openingRows([], 0))).toBe('w');
  });

  it('are last time’s sets, kind for kind and in order', () => {
    expect(kinds(openingRows([U, W, W, D]))).toBe('uwwd');
  });

  it('count a warm-up as one of the plan’s sets, not as one more', () => {
    // Four planned, done as a warm-up and three: four rows, not five.
    expect(kinds(openingRows([U, W, W, W], 4))).toBe('uwww');
  });

  it('keep more sets than the plan asks for, when more were done', () => {
    expect(kinds(openingRows([U, W, W, W, W], 4))).toBe('uwwww');
    expect(kinds(openingRows([W, W, W, W, W], 3))).toBe('wwwww');
  });

  it('are filled back up to the plan after a workout that was cut short', () => {
    expect(kinds(openingRows([W, W], 4))).toBe('wwww');
    // The warm-up still has its place among the four.
    expect(kinds(openingRows([U, W], 4))).toBe('uwww');
  });

  it('always include a working set', () => {
    expect(kinds(openingRows([U], 1))).toBe('uw');
    expect(kinds(openingRows([U, U]))).toBe('uuw');
  });

  it('do not start with a drop set, which has nothing above it to continue', () => {
    expect(kinds(openingRows([D, W]))).toBe('ww');
  });

  it('leave the list they were given alone', () => {
    const last = [U, W];
    openingRows(last, 4);
    expect(last).toEqual([U, W]);
  });
});
