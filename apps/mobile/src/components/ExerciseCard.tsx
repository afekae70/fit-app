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
import { useUnitSystem } from '../settings.js';
import { colors, fontSize, radius, spacing } from '../theme.js';
import {
  displayDistanceToMetres,
  displayWeightToKg,
  distanceUnitKey,
  formatVolume,
  isEditedWeight,
  kgToDisplay,
  metresToDisplay,
  weightUnitKey,
} from '../units.js';

export interface ExerciseCardProps {
  exercise: ExerciseSeed;
  sets: SetRow[];
  previousBest: { weight_kg: number; reps: number } | null;
  onAddSet: () => void;
  onRemoveSet: (setId: string) => void;
  onUpdateSet: (setId: string, patch: Record<string, number | boolean | null>) => void;
  onRemoveExercise: () => void;
  /**
   * A working set was just performed — starts the rest countdown.
   *
   * Fired from the two moments that actually mean "I finished that set": committing a changed
   * value into a set's fields, and adding the next set. Warmups do not fire it, since resting
   * a full three minutes after an empty-bar warmup is not what anyone wants.
   */
  onSetLogged?: (exerciseKey: string) => void;
}

/** Parse a typed value, treating an empty field as "cleared" rather than zero. */
function parseField(raw: string): number | null {
  const normalised = raw.replace(',', '.').trim();
  if (normalised === '') return null;
  const value = Number(normalised);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

function ExerciseCardImpl({
  exercise,
  sets,
  previousBest,
  onAddSet,
  onRemoveSet,
  onUpdateSet,
  onRemoveExercise,
  onSetLogged,
}: ExerciseCardProps) {
  const { t, i18n } = useTranslation();
  const isHebrew = i18n.language === 'he';
  const unitSystem = useUnitSystem();
  const weightUnit = t(`common.${weightUnitKey(unitSystem)}`);
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

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <View style={styles.headerMain}>
          <Text style={styles.title}>{isHebrew ? exercise.nameHe : exercise.nameEn}</Text>
          <Text style={styles.subtitle}>
            {previousBest
              ? `${t('workout.lastTime')}: ${kgToDisplay(previousBest.weight_kg, unitSystem)}${weightUnit} × ${previousBest.reps}`
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
            <Text style={[styles.columnLabel, styles.headerInput]}>
              {t('workout.weight')} ({weightUnit})
            </Text>
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

      {sets.map((set) => (
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
              // Keyed on the unit system as well as the set: the field is uncontrolled, so
              // switching units mid-workout has to remount it for the new defaultValue to
              // take — otherwise the row would keep showing kilograms labelled as pounds.
              key={`${set.id}-${unitSystem}`}
              defaultValue={set.weight_kg === null ? '' : String(kgToDisplay(set.weight_kg, unitSystem))}
              onEndEditing={(e) => {
                const typed = parseField(e.nativeEvent.text);
                // Blur fires whether or not anything was typed. Writing regardless would
                // walk the stored weight by the display rounding error on every tap-through.
                if (!isEditedWeight(set.weight_kg, typed, unitSystem)) return;
                onUpdateSet(set.id, {
                  weightKg: typed === null ? null : displayWeightToKg(typed, unitSystem),
                });
                if (set.is_warmup === 0) onSetLogged?.(exercise.nameEn);
              }}
              keyboardType="numeric"
              inputMode="decimal"
              style={styles.input}
              selectTextOnFocus
              placeholder="—"
              placeholderTextColor={colors.textMuted}
            />
          ) : null}

          {showsReps ? (
            <TextInput
              defaultValue={set.reps === null ? '' : String(set.reps)}
              onEndEditing={(e) => {
                const typed = parseField(e.nativeEvent.text);
                // Same discipline as the weight field: blur fires whether or not anything
                // changed, and an unchanged blur is not a set being performed.
                if (typed === set.reps) return;
                onUpdateSet(set.id, { reps: typed });
                if (set.is_warmup === 0) onSetLogged?.(exercise.nameEn);
              }}
              keyboardType="number-pad"
              inputMode="numeric"
              style={styles.input}
              selectTextOnFocus
              placeholder="—"
              placeholderTextColor={colors.textMuted}
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
              placeholder={t('workout.seconds')}
              placeholderTextColor={colors.textMuted}
            />
          ) : null}

          {showsDistance ? (
            <TextInput
              key={`${set.id}-dist-${unitSystem}`}
              defaultValue={
                set.distance_m === null ? '' : String(metresToDisplay(set.distance_m, unitSystem))
              }
              onEndEditing={(e) => {
                const typed = parseField(e.nativeEvent.text);
                onUpdateSet(set.id, {
                  distanceM: typed === null ? null : displayDistanceToMetres(typed, unitSystem),
                });
              }}
              keyboardType="numeric"
              inputMode="decimal"
              style={styles.input}
              selectTextOnFocus
              placeholder={t(`common.${distanceUnitKey(unitSystem)}`)}
              placeholderTextColor={colors.textMuted}
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
      ))}

      {/* Adding the next set is the other honest "I just finished one" signal — and it is the
          only one available when the plan pre-filled the numbers and nothing was typed. */}
      <Pressable
        onPress={() => {
          onAddSet();
          onSetLogged?.(exercise.nameEn);
        }}
        style={styles.addSet}
        accessibilityRole="button"
      >
        <Text style={styles.addSetText}>+ {t('workout.addSet')}</Text>
      </Pressable>

      {volume > 0 ? (
        <Text style={styles.volume}>
          {workingSets.length} {t('workout.totalSets')} · {formatVolume(volume, unitSystem)}{' '}
          {weightUnit} {t('workout.totalVolume')}
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
