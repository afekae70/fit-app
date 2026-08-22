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
import { memo, useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Animated,
  Easing,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

import type { SetRow } from '../db/workouts.js';
import { hapticLight } from '../haptics.js';
import { ExerciseVisual } from './ExerciseVisual.js';
import { useTheme } from '../ThemeProvider.js';
import { useUnit } from '../UnitsProvider.js';
import {
  displayDistanceToMetres,
  displayWeightToKg,
  distanceUnitKey,
  formatVolume,
  kgToDisplay,
  metresToDisplay,
  weightUnitKey,
} from '../units.js';
import { WEIGHT_STEP_KG, WEIGHT_STEP_LB } from '../workout/derived.js';
import { duration, fontSize, radius, spacing, type ColorPalette } from '../theme.js';

export interface PreviousSet {
  set_index: number;
  weight_kg: number | null;
  reps: number | null;
  duration_seconds: number | null;
  distance_m: number | null;
  is_warmup: number;
  /** Rated effort last time, when it was rated. Sizes the jump the advice suggests. */
  rpe?: number | null;
}

export interface ExerciseTarget {
  target_sets: number | null;
  target_reps_min: number | null;
  target_reps_max: number | null;
}

export interface ExerciseCardProps {
  exercise: ExerciseSeed;
  sets: SetRow[];
  /** Last session's sets for this exercise, in set order — the numbers to beat or match. */
  previousSets: PreviousSet[] | null;
  /**
   * What the plan prescribed, when this session was started from a plan day.
   *
   * Shown alongside last time's actuals, never instead of them: the target says what to aim
   * for, the history says what you managed, and improving requires seeing both.
   */
  target?: ExerciseTarget | null;
  onAddSet: () => void;
  onRemoveSet: (setId: string) => void;
  /**
   * Open one set's menu — its kind, its rating, or deleting it.
   *
   * Editing a finished workout is where a stray set is most likely to be noticed, and it was the
   * screen where deleting one was hardest to find: a long press on the tick, hinted at nowhere
   * but an accessibility label. The active-workout card grew the same menu; this is the other
   * half of that, so the gesture means one thing in both places.
   */
  onSetOptions?: (setId: string) => void;
  onUpdateSet: (setId: string, patch: Record<string, number | boolean | null>) => void;
  /** The design's checkmark: ticks the set off, which is also what starts the rest timer. */
  onToggleDone: (setId: string, done: boolean) => void;
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

/** "3 × 8-12", collapsing to "3 × 8" when the range has no spread and omitting absent parts. */
function formatTarget(target: ExerciseTarget): string | null {
  const { target_sets: sets, target_reps_min: min, target_reps_max: max } = target;
  const reps = min === null ? (max === null ? null : `${max}`) : max === null || max === min ? `${min}` : `${min}-${max}`;
  if (sets === null && reps === null) return null;
  if (sets === null) return reps;
  if (reps === null) return `${sets}`;
  return `${sets} × ${reps}`;
}

/**
 * A numeric field flanked by −/+ buttons, so a set can be logged without opening the keyboard
 * at all — the common case is nudging last time's weight or reps by one increment, not typing a
 * new number from scratch.
 *
 * The `TextInput` stays `defaultValue`-based (uncontrolled) like every other field on this card
 * — typing must not re-render on every keystroke. A stepper press writes straight to `onCommit`
 * (bypassing the field), so the input is re-keyed on the committed value to force it to pick up
 * the new number; typing and blurring changes the committed value too, which harmlessly re-keys
 * the same way right as the field loses focus anyway.
 */
function SteppedField({
  value,
  step,
  decimals,
  placeholder,
  onCommit,
  colors,
  inputStyle,
  groupStyle,
  buttonStyle,
  buttonTextStyle,
}: {
  value: number | null;
  step: number;
  decimals: number;
  placeholder: string;
  onCommit: (next: number | null) => void;
  colors: ColorPalette;
  inputStyle: StyleProp<TextStyle>;
  groupStyle: StyleProp<ViewStyle>;
  buttonStyle: StyleProp<ViewStyle>;
  buttonTextStyle: StyleProp<TextStyle>;
}) {
  const adjust = (delta: number) => {
    hapticLight();
    const next = Math.max(0, Number(((value ?? 0) + delta).toFixed(decimals)));
    onCommit(next);
  };

  return (
    <View style={groupStyle}>
      <Pressable onPress={() => adjust(-step)} style={buttonStyle} hitSlop={6} accessibilityRole="button">
        <Text style={buttonTextStyle}>−</Text>
      </Pressable>
      <TextInput
        key={value ?? 'empty'}
        defaultValue={value === null ? '' : String(value)}
        onEndEditing={(e) => onCommit(parseField(e.nativeEvent.text))}
        keyboardType={decimals > 0 ? 'numeric' : 'number-pad'}
        inputMode={decimals > 0 ? 'decimal' : 'numeric'}
        style={inputStyle}
        selectTextOnFocus
        placeholder={placeholder}
        placeholderTextColor={colors.textFaint}
      />
      <Pressable onPress={() => adjust(step)} style={buttonStyle} hitSlop={6} accessibilityRole="button">
        <Text style={buttonTextStyle}>+</Text>
      </Pressable>
    </View>
  );
}

/**
 * The tick, with the design system's `pop` on the way in: scale .7 -> 1.12 -> 1.
 *
 * The overshoot is the point — a mark that simply appears reads as a state change, while one
 * that springs past its size and settles reads as a thing you just did. Native-driven start to
 * finish, and each set owns its own value: a single shared one would pop every row in the card
 * whenever any set was ticked.
 */
function DoneMark({ done, style }: { done: boolean; style: StyleProp<TextStyle> }) {
  const pop = useRef(new Animated.Value(done ? 1 : 0)).current;
  const wasDone = useRef(done);

  useEffect(() => {
    // Only animate the transition into done. Unticking is a correction, and celebrating a
    // correction is noise.
    if (done && !wasDone.current) {
      pop.setValue(0);
      Animated.timing(pop, {
        toValue: 1,
        duration: duration.normal,
        easing: Easing.out(Easing.back(2.2)),
        useNativeDriver: true,
      }).start();
    } else if (!done) {
      pop.setValue(0);
    }
    wasDone.current = done;
  }, [done, pop]);

  return (
    <Animated.Text
      style={[
        style,
        { transform: [{ scale: done ? pop.interpolate({ inputRange: [0, 1], outputRange: [0.7, 1] }) : 1 }] },
      ]}
    >
      ✓
    </Animated.Text>
  );
}

function ExerciseCardImpl({
  exercise,
  sets,
  previousSets,
  target,
  onAddSet,
  onRemoveSet,
  onSetOptions,
  onUpdateSet,
  onToggleDone,
  onRemoveExercise,
}: ExerciseCardProps) {
  const { t, i18n } = useTranslation();
  const isHebrew = i18n.language === 'he';
  const { colors } = useTheme();
  const unit = useUnit();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const loadType = exercise.loadType ?? 'weight_reps';

  const showsWeight = loadType === 'weight_reps' || loadType === 'bodyweight_plus';
  const showsReps = loadType !== 'time' && loadType !== 'distance';
  const showsDuration = loadType === 'time';
  const showsDistance = loadType === 'distance';

  const workingSets = sets.filter((s) => s.is_warmup === 0);

  // Keyed by set id rather than position: the rows here carry real ids, and a map survives a
  // warm-up being flipped mid-list without renumbering the wrong row.
  const labels = useMemo(() => {
    const out = new Map<string, number>();
    let working = 0;
    for (const set of sets) {
      if (set.is_warmup === 0) out.set(set.id, ++working);
    }
    return out;
  }, [sets]);
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
      if (set.distance_m !== null)
        return `${metresToDisplay(set.distance_m, unit)}${t(`common.${distanceUnitKey(unit)}`)}`;
      if (set.weight_kg === null && set.reps === null) return null;
      if (set.weight_kg === null) return `${set.reps}`;
      return `${kgToDisplay(set.weight_kg, unit)}×${set.reps ?? '?'}`;
    })
    .filter((entry): entry is string => entry !== null)
    .join(' · ');

  const targetLabel = target ? formatTarget(target) : null;

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <View style={styles.cardThumb}>
          <ExerciseVisual exercise={exercise} height={52} />
        </View>
        <View style={styles.headerMain}>
          <View style={styles.titleRow}>
            <Text style={styles.title}>{isHebrew ? exercise.nameHe : exercise.nameEn}</Text>
            {targetLabel ? (
              <View style={styles.targetBadge}>
                <Text style={styles.targetBadgeText}>
                  {t('plan.target')} {targetLabel}
                </Text>
              </View>
            ) : null}
          </View>
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
            onPress={() =>
              onSetOptions
                ? onSetOptions(set.id)
                : onUpdateSet(set.id, { isWarmup: set.is_warmup === 0 })
            }
            style={[
              styles.colIndex,
              styles.indexBadge,
              set.to_failure === 1 && styles.indexBadgeFailure,
              set.is_warmup === 1 && styles.indexBadgeWarmup,
            ]}
            accessibilityRole="button"
            accessibilityLabel={
              onSetOptions ? t('workout.setOptions', { index: set.set_index }) : t('workout.warmup')
            }
          >
            <Text
              style={[
                styles.indexText,
                set.to_failure === 1 && styles.indexTextFailure,
                set.is_warmup === 1 && styles.indexTextWarmup,
              ]}
            >
              {set.is_warmup === 1
                ? t('workout.warmupShort')
                : (labels.get(set.id) ?? set.set_index)}
            </Text>
          </Pressable>

          {showsWeight ? (
            <SteppedField
              // The stepper is unit-agnostic on purpose: it is handed the number the user is
              // reading and the grid that number lives on, and hands one back in the same space.
              // Converting here rather than inside it keeps kilograms the only thing stored.
              value={set.weight_kg === null ? null : kgToDisplay(set.weight_kg, unit)}
              step={unit === 'imperial' ? WEIGHT_STEP_LB : WEIGHT_STEP_KG}
              decimals={2}
              placeholder={hint(
                previous?.weight_kg === null || previous?.weight_kg === undefined
                  ? previous?.weight_kg
                  : kgToDisplay(previous.weight_kg, unit),
              )}
              onCommit={(display) =>
                onUpdateSet(set.id, {
                  weightKg: display === null ? null : displayWeightToKg(display, unit),
                })
              }
              colors={colors}
              inputStyle={styles.input}
              groupStyle={styles.stepperGroup}
              buttonStyle={styles.stepperBtn}
              buttonTextStyle={styles.stepperBtnText}
            />
          ) : null}

          {showsReps ? (
            <SteppedField
              value={set.reps}
              step={1}
              decimals={0}
              placeholder={hint(previous?.reps)}
              onCommit={(reps) => onUpdateSet(set.id, { reps })}
              colors={colors}
              inputStyle={styles.input}
              groupStyle={styles.stepperGroup}
              buttonStyle={styles.stepperBtn}
              buttonTextStyle={styles.stepperBtnText}
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
              // Re-keyed on the unit so an uncontrolled field picks up the converted
              // defaultValue; without it a switch mid-workout would leave metres labelled yards.
              key={`${set.id}-dist-${unit}`}
              defaultValue={
                set.distance_m === null ? '' : String(metresToDisplay(set.distance_m, unit))
              }
              onEndEditing={(e) => {
                const typed = parseField(e.nativeEvent.text);
                onUpdateSet(set.id, {
                  distanceM: typed === null ? null : displayDistanceToMetres(typed, unit),
                });
              }}
              keyboardType="numeric"
              inputMode="decimal"
              style={styles.input}
              selectTextOnFocus
              placeholder={
                previous?.distance_m === null || previous?.distance_m === undefined
                  ? t(`common.${distanceUnitKey(unit)}`)
                  : String(metresToDisplay(previous.distance_m, unit))
              }
              placeholderTextColor={colors.textFaint}
            />
          ) : null}

          {/* Ticks the set off, and only that. Deleting used to be a long press here, findable
              only by being told — it lives in the index badge's menu now, named, alongside the
              other things one set can be. */}
          <Pressable
            onPress={() => onToggleDone(set.id, set.done_at === null)}
            onLongPress={onSetOptions ? undefined : () => onRemoveSet(set.id)}
            delayLongPress={450}
            style={[styles.doneBtn, set.done_at !== null && styles.doneBtnActive]}
            accessibilityRole="button"
            accessibilityState={{ checked: set.done_at !== null }}
            accessibilityLabel={t('workout.markDone')}
            hitSlop={4}
          >
            <DoneMark
              done={set.done_at !== null}
              style={[styles.doneMark, set.done_at !== null && styles.doneMarkActive]}
            />
          </Pressable>
        </View>
        );
      })}

      <Pressable
        onPress={() => {
          hapticLight();
          onAddSet();
        }}
        style={styles.addSet}
        accessibilityRole="button"
      >
        <Text style={styles.addSetText}>+ {t('workout.addSet')}</Text>
      </Pressable>

      {volume > 0 ? (
        <Text style={styles.volume}>
          {workingSets.length} {t('workout.totalSets')} · {formatVolume(volume, unit)}{' '}
          {t(`common.${weightUnitKey(unit)}`)} {t('workout.totalVolume')}
        </Text>
      ) : null}
    </View>
  );
}

