/**
 * The weight trend, drawn as what it is: a function of time.
 *
 * One continuous curve for the trend, a dot for every weigh-in, the area under the curve tinted,
 * a scale up the side and dates along the bottom. It used to be a row of separate dashes, one per
 * weigh-in, each at its own height — every value was there and nothing connected them, so a
 * steady loss read as a staircase and the eye had to draw the trend the chart was supposed to be
 * showing.
 *
 * ## Two things are plotted, because they are two different facts
 *
 * **The curve is the 7-day moving average**, on purpose. Daily scale weight swings 1-2 kg on
 * water and food alone, and a raw line makes a steady loss look like noise — misreading that is
 * the single most common way people abandon a working diet.
 *
 * **The dots are the weigh-ins themselves**, each at the weight the scale showed and the moment
 * it showed it. The curve alone was not enough: an average trails what it averages, so someone
 * who weighed 79.8 this morning found the line ending at 80.4 under a card that said 79.8, and
 * reasonably concluded the chart had not caught up. It had — it was showing a different number
 * and not saying so. Now the number they weighed is on the chart, the trend runs through the
 * cloud of them, and the gap between a dot and the curve is the smoothing made visible.
 *
 * Both share one scale, taken across the two together: the average never reaches as high or as
 * low as the readings it is an average of, and a plot scaled to it alone would draw the newest
 * weigh-in off the edge.
 *
 * The average is always computed over the FULL history handed in, then the week/month/all switch
 * below only changes what slice is drawn — narrowing the input first would thin out the trailing
 * window at the edges of a short range and make the line jumpier, not smoother.
 *
 * Everything is placed by *date*, not by position in the list. Seven weigh-ins in a week and
 * then one a month later are not eight evenly spaced events.
 *
 * ## No charting library, still
 *
 * The drawing is `react-native-svg`, which the app already carries for the progress rings and the
 * muscle map — so this costs no new native module and no rebuild of anyone's dev client. The
 * geometry is in `chart/curve.ts`, pure and tested: a monotone cubic, chosen because it cannot
 * overshoot. A rounder spline would draw a peak above the highest point it passes through, and a
 * weight chart that invents weights is worse than one made of dashes.
 *
 * Scrubbing is `PanResponder`, for the same reason `SwipeableRow` is: no gesture-handler
 * dependency.
 *
 * ## Not mirrored for Hebrew
 *
 * Every screen in this app is right-to-left, and this is the exception: the oldest reading is on
 * the left and the newest on the right in both languages. A graph is read the way mathematics is
 * written, and a time axis running leftward would be a function drawn backwards. The chart forces
 * `direction: 'ltr'` on itself so its scale and its dates sit where its coordinates put them.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Animated,
  PanResponder,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import Svg, { Circle, Defs, Line, LinearGradient, Path, Stop } from 'react-native-svg';

import { areaPath, nearestIndex, placeTrend, smoothPath, trendDomain } from '../chart/curve.js';
import { useTheme } from '../ThemeProvider.js';
import { useUnit } from '../UnitsProvider.js';
import { formatBodyWeight, weightUnitKey } from '../units.js';
import { duration, fontSize, fontWeight, radius, spacing, type ColorPalette } from '../theme.js';
import { Segmented } from './ui.js';

interface WeightPoint {
  date: Date;
  weightKg: number;
}

export interface WeightSparklineProps {
  /** The trend: smoothed points, oldest first, full history. Drawn as the curve. */
  points: WeightPoint[];
  /**
   * The weigh-ins themselves, oldest first, full history. Drawn as dots.
   *
   * Optional only so that a caller with nothing but a trend can still draw one. Both screens
   * that show a weight pass it: the number someone weighed has to be findable on the chart.
   */
  readings?: WeightPoint[];
  height?: number;
  /**
   * Whether to offer the week/month/all switch.
   *
   * Off on the home screen, where this is a glance and not a tool — a segmented control there
   * would be the only thing on the card asking to be operated. Tapping the card opens the
   * metrics screen, which has the switch.
   */
  showRangePicker?: boolean;
}

type Range = 'week' | 'month' | 'all';
const RANGE_DAYS: Record<Exclude<Range, 'all'>, number> = { week: 7, month: 30 };

