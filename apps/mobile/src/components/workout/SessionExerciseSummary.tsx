/**
 * One exercise of a finished workout, read rather than edited.
 *
 * Built to look like the card used while training (`ExercisePanel`): the same picture, the same
 * name, the same numbered rows. A workout looked at afterwards should be recognisable as the one
 * that was done — a different layout for the same sets makes the reader translate between two
 * pictures of one session.
 *
 * What it drops is everything that only makes sense while training: the steppers, the tick, the
 * target and the advice. What it adds is the line under the name — how many working sets, and
 * the volume they came to — which is the question actually asked of a workout in the past.
 */

import type { ExerciseSeed } from '@fit/shared/catalog';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, View, type TextStyle, type ViewStyle } from 'react-native';

import type { SetRow } from '../../db/workouts.js';
import { useTheme } from '../../ThemeProvider.js';
import { fontSize, fontWeight, radius, spacing, type ColorPalette } from '../../theme.js';
import { useUnit } from '../../UnitsProvider.js';
import {
  distanceUnitKey,
  formatVolume,
  kgToDisplay,
  metresToDisplay,
  weightUnitKey,
} from '../../units.js';
import { ExerciseVisual } from '../ExerciseVisual.js';

export function SessionExerciseSummary({
  seed,
  name,
  sets,
}: {
  seed: ExerciseSeed | undefined;
  name: string;
  sets: readonly SetRow[];
}) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const unit = useUnit();
  const s = useMemo(() => createStyles(colors), [colors]);

  const working = sets.filter((set) => set.is_warmup === 0);
  const volume = working.reduce((sum, set) => sum + (set.weight_kg ?? 0) * (set.reps ?? 0), 0);

  /** Warm-ups are not numbered: they are a ramp, and numbering them shifts every working set. */
  let workingIndex = 0;

  return (
    <View style={s.card}>
      <View style={s.header}>
        {seed ? (
          <View style={s.thumb}>
            <ExerciseVisual exercise={seed} height={52} />
          </View>
        ) : null}
        <View style={s.headerText}>
          <Text style={s.name}>{name}</Text>
          <Text style={s.meta}>
            {t('history.sets')}: {working.length}
            {volume > 0
              ? ` · ${formatVolume(volume, unit)} ${t(`common.${weightUnitKey(unit)}`)}`
              : ''}
          </Text>
        </View>
      </View>

      <View style={s.sets}>
        {sets.map((set) => {
          const warmup = set.is_warmup === 1;
          if (!warmup) workingIndex += 1;
          return (
            <View key={set.id} style={s.setLine}>
              <Text
                style={[s.index, warmup && s.indexWarmup, set.is_drop === 1 && s.indexDrop]}
              >
                {warmup ? t('workout.warmupShort') : set.is_drop === 1 ? '↓' : workingIndex}
              </Text>
              <Text style={[s.value, warmup && s.valueWarmup]}>
                {describeSet(set, unit, t)}
              </Text>
              {set.rpe !== null ? <Text style={s.rpe}>@{set.rpe}</Text> : null}
              {set.to_failure === 1 ? <Text style={s.failure}>{t('workout.toFailure')}</Text> : null}
            </View>
          );
        })}
      </View>
    </View>
  );
}

/** A set as it is read back: "82.5 kg × 8", "45 sec", "400 m" — whichever it was logged as. */
function describeSet(
  set: SetRow,
  unit: Parameters<typeof kgToDisplay>[1],
  t: (key: string) => string,
): string {
  const parts: string[] = [];
  if (set.weight_kg !== null && set.reps !== null) {
    parts.push(`${kgToDisplay(set.weight_kg, unit)} ${t(`common.${weightUnitKey(unit)}`)} × ${set.reps}`);
  } else if (set.weight_kg !== null) {
    parts.push(`${kgToDisplay(set.weight_kg, unit)} ${t(`common.${weightUnitKey(unit)}`)}`);
  } else if (set.reps !== null) {
    parts.push(`${set.reps}`);
  }
  if (set.duration_seconds !== null) parts.push(`${set.duration_seconds} ${t('workout.seconds')}`);
  if (set.distance_m !== null) {
    parts.push(`${metresToDisplay(set.distance_m, unit)} ${t(`common.${distanceUnitKey(unit)}`)}`);
  }
  return parts.join(' · ') || '—';
}

const createStyles = (colors: ColorPalette) =>
  StyleSheet.create<{
    card: ViewStyle;
    header: ViewStyle;
    thumb: ViewStyle;
    headerText: ViewStyle;
    name: TextStyle;
    meta: TextStyle;
    sets: ViewStyle;
    setLine: ViewStyle;
    index: TextStyle;
    indexWarmup: TextStyle;
    indexDrop: TextStyle;
    value: TextStyle;
    valueWarmup: TextStyle;
    rpe: TextStyle;
    failure: TextStyle;
  }>({
    card: {
      backgroundColor: colors.surface,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: colors.borderSubtle,
      padding: 14,
      gap: 12,
    },
    header: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
    thumb: { width: 56 },
    headerText: { flex: 1 },
    name: {
      color: colors.text,
      fontSize: fontSize.md,
      fontWeight: fontWeight.bold,
      textAlign: 'auto',
    },
    meta: { color: colors.textMuted, fontSize: fontSize.xs, marginTop: 2, textAlign: 'auto' },
    sets: { gap: 6 },
    setLine: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
    // The same numbered chip the logging row uses, so a set is recognisable in both places.
    index: {
      width: 26,
      height: 26,
      borderRadius: radius.pill,
      backgroundColor: colors.surfaceRaised,
      color: colors.textSecondary,
      fontSize: fontSize.xs,
      textAlign: 'center',
      lineHeight: 26,
      fontVariant: ['tabular-nums'],
    },
    indexWarmup: { color: colors.textFaint },
    indexDrop: { color: colors.accent },
    value: {
      flex: 1,
      color: colors.text,
      fontSize: fontSize.sm,
      textAlign: 'auto',
      fontVariant: ['tabular-nums'],
    },
    valueWarmup: { color: colors.textMuted },
    rpe: { color: colors.textMuted, fontSize: fontSize.xs, fontVariant: ['tabular-nums'] },
    failure: { color: colors.warning, fontSize: fontSize.xxs },
  });
