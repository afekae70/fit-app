/**
 * One exercise inside an active workout, with its own independent list of sets.
 *
 * This component is where the "dynamic sets" requirement becomes visible: the add-set and
 * delete-set controls belong to THIS card only. Adding a fifth set to chest press does not
 * touch the face pulls rendered by the sibling card — they are separate rows in `sets`, keyed
 * to different `session_exercise_id`s.
 *
 * Which inputs render depends on the exercise's `loadType`: weight+reps for a barbell lift,
 * a duration field for a plank, a distance field for a carry.
 */

import type { ExerciseSeed } from '@fit/shared/catalog';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

import type { SetRow } from '../db/workouts.js';
import { colors, fontSize, radius, spacing } from '../theme.js';

export interface PreviousSet {
  set_index: number;
  weight_kg: number | null;
  reps: number | null;
  duration_seconds: number | null;
  distance_m: number | null;
  is_warmup: number;
}

export interface ExerciseCardProps {
  exercise: ExerciseSeed;
  sets: SetRow[];
  /** Last session's sets for this exercise, in set order — the numbers to beat or match. */
  previousSets: PreviousSet[] | null;
  onAddSet: () => void;
  onRemoveSet: (setId: string) => void;
  onUpdateSet: (setId: string, patch: Record<string, number | boolean | null>) => void;
  onRemoveExercise: () => void;
}