/** The scale's column, at the physical left. Wide enough for "100.5". */
const AXIS_WIDTH = 38;
/** Room around the plot so the stroke and the end marker are not clipped by the SVG's edge. */
const PAD_TOP = 10;
const PAD_BOTTOM = 8;
const PAD_END = 10;
const TOOLTIP_WIDTH = 96;

/**
 * How big a weigh-in's dot is.
 *
 * Smaller as they crowd: a month of dots can each be a dot, but half a year of them at that size
 * is a smear with a line somewhere inside it. Past a few dozen they are there to show the spread
 * around the trend, not to be picked out one at a time.
 */
function dotRadius(count: number): number {
  if (count > 90) return 1.6;
  if (count > 45) return 2.1;
  return 2.8;
}

export function WeightSparkline({
  points,
  readings,
  height = 150,
  showRangePicker = true,
}: WeightSparklineProps) {
  const { t, i18n } = useTranslation();
  const { colors } = useTheme();
  const unit = useUnit();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const [range, setRange] = useState<Range>('month');
  const [scrubIndex, setScrubIndex] = useState<number | null>(null);
  const [width, setWidth] = useState(0);

  // One cutoff for both series, decided once. Each filtered on its own could disagree about
  // where the plot starts, and the dots would drift off the curve they belong to.
  const shown = useMemo(() => {
    const all = { trend: points, weighIns: readings ?? [] };
    if (range === 'all') return all;

    const cutoffMs = Date.now() - RANGE_DAYS[range] * 24 * 60 * 60 * 1000;
    const recent = (list: WeightPoint[]) => list.filter((p) => p.date.getTime() >= cutoffMs);
    const trend = recent(points);
    // Falls back to the full history if the chosen range is narrower than the data actually
    // covers — picking "week" with only two logged days should not render an empty chart.
    return trend.length >= 2 ? { trend, weighIns: recent(all.weighIns) } : all;
  }, [points, readings, range]);

  const plot = useMemo(
    () => ({
      left: AXIS_WIDTH,
      top: PAD_TOP,
      width: Math.max(0, width - AXIS_WIDTH - PAD_END),
      height: Math.max(0, height - PAD_TOP - PAD_BOTTOM),
    }),
    [width, height],
  );

  const geometry = useMemo(() => {
    const trend = shown.trend.map((p) => ({ time: p.date.getTime(), value: p.weightKg }));
    const weighIns = shown.weighIns.map((p) => ({ time: p.date.getTime(), value: p.weightKg }));
    const domain = trendDomain([trend, weighIns]);
    if (!domain) return { curve: [], dots: [], line: '', area: '', low: 0, high: 0 };

    const curve = placeTrend(trend, plot, domain);
    return {
      curve,
      dots: placeTrend(weighIns, plot, domain),
      line: smoothPath(curve),
      area: areaPath(curve, plot.top + plot.height),
      low: domain.low,
      high: domain.high,
    };
  }, [shown, plot]);

  // What a finger picks out: a weigh-in where there are weigh-ins, since that is the number
  // someone is looking for, and a point on the trend otherwise.
  const scrubbable = shown.weighIns.length > 0 ? shown.weighIns : shown.trend;
  const scrubPoints = shown.weighIns.length > 0 ? geometry.dots : geometry.curve;

  // PanResponder is created once; its handlers read this ref rather than closing over the
  // geometry directly, so a range switch or new data doesn't leave them acting on stale points.
  const xs = useRef<number[]>([]);
  xs.current = scrubPoints.map((p) => p.x);

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (evt) => {
        const index = nearestIndex(xs.current, evt.nativeEvent.locationX);
        if (index >= 0) setScrubIndex(index);
      },
      onPanResponderMove: (evt) => {
        const index = nearestIndex(xs.current, evt.nativeEvent.locationX);
        if (index >= 0) setScrubIndex(index);
      },
      onPanResponderRelease: () => setScrubIndex(null),
      onPanResponderTerminate: () => setScrubIndex(null),
    }),
  ).current;

  // The chart settles in when it changes — a new range, a new weigh-in — rather than snapping
  // from one shape to another. Opacity only, on the native driver, on a node that animates
  // nothing else.
  const appear = useRef(new Animated.Value(0)).current;
  const signature = `${geometry.line}|${geometry.dots.length}`;
  useEffect(() => {
    if (geometry.line === '') return;
    appear.setValue(0);
    Animated.timing(appear, {
      toValue: 1,
      duration: duration.slow,
      useNativeDriver: true,
    }).start();
    // `signature` stands for the geometry: the effect should re-run when what is drawn changes,
    // not on every render that rebuilds an identical object.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appear, signature]);

  if (points.length < 2) return null;

  const unitLabel = t(`common.${weightUnitKey(unit)}`);
  const scrubbed = scrubIndex !== null ? scrubbable[scrubIndex] : undefined;
  const scrubPoint = scrubIndex !== null ? scrubPoints[scrubIndex] : undefined;

  // The newest weigh-in: the one the card's big number is, and so the one that is marked.
  // Without weigh-ins to mark, the end of the trend stands in.
  const newest =
    geometry.dots[geometry.dots.length - 1] ?? geometry.curve[geometry.curve.length - 1];
  const r = dotRadius(geometry.dots.length);

  // Three lines across the plot, and the three numbers that label them.
  const ticks = [0, 0.5, 1].map((share) => ({
    y: plot.top + share * plot.height,
    value: geometry.high - share * (geometry.high - geometry.low),
  }));

  const dateLabel = (date: Date) =>
    date.toLocaleDateString(i18n.language, { day: 'numeric', month: 'short' });
  const first = shown.trend[0];
  const latest = shown.trend[shown.trend.length - 1];

  return (
    <View>
      {showRangePicker ? (
        <Segmented<Range>
          label={t('metrics.range')}
          selected={range}
          onSelect={(next) => {
            setScrubIndex(null);
            setRange(next);
          }}
          options={[
            { value: 'week', label: t('metrics.rangeWeek') },
            { value: 'month', label: t('metrics.rangeMonth') },
            { value: 'all', label: t('metrics.rangeAll') },
          ]}
        />
      ) : null}

      <View
        style={[styles.chart, { height }]}
        onLayout={(e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width)}
        accessible
        accessibilityLabel={t('metrics.trendTitle')}
        {...panResponder.panHandlers}
      >
        {/* The scale. Plain text over the SVG rather than SVG text: it follows the app's font
            and the user's font size, which SVG text does neither of. In a layer that takes no
            touches, so the chart itself is always what a finger lands on. */}
        <View style={StyleSheet.absoluteFill} pointerEvents="none">
          {ticks.map((tick) => (
            <Text key={tick.y} style={[styles.tick, { top: tick.y - 7 }]} numberOfLines={1}>
              {formatBodyWeight(tick.value, unit)}
            </Text>
          ))}
        </View>

        {width > 0 ? (
          <Animated.View style={[StyleSheet.absoluteFill, { opacity: appear }]} pointerEvents="none">
            <Svg width={width} height={height}>
              <Defs>
                <LinearGradient id="weightFill" x1="0" y1="0" x2="0" y2="1">
                  <Stop offset="0" stopColor={colors.accent} stopOpacity={0.26} />
                  <Stop offset="1" stopColor={colors.accent} stopOpacity={0} />
                </LinearGradient>
              </Defs>

              {ticks.map((tick) => (
                <Line
                  key={tick.y}
                  x1={plot.left}
                  x2={plot.left + plot.width}
                  y1={tick.y}
                  y2={tick.y}
                  stroke={colors.border}
                  strokeWidth={1}
                  strokeDasharray="2 6"
                />
              ))}

              {geometry.area ? <Path d={geometry.area} fill="url(#weightFill)" /> : null}
              <Path
                d={geometry.line}
                fill="none"
                stroke={colors.accent}
                strokeWidth={3}
                strokeLinecap="round"
                strokeLinejoin="round"
              />

              {/* The weigh-ins, over the curve. Ringed in the card's own colour so that one
                  sitting right on the line still reads as a separate thing from it. */}
              {geometry.dots.map((dot, index) => (
                <Circle
                  key={index}
                  cx={dot.x}
                  cy={dot.y}
                  r={r}
                  fill={colors.text}
                  stroke={colors.surface}
                  strokeWidth={1}
                  opacity={0.75}
                />
              ))}

              {newest && !scrubPoint ? (
                <>
                  <Circle cx={newest.x} cy={newest.y} r={8} fill={colors.accent} opacity={0.22} />
                  <Circle
                    cx={newest.x}
                    cy={newest.y}
                    r={4.5}
                    fill={colors.accent}
                    stroke={colors.surface}
                    strokeWidth={2}
                  />
                </>
              ) : null}

              {scrubPoint ? (
                <>
                  <Line
                    x1={scrubPoint.x}
                    x2={scrubPoint.x}
                    y1={plot.top}
                    y2={plot.top + plot.height}
                    stroke={colors.borderStrong}
                    strokeWidth={1}
                  />
                  <Circle
                    cx={scrubPoint.x}
                    cy={scrubPoint.y}
                    r={5.5}
                    fill={colors.surface}
                    stroke={colors.accent}
                    strokeWidth={3}
                  />
                </>
              ) : null}
            </Svg>
          </Animated.View>
        ) : null}

        {scrubbed && scrubPoint ? (
          <View
            pointerEvents="none"
            style={[
              styles.tooltip,
              {
                // Centred on the reading, and held inside the chart at either end. `start` is
                // the left here: the chart lays itself out left to right in every language.
                start: Math.min(
                  Math.max(0, scrubPoint.x - TOOLTIP_WIDTH / 2),
                  Math.max(0, width - TOOLTIP_WIDTH),
                ),
              },
            ]}
          >
            <Text style={styles.tooltipWeight}>
              {formatBodyWeight(scrubbed.weightKg, unit)} {unitLabel}
            </Text>
            <Text style={styles.tooltipDate}>{dateLabel(scrubbed.date)}</Text>
          </View>
        ) : null}
      </View>

      {/* The time axis — when the plot starts and ends, under its two ends — and between them,
          what the two kinds of mark are. A chart with two series and no key is a puzzle. */}
      <View style={styles.axis}>
        <Text style={styles.axisLabel}>{first ? dateLabel(first.date) : ''}</Text>
        <View style={styles.legend}>
          {geometry.dots.length > 0 ? (
            <>
              <View style={styles.legendDot} />
              <Text style={styles.legendText}>{t('metrics.legendWeighIn')}</Text>
            </>
          ) : null}
          <View style={styles.legendLine} />
          <Text style={styles.legendText}>{t('metrics.movingAverage')}</Text>
        </View>
        <Text style={styles.axisLabel}>{latest ? dateLabel(latest.date) : ''}</Text>
      </View>
    </View>
  );
}

const createStyles = (colors: ColorPalette) =>
  StyleSheet.create<{
    chart: ViewStyle;
    tick: TextStyle;
    axis: ViewStyle;
    axisLabel: TextStyle;
    legend: ViewStyle;
    legendDot: ViewStyle;
    legendLine: ViewStyle;
    legendText: TextStyle;
    tooltip: ViewStyle;
    tooltipWeight: TextStyle;
    tooltipDate: TextStyle;
  }>({
    // Left to right whatever the language — see the note at the top of the file.
    chart: { marginTop: spacing.sm, direction: 'ltr' },
    tick: {
      position: 'absolute',
      start: 0,
      width: AXIS_WIDTH - 6,
      // Against the axis, which is on their right. Not 'auto': these are a scale's labels and
      // line up on the plot's edge, not on the direction the app reads in.
      textAlign: 'right',
      color: colors.textMuted,
      fontSize: fontSize.xxs,
      fontVariant: ['tabular-nums'],
    },
    axis: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginTop: spacing.xs,
      // Under the plot, not under the scale beside it, so each date sits below its end of the
      // curve.
      paddingStart: AXIS_WIDTH,
      paddingEnd: PAD_END,
      direction: 'ltr',
    },
    axisLabel: { color: colors.textMuted, fontSize: fontSize.xs },
    legend: { flexDirection: 'row', alignItems: 'center', gap: 5 },
    legendDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.text, opacity: 0.75 },
    legendLine: {
      width: 14,
      height: 3,
      borderRadius: 2,
      backgroundColor: colors.accent,
      marginStart: 6,
    },
    legendText: { color: colors.textFaint, fontSize: fontSize.xxs },
    tooltip: {
      position: 'absolute',
      top: -34,
      width: TOOLTIP_WIDTH,
      alignItems: 'center',
      zIndex: 10,
      backgroundColor: colors.surfaceRaised,
      borderWidth: 1,
      borderColor: colors.borderStrong,
      borderRadius: radius.sm,
      paddingVertical: 4,
      paddingHorizontal: spacing.sm,
    },
    tooltipWeight: { color: colors.text, fontSize: fontSize.xs, fontWeight: fontWeight.bold },
    tooltipDate: { color: colors.textMuted, fontSize: fontSize.xxs },
  });
