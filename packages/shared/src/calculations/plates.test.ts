import { describe, expect, it } from 'vitest';

import {
  formatPlates,
  OLYMPIC_BAR,
  OLYMPIC_BAR_LB,
  platesPerSide,
  type BarSpec,
} from './plates.js';

describe('platesPerSide', () => {
  it('halves what is left after the bar, not the target', () => {
    // The mistake this exists to prevent: 100 kg is 40 per side on a 20 kg bar, not 50.
    const load = platesPerSide(100);
    expect(load.achieved).toBe(100);
    expect(load.remainder).toBe(0);
    // 40 a side, taken heaviest first.
    expect(load.perSide).toEqual([
      { plate: 25, count: 1 },
      { plate: 15, count: 1 },
    ]);
  });

  it('works down from the heaviest plate', () => {
    // 142.5 kg → 61.25 per side → 25 + 25 + 10 + 1.25.
    expect(formatPlates(platesPerSide(142.5))).toBe('25 + 25 + 10 + 1.25');
  });

  it('suggests nothing for the bare bar', () => {
    const load = platesPerSide(20);
    expect(load.perSide).toEqual([]);
    expect(load.remainder).toBe(0);
  });

  it('reports a target the plates cannot reach rather than rounding to one they can', () => {
    // 61 kg is 20.5 per side, and the smallest plate is 1.25. The honest answer is that it
    // cannot be loaded — a breakdown that quietly produced 60 would be believed.
    const load = platesPerSide(61);
    expect(load.achieved).toBe(60);
    expect(load.remainder).toBe(1);
  });

  it('warns rather than agrees when the target is under the bar', () => {
    // "No plates" would read as "you are ready to lift", which for 15 kg on a 20 kg bar is wrong.
    const load = platesPerSide(15);
    expect(load.perSide).toEqual([]);
    expect(load.remainder).toBe(-5);
  });

  it('does not lose a plate to floating-point drift', () => {
    // 0.1 + 0.2 arithmetic on repeated 1.25 subtractions is exactly where a plate goes missing.
    expect(platesPerSide(62.5).remainder).toBe(0);
    expect(formatPlates(platesPerSide(62.5))).toBe('20 + 1.25');
  });

  it('respects a gym that stocks nothing small', () => {
    const heavyOnly: BarSpec = { kg: 20, plates: [25, 20] };
    // 110 kg is 45 a side: 25 + 20, exactly.
    expect(platesPerSide(110, heavyOnly).remainder).toBe(0);
    // 112.5 needs a 1.25 this gym does not own, and says so instead of rounding down quietly.
    expect(platesPerSide(112.5, heavyOnly).remainder).toBe(2.5);
  });

  it('reports the shortfall when greedy strands a plate it could have avoided', () => {
    // 40 a side is 20 + 20, but greedy takes a 25 first and cannot place the last 15. Left as
    // it is: `remainder` shows the gap, and a suggestion the lifter can see is short is one
    // they can finish themselves. Solving it properly would only matter to a gym that stocks
    // 25s and 20s and nothing else.
    const heavyOnly: BarSpec = { kg: 20, plates: [25, 20] };
    const load = platesPerSide(100, heavyOnly);
    expect(load.perSide).toEqual([{ plate: 25, count: 1 }]);
    expect(load.remainder).toBe(30);
  });

  it('handles a pound gym', () => {
    // 225 lb on a 45 lb bar is the classic two-plates-a-side.
    const load = platesPerSide(225, OLYMPIC_BAR_LB);
    expect(load.perSide).toEqual([{ plate: 45, count: 2 }]);
    expect(load.remainder).toBe(0);
  });

  it('refuses to invent a loading from a broken number', () => {
    expect(platesPerSide(Number.NaN).perSide).toEqual([]);
    expect(platesPerSide(Number.POSITIVE_INFINITY).perSide).toEqual([]);
  });
});

describe('formatPlates', () => {
  it('repeats a plate rather than multiplying it', () => {
    // The reader is about to pick up that many discs; counting them beats parsing "2×20".
    expect(formatPlates(platesPerSide(140))).toBe('25 + 25 + 10');
  });

  it('is empty when there is nothing to load', () => {
    expect(formatPlates(platesPerSide(OLYMPIC_BAR.kg))).toBe('');
  });
});