export const ExerciseCard = memo(ExerciseCardImpl);

const createStyles = (colors: ColorPalette) =>
  StyleSheet.create<{
    card: ViewStyle;
    header: ViewStyle;
    cardThumb: ViewStyle;
    headerMain: ViewStyle;
    titleRow: ViewStyle;
    title: TextStyle;
    targetBadge: ViewStyle;
    targetBadgeText: TextStyle;
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
    indexBadgeFailure: ViewStyle;
    indexBadgeWarmup: ViewStyle;
    indexText: TextStyle;
    indexTextFailure: TextStyle;
    indexTextWarmup: TextStyle;
    input: TextStyle;
    stepperGroup: ViewStyle;
    stepperBtn: ViewStyle;
    stepperBtnText: TextStyle;
    doneBtn: ViewStyle;
    doneBtnActive: ViewStyle;
    doneMark: TextStyle;
    doneMarkActive: TextStyle;
    deleteText: TextStyle;
    addSet: ViewStyle;
    addSetText: TextStyle;
    volume: TextStyle;
  }>({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  header: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: spacing.sm },
  cardThumb: { width: 58, marginEnd: spacing.sm },
  headerMain: { flex: 1 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' },
  title: { color: colors.text, fontSize: fontSize.md, fontWeight: '700', textAlign: 'auto' },
  targetBadge: {
    paddingVertical: 1,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.accentBorder,
    backgroundColor: colors.accentSoft,
  },
  targetBadgeText: { color: colors.accent, fontSize: fontSize.xxs, fontWeight: '700' },
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
  // Before the warm-up styles, so a ramp still reads as a ramp if both flags land on one set.
  indexBadgeFailure: { backgroundColor: colors.dangerSoft },
  indexBadgeWarmup: { backgroundColor: colors.warningSoft },
  indexText: { color: colors.textMuted, fontSize: fontSize.sm, fontWeight: '700' },
  indexTextFailure: { color: colors.danger, fontWeight: '700' },
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
  stepperGroup: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 4 },
  stepperBtn: {
    width: 28,
    height: 40,
    borderRadius: radius.sm,
    backgroundColor: colors.surfaceRaised,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepperBtnText: { color: colors.textMuted, fontSize: fontSize.md, fontWeight: '700' },
  doneBtn: {
    width: 44,
    height: 40,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceRaised,
    alignItems: 'center',
    justifyContent: 'center',
  },
  doneBtnActive: { borderColor: colors.accent, backgroundColor: colors.accentSoft },
  doneMark: { color: colors.textFaint, fontSize: fontSize.md, fontWeight: '700' },
  doneMarkActive: { color: colors.accent },
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
