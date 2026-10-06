/**
 * The trend curve, checked for the one thing a smooth line is tempted to do: lie.
 *
 * A rounder spline would look just as good and would draw a peak above the highest weigh-in.
 * Most of this file is about that — the curve must pass through every reading and must not leave
 * the range of the two readings it is travelling between.
 */

import { describe, expect, it } from 'vitest';

import {
  areaPath,
  curveSegments,
  layoutTrend,
  nearestIndex,
  placeTrend,
  smoothPath,
  trendDomain,
  type XY,
} from './curve.js';

/** A point on a cubic Bézier, for sampling the curve between its ends. */
function bezier(from: XY, c1: XY, c2: XY, to: XY, t: number): XY {
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const c = 3 * u * t * t;
  const d = t * t * t;
  return {
    x: a * from.x + b * c1.x + c * c2.x + d * to.x,
    y: a * from.y + b * c1.y + c * c2.y + d * to.y,
  };
}

/** Every piece of the curve sampled finely, with the two readings it runs between. */
function sampled(points: XY[]): { from: XY; to: XY; at: XY }[] {
  const out: { from: XY; to: XY; at: XY }[] = [];
  curveSegments(points).forEach((segment, index) => {
    const from = points[index]!;
    for (let step = 0; step <= 20; step += 1) {
      out.push({ from, to: segment.end, at: bezier(from, segment.c1, segment.c2, segment.end, step / 20) });
    }
  });
  return out;
}

// A real-looking month: down, a plateau, a bump, down again.
const weights: XY[] = [
  { x: 0, y: 82.4 },
  { x: 10, y: 81.9 },
  { x: 20, y: 81.9 },
  { x: 35, y: 82.3 },
  { x: 50, y: 81.2 },
  { x: 60, y: 80.8 },
];

describe('curveSegments', () => {
  it('passes through every reading', () => {
    const ends = curveSegments(weights).map((segment) => segment.end);
    expect(ends).toEqual(weights.slice(1));
  });

  it('never leaves the range of the two readings it is between', () => {
    // The whole point of choosing this curve. A hair of tolerance for floating point, nothing
    // that could be seen.
    for (const { from, to, at } of sampled(weights)) {
      expect(at.y).toBeGreaterThanOrEqual(Math.min(from.y, to.y) - 1e-9);
      expect(at.y).toBeLessThanOrEqual(Math.max(from.y, to.y) + 1e-9);
    }
  });

  it('keeps a flat stretch flat', () => {
    const plateau = sampled(weights).filter(({ from, to }) => from.y === to.y);
    expect(plateau.length).toBeGreaterThan(0);
    for (const { from, at } of plateau) expect(at.y).toBeCloseTo(from.y, 9);
  });

  it('always moves forward in time', () => {
    const xs = sampled(weights).map(({ at }) => at.x);
    for (let i = 1; i < xs.length; i += 1) expect(xs[i]!).toBeGreaterThanOrEqual(xs[i - 1]! - 1e-9);
  });

  it('joins two readings with a straight line', () => {
    const [only] = curveSegments([
      { x: 0, y: 0 },
      { x: 30, y: 60 },
    ]);
    // Control points on the line itself: a cubic through two points with nothing to bend toward.
    expect(only?.c1).toEqual({ x: 10, y: 20 });
    expect(only?.c2).toEqual({ x: 20, y: 40 });
  });

  it('has nothing to draw for fewer than two readings', () => {
    expect(curveSegments([])).toEqual([]);
    expect(curveSegments([{ x: 5, y: 5 }])).toEqual([]);
  });

  it('survives two readings on the same pixel', () => {
    // Two weigh-ins minutes apart on a chart a year wide. The later one is kept; nothing divides
    // by zero.
    const segments = curveSegments([
      { x: 0, y: 80 },
      { x: 10, y: 81 },
      { x: 10, y: 82 },
      { x: 20, y: 80 },
    ]);
    expect(segments.map((s) => s.end)).toEqual([
      { x: 10, y: 82 },
      { x: 20, y: 80 },
    ]);
    for (const { c1, c2 } of segments) {
      expect(Number.isFinite(c1.y)).toBe(true);
      expect(Number.isFinite(c2.y)).toBe(true);
    }
  });

  it('ignores a reading that is not a number', () => {
    const segments = curveSegments([
      { x: 0, y: 80 },
      { x: 10, y: Number.NaN },
      { x: 20, y: 81 },
    ]);
    expect(segments).toHaveLength(1);
    expect(segments[0]?.end).toEqual({ x: 20, y: 81 });
  });
});

describe('smoothPath', () => {
  it('starts on the first reading and runs a curve to each of the rest', () => {
    const path = smoothPath(weights);
    expect(path.startsWith('M0,82.4 C')).toBe(true);
    expect(path.match(/C/g)).toHaveLength(weights.length - 1);
    expect(path.endsWith('60,80.8')).toBe(true);
  });

  it('is empty when there is nothing to draw', () => {
    expect(smoothPath([])).toBe('');
  });

  it('never writes a number that is not one', () => {
    expect(smoothPath(weights)).not.toMatch(/NaN|Infinity/);
  });
});

