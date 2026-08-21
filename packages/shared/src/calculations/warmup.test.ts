import { describe, expect, it } from 'vitest';

import { warmupRamp } from './warmup.js';

describe('warmupRamp', () => {
  it('ramps to a heavy working weight', () => {
    // 100 kg → 40 / 60 / 80, with reps falling as the weight climbs.
    expect(warmupRamp(100)).toEqual([
      { weight: 40, reps: 5 },
      { weight: 60, reps: 3 },
      { weight: 80, reps: 2 },
    ]);
  });

  it('rounds down, never up', () => {
    // 85 kg: 40% is 34, which is not loadable; 32.5 is. Rounding up would put 35 on the bar,
    // and a warm-up that overshoots is a working set nobody planned.
    const ramp = warmupRamp(85);
    expect(ramp[0]?.weight).toBe(32.5);
    expect(ramp.every((set) => set.weight < 85)).toBe(true);
  });

  it('starts at the bare bar rather than proposing something unloadable', () => {
    // 50 kg: 40% is 20, exactly the bar. 60% is 30. The first step is the empty bar, which is
    // a real warm-up set and the one most worth doing.
    expect(warmupRamp(50)).toEqual([
      { weight: 20, reps: 5 },
      { weight: 30, reps: 3 },
      { weight: 40, reps: 2 },
    ]);
  });

  it('collapses steps that land on the same weight', () => {
    // 30 kg: 40% floors to 10 and 60% to 17.5, and both are under the bar, so both become the
    // bare bar — which is offered once. The same weight twice is a rep scheme, not a warm-up.
    expect(warmupRamp(30)).toEqual([
      { weight: 20, reps: 5 },
      { weight: 22.5, reps: 2 },
    ]);
  });

  it('offers nothing for the bare bar', () => {
    // There is nothing lighter to lift, and a set the user then has to delete is worse than
    // no suggestion at all.
    expect(warmupRamp(20)).toEqual([]);
    expect(warmupRamp(15)).toEqual([]);
  });

  it('never proposes the working weight itself', () => {
    for (const working of [22.5, 25, 27.5, 35, 42.5, 60, 137.5]) {
      expect(warmupRamp(working).every((set) => set.weight < working)).toBe(true);
    }
  });

  it('respects a different smallest increment', () => {
    // A dumbbell rack in 5 kg steps should never be told to pick up 32.5.
    const ramp = warmupRamp(100, { bar: null, increment: 5 });
    expect(ramp.every((set) => set.weight % 5 === 0)).toBe(true);
  });

  it('works without a bar at all', () => {
    // Dumbbells and stacks have no bare-bar floor; the smallest increment is the floor.
    // 80% of 40 is 32, which floors to 30 rather than reaching for 32.5.
    expect(warmupRamp(40, { bar: null, increment: 2.5 })).toEqual([
      { weight: 15, reps: 5 },
      { weight: 22.5, reps: 3 },
      { weight: 30, reps: 2 },
    ]);
  });

  it('refuses to invent a ramp from a broken number', () => {
    expect(warmupRamp(Number.NaN)).toEqual([]);
    expect(warmupRamp(0)).toEqual([]);
    expect(warmupRamp(-50)).toEqual([]);
  });
});
