/**
 * Weight trend sparkline, drawn with plain Views.
 *
 * No charting library: the app needs one small trend line, and a Skia-backed chart package
 * would add a native dependency (and another development-build requirement) for something a
 * row of positioned bars renders adequately. Scrubbing is `PanResponder`-based for the same
 * reason `SwipeableRow` is — no react-native-gesture-handler dependency, so this works against
 * the dev client already installed on device with no native rebuild.
 *
 * Plots the 7-day moving average rather than raw weigh-ins on purpose. Daily scale weight
 * swings 1-2 kg on water and food alone, and a raw line makes a steady loss look like noise —
 * misreading that is the single most common way people abandon a working diet. The average is
 * always computed over the FULL history handed in, then the week/month/all switch below only
 * changes what slice is drawn — narrowing the input first would thin out the trailing window at
 * the edges of a short range and make the line jumpier, not smoother.
 */

import { useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  PanResponder,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

import { useTheme } from '../ThemeProvider.js';
import { fontSize, fontWeight, radius, spacing, type ColorPalette } from '../theme.js';
import { Segmented } from './ui.js';

export interface WeightSparklineProps {
  /** Smoothed points, oldest first, full history. */
  points: { date: Date; weightKg: number }[];
  height?: number;
}

type Range = 'week' | 'month' | 'all';
const RANGE_DAYS: Record<Exclude<Range, 'all'>, number> = { week: 7, month: 30 };

export function WeightSparkline({ points, height = 96 }: WeightSparklineProps) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const [range, setRange] = useState<Range>('month');
  const [scrubIndex, setScrubIndex] = useState<number | null>(null);
  const chartWidth = useRef(0);
  // PanResponder is created once; its handlers read this ref rather than closing over
  // `filtered` directly, so a range switch or new data doesn't leave them acting on stale points.
  const filteredRef = useRef<{ date: Date; weightKg: number }[]>([]);

  const filtered = useMemo(() => {
    if (range === 'all') return points;
    const cutoffMs = Date.now() - RANGE_DAYS[range] * 24 * 60 * 60 * 1000;
    const sliced = points.filter((p) => p.date.getTime() >= cutoffMs);
    // Falls back to the full history if the chosen range is narrower than the data actually
    // covers — picking "week" with only two logged days should not render an empty chart.
    return sliced.length >= 2 ? sliced : points;
  }, [points, range]);
  filteredRef.current = filtered;

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderMove: (evt) => {
        const width = chartWidth.current;
        const current = filteredRef.current;
        if (width <= 0 || current.length < 2) return;
        const ratio = Math.min(1, Math.max(0, evt.nativeEvent.locationX / width));
        setScrubIndex(Math.round(ratio * (current.length - 1)));
      },
      onPanResponderRelease: () => setScrubIndex(null),
      onPanResponderTerminate: () => setScrubIndex(null),
    }),
  ).current;

  if (points.length < 2) return null;

  const weights = filtered.map((p) => p.weightKg);
  const min = Math.min(...weights);
  const max = Math.max(...weights);
  // A perfectly flat series would divide by zero; give it a nominal band so the line renders
  // through the middle instead of collapsing.
  const spread = max - min < 0.1 ? 1 : max - min;

  const scrubbed = scrubIndex !== null ? filtered[scrubIndex] : null;
  const tooltipLeftPct =
    scrubIndex !== null && filtered.length > 1 ? (scrubIndex / (filtered.length - 1)) * 100 : 0;

  return (
    <View>
      <Segmented<Range>
        label={t('metrics.range')}
        selected={range}
        onSelect={setRange}
        options={[
          { value: 'week', label: t('metrics.rangeWeek') },
          { value: 'month', label: t('metrics.rangeMonth') },
          { value: 'all', label: t('metrics.rangeAll') },
        ]}
      />

      <View
        style={[styles.chart, { height }]}
        onLayout={(e: LayoutChangeEvent) => {
          chartWidth.current = e.nativeEvent.layout.width;
        }}
        {...panResponder.panHandlers}
      >
        {scrubbed ? (
          <View style={[styles.tooltip, { left: `${tooltipLeftPct}%` }]} pointerEvents="none">
            <Text style={styles.tooltipWeight}>
              {scrubbed.weightKg.toFixed(1)} {t('common.kg')}
            </Text>
            <Text style={styles.tooltipDate}>
              {scrubbed.date.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}
            </Text>
          </View>
        ) : null}

        {filtered.map((point, index) => {
          const normalised = (point.weightKg - min) / spread;
          const active = index === scrubIndex;
          return (
            <View key={`${point.date.toISOString()}-${index}`} style={styles.column}>
              <View
                style={[
                  styles.dot,
                  active && styles.dotActive,
                  {
                    // 0 = lowest weight in the window, sits at the bottom of the band.
                    bottom: normalised * (height - 8),
                  },
                ]}
              />
            </View>
          );
        })}
      </View>

      <View style={styles.axis}>
        <Text style={styles.axisLabel}>
          {min.toFixed(1)} {t('common.kg')}
        </Text>
        <Text style={styles.axisCaption}>{t('metrics.movingAverage')}</Text>
        <Text style={styles.axisLabel}>
          {max.toFixed(1)} {t('common.kg')}
        </Text>
      </View>
    </View>
  );
}

const createStyles = (colors: ColorPalette) =>
  StyleSheet.create<{
    chart: ViewStyle;
    column: ViewStyle;
    dot: ViewStyle;
    dotActive: ViewStyle;
    axis: ViewStyle;
    axisLabel: TextStyle;
    axisCaption: TextStyle;
    tooltip: ViewStyle;
    tooltipWeight: TextStyle;
    tooltipDate: TextStyle;
  }>({
  chart: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    marginTop: spacing.sm,
  },
  column: { flex: 1, height: '100%' },
  dot: {
    position: 'absolute',
    start: 0,
    end: 0,
    height: 3,
    borderRadius: 2,
    backgroundColor: colors.accent,
  },
  dotActive: {
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.text,
  },
  axis: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: spacing.xs,
  },
  axisLabel: { color: colors.textMuted, fontSize: fontSize.xs },
  axisCaption: { color: colors.textMuted, fontSize: fontSize.xs },
  tooltip: {
    position: 'absolute',
    top: -32,
    zIndex: 10,
    backgroundColor: colors.surfaceRaised,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radius.sm,
    paddingVertical: 4,
    paddingHorizontal: spacing.sm,
    // Roughly centres the tooltip over the touched column without measuring its own width.
    transform: [{ translateX: -30 }],
  },
  tooltipWeight: { color: colors.text, fontSize: fontSize.xs, fontWeight: fontWeight.bold },
  tooltipDate: { color: colors.textMuted, fontSize: fontSize.xxs },
});
