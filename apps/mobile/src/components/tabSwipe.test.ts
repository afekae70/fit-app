import { describe, expect, it } from 'vitest';

import { SWIPE_DISTANCE, tabAfterSwipe } from './tabSwipe.js';

const COUNT = 4;

describe('swiping between tabs', () => {
  it('moves forward when dragged from left to right', () => {
    expect(tabAfterSwipe(120, 0, COUNT)).toBe(1);
    expect(tabAfterSwipe(120, 2, COUNT)).toBe(3);
  });

  it('goes back when dragged the other way', () => {
    expect(tabAfterSwipe(-120, 2, COUNT)).toBe(1);
  });

  it('ignores a drag too short to have been meant', () => {
    expect(tabAfterSwipe(SWIPE_DISTANCE - 1, 1, COUNT)).toBeNull();
    expect(tabAfterSwipe(-(SWIPE_DISTANCE - 1), 1, COUNT)).toBeNull();
    expect(tabAfterSwipe(0, 1, COUNT)).toBeNull();
  });

  it('stops at both ends rather than wrapping around', () => {
    expect(tabAfterSwipe(-120, 0, COUNT)).toBeNull();
    expect(tabAfterSwipe(120, COUNT - 1, COUNT)).toBeNull();
  });

  it('takes a drag exactly at the threshold', () => {
    expect(tabAfterSwipe(SWIPE_DISTANCE, 0, COUNT)).toBe(1);
  });
});
