import { describe, expect, it } from 'vitest';

import { stationMove, stripDropTarget } from './stripReorder.js';

describe('where a dragged picture lands', () => {
  it('moves one slot per slot-width travelled, rounding to the nearest', () => {
    expect(stripDropTarget(1, 70, 70, 5)).toBe(2);
    expect(stripDropTarget(1, 100, 70, 5)).toBe(2);
    expect(stripDropTarget(1, 110, 70, 5)).toBe(3);
    expect(stripDropTarget(3, -140, 70, 5)).toBe(1);
  });

  it('stays where it is for a short wobble', () => {
    expect(stripDropTarget(2, 20, 70, 5)).toBe(2);
    expect(stripDropTarget(2, -30, 70, 5)).toBe(2);
  });

  it('never leaves the strip', () => {
    expect(stripDropTarget(0, -500, 70, 5)).toBe(0);
    expect(stripDropTarget(4, 900, 70, 5)).toBe(4);
  });
});

describe('which exercise moves where', () => {
  // Stations: [0] [1,2 superset] [3] [4]
  const groups = [[0], [1, 2], [3], [4]];

  it('moves a single exercise forward to the end of the target station', () => {
    expect(stationMove(groups, 0, 2)).toEqual({ fromIndex: 0, toIndex: 3 });
    expect(stationMove(groups, 0, 1)).toEqual({ fromIndex: 0, toIndex: 2 });
  });

  it('moves a single exercise back to the start of the target station', () => {
    expect(stationMove(groups, 2, 1)).toEqual({ fromIndex: 3, toIndex: 1 });
    expect(stationMove(groups, 3, 0)).toEqual({ fromIndex: 4, toIndex: 0 });
  });

  it('leaves a superset alone rather than pulling one half out', () => {
    expect(stationMove(groups, 1, 3)).toBeNull();
    expect(stationMove(groups, 1, 0)).toBeNull();
  });

  it('does nothing for a drop on its own slot', () => {
    expect(stationMove(groups, 2, 2)).toBeNull();
  });
});
