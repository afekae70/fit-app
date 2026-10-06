/**
 * A smooth curve through measured points — the geometry of a trend line.
 *
 * A trend is a function of time, and it should look like one: a single continuous line, not a row
 * of separate marks at separate heights. This turns points into that line, as SVG path data.
 *
 * ## Why this curve and not a rounder one
 *
 * The obvious smooth curve — a Catmull-Rom or a cardinal spline — bulges. Between a point at 80.2
 * and the next at 80.2 it will happily swing up to 80.5 and back, because its tangents come from
 * the neighbours on either side. On a weight chart that is the graph inventing a weight nobody
 * weighed: a peak above the highest reading, a dip below the lowest.
 *
 * So this is monotone cubic interpolation (Fritsch–Carlson, the same idea as d3's
 * `curveMonotoneX`). It is as smooth as a cubic can be while promising one thing: between two
 * points the curve never leaves the range those two points span. A local high stays the high, a
 * flat stretch stays flat, and the line passes through every reading exactly.
 *
 * All pure. The component that draws it supplies pixels and gets a string back.
 */

export interface XY {
  x: number;
  y: number;
}

/** One cubic Bézier piece of the curve: two control points and where it lands. */
export interface CurveSegment {
  c1: XY;
  c2: XY;
  end: XY;
}

/**
 * Drop anything that cannot be drawn, and anything that does not move forward.
 *
 * The curve is a function of x, so x has to strictly increase. Two readings that land on the same
 * pixel — two weigh-ins minutes apart on a chart a year wide — would otherwise be a division by
 * zero; the later one wins, since it is the more recent truth about that moment.
 */
function forward(points: readonly XY[]): XY[] {
  const out: XY[] = [];
  for (const point of points) {
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) continue;
    const last = out[out.length - 1];
    if (last && point.x <= last.x) {
      if (point.x === last.x) out[out.length - 1] = point;
      continue;
    }
    out.push(point);
  }
  return out;
}

/**
 * The tangent at each point.
 *
 * At a point where the data turns around — up then down — the tangent is flat, which is what
 * keeps a peak a peak. Elsewhere it is a weighted harmonic mean of the slopes on either side:
 * harmonic rather than arithmetic because it is pulled toward the gentler slope, and it is the
 * steep one that causes overshoot.
 */
function tangents(points: readonly XY[]): number[] {
  const n = points.length;
  const widths: number[] = [];
  const slopes: number[] = [];
  for (let i = 0; i < n - 1; i += 1) {
    const h = points[i + 1]!.x - points[i]!.x;
    widths.push(h);
    slopes.push((points[i + 1]!.y - points[i]!.y) / h);
  }

  const m: number[] = new Array<number>(n).fill(0);
  m[0] = slopes[0] ?? 0;
  m[n - 1] = slopes[n - 2] ?? 0;

  for (let i = 1; i < n - 1; i += 1) {
    const before = slopes[i - 1]!;
    const after = slopes[i]!;
    if (before * after <= 0) {
      m[i] = 0;
      continue;
    }
    const hBefore = widths[i - 1]!;
    const hAfter = widths[i]!;
    m[i] =
      (3 * (hBefore + hAfter)) /
      ((2 * hAfter + hBefore) / before + (hAfter + 2 * hBefore) / after);
  }
  return m;
}

/**
 * The curve as Bézier pieces, one per gap between points.
 *
 * Exposed apart from the path string because the pieces are what can be checked: that each one
 * ends on its reading, and that no control point strays outside the two readings it joins.
 */
export function curveSegments(input: readonly XY[]): CurveSegment[] {
  const points = forward(input);
  if (points.length < 2) return [];

  const m = tangents(points);
  const segments: CurveSegment[] = [];
  for (let i = 0; i < points.length - 1; i += 1) {
    const from = points[i]!;
    const to = points[i + 1]!;
    const third = (to.x - from.x) / 3;
    segments.push({
      c1: { x: from.x + third, y: from.y + m[i]! * third },
      c2: { x: to.x - third, y: to.y - m[i + 1]! * third },
      end: to,
    });
  }
  return segments;
}

/** Two decimals is a hundredth of a pixel, and keeps the path string short. */
function n(value: number): string {
  return String(Math.round(value * 100) / 100);
}

/**
 * The curve as SVG path data. Empty for no points; a lone point is a move with nothing after it,
 * which draws nothing — the caller marks a single reading with a dot instead.
 */
