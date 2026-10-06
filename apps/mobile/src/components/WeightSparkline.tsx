/**
 * The weight trend, drawn as what it is: a function of time.
 *
 * One continuous curve through the readings, the area under it tinted, a scale up the side and
 * dates along the bottom. It used to be a row of separate dashes, one per weigh-in, each at its
 * own height — every value was there and nothing connected them, so a steady loss read as a
 * staircase and the eye had to draw the trend the chart was supposed to be showing.
 *
 * ## No charting library, still
 *
 * The curve is `react-native-svg`, which the app already carries for the progress rings and the
 * muscle map — so this costs no new native module and no rebuild of anyone's dev client. The
 * geometry is in `chart/curve.ts`, pure and tested: a monotone cubic, chosen because it cannot
 * overshoot. A rounder spline would draw a peak above the highest weigh-in, and a weight chart
 * that invents weights is worse than one made of dashes.
 *
 * Scrubbing is `PanResponder`, for the same reason `SwipeableRow` is: no gesture-handler
 * dependency.
 *
 * ## What is plotted
 *
 * The 7-day moving average rather than raw weigh-ins, on purpose. Daily scale weight swings 1-2
 * kg on water and food alone, and a raw line makes a steady loss look like noise — misreading
 * that is the single most common way people abandon a working diet. The average is always
 * computed over the FULL history handed in, then the week/month/all switch below only changes
 * what slice is drawn — narrowing the input first would thin out the trailing window at the edges
 * of a short range and make the line jumpier, not smoother.
 *
 * Readings are placed by *date*, not by their position in the list. Seven weigh-ins in a week and
 * then one a month later are not eight evenly spaced events.
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

import { areaPath, layoutTrend, nearestIndex, smoothPath } from '../chart/curve.js';
import { useTheme } from '../ThemeProvider.js';
import { useUnit } from '../UnitsProvider.js';
import { formatBodyWeight, weightUnitKey } from '../units.js';
import { duration, fontSize, fontWeight, radius, spacing, type ColorPalette } from '../theme.js';
import { Segmented } from './ui.js';

export interface WeightSparklineProps {
  /** Smoothed points, oldest first, full history. */
  points: { date: Date; weightKg: number }[];
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
const TOOLTIP_WIDTH = 92;

export function WeightSparkline({
  points,
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

  const filtered = useMemo(() => {
    if (range === 'all') return points;
    const cutoffMs = Date.now() - RANGE_DAYS[range] * 24 * 60 * 60 * 1000;
    const sliced = points.filter((p) => p.date.getTime() >= cutoffMs);
    // Falls back to the full history if the chosen range is narrower than the data actually
    // covers — picking "week" with only two logged days should not render an empty chart.
    return sliced.length >= 2 ? sliced : points;
  }, [points, range]);

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
    const layout = layoutTrend(
      filtered.map((p) => ({ time: p.date.getTime(), value: p.weightKg })),
      plot,
    );
    return {
      ...layout,
      line: smoothPath(layout.points),
      area: areaPath(layout.points, plot.top + plot.height),
    };
  }, [filtered, plot]);

  // PanResponder is created once; its handlers read this ref rather than closing over the
  // geometry directly, so a range switch or new data doesn't leave them acting on stale points.
  const xs = useRef<number[]>([]);
  xs.current = geometry.points.map((p) => p.x);

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

  // The curve settles in when it changes — a new range, a new weigh-in — rather than snapping
  // from one shape to another. Opacity only, on the native driver, on a node that animates
  // nothing else.
  const appear = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (geometry.line === '') return;
    appear.setValue(0);
    Animated.timing(appear, {
      toValue: 1,
      duration: duration.slow,
      useNativeDriver: true,
    }).start();
  }, [appear, geometry.line]);

  if (points.length < 2) return null;

  const unitLabel = t(`common.${weightUnitKey(unit)}`);
  const last = geometry.points[geometry.points.length - 1];
  const scrubbed = scrubIndex !== null ? filtered[scrubIndex] : undefined;
  const scrubPoint = scrubIndex !== null ? geometry.points[scrubIndex] : undefined;

  // Three lines across the plot, and the three numbers that label them.
  const ticks = [0, 0.5, 1].map((share) => ({
    y: plot.top + share * plot.height,
    value: geometry.high - share * (geometry.high - geometry.low),
  }));

  const dateLabel = (date: Date) =>
    date.toLocaleDateString(i18n.language, { day: 'numeric', month: 'short' });
  const first = filtered[0];
  const latest = filtered[filtered.length - 1];

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
            and the user's font size, which SVG text does neither of. */}
        <View style={StyleSheet.absoluteFill} pointerEvents="none">
          {ticks.map((tick) => (
            <Text key={tick.y} style={[styles.tick, { top: tick.y - 7 }]} numberOfLines={1}>
              {formatBodyWeight(tick.value, unit)}
            </Text>
          ))}
        </View>

        {width > 0 ? (
          // Nothing in here takes touches: the chart itself is the target, so a finger's
          // position is measured against the same box the points were laid out in.
          <Animated.View style={[StyleSheet.absoluteFill, { opacity: appear }]} pointerEvents="none">
            <Svg width={width} height={height}>
              <Defs>
                <LinearGradient id="weightFill" x1="0" y1="0" x2="0" y2="1">
                  <Stop offset="0" stopColor={colors.accent} stopOpacity={0.3} />
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

              {/* Where the curve is now. The one point on it that matters at a glance, so it is
                  the one that is marked — a dot on every reading would turn the line back into
                  the row of marks it replaced. */}
              {last && !scrubPoint ? (
                <>
                  <Circle cx={last.x} cy={last.y} r={8} fill={colors.accent} opacity={0.2} />
                  <Circle
                    cx={last.x}
                    cy={last.y}
                    r={4}
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

      {/* The time axis: when the curve starts and when it ends, under its two ends. */}
      <View style={styles.axis}>
        <Text style={styles.axisLabel}>{first ? dateLabel(first.date) : ''}</Text>
        <Text style={styles.axisCaption}>
          {t('metrics.movingAverage')} · {unitLabel}
        </Text>
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
    axisCaption: TextStyle;
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
    axisCaption: { color: colors.textFaint, fontSize: fontSize.xs },
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
