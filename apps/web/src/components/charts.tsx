/**
 * The dashboard's charts, drawn as plain SVG.
 *
 * No charting library: four small charts do not need one, and drawing them here keeps them to
 * the marks the dataviz guidance asks for — bars no thicker than 24px with rounded tops, 2px
 * lines, an end-dot with a ring in the card's colour, hairline gridlines, one axis, and a hover
 * readout that never holds a value the table view does not also show.
 *
 * Time runs from right to left, oldest on the right, as the app's own charts do in Hebrew: a
 * reader of a right-to-left page starts at the right.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import type { DayOutcome } from '@fit/shared/coaching';

import { he } from '../i18n/he.js';
import { compact, niceMax } from '../lib/chartMath.js';
import { formatDayLong } from '../lib/format.js';

/* ------------------------------------------------------------------ measuring */

/** The width of an element, kept up to date. Charts draw at real pixels, so text stays text-sized. */
function useWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWidth(Math.floor(entry.contentRect.width));
    });
    observer.observe(element);
    setWidth(Math.floor(element.getBoundingClientRect().width));
    return () => observer.disconnect();
  }, []);
  return [ref, width];
}

/* ------------------------------------------------------------------ the frame */

/** A chart with a switch to the same numbers as a table — the version a screen reader reads. */
export function ChartFrame({ chart, table }: { chart: ReactNode; table: ReactNode }) {
  const [asTable, setAsTable] = useState(false);
  return (
    <>
      {asTable ? table : chart}
      <button
        type="button"
        className="button ghost small table-toggle"
        onClick={() => setAsTable((on) => !on)}
      >
        {asTable ? he.charts.hideTable : he.charts.showTable}
      </button>
    </>
  );
}

interface Tip {
  x: number;
  y: number;
  title: string;
  rows: { label: string; value: string; colour?: string }[];
}