export function smoothPath(input: readonly XY[]): string {
  const points = forward(input);
  const first = points[0];
  if (!first) return '';

  const pieces = curveSegments(points).map(
    ({ c1, c2, end }) => `C${n(c1.x)},${n(c1.y)} ${n(c2.x)},${n(c2.y)} ${n(end.x)},${n(end.y)}`,
  );
  return [`M${n(first.x)},${n(first.y)}`, ...pieces].join(' ');
}

/**
 * The same curve closed down to a baseline — the shape that is filled underneath the line.
 *
 * Needs two points: an area under a single reading has no width.
 */
export function areaPath(input: readonly XY[], baseline: number): string {
  const points = forward(input);
  const first = points[0];
  const last = points[points.length - 1];
  if (!first || !last || points.length < 2) return '';

  return `${smoothPath(points)} L${n(last.x)},${n(baseline)} L${n(first.x)},${n(baseline)} Z`;
}

/**
 * Which point a finger at `x` is on: the nearest one.
 *
 * Nearest by position, not by dividing the width evenly — the points are placed by date, so two
 * weigh-ins a day apart sit closer together than two a fortnight apart, and an even split would
 * report the wrong one.
 */
export function nearestIndex(xs: readonly number[], x: number): number {
  let best = -1;
  let distance = Infinity;
  for (let i = 0; i < xs.length; i += 1) {
    const d = Math.abs(xs[i]! - x);
    if (d < distance) {
      distance = d;
      best = i;
    }
  }
  return best;
}

export interface PlotBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** One measurement: when, and how much. */
export interface Reading {
  time: number;
  value: number;
}

/** What the plot spans: the first and last moment, and the values at its bottom and top. */
export interface TrendDomain {
  start: number;
  end: number;
  low: number;
  high: number;
}

function usable(readings: readonly Reading[]): Reading[] {
  return readings.filter((r) => Number.isFinite(r.time) && Number.isFinite(r.value));
}

/**
 * The span that holds every series drawn on one plot.
 *
 * Taken across all of them together, because they share one scale. The trend is an average and
 * so never reaches as high or as low as the weigh-ins it is an average *of* — scale the plot to
 * the trend alone and the highest weigh-in is drawn off the top of it.
 *
 * A set of readings with no spread — the same weight every time — is given a nominal band and
 * drawn through the middle of it, rather than divided by zero or pinned to an edge where it would
 * look like a floor or a ceiling.
 */
export function trendDomain(
  series: readonly (readonly Reading[])[],
  /** The smallest spread worth drawing as a slope, in the value's own units. */
  minimumSpread = 1,
): TrendDomain | null {
  const all = series.flatMap((readings) => usable(readings));
  if (all.length === 0) return null;

  const times = all.map((r) => r.time);
  const values = all.map((r) => r.value);
  let low = Math.min(...values);
  let high = Math.max(...values);
  if (high - low < minimumSpread) {
    const middle = (high + low) / 2;
    low = middle - minimumSpread / 2;
    high = middle + minimumSpread / 2;
  }

  return { start: Math.min(...times), end: Math.max(...times), low, high };
}

/**
 * Place readings in a box: left to right by time, bottom to top by value.
 *
 * By *time*, not by position in the list. Seven weigh-ins in one week and then one a month later
 * are not eight evenly spaced events, and drawing them that way makes a month of nothing look
 * like a day.
 */
export function placeTrend(
  readings: readonly Reading[],
  box: PlotBox,
  domain: TrendDomain,
): XY[] {
  const kept = usable(readings);
  const span = domain.end - domain.start;

  return kept.map((reading, index) => {
    // Everything at one instant, or a single reading: spread by order, since there is no time
    // to spread by.
    const along =
      span > 0 ? (reading.time - domain.start) / span : kept.length > 1 ? index / (kept.length - 1) : 0.5;
    return {
      x: box.left + along * box.width,
      y: box.top + (1 - (reading.value - domain.low) / (domain.high - domain.low)) * box.height,
    };
  });
}

export interface TrendLayout {
  /** Where each reading is drawn, in the same order it was given. */
  points: XY[];
  /** The values at the bottom and the top of the plot — not always the data's own extremes. */
  low: number;
  high: number;
}

/** One series on a plot of its own: its domain, and its readings placed in it. */
export function layoutTrend(
  readings: readonly Reading[],
  box: PlotBox,
  minimumSpread = 1,
): TrendLayout {
  const domain = trendDomain([readings], minimumSpread);
  if (!domain) return { points: [], low: 0, high: 0 };
  return { points: placeTrend(readings, box, domain), low: domain.low, high: domain.high };
}
