import { describe, expect, it } from 'vitest';

import { adoptGhost, ghostsFor, type GhostSource } from './ghost.js';

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

  it('does not offer a set that held nothing', () => {
    expect(ghostsFor(rows('w', 'w'), [work(null, null), work(100, 8)])).toEqual([
      null,
      { weightKg: 100, reps: 8 },
    ]);
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
