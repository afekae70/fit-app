/**
 * The three summary blocks from the design's progress screen: weekly volume, a consistency
 * grid, and personal records.
 *
 * All three are plain Views. The bars are heights, the grid is a wrapped row of squares, and
 * neither needs a drawing surface — which keeps `react-native-svg` out of the dependency list
 * (see CLAUDE.md for why a native module is a bigger decision than it looks).
 *
 * Every aggregation is done in SQL by `db/progression.ts` and unit-tested there. These
 * components only decide how a number becomes a height or a shade, so a wrong bar is a styling
 * bug rather than a wrong figure.
 */

import type { PersonalRecord, TrainingDay, WeeklyVolume } from '../db/progression.js';
import { EXERCISE_SEED, type ExerciseSeed } from '@fit/shared/catalog';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View, type TextStyle, type ViewStyle } from 'react-native';
import { Pressable } from './Pressable.js';
import { ChartBar } from './ChartBar.js';
import { Text } from './Text.js';

import { useTheme } from '../ThemeProvider.js';
import { useUnit } from '../UnitsProvider.js';
import { formatVolume, kgToDisplay, weightUnitKey } from '../units.js';
import { fontSize, fontWeight, radius, spacing, type ColorPalette } from '../theme.js';

const EXERCISE_BY_KEY = new Map<string, ExerciseSeed>(
  EXERCISE_SEED.map((exercise) => [exercise.nameEn, exercise]),
);

const CHART_HEIGHT = 96;

/**
 * Volume per week as bars, in tonnes — the design's unit, and the only one that stays short.
 *
 * The bars alone say "more than last week" and not how much. Touching one reads it out above
 * the chart: which week, and its volume in full. With nothing touched the line reads the
 * latest week, which is the number someone opens this screen for; touching the same bar again
 * goes back to it.
 */
export function WeeklyVolumeChart({ weeks }: { weeks: readonly WeeklyVolume[] }) {
  const { t, i18n } = useTranslation();
  const { colors } = useTheme();
  const unit = useUnit();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [chosen, setChosen] = useState<number | null>(null);

  const peak = Math.max(...weeks.map((w) => w.volumeKg), 1);
  // A week that has since scrolled off the end of the chart cannot stay chosen.
  const picked = chosen !== null && chosen < weeks.length ? chosen : null;
  const shown = weeks[picked ?? weeks.length - 1];

  const readout = (week: WeeklyVolume) => {
    const date = new Date(`${week.weekStart}T12:00:00`).toLocaleDateString(i18n.language, {
      day: 'numeric',
      month: 'short',
    });
    const volume =
      week.volumeKg > 0
        ? `${formatVolume(week.volumeKg, unit)} ${t(`common.${weightUnitKey(unit)}`)}`
        : t('progress.weekEmpty');
    return `${t('progress.weekOf', { date })} · ${volume}`;
  };

  return (
    <View>
      {shown ? (
        <Text style={[styles.readout, picked !== null && styles.readoutPicked]}>
          {readout(shown)}
        </Text>
      ) : null}
      <View style={[styles.bars, { height: CHART_HEIGHT }]}>
        {weeks.map((week, index) => {
          const ratio = week.volumeKg / peak;
          return (
            <Pressable
              key={week.weekStart}
              onPress={() => setChosen(picked === index ? null : index)}
              accessibilityRole="button"
              accessibilityLabel={readout(week)}
              accessibilityState={{ selected: picked === index }}
              style={styles.barSlot}
            >
              {/* The track is the full height of the chart, so a light week reads as a small
                  part of something rather than as a lonely stub in white space. It is also
                  what makes the whole column the target, and not only the bar in it. */}
              <View style={styles.barTrack} />
              <ChartBar
                index={index}
                dimmed={picked !== null && picked !== index}
                // A trained week always keeps a visible stub: a 3px sliver still reads as
                // "trained, lightly", where a zero-height bar is indistinguishable from a
                // week off — which is the one thing this chart must never blur.
                height={week.volumeKg > 0 ? Math.max(6, ratio * CHART_HEIGHT) : 0}
              />
            </Pressable>
          );
        })}
      </View>
      <View style={styles.axis}>
        <Text style={styles.axisLabel}>
          {/* Thousands either way. A tonne of pounds is not a unit anyone uses, so imperial
              gets "k lb" rather than a converted tonne. */}
          {(kgToDisplay(peak, unit) / 1000).toFixed(1)}{' '}
          {unit === 'imperial' ? t('progress.thousandLb') : t('progress.tonnes')}
        </Text>
        <Text style={styles.axisLabel}>
          {weeks.length} {t('progress.weeks')}
        </Text>
      </View>
    </View>
  );
}

/**
 * A day-per-square consistency grid, in columns of seven.
 *
 * Laid out column-major on purpose: each column is one week, so vertical banding reads as "I
 * always train Mondays" — the pattern the grid is for. A plain wrapped row would put an
 * arbitrary day at the top of each column and destroy that.
 */
