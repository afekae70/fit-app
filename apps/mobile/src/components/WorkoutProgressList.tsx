/**
 * Every named workout, each with how its latest session stood against the one before.
 *
 * The way into `app/workout-progress.tsx`, and a summary in its own right: one row per
 * workout, newest first, with the number it is measured by and an arrow. See
 * `progress/workoutProgress.ts` for what "the same workout" and "the number" mean.
 *
 * Also the home of the two small pieces both screens need — how a workout's number is written
 * and how a change is drawn — so that 8,450 kg and "up 5%" look the same in the list and on
 * the page it opens.
 */

import { router } from 'expo-router';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View, type TextStyle, type ViewStyle } from 'react-native';

import { latestComparison, type Metric, type WorkoutLine } from '../progress/workoutProgress.js';
import { useTheme } from '../ThemeProvider.js';
import { fontSize, fontWeight, radius, spacing, type ColorPalette } from '../theme.js';
import { useUnit } from '../UnitsProvider.js';
import { distanceUnitKey, formatVolume, metresToDisplay, weightUnitKey } from '../units.js';

/** A workout's number with its unit: "8,450 kg", "5,000 m", "52 min". */
export function useMetricText(): (value: number, metric: Metric) => string {
  const { t } = useTranslation();
  const unit = useUnit();
  return (value, metric) => {
    if (metric === 'volume') {
      return `${formatVolume(value, unit) ?? '0'} ${t(`common.${weightUnitKey(unit)}`)}`;
    }
    if (metric === 'distance') {
      return `${Math.round(metresToDisplay(value, unit)).toLocaleString()} ${t(`common.${distanceUnitKey(unit)}`)}`;
    }
    return `${Math.round(value)} ${t('history.minutes')}`;
  };
}

/**
 * A change as an arrow and a percentage, or a dash when there is nothing to compare with.
 *
 * Up is the accent; down is the warning tone rather than red. A lighter leg day is not an
 * error — it may be a deload, a short night, or the plan — and the screen should report it
 * without scolding.
 */
export function ChangeChip({ change }: { change: number | null }) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  if (change === null) return <Text style={[styles.chip, styles.chipFlat]}>—</Text>;
  const percent = Math.round(Math.abs(change) * 100);
  if (percent === 0) return <Text style={[styles.chip, styles.chipFlat]}>＝</Text>;
  const up = change > 0;
  return (
    <Text style={[styles.chip, up ? styles.chipUp : styles.chipDown]}>
      {up ? '▲' : '▼'} {percent}%
    </Text>
  );
}

export function WorkoutProgressList({ lines }: { lines: readonly WorkoutLine[] }) {
  const { t, i18n } = useTranslation();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const metricText = useMetricText();

  return (
    <View style={styles.list}>
      {lines.map((line) => {
        const comparison = latestComparison(line);
        const last = new Date(comparison.latest.startedAt).toLocaleDateString(i18n.language, {
          day: 'numeric',
          month: 'short',
        });
        return (
          <Pressable
            key={line.key}
            onPress={() =>
              router.push({ pathname: '/workout-progress', params: { name: line.key } })
            }
            accessibilityRole="button"
            style={({ pressed }) => [styles.row, pressed && styles.pressed]}
          >
            <View style={styles.rowText}>
              <Text style={styles.name} numberOfLines={1}>
                {line.name}
              </Text>
              <Text style={styles.meta}>
                {t('progress.workoutCount', { count: line.sessions.length })} · {last}
              </Text>
            </View>
            <View style={styles.rowValue}>
              <Text style={styles.value}>
                {metricText(comparison.latestValue, comparison.metric)}
              </Text>
              <ChangeChip change={comparison.change} />
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

const createStyles = (colors: ColorPalette) =>
  StyleSheet.create<{
    list: ViewStyle;
    row: ViewStyle;
    pressed: ViewStyle;
    rowText: ViewStyle;
    rowValue: ViewStyle;
    name: TextStyle;
    meta: TextStyle;
    value: TextStyle;
    chip: TextStyle;
    chipUp: TextStyle;
    chipDown: TextStyle;
    chipFlat: TextStyle;
  }>({
    list: { gap: spacing.sm },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      padding: spacing.md,
      borderRadius: radius.lg,
      backgroundColor: colors.surfaceRaised,
    },
    pressed: { opacity: 0.6 },
    rowText: { flex: 1, gap: spacing.xxs },
    rowValue: { alignItems: 'flex-end', gap: spacing.xxs },
    name: {
      color: colors.text,
      fontSize: fontSize.md,
      fontWeight: fontWeight.bold,
      textAlign: 'auto',
    },
    meta: { color: colors.textMuted, fontSize: fontSize.xs, textAlign: 'auto' },
    value: {
      color: colors.text,
      fontSize: fontSize.sm,
      fontWeight: fontWeight.medium,
      fontVariant: ['tabular-nums'],
    },
    chip: { fontSize: fontSize.xs, fontWeight: fontWeight.bold, fontVariant: ['tabular-nums'] },
    chipUp: { color: colors.accent },
    chipDown: { color: colors.warning },
    chipFlat: { color: colors.textFaint },
  });
