import { describe, expect, it } from 'vitest';

import { resolveDropIndex, restingOffset, shiftForIndex } from './dragMath.js';

/** Four exercise cards of realistic, deliberately unequal heights. */
const HEIGHTS = [200, 300, 150, 250];

describe('resolveDropIndex', () => {
  it('stays put until the neighbour is half covered', () => {
    // Row 1 is 300 tall, so row 0 holds its place until it has travelled 150.
    expect(resolveDropIndex(HEIGHTS, 0, 100)).toBe(0);
    expect(resolveDropIndex(HEIGHTS, 0, 149)).toBe(0);
    expect(resolveDropIndex(HEIGHTS, 0, 151)).toBe(1);
  });

  it('uses each neighbour\u2019s own height, not an average', () => {
    // Past row 1 (300) at 150; past row 2 (150) at 300 + 75 = 375, not at some uniform step.
    expect(resolveDropIndex(HEIGHTS, 0, 374)).toBe(1);
    expect(resolveDropIndex(HEIGHTS, 0, 376)).toBe(2);
  });

  it('moves upward on a negative drag', () => {
    // Row 3 rising past row 2 (150) needs 75.
    expect(resolveDropIndex(HEIGHTS, 3, -74)).toBe(3);
    expect(resolveDropIndex(HEIGHTS, 3, -76)).toBe(2);
  });

  it('carries the first row all the way to the end', () => {
    // The reported case: a lift written first that should be done last.
    expect(resolveDropIndex(HEIGHTS, 0, 10_000)).toBe(3);
  });

  it('clamps at both ends rather than running off the list', () => {
    expect(resolveDropIndex(HEIGHTS, 3, 10_000)).toBe(3);
    expect(resolveDropIndex(HEIGHTS, 0, -10_000)).toBe(0);
  });

  it('does not jump a short row while a tall one is only half covered', () => {
    // Rows of 400 then 20: without stopping at the first uncleared neighbour, a drag of 250
    // would sail past both and land two places down.
    expect(resolveDropIndex([100, 400, 20], 0, 250)).toBe(1);
  });

  it('returns the index unchanged for an out-of-range row', () => {
    expect(resolveDropIndex(HEIGHTS, 9, 500)).toBe(9);
    expect(resolveDropIndex([], 0, 500)).toBe(0);
  });
});

describe('shiftForIndex', () => {
  it('slides the rows a downward drag passed up by exactly the dragged height', () => {
    // Row 0 (200 tall) moving to position 2: rows 1 and 2 close up behind it.
    expect(shiftForIndex(1, 0, 2, 200)).toBe(-200);
    expect(shiftForIndex(2, 0, 2, 200)).toBe(-200);
    // Row 3 was never passed, so it does not move.
    expect(shiftForIndex(3, 0, 2, 200)).toBe(0);
  });

  it('slides the rows an upward drag passed down', () => {
    expect(shiftForIndex(1, 3, 1, 250)).toBe(250);
    expect(shiftForIndex(2, 3, 1, 250)).toBe(250);
    expect(shiftForIndex(0, 3, 1, 250)).toBe(0);
  });

  it('never moves the dragged row itself — the finger owns that one', () => {
    expect(shiftForIndex(2, 2, 0, 150)).toBe(0);
  });

  it('leaves everything still when nothing has moved yet', () => {
    for (let i = 0; i < HEIGHTS.length; i++) expect(shiftForIndex(i, 1, 1, 300)).toBe(0);
  });
});

describe('restingOffset', () => {
  it('lands the card in the gap rather than under the finger', () => {
    // Row 0 to position 2 has to clear rows 1 and 2: 300 + 150.
    expect(restingOffset(HEIGHTS, 0, 2)).toBe(450);
  });

  it('is negative going up', () => {
    // Row 3 to position 1 rises over rows 1 and 2: 300 + 150.
    expect(restingOffset(HEIGHTS, 3, 1)).toBe(-450);
  });

  it('is zero when the row did not change place', () => {
    expect(restingOffset(HEIGHTS, 2, 2)).toBe(0);
  });
});