describe('areaPath', () => {
  it('closes the curve down to the baseline and back', () => {
    const path = areaPath(weights, 100);
    expect(path.startsWith(smoothPath(weights))).toBe(true);
    expect(path.endsWith('L60,100 L0,100 Z')).toBe(true);
  });

  it('has no area under a single reading', () => {
    expect(areaPath([{ x: 5, y: 5 }], 100)).toBe('');
  });
});

describe('nearestIndex', () => {
  it('finds the reading under the finger', () => {
    expect(nearestIndex([0, 10, 20, 100], 12)).toBe(1);
    expect(nearestIndex([0, 10, 20, 100], 70)).toBe(3);
  });

  it('goes by distance, not by an even split of the width', () => {
    // Readings bunched at the left: halfway across is still nearest the last of the bunch.
    expect(nearestIndex([0, 5, 10, 100], 50)).toBe(2);
  });

  it('holds at the ends', () => {
    expect(nearestIndex([0, 10, 20], -50)).toBe(0);
    expect(nearestIndex([0, 10, 20], 500)).toBe(2);
  });

  it('has no answer with no readings', () => {
    expect(nearestIndex([], 10)).toBe(-1);
  });
});

describe('layoutTrend', () => {
  const box = { left: 40, top: 10, width: 200, height: 100 };
  const day = 86_400_000;

  it('puts the highest reading at the top and the lowest at the bottom', () => {
    const { points, low, high } = layoutTrend(
      [
        { time: 0, value: 80 },
        { time: day, value: 82 },
        { time: 2 * day, value: 81 },
      ],
      box,
    );

    expect(low).toBe(80);
    expect(high).toBe(82);
    expect(points[0]).toEqual({ x: 40, y: 110 });
    expect(points[1]).toEqual({ x: 140, y: 10 });
    expect(points[2]).toEqual({ x: 240, y: 60 });
  });

  it('spaces readings by when they were taken, not by how many there are', () => {
    // Two days running, then nothing for eight: the third reading belongs at the far edge and
    // the second a tenth of the way along, not in the middle.
    const { points } = layoutTrend(
      [
        { time: 0, value: 80 },
        { time: day, value: 81 },
        { time: 10 * day, value: 82 },
      ],
      box,
    );

    expect(points[1]?.x).toBeCloseTo(60, 9);
    expect(points[2]?.x).toBeCloseTo(240, 9);
  });

  it('draws a series that never moves through the middle', () => {
    const { points, low, high } = layoutTrend(
      [
        { time: 0, value: 80 },
        { time: day, value: 80 },
      ],
      box,
    );

    expect(high - low).toBe(1);
    expect(points.every((p) => p.y === 60)).toBe(true);
  });

  it('centres a single reading', () => {
    const { points } = layoutTrend([{ time: 5, value: 80 }], box);
    expect(points).toEqual([{ x: 140, y: 60 }]);
  });

  it('has nothing to place with no readings', () => {
    expect(layoutTrend([], box).points).toEqual([]);
  });
});

describe('two series on one plot', () => {
  const box = { left: 40, top: 10, width: 200, height: 100 };
  const day = 86_400_000;

  // Three weigh-ins, and the average that trails them: it never gets as low as the last one.
  const weighIns = [
    { time: 0, value: 82 },
    { time: day, value: 81 },
    { time: 2 * day, value: 80 },
  ];
  const average = [
    { time: 0, value: 82 },
    { time: day, value: 81.5 },
    { time: 2 * day, value: 81 },
  ];

  it('scales to the weigh-ins as well as the average of them', () => {
    // The whole reason for a shared domain. Scaled to the average alone the plot would stop at
    // 81, and the weigh-in at 80 — the one the user just did — would be drawn below the box.
    const domain = trendDomain([average, weighIns]);
    expect(domain).toEqual({ start: 0, end: 2 * day, low: 80, high: 82 });

    const dots = placeTrend(weighIns, box, domain!);
    for (const dot of dots) {
      expect(dot.y).toBeGreaterThanOrEqual(box.top);
      expect(dot.y).toBeLessThanOrEqual(box.top + box.height);
    }
    expect(dots[2]).toEqual({ x: 240, y: 110 });
  });

  it('puts a weigh-in and its average on the same vertical line', () => {
    const domain = trendDomain([average, weighIns])!;
    const dots = placeTrend(weighIns, box, domain);
    const curve = placeTrend(average, box, domain);

    expect(dots.map((p) => p.x)).toEqual(curve.map((p) => p.x));
    // And apart vertically by what the average smoothed away: half a kilo of twenty, a quarter
    // of the box.
    expect(curve[1]!.y - dots[1]!.y).toBeCloseTo(-25, 9);
  });

  it('spans the earliest and latest moment of either series', () => {
    const domain = trendDomain([
      [{ time: 5 * day, value: 80 }],
      [
        { time: day, value: 81 },
        { time: 9 * day, value: 82 },
      ],
    ]);
    expect(domain?.start).toBe(day);
    expect(domain?.end).toBe(9 * day);
  });

  it('has no domain with nothing to draw', () => {
    expect(trendDomain([[], []])).toBeNull();
  });
});
