/**
 * Every named workout, each with how its latest session stood against the one before.
 *
 * The way into `app/workout-progress.tsx`, and a summary in its own right: one row per
 * workout, newest first, with the number it is measured by and an arrow. See
 * `progress/workoutProgress.ts` for what "the same workout" and "the number" mean.
 *
 * Also the home of the small pieces the progress screens share — how a workout's number is
 * written, how a set is written, and how a change is drawn — so that "16 sets", "100 kg × 8"
 * and "▲3 ▼1" look the same in the list, on the page it opens, and on an exercise's page.
 */

import { router } from 'expo-router';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View, type TextStyle, type ViewStyle } from 'react-native';
import { Pressable } from './Pressable.js';
import { Text } from './Text.js';

import {
  improved,
  worse,
  type SetChange,
  type Tally,
  type WorkingSet,
} from '../progress/setBySet.js';
import { latestComparison, type Metric, type WorkoutLine } from '../progress/workoutProgress.js';
import { useTheme } from '../ThemeProvider.js';
import { fontSize, fontWeight, radius, spacing, type ColorPalette } from '../theme.js';
import { useUnit } from '../UnitsProvider.js';
import { distanceUnitKey, kgToDisplay, metresToDisplay, weightUnitKey } from '../units.js';
import { formatDuration } from '../workout/cardioTimer.js';

/** A workout's number with its unit: "16 sets", "5,000 m", "52 min". */
export function useMetricText(): (value: number, metric: Metric) => string {
  const { t } = useTranslation();
  const unit = useUnit();
  return (value, metric) => {
    if (metric === 'strength') return t('progress.setCount', { count: value });
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

/**
 * One set as it is said: "100 kg × 8", "× 12" for one with no weight, "500 m · 2:05" or "1:00"
 * for one held by distance or time.
 */
export function useSetText(): (set: WorkingSet | null) => string {
  const { t } = useTranslation();
  const unit = useUnit();
  return (set) => {
    if (!set) return '—';
    if (set.weightKg !== null && set.weightKg > 0) {
      const weight = `${kgToDisplay(set.weightKg, unit)} ${t(`common.${weightUnitKey(unit)}`)}`;
      return set.reps !== null ? `${weight} × ${set.reps}` : weight;
    }
    if (set.reps !== null) return `× ${set.reps}`;
    const parts: string[] = [];
    if (set.distanceM !== null && set.distanceM > 0) {
      parts.push(
        `${Math.round(metresToDisplay(set.distanceM, unit)).toLocaleString()} ${t(`common.${distanceUnitKey(unit)}`)}`,
      );
    }
    if (set.durationSeconds !== null && set.durationSeconds > 0) {
      parts.push(formatDuration(set.durationSeconds));
    }
    return parts.length > 0 ? parts.join(' · ') : '—';
  };
}

/**
 * How a workout's sets stood against the time before: "▲3 ▼1", a calm "＝" when nothing moved,
 * a dash when there was no time before. Improved counts a set added; worse, a set left out.
 */
export function TallyChip({ tally }: { tally: Tally | null }) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  if (tally === null) return <Text style={[styles.chip, styles.chipFlat]}>—</Text>;
  const up = improved(tally);
  const down = worse(tally);
  const label = t('progress.tallyLabel', { up, same: tally.same, down });
  if (up === 0 && down === 0) {
    return (
      <Text style={[styles.chip, styles.chipFlat]} accessibilityLabel={label}>
        ＝
      </Text>
    );
  }
  return (
    <Text style={styles.chip} accessibilityLabel={label}>
      {up > 0 ? <Text style={styles.chipUp}>▲{up}</Text> : null}
      {up > 0 && down > 0 ? ' ' : null}
      {down > 0 ? <Text style={styles.chipDown}>▼{down}</Text> : null}
    </Text>
  );
}

/** The mark beside one set: ▲ better, ▼ worse, ＝ the same, ＋ a set more, – one fewer. */
export function SetChangeMark({ change }: { change: SetChange }) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const mark = { up: '▲', down: '▼', same: '＝', added: '＋', dropped: '–' }[change];
  const tone =
    change === 'up' || change === 'added'
      ? styles.chipUp
      : change === 'down' || change === 'dropped'
        ? styles.chipDown
        : styles.chipFlat;
  return (
    <Text style={[styles.mark, tone]} accessibilityLabel={t(`progress.setChange_${change}`)}>
      {mark}
    </Text>
  );
}

export function WorkoutProgressList({
  lines,
  tallies,
}: {
  lines: readonly WorkoutLine[];
  /** Per line, by key: its latest session's sets against the one before. Strength lines only. */
  tallies?: ReadonlyMap<string, Tally | null>;
}) {
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
              {comparison.metric === 'strength' ? (
                <TallyChip tally={tallies?.get(line.key) ?? null} />
              ) : (
                <ChangeChip change={comparison.change} />
              )}
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
    mark: TextStyle;
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
    chipFlat: { color: colors.textMuted },
    mark: { width: 18, textAlign: 'center', fontSize: fontSize.sm, fontWeight: fontWeight.bold },
  });