/** Parse a typed value, treating an empty field as "cleared" rather than zero. */
function parseField(raw: string): number | null {
  const normalised = raw.replace(',', '.').trim();
  if (normalised === '') return null;
  const value = Number(normalised);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

/** Render a previous value as placeholder text, or the em-dash when there is nothing to show. */
const hint = (value: number | null | undefined): string =>
  value === null || value === undefined ? '—' : String(value);

function ExerciseCardImpl({
  exercise,
  sets,
  previousSets,
  onAddSet,
  onRemoveSet,
  onUpdateSet,
  onRemoveExercise,
}: ExerciseCardProps) {
  const { t, i18n } = useTranslation();
  const isHebrew = i18n.language === 'he';
  const loadType = exercise.loadType ?? 'weight_reps';

  const showsWeight = loadType === 'weight_reps' || loadType === 'bodyweight_plus';
  const showsReps = loadType !== 'time' && loadType !== 'distance';
  const showsDuration = loadType === 'time';
  const showsDistance = loadType === 'distance';

  const workingSets = sets.filter((s) => s.is_warmup === 0);
  const volume = workingSets.reduce(
    (total, s) => total + (s.weight_kg ?? 0) * (s.reps ?? 0),
    0,
  );

  // Keyed by set_index so row N lines up with what row N was last time. A plain array index
  // would drift the moment a warmup set is added or removed on either side.
  const previousByIndex = new Map<number, PreviousSet>(
    (previousSets ?? []).map((set) => [set.set_index, set]),
  );

  /** Last session's working sets as "80×8 · 80×8 · 75×6" — the whole session at a glance. */
  const previousSummary = (previousSets ?? [])
    .filter((set) => set.is_warmup === 0)
    .map((set) => {
      if (set.duration_seconds !== null) return `${set.duration_seconds}${t('workout.seconds')}`;
      if (set.distance_m !== null) return `${set.distance_m}${t('workout.meters')}`;
      if (set.weight_kg === null && set.reps === null) return null;
      if (set.weight_kg === null) return `${set.reps}`;
      return `${set.weight_kg}×${set.reps ?? '?'}`;
    })
    .filter((entry): entry is string => entry !== null)
    .join(' · ');

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <View style={styles.headerMain}>
          <Text style={styles.title}>{isHebrew ? exercise.nameHe : exercise.nameEn}</Text>
          <Text style={styles.subtitle}>
            {previousSummary
              ? `${t('workout.lastTime')}: ${previousSummary}`
              : t('workout.noHistory')}
          </Text>
        </View>
        <Pressable
          onPress={onRemoveExercise}
          style={styles.removeExercise}
          accessibilityRole="button"
          accessibilityLabel={t('workout.removeExercise')}
        >
          <Text style={styles.removeExerciseText}>✕</Text>
        </Pressable>
      </View>

      {sets.length > 0 ? (
        <View style={styles.columnHeader}>
          <Text style={[styles.columnLabel, styles.headerIndex]}>#</Text>
          {showsWeight ? (
            <Text style={[styles.columnLabel, styles.headerInput]}>{t('workout.weight')}</Text>
          ) : null}
          {showsReps ? (
            <Text style={[styles.columnLabel, styles.headerInput]}>{t('workout.reps')}</Text>
          ) : null}
          {showsDuration ? (
            <Text style={[styles.columnLabel, styles.headerInput]}>{t('workout.duration')}</Text>
          ) : null}
          {showsDistance ? (
            <Text style={[styles.columnLabel, styles.headerInput]}>{t('workout.distance')}</Text>
          ) : null}
          <View style={styles.colActions} />
        </View>
      ) : null}

      {sets.map((set) => {
        // The placeholder carries last session's number for THIS set. It is deliberately a
        // placeholder and not a value: it disappears the moment the user types, and an
        // untouched field still saves as empty rather than as a weight that was never lifted.
        const previous = previousByIndex.get(set.set_index);

        return (
        <View key={set.id} style={styles.setRow}>
          <Pressable
            onPress={() => onUpdateSet(set.id, { isWarmup: set.is_warmup === 0 })}
            style={[styles.colIndex, styles.indexBadge, set.is_warmup === 1 && styles.indexBadgeWarmup]}
            accessibilityRole="button"
            accessibilityLabel={t('workout.warmup')}
          >
            <Text style={[styles.indexText, set.is_warmup === 1 && styles.indexTextWarmup]}>
              {set.is_warmup === 1 ? t('workout.warmupShort') : set.set_index}
            </Text>
          </Pressable>

          {showsWeight ? (
            <TextInput
              defaultValue={set.weight_kg === null ? '' : String(set.weight_kg)}
              onEndEditing={(e) =>
                onUpdateSet(set.id, { weightKg: parseField(e.nativeEvent.text) })
              }
              keyboardType="numeric"
              inputMode="decimal"
              style={styles.input}
              selectTextOnFocus
              placeholder={hint(previous?.weight_kg)}
              placeholderTextColor={colors.textFaint}
            />
          ) : null}

          {showsReps ? (
            <TextInput
              defaultValue={set.reps === null ? '' : String(set.reps)}
              onEndEditing={(e) => onUpdateSet(set.id, { reps: parseField(e.nativeEvent.text) })}
              keyboardType="number-pad"
              inputMode="numeric"
              style={styles.input}
              selectTextOnFocus
              placeholder={hint(previous?.reps)}
              placeholderTextColor={colors.textFaint}
            />
          ) : null}

          {showsDuration ? (
            <TextInput
              defaultValue={set.duration_seconds === null ? '' : String(set.duration_seconds)}
              onEndEditing={(e) =>
                onUpdateSet(set.id, { durationSeconds: parseField(e.nativeEvent.text) })
              }
              keyboardType="number-pad"
              inputMode="numeric"
              style={styles.input}
              selectTextOnFocus
              placeholder={
                previous?.duration_seconds === null || previous?.duration_seconds === undefined
                  ? t('workout.seconds')
                  : String(previous.duration_seconds)
              }
              placeholderTextColor={colors.textFaint}
            />
          ) : null}

          {showsDistance ? (
            <TextInput
              defaultValue={set.distance_m === null ? '' : String(set.distance_m)}
              onEndEditing={(e) =>
                onUpdateSet(set.id, { distanceM: parseField(e.nativeEvent.text) })
              }
              keyboardType="numeric"
              inputMode="decimal"
              style={styles.input}
              selectTextOnFocus
              placeholder={
                previous?.distance_m === null || previous?.distance_m === undefined
                  ? t('workout.meters')
                  : String(previous.distance_m)
              }
              placeholderTextColor={colors.textFaint}
            />
          ) : null}

          <Pressable
            onPress={() => onRemoveSet(set.id)}
            style={styles.colActions}
            accessibilityRole="button"
            accessibilityLabel={t('workout.removeSet')}
            hitSlop={8}
          >
            <Text style={styles.deleteText}>✕</Text>
          </Pressable>
        </View>
        );
      })}

      <Pressable onPress={onAddSet} style={styles.addSet} accessibilityRole="button">
        <Text style={styles.addSetText}>+ {t('workout.addSet')}</Text>
      </Pressable>

      {volume > 0 ? (
        <Text style={styles.volume}>
          {workingSets.length} {t('workout.totalSets')} · {Math.round(volume).toLocaleString()}{' '}
          {t('common.kg')} {t('workout.totalVolume')}
        </Text>
      ) : null}
    </View>
  );
}

