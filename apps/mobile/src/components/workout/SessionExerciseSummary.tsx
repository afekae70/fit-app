/**
 * One exercise of a finished workout, read rather than edited.
 *
 * The card is the one used while training (`ExercisePanel`): the same picture, the same name. A
 * workout looked at afterwards should be recognisable as the one that was done.
 *
 * The sets are not. While training, each set is a row because each is a thing to be done — a
 * weight to type, a box to tick. Afterwards they are a result, and a column of rows makes the
 * reader walk down eight lines to see what was a short sentence: 80×8, 80×8, 75×6. So they are
 * laid out as pills that wrap, the shape the app already uses for "last time" during a workout,
 * and the whole exercise is taken in at a glance.
 *
 * The best working set is marked. It is the number anyone actually looks for afterwards, and
 * picking it out is otherwise a comparison done by eye down a list.
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
import { bestSetIndex, formatSet } from '../../workout/setFormat.js';
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
  const best = bestSetIndex(sets);

  const labels = {
    weight: t(`common.${weightUnitKey(unit)}`),
    distance: t(`common.${distanceUnitKey(unit)}`),
    seconds: t('workout.seconds'),
  };

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
            {working.length} {t('history.sets')}
            {volume > 0
              ? ` · ${formatVolume(volume, unit)} ${t(`common.${weightUnitKey(unit)}`)}`
              : ''}
          </Text>
        </View>
      </View>

      <View style={s.pills}>
        {sets.map((set, index) => {
          const warmup = set.is_warmup === 1;
          const isBest = index === best;
          return (
            <View
              key={set.id}
              style={[s.pill, warmup && s.pillWarmup, isBest && s.pillBest]}
              // Read as one thing: "warm-up, 60 kg × 5" rather than five separate scraps.
              accessibilityLabel={[
                warmup ? t('workout.warmup') : null,
                formatSet(
                  {
                    ...set,
                    weight_kg: set.weight_kg === null ? null : kgToDisplay(set.weight_kg, unit),
                    distance_m:
                      set.distance_m === null ? null : metresToDisplay(set.distance_m, unit),
                  },
                  labels,
                ),
                set.to_failure === 1 ? t('workout.toFailure') : null,
              ]
                .filter(Boolean)
                .join(', ')}
            >
              {/* A warm-up says so; a drop set keeps the arrow it is marked with everywhere else. */}
              {warmup || set.is_drop === 1 ? (
                <Text style={[s.tag, warmup && s.tagWarmup]}>
                  {warmup ? t('workout.warmupShort') : '↓'}
                </Text>
              ) : null}
              <Text style={[s.value, warmup && s.valueWarmup, isBest && s.valueBest]}>
                {formatSet(
                  {
                    ...set,
                    weight_kg: set.weight_kg === null ? null : kgToDisplay(set.weight_kg, unit),
                    distance_m:
                      set.distance_m === null ? null : metresToDisplay(set.distance_m, unit),
                  },
                  labels,
                )}
              </Text>
              {set.rpe !== null ? <Text style={s.rpe}>@{set.rpe}</Text> : null}
              {set.to_failure === 1 ? <Text style={s.failure}>✗</Text> : null}
            </View>
          );
        })}
      </View>
    </View>
  );
}

const createStyles = (colors: ColorPalette) =>
  StyleSheet.create<{
    card: ViewStyle;
    header: ViewStyle;
    thumb: ViewStyle;
    headerText: ViewStyle;
    name: TextStyle;
    meta: TextStyle;
    pills: ViewStyle;
    pill: ViewStyle;
    pillWarmup: ViewStyle;
    pillBest: ViewStyle;
    tag: TextStyle;
    tagWarmup: TextStyle;
    value: TextStyle;
    valueWarmup: TextStyle;
    valueBest: TextStyle;
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
    // Wrapping, so three sets take one line and eight take two, instead of eight rows either way.
    pills: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
    pill: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      paddingVertical: 6,
      paddingHorizontal: spacing.sm,
      borderRadius: radius.sm,
      backgroundColor: colors.surfaceRaised,
      borderWidth: 1,
      borderColor: colors.borderSubtle,
    },
    // A ramp, present but not competing with the work.
    pillWarmup: { backgroundColor: 'transparent', borderStyle: 'dashed' },
    pillBest: { borderColor: colors.accentBorder, backgroundColor: colors.accentSoft },
    tag: { color: colors.accent, fontSize: fontSize.xxs, fontWeight: fontWeight.bold },
    tagWarmup: { color: colors.textFaint },
    value: {
      color: colors.text,
      fontSize: fontSize.sm,
      fontVariant: ['tabular-nums'],
    },
    valueWarmup: { color: colors.textMuted },
    valueBest: { color: colors.accent, fontWeight: fontWeight.bold },
    rpe: { color: colors.textMuted, fontSize: fontSize.xxs, fontVariant: ['tabular-nums'] },
    failure: { color: colors.warning, fontSize: fontSize.xxs },
  });