export function ConsistencyGrid({ days }: { days: readonly TrainingDay[] }) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const weeks = useMemo(() => {
    const out: TrainingDay[][] = [];
    for (let i = 0; i < days.length; i += 7) out.push(days.slice(i, i + 7));
    return out;
  }, [days]);

  const shades = [
    colors.surfaceRaised,
    colors.accentSoft,
    colors.accentBorder,
    colors.accent,
    colors.accent,
  ];

  return (
    <View>
      <View style={styles.grid}>
        {weeks.map((week, i) => (
          <View key={week[0]?.day ?? i} style={styles.gridCol}>
            {week.map((day) => (
              <View
                key={day.day}
                style={[
                  styles.cell,
                  { backgroundColor: shades[day.level] ?? colors.surfaceRaised },
                  // The top bucket is the only one that also gets a ring, so the very best days
                  // stay distinguishable from merely good ones without inventing a sixth shade.
                  day.level === 4 && styles.cellPeak,
                ]}
              />
            ))}
          </View>
        ))}
      </View>
      <View style={styles.axis}>
        <Text style={styles.axisLabel}>{t('progress.less')}</Text>
        <View style={styles.legend}>
          {shades.slice(0, 4).map((shade, i) => (
            <View key={i} style={[styles.legendCell, { backgroundColor: shade }]} />
          ))}
        </View>
        <Text style={styles.axisLabel}>{t('progress.more')}</Text>
      </View>
    </View>
  );
}

export function PersonalRecordList({
  records,
  isHebrew,
}: {
  records: readonly PersonalRecord[];
  isHebrew: boolean;
}) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const unit = useUnit();
  const styles = useMemo(() => createStyles(colors), [colors]);

  return (
    <View>
      {records.map((record) => {
        const seed = EXERCISE_BY_KEY.get(record.exerciseKey);
        const label = seed ? (isHebrew ? seed.nameHe : seed.nameEn) : record.exerciseKey;
        return (
          <View key={record.exerciseKey} style={styles.prRow}>
            <View style={styles.prMain}>
              <Text style={styles.prName} numberOfLines={1}>
                {label}
              </Text>
              <Text style={styles.prWhen}>
                {new Date(record.achievedAt).toLocaleDateString()} · {record.reps}{' '}
                {t('common.reps')}
              </Text>
            </View>
            <Text style={styles.prValue}>
              {record.weightKg}
              <Text style={styles.prUnit}> {t(`common.${weightUnitKey(unit)}`)}</Text>
            </Text>
          </View>
        );
      })}
    </View>
  );
}

const createStyles = (colors: ColorPalette) =>
  StyleSheet.create<{
    bars: ViewStyle;
    barSlot: ViewStyle;
    barTrack: ViewStyle;
    readout: TextStyle;
    readoutPicked: TextStyle;
    axis: ViewStyle;
    axisLabel: TextStyle;
    grid: ViewStyle;
    gridCol: ViewStyle;
    cell: ViewStyle;
    cellPeak: ViewStyle;
    legend: ViewStyle;
    legendCell: ViewStyle;
    prRow: ViewStyle;
    prMain: ViewStyle;
    prName: TextStyle;
    prWhen: TextStyle;
    prValue: TextStyle;
    prUnit: TextStyle;
  }>({
    bars: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.sm },
    // Stretched to the chart's height, whatever the bar's: the row lays its children out at
    // the bottom, which would otherwise make a column exactly as tall as its bar — a track
    // nobody could see behind it, and for a week off, nothing to touch at all.
    barSlot: { flex: 1, alignSelf: 'stretch', justifyContent: 'flex-end' },
    barTrack: {
      ...StyleSheet.absoluteFillObject,
      borderRadius: radius.pill,
      backgroundColor: colors.surfaceRaised,
    },
    // The week being read. Quiet while it is only the latest; the accent once it is one
    // somebody chose, so the line and the bar it speaks for are visibly the same thing.
    readout: {
      color: colors.textSecondary,
      fontSize: fontSize.xs,
      fontVariant: ['tabular-nums'],
      textAlign: 'auto',
      marginBottom: spacing.sm,
    },
    readoutPicked: { color: colors.accent, fontWeight: fontWeight.bold },
    axis: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginTop: spacing.xs,
      gap: spacing.sm,
    },
    axisLabel: { color: colors.textMuted, fontSize: fontSize.xxs },
    // `row`, not `row-reverse`: the grid is a timeline and must run oldest-to-newest the same
    // way in both languages, or "last week" would move sides with the UI language.
    grid: { flexDirection: 'row', gap: 3 },
    gridCol: { flex: 1, gap: 3 },
    cell: { width: '100%', aspectRatio: 1, borderRadius: 5 },
    cellPeak: { borderWidth: 1, borderColor: colors.text },
    legend: { flexDirection: 'row', gap: 3, flex: 1, justifyContent: 'center' },
    legendCell: { width: 10, height: 10, borderRadius: 3 },
    prRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      paddingVertical: spacing.sm,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    prMain: { flex: 1 },
    prName: { color: colors.text, fontSize: fontSize.sm, fontWeight: fontWeight.medium, textAlign: 'auto' },
    prWhen: { color: colors.textMuted, fontSize: fontSize.xxs, marginTop: 2, textAlign: 'auto' },
    prValue: { color: colors.accent, fontSize: fontSize.lg, fontWeight: fontWeight.bold },
    prUnit: { color: colors.textMuted, fontSize: fontSize.xxs, fontWeight: fontWeight.regular },
  });