function Tooltip({ tip }: { tip: Tip | null }) {
  if (!tip) return null;
  return (
    <div className="tooltip" style={{ left: tip.x, top: tip.y }} role="status">
      <div className="tooltip-title">{tip.title}</div>
      {tip.rows.map((row) => (
        <div className="tooltip-row" key={row.label}>
          {row.colour ? <span className="tooltip-key" style={{ background: row.colour }} /> : null}
          <strong>{row.value}</strong>
          <span>{row.label}</span>
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ bars */

export interface Bar {
  key: string;
  /** Under the bar, when there is room for it. */
  axisLabel: string;
  value: number;
  /** The readout's heading. */
  title: string;
}

const PAD = { top: 12, bottom: 26, start: 44, end: 8 };

/**
 * One series of bars on a zero baseline — a week's volume, a week's workouts.
 *
 * Bars grow from the baseline and are never thicker than 24px, so a twelve-week chart is
 * twelve marks with air between them rather than a wall. The axis is labelled at zero, half and
 * the top, in round numbers.
 */
export function BarChart({
  bars,
  format,
  height = 220,
  valueLabel,
  whole = false,
  reference,
}: {
  bars: readonly Bar[];
  format: (value: number) => string;
  height?: number;
  valueLabel: string;
  /** Counts: the axis says 0, 2, 4 — never two and a half workouts. */
  whole?: boolean;
  /** A dashed line across the bars — a daily target — named in the readout beside the bar. */
  reference?: { value: number; label: string } | undefined;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);

  const highest = Math.max(0, reference?.value ?? 0, ...bars.map((bar) => bar.value));
  // An even top, so the middle tick is a whole number too.
  const top = whole ? Math.max(2, Math.ceil(highest / 2) * 2) : niceMax(highest);
  const plotWidth = Math.max(0, width - PAD.start - PAD.end);
  const plotHeight = height - PAD.top - PAD.bottom;
  const slot = bars.length > 0 ? plotWidth / bars.length : 0;
  const barWidth = Math.max(2, Math.min(24, slot * 0.62));
  const y = (value: number) => PAD.top + plotHeight - (value / top) * plotHeight;
  // Right to left: the first bar, the oldest, at the right.
  const centre = (index: number) => width - PAD.start - (index + 0.5) * slot;
  // As many axis labels as fit, about 64px apart, always including the newest.
  const every = Math.max(1, Math.ceil(64 / Math.max(1, slot)));

  const hovered = hover === null ? null : bars[hover];
  const tip: Tip | null = hovered
    ? {
        x: centre(hover!),
        y: y(hovered.value),
        title: hovered.title,
        rows: [
          { label: valueLabel, value: format(hovered.value) },
          ...(reference ? [{ label: reference.label, value: format(reference.value) }] : []),
        ],
      }
    : null;

  return (
    <div className="chart" ref={ref}>
      {width > 0 ? (
        <svg height={height} role="img" aria-label={valueLabel} onMouseLeave={() => setHover(null)}>
          {[0, top / 2, top].map((tick) => (
            <g key={tick}>
              <line
                className="grid-line"
                x1={PAD.end}
                x2={width - PAD.start}
                y1={y(tick)}
                y2={y(tick)}
              />
              <text className="axis-text" x={width - PAD.start + 6} y={y(tick) + 4}>
                {compact(tick)}
              </text>
            </g>
          ))}
          {bars.map((bar, index) => {
            const x = centre(index) - barWidth / 2;
            const barTop = y(bar.value);
            const barHeight = PAD.top + plotHeight - barTop;
            const radius = Math.min(4, barWidth / 2, barHeight);
            return (
              <g key={bar.key}>
                {bar.value > 0 ? (
                  <path
                    d={roundedTop(x, barTop, barWidth, barHeight, radius)}
                    fill="var(--series-1)"
                    opacity={hover === null || hover === index ? 1 : 0.55}
                  />
                ) : null}
                {(bars.length - 1 - index) % every === 0 ? (
                  <text className="axis-text" x={centre(index)} y={height - 8} textAnchor="middle">
                    {bar.axisLabel}
                  </text>
                ) : null}
                <rect
                  className="hit"
                  x={centre(index) - slot / 2}
                  y={PAD.top}
                  width={slot}
                  height={plotHeight}
                  tabIndex={0}
                  aria-label={`${bar.title}: ${format(bar.value)}`}
                  onMouseEnter={() => setHover(index)}
                  onFocus={() => setHover(index)}
                  onBlur={() => setHover(null)}
                />
              </g>
            );
          })}
          {reference ? (
            <g pointerEvents="none">
              <line
                className="reference-line"
                x1={PAD.end}
                x2={width - PAD.start}
                y1={y(reference.value)}
                y2={y(reference.value)}
              />
              <text className="axis-text reference-text" x={PAD.end} y={y(reference.value) - 6}>
                {reference.label} {format(reference.value)}
              </text>
            </g>
          ) : null}
        </svg>
      ) : (
        <div style={{ height }} />
      )}
      <Tooltip tip={tip} />
    </div>
  );
}

/** A bar's shape: square at the baseline, rounded at the data end. */
function roundedTop(x: number, y: number, w: number, h: number, r: number): string {
  if (h <= 0) return '';
  return [
    `M${x},${y + h}`,
    `V${y + r}`,
    `Q${x},${y} ${x + r},${y}`,
    `H${x + w - r}`,
    `Q${x + w},${y} ${x + w},${y + r}`,
    `V${y + h}`,
    'Z',
  ].join(' ');
}

/* ------------------------------------------------------------------ lines */

export interface LinePoint {
  /** Milliseconds, for the time axis. */
  t: number;
  value: number;
  /** The local day, for the readout. */
  day: string;
  detail?: string;
}

export interface LineSeries {
  key: string;
  label: string;
  /** `var(--series-n)`, in the fixed order. */
  colour: string;
  points: readonly LinePoint[];
  /**
   * `dots`: each point on its own, unjoined and lighter — for noisy daily readings drawn under
   * the line that averages them. A line by default.
   */
  kind?: 'line' | 'dots';
}

/**
 * Up to three lines on one time axis — a lift's estimated one-rep max over the period.
 *
 * The axis does not start at zero: a line's job is the change, and from zero a 5% gain is a
 * flat line. The readout follows the pointer to the nearest workout and lists every line's
 * figure there, so nobody has to aim at a 2px line.
 */
export function LineChart({
  series,
  from,
  to,
  format,
  height = 260,
  label = he.charts.strength,
}: {
  series: readonly LineSeries[];
  /** The ends of the time axis, in milliseconds. */
  from: number;
  to: number;
  format: (value: number) => string;
  height?: number;
  /** What the chart is, for a screen reader. */
  label?: string;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hoverT, setHoverT] = useState<number | null>(null);
  const pad = { top: 16, bottom: 26, start: 48, end: 12 };

  const values = series.flatMap((line) => line.points.map((point) => point.value));
  const low = values.length > 0 ? Math.min(...values) : 0;
  const high = values.length > 0 ? Math.max(...values) : 1;
  const span = Math.max(high - low, high * 0.1, 1);
  const yMin = Math.max(0, Math.floor((low - span * 0.15) / 5) * 5);
  const yMax = Math.ceil((high + span * 0.15) / 5) * 5;

  const plotWidth = Math.max(0, width - pad.start - pad.end);
  const plotHeight = height - pad.top - pad.bottom;
  const x = useCallback(
    (t: number) => width - pad.start - ((t - from) / Math.max(1, to - from)) * plotWidth,
    [width, pad.start, from, to, plotWidth],
  );
  const y = (value: number) => pad.top + plotHeight - ((value - yMin) / (yMax - yMin)) * plotHeight;

  const instants = useMemo(
    () =>
      [...new Set(series.flatMap((line) => line.points.map((point) => point.t)))].sort(
        (a, b) => a - b,
      ),
    [series],
  );

  const months = useMemo(() => {
    const ticks: { t: number; label: string }[] = [];
    const start = new Date(from);
    const cursor = new Date(start.getFullYear(), start.getMonth() + 1, 1);
    while (cursor.getTime() <= to) {
      ticks.push({
        t: cursor.getTime(),
        label: cursor.toLocaleDateString('he-IL', { month: 'short' }),
      });
      cursor.setMonth(cursor.getMonth() + 1);
    }
    return ticks;
  }, [from, to]);
  const monthEvery = Math.max(
    1,
    Math.ceil(months.length / Math.max(1, Math.floor(plotWidth / 56))),
  );

  const snap = (clientX: number, rect: DOMRect) => {
    const local = clientX - rect.left;
    let best: number | null = null;
    for (const t of instants) {
      if (best === null || Math.abs(x(t) - local) < Math.abs(x(best) - local)) best = t;
    }
    setHoverT(best);
  };

  const tip: Tip | null =
    hoverT === null
      ? null
      : {
          x: x(hoverT),
          y: pad.top + 8,
          title: formatDayLong(
            series.flatMap((line) => line.points).find((point) => point.t === hoverT)?.day ?? '',
          ),
          rows: series.map((line) => {
            const point = nearest(line.points, hoverT);
            return {
              label: point?.detail ? `${line.label} · ${point.detail}` : line.label,
              value: point ? format(point.value) : '—',
              colour: line.colour,
            };
          }),
        };

  const ticks = [yMin, (yMin + yMax) / 2, yMax];

  return (
    <div className="chart" ref={ref}>
      {series.length > 1 ? (
        <div className="legend" style={{ marginBlockEnd: 8 }}>
          {series.map((line) => (
            <span className="legend-item" key={line.key}>
              <span
                className={line.kind === 'dots' ? 'legend-dot' : 'legend-line'}
                style={{ background: line.colour }}
              />
              {line.label}
            </span>
          ))}
        </div>
      ) : null}
      {width > 0 ? (
        <svg
          height={height}
          role="img"
          aria-label={label}
          onMouseMove={(event) => snap(event.clientX, event.currentTarget.getBoundingClientRect())}
          onMouseLeave={() => setHoverT(null)}
        >
          {ticks.map((tick) => (
            <g key={tick}>
              <line
                className="grid-line"
                x1={pad.end}
                x2={width - pad.start}
                y1={y(tick)}
                y2={y(tick)}
              />
              <text className="axis-text" x={width - pad.start + 6} y={y(tick) + 4}>
                {compact(tick)}
              </text>
            </g>
          ))}
          {months.map((tick, index) =>
            index % monthEvery === 0 ? (
              <text
                key={tick.t}
                className="axis-text"
                x={x(tick.t)}
                y={height - 8}
                textAnchor="middle"
              >
                {tick.label}
              </text>
            ) : null,
          )}
          {hoverT !== null ? (
            <line
              className="grid-line"
              x1={x(hoverT)}
              x2={x(hoverT)}
              y1={pad.top}
              y2={pad.top + plotHeight}
              style={{ stroke: 'var(--border-strong)' }}
            />
          ) : null}
          {series.map((line) => {
            const path = line.points
              .map((point, index) => `${index === 0 ? 'M' : 'L'}${x(point.t)},${y(point.value)}`)
              .join(' ');
            const last = line.points[line.points.length - 1];
            const marked = hoverT === null ? null : nearest(line.points, hoverT);
            if (line.kind === 'dots') {
              return (
                <g key={line.key}>
                  {line.points.map((point) => (
                    <circle
                      key={point.t}
                      cx={x(point.t)}
                      cy={y(point.value)}
                      r={point === marked ? 5 : 4}
                      fill={line.colour}
                      fillOpacity={point === marked ? 1 : 0.4}
                      stroke="var(--surface)"
                      strokeWidth={point === marked ? 2 : 0}
                    />
                  ))}
                </g>
              );
            }
            return (
              <g key={line.key}>
                <path
                  d={path}
                  fill="none"
                  stroke={line.colour}
                  strokeWidth={2}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                />
                {[last, marked].map((point, index) =>
                  point ? (
                    <circle
                      key={index}
                      cx={x(point.t)}
                      cy={y(point.value)}
                      r={4}
                      fill={line.colour}
                      stroke="var(--surface)"
                      strokeWidth={2}
                    />
                  ) : null,
                )}
              </g>
            );
          })}
          {/* The pointer's target: the whole plot, not the lines. */}
          <rect className="hit" x={pad.end} y={pad.top} width={plotWidth} height={plotHeight} />
        </svg>
      ) : (
        <div style={{ height }} />
      )}
      <Tooltip tip={tip} />
    </div>
  );
}

/** The point of a line closest in time to `t`, within a fortnight; null if none is that close. */
function nearest(points: readonly LinePoint[], t: number): LinePoint | null {
  let best: LinePoint | null = null;
  for (const point of points) {
    if (!best || Math.abs(point.t - t) < Math.abs(best.t - t)) best = point;
  }
  return best && Math.abs(best.t - t) <= 14 * 86_400_000 ? best : null;
}

/* ------------------------------------------------------------------ days */

export interface DayCell {
  day: string;
  outcome: DayOutcome | 'outside';
  /** The readout's extra line: what was done or planned. */
  detail?: string;
}

const OUTCOME_ORDER: readonly DayOutcome[] = [
  'done',
  'extra',
  'missed',
  'planned',
  'rest',
  'nothing',
];

/**
 * A square per day, a column per week, Sunday at the top: whether each planned workout
 * happened. The legend names every state, and each square says its state in words to anyone
 * who hovers, focuses or reads it.
 */
export function ActivityGrid({ weeks }: { weeks: readonly (readonly DayCell[])[] }) {
  const [tip, setTip] = useState<Tip | null>(null);
  const box = useRef<HTMLDivElement>(null);

  const show = (cell: DayCell, target: HTMLElement) => {
    const outer = box.current?.getBoundingClientRect();
    const rect = target.getBoundingClientRect();
    if (!outer || cell.outcome === 'outside') return;
    setTip({
      x: rect.left - outer.left + rect.width / 2,
      y: rect.top - outer.top,
      title: formatDayLong(cell.day),
      rows: [{ label: cell.detail ?? '', value: he.outcome[cell.outcome] }],
    });
  };

  return (
    <div className="chart" ref={box} onMouseLeave={() => setTip(null)}>
      <div className="days-grid" role="grid" aria-label={he.charts.activity}>
        {weeks.flatMap((week) =>
          week.map((cell) => (
            <span
              key={cell.day}
              className={`day-cell ${cell.outcome}`}
              role="gridcell"
              tabIndex={cell.outcome === 'outside' ? -1 : 0}
              aria-label={
                cell.outcome === 'outside'
                  ? undefined
                  : `${formatDayLong(cell.day)}: ${he.outcome[cell.outcome]}`
              }
              onMouseEnter={(event) => show(cell, event.currentTarget)}
              onFocus={(event) => show(cell, event.currentTarget)}
              onBlur={() => setTip(null)}
            />
          )),
        )}
      </div>
      <div className="legend" style={{ marginBlockStart: 12 }}>
        {OUTCOME_ORDER.map((outcome) => (
          <span className="legend-item" key={outcome}>
            <span className={`day-cell ${outcome}`} />
            {he.outcome[outcome]}
          </span>
        ))}
      </div>
      <Tooltip tip={tip} />
    </div>
  );
}

/* ------------------------------------------------------------------ horizontal bars */

/** Things against one scale, each with its number written beside it. */
export function HorizontalBars({
  rows,
  format,
}: {
  rows: readonly { key: string; label: string; value: number; secondary?: number }[];
  format: (value: number) => string;
}) {
  const top = Math.max(1, ...rows.map((row) => row.value));
  return (
    <div className="hbars">
      {rows.map((row) => (
        <div className="hbar" key={row.key}>
          <span>{row.label}</span>
          <span className="hbar-track" aria-hidden>
            <span className="hbar-fill" style={{ width: `${(row.value / top) * 100}%` }} />
          </span>
          <span className="hbar-value">{format(row.value)}</span>
        </div>
      ))}
    </div>
  );
}
