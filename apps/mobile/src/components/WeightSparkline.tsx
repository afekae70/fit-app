/**
 * Weight trend sparkline, drawn with plain Views.
 *
 * No charting library: the app needs one small trend line, and a Skia-backed chart package
 * would add a native dependency (and another development-build requirement) for something a
 * row of positioned bars renders adequately.
 *
 * Plots the 7-day moving average rather than raw weigh-ins on purpose. Daily scale weight
 * swings 1-2 kg on water and food alone, and a raw line makes a steady loss look like noise —
 * misreading that is the single most common way people abandon a working diet.
 */

import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, View, type TextStyle, type ViewStyle } from 'react-native';

import { colors, fontSize, spacing } from '../theme.js';

export interface WeightSparklineProps {
  /** Smoothed points, oldest first. */
  points: { date: Date; weightKg: number }[];
  height?: number;
}

export function WeightSparkline({ points, height = 96 }: WeightSparklineProps) {
  const { t } = useTranslation();

  if (points.length < 2) return null;

  const weights = points.map((p) => p.weightKg);
  const min = Math.min(...weights);
  const max = Math.max(...weights);
  // A perfectly flat series would divide by zero; give it a nominal band so the line renders
  // through the middle instead of collapsing.
  const range = max - min < 0.1 ? 1 : max - min;

  return (
    <View>
      <View style={[styles.chart, { height }]}>
        {points.map((point, index) => {
          const normalised = (point.weightKg - min) / range;
          return (
            <View key={`${point.date.toISOString()}-${index}`} style={styles.column}>
              <View
                style={[
                  styles.dot,
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

const styles = StyleSheet.create<{
  chart: ViewStyle;
  column: ViewStyle;
  dot: ViewStyle;
  axis: ViewStyle;
  axisLabel: TextStyle;
  axisCaption: TextStyle;
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
  axis: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: spacing.xs,
  },
  axisLabel: { color: colors.textMuted, fontSize: fontSize.xs },
  axisCaption: { color: colors.textMuted, fontSize: fontSize.xs },
});