export const ExerciseCard = memo(ExerciseCardImpl);

const styles = StyleSheet.create<{
  card: ViewStyle;
  header: ViewStyle;
  headerMain: ViewStyle;
  title: TextStyle;
  subtitle: TextStyle;
  removeExercise: ViewStyle;
  removeExerciseText: TextStyle;
  columnHeader: ViewStyle;
  columnLabel: TextStyle;
  // The header labels are <Text> and the row cells are <View>/<TextInput>. RN's TextStyle is
  // not assignable to ViewStyle, so the same column width needs an entry of each type rather
  // than one shared entry.
  headerIndex: TextStyle;
  headerInput: TextStyle;
  colIndex: ViewStyle;
  colActions: ViewStyle;
  setRow: ViewStyle;
  indexBadge: ViewStyle;
  indexBadgeWarmup: ViewStyle;
  indexText: TextStyle;
  indexTextWarmup: TextStyle;
  input: TextStyle;
  deleteText: TextStyle;
  addSet: ViewStyle;
  addSetText: TextStyle;
  volume: TextStyle;
}>({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  header: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: spacing.sm },
  headerMain: { flex: 1 },
  title: { color: colors.text, fontSize: fontSize.md, fontWeight: '700', textAlign: 'auto' },
  subtitle: { color: colors.textMuted, fontSize: fontSize.xs, marginTop: 2, textAlign: 'auto' },
  removeExercise: { padding: spacing.xs, marginStart: spacing.sm },
  removeExerciseText: { color: colors.textMuted, fontSize: fontSize.sm },
  columnHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.xs,
  },
  columnLabel: { color: colors.textMuted, fontSize: fontSize.xs, textAlign: 'center' },
  headerIndex: { width: 36 },
  headerInput: { flex: 1 },
  colIndex: { width: 36, alignItems: 'center' },
  colActions: { width: 32, alignItems: 'center' },
  setRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.xs,
  },
  indexBadge: {
    height: 40,
    borderRadius: radius.sm,
    backgroundColor: colors.surfaceRaised,
    alignItems: 'center',
    justifyContent: 'center',
  },
  indexBadgeWarmup: { backgroundColor: '#3A2E10' },
  indexText: { color: colors.textMuted, fontSize: fontSize.sm, fontWeight: '700' },
  indexTextWarmup: { color: colors.warning },
  input: {
    // flex lives here rather than in a shared column style: RN's ViewStyle is not assignable
    // to a TextInput's TextStyle, so one entry cannot serve both the header and the cells.
    flex: 1,
    height: 40,
    backgroundColor: colors.surfaceRaised,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    color: colors.text,
    fontSize: fontSize.md,
    textAlign: 'center',
  },
  deleteText: { color: colors.textMuted, fontSize: fontSize.sm },
  addSet: {
    marginTop: spacing.xs,
    paddingVertical: spacing.sm,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    borderStyle: 'dashed',
    alignItems: 'center',
  },
  addSetText: { color: colors.accent, fontSize: fontSize.sm, fontWeight: '700' },
  volume: {
    color: colors.textMuted,
    fontSize: fontSize.xs,
    marginTop: spacing.sm,
    textAlign: 'auto',
  },
});
