/**
 * One exercise inside the active workout: its name, what you did last time, the target, its sets,
 * and the volume accumulating as you tick them.
 *
 * The "previous session" line is the reason this card is worth its space. The handoff calls for
 * last session's real performance, set by set — `82.5×8 · 82.5×7 · 80×7 · 80×6` — because that is
 * what a lifter is actually working against. A target says what was planned; the previous line
 * says what happened, and the difference between them is the whole point of progressive overload.
 *
 * Volume is recomputed from the sets on every render rather than tracked. See `workout/derived.ts`
 * for why nothing here is stored.
 */

import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View, type TextStyle, type ViewStyle } from 'react-native';

import { exerciseVolume, type DerivedSet } from '../../workout/derived.js';
import { useTheme } from '../../ThemeProvider.js';
import type { UnitPreference } from '@fit/shared';
import { formatPlates, OLYMPIC_BAR, OLYMPIC_BAR_LB, platesPerSide } from '@fit/shared/calculations';

import { useUnit } from '../../UnitsProvider.js';
import { formatVolume, kgToDisplay, weightUnitKey } from '../../units.js';
import { radius, type ColorPalette } from '../../theme.js';
import type { DragHandleProps } from '../DragReorderList.js';
import { SetRow } from './SetRow.js';

export interface PreviousSet {
  weightKg: number | null;
  reps: number | null;
}

export interface ExerciseTarget {
  sets: number | null;
  repsMin: number | null;
  repsMax: number | null;
}

export interface ExercisePanelProps {
  name: string;
  sets: readonly DerivedSet[];
  previous: readonly PreviousSet[] | null;
  target: ExerciseTarget | null;
  onChangeWeight: (setIndex: number, next: number) => void;
  onChangeReps: (setIndex: number, next: number) => void;
  onToggle: (setIndex: number) => void;
  onAddSet: () => void;
  onRemoveSet?: (setIndex: number) => void;
  /**
   * Open this exercise's menu — swap it for another, or take it out.
   *
   * Removing used to be a long press on the name, undiscoverable but harmless. It stopped being
   * harmless once a long press also picks the card up to drag it: the same gesture would lift
   * the card and then offer to delete what was in the air. One visible button owns both actions
   * now, and the long press means exactly one thing.
   */
  onOptions?: () => void;
  /**
   * Grab handle for dragging the whole card, sets included, to another place in the session.
   *
   * The panel does not implement the drag; `DragReorderList` owns the gesture and the card just
   * offers somewhere to take hold of it. Kept to a handle rather than the whole card because
   * everything else here — weight fields, rep fields, the done checkbox — wants the touch too.
   */
  dragHandle?: DragHandleProps;
  /**
   * Whether this exercise loads a straight barbell, which turns on the plate hint.
   *
   * Only the straight bar. An EZ bar is anywhere from 6.5 to 10 kg, a trap bar from 20 to 32,
   * and a Smith machine's sled is counterbalanced by an amount nobody prints — a confidently
   * wrong bar weight there would shift every number on the screen without looking wrong.
   */
  onBarbell?: boolean;
  /**
   * Add a warm-up ramp before the working sets.
   *
   * Offered only while there is nothing warmed up yet and a working weight to ramp toward —
   * a button that would do nothing is worse than an absent one.
   */
  onAddWarmup?: () => void;
  canAddWarmup?: boolean;
}

export function ExercisePanel({
  name,
  sets,
  previous,
  target,
  onChangeWeight,
  onChangeReps,
  onToggle,
  onAddSet,
  onRemoveSet,
  onOptions,
  dragHandle,
  onBarbell = false,
  onAddWarmup,
  canAddWarmup = false,
}: ExercisePanelProps) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const unit = useUnit();
  const s = useMemo(() => createStyles(colors), [colors]);

  const volume = exerciseVolume(sets);

  /*
   * What to put on the bar for the set you are about to do.
   *
   * The next unfinished set, not the heaviest and not the last — those answer a different
   * question. On a ramp the bar changes between sets, and the only loading worth showing while
   * standing in front of the rack is the one for the set in front of you.
   *
   * Shown once per exercise rather than on every row: SetRow is built for one thumb, and its
   * own comments say so. A line per set would crowd the thing it is meant to help with.
   */
  const plateHint = useMemo(() => {
    if (!onBarbell) return null;
    const next = sets.find((set) => !set.done) ?? sets[sets.length - 1];
    if (!next?.weightKg) return null;

    const bar = unit === 'imperial' ? OLYMPIC_BAR_LB : OLYMPIC_BAR;
    const load = platesPerSide(kgToDisplay(next.weightKg, unit), bar);
    const plates = formatPlates(load);
    // Nothing to hang, or a target these plates cannot make — either way a hint would mislead
    // more than it helps, and `remainder` is what makes the difference visible.
    return plates && load.remainder === 0 ? { bar: bar.kg, plates } : null;
  }, [onBarbell, sets, unit]);
  const targetLabel = target ? formatTarget(target, t) : null;
  const previousLabel = previous && previous.length > 0 ? formatPrevious(previous, unit) : null;

  return (
    <View style={s.card}>
      <View style={s.header}>
        <View style={s.headerText}>
          <Text style={s.name}>{name}</Text>
          {previousLabel ? (
            <Text style={s.previous} numberOfLines={1}>
              {t('workout.lastTime')}: {previousLabel}
            </Text>
          ) : (
            // Said plainly rather than left blank: an empty line here reads as data that failed
            // to load, when in fact this is simply the first time.
            <Text style={s.previous}>{t('workout.firstTime')}</Text>
          )}
        </View>
        {targetLabel ? (
          <View style={s.targetPill}>
            <Text style={s.targetText}>{targetLabel}</Text>
          </View>
        ) : null}

        {onOptions ? (
          <Pressable
            onPress={onOptions}
            accessibilityRole="button"
            accessibilityLabel={t('workout.exerciseOptions')}
            hitSlop={6}
            style={({ pressed }) => [s.options, pressed && s.pressed]}
          >
            <Text style={s.optionsGlyph}>⋯</Text>
          </Pressable>
        ) : null}

        {/* In the header rather than beside the sets: this moves the whole exercise, and sitting
            it next to a set's controls would read as moving that one row. */}
        {dragHandle ? (
          <View
            {...dragHandle.handlers}
            style={[s.handle, dragHandle.active && s.handleActive]}
            accessibilityRole="adjustable"
            accessibilityLabel={t('workout.dragExercise')}
            /* Dragging is unusable through a screen reader, so the same move is offered as two
               named actions. Without this the feature would be sighted-only. */
            accessibilityActions={[
              ...(dragHandle.canMoveUp ? [{ name: 'moveUp', label: t('plan.moveExerciseUp') }] : []),
              ...(dragHandle.canMoveDown
                ? [{ name: 'moveDown', label: t('plan.moveExerciseDown') }]
                : []),
            ]}
            onAccessibilityAction={(event) => {
              if (event.nativeEvent.actionName === 'moveUp') dragHandle.moveUp();
              if (event.nativeEvent.actionName === 'moveDown') dragHandle.moveDown();
            }}
          >
            <Text style={[s.handleGlyph, dragHandle.active && s.handleGlyphActive]}>⠿</Text>
          </View>
        ) : null}
      </View>

      {plateHint ? (
        <Text style={s.plateHint}>
          {t('workout.plateHint', { bar: plateHint.bar, plates: plateHint.plates })}
        </Text>
      ) : null}

      <View style={s.columns}>
        <Text style={[s.columnLabel, s.columnIndex]}>#</Text>
        <Text style={[s.columnLabel, s.columnField]}>{t('workout.weight')}</Text>
        <Text style={[s.columnLabel, s.columnField]}>{t('workout.reps')}</Text>
        <View style={s.columnCheck} />
      </View>

      <View style={s.rows}>
        {sets.map((set, index) => (
          <SetRow
            // Index as key: these rows have no stable id of their own here, and the list only ever
            // grows at the end — appending never reorders what is above it.
            key={index}
            index={index + 1}
            weightKg={set.weightKg}
            reps={set.reps}
            done={set.done}
            onChangeWeight={(next) => onChangeWeight(index, next)}
            onChangeReps={(next) => onChangeReps(index, next)}
            onToggle={() => onToggle(index)}
            onRemove={onRemoveSet ? () => onRemoveSet(index) : undefined}
          />
        ))}
      </View>

      <View style={s.footer}>
        <Pressable
          onPress={onAddSet}
          accessibilityRole="button"
          style={({ pressed }) => [s.addSet, pressed && s.pressed]}
        >
          <Text style={s.addSetText}>+ {t('workout.addSet')}</Text>
        </Pressable>
        {onAddWarmup && canAddWarmup ? (
          <Pressable
            onPress={onAddWarmup}
            accessibilityRole="button"
            style={({ pressed }) => [s.addSet, pressed && s.pressed]}
          >
            <Text style={s.addSetText}>+ {t('workout.addWarmup')}</Text>
          </Pressable>
        ) : null}
        {/* Only once something has been lifted. A live "0 kg" beside an untouched card is a score
            nobody asked for. */}
        {volume > 0 ? (
          <Text style={s.volume}>
            {formatVolume(volume, unit)} {t(`common.${weightUnitKey(unit)}`)} {t('workout.volume')}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

/** `4 × 6-8`, or `4 × 8` when the plan names a single number. */
function formatTarget(target: ExerciseTarget, t: (key: string) => string): string | null {
  const { sets, repsMin, repsMax } = target;
  if (sets === null && repsMin === null && repsMax === null) return null;

  const reps =
    repsMin !== null && repsMax !== null && repsMin !== repsMax
      ? `${repsMin}-${repsMax}`
      : `${repsMin ?? repsMax ?? ''}`;

  if (sets === null) return reps ? `${t('workout.target')} ${reps}` : null;
  return reps ? `${t('workout.target')} ${sets} × ${reps}` : `${t('workout.target')} ${sets}`;
}

/** `82.5×8 · 82.5×7 · 80×7` — every set of the last session, in order, in the reader's units. */
function formatPrevious(previous: readonly PreviousSet[], unit: UnitPreference): string {
  return previous
    .map((p) =>
      p.weightKg === null
        ? `${p.reps ?? '—'}`
        : `${kgToDisplay(p.weightKg, unit)}×${p.reps ?? '—'}`,
    )
    .join(' · ');
}

const createStyles = (colors: ColorPalette) =>
  StyleSheet.create<{
    card: ViewStyle;
    header: ViewStyle;
    headerText: ViewStyle;
    name: TextStyle;
    previous: TextStyle;
    targetPill: ViewStyle;
    targetText: TextStyle;
    plateHint: TextStyle;
    options: ViewStyle;
    optionsGlyph: TextStyle;
    handle: ViewStyle;
    handleActive: ViewStyle;
    handleGlyph: TextStyle;
    handleGlyphActive: TextStyle;
    columns: ViewStyle;
    columnLabel: TextStyle;
    columnIndex: TextStyle;
    columnField: TextStyle;
    columnCheck: ViewStyle;
    rows: ViewStyle;
    footer: ViewStyle;
    addSet: ViewStyle;
    addSetText: TextStyle;
    pressed: ViewStyle;
    volume: TextStyle;
  }>({
    card: {
      borderWidth: 1,
      borderColor: colors.borderSubtle,
      backgroundColor: colors.surface,
      borderRadius: radius.lg,
      padding: 14,
      gap: 12,
    },

    header: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 },
    headerText: { flex: 1, gap: 3 },
    name: { color: colors.text, fontSize: 16, fontWeight: '500', textAlign: 'auto' },
    previous: { color: colors.textFaint, fontSize: 12, textAlign: 'auto' },
    targetPill: {
      paddingVertical: 4,
      paddingHorizontal: 9,
      borderRadius: radius.pill,
      borderWidth: 1,
      borderColor: colors.accentBorder,
    },
    targetText: { color: colors.accent, fontSize: 11 },
    // Quiet and monospaced-ish: it is a number to glance at between sets, not a label to read.
    plateHint: {
      color: colors.textMuted,
      fontSize: 12,
      textAlign: 'auto',
      fontVariant: ['tabular-nums'],
    },
    options: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
    optionsGlyph: { color: colors.textSecondary, fontSize: 20, lineHeight: 22 },
    // A full 44pt target. The grip is small, but the area that answers to a thumb is not —
    // a handle you have to aim at is a handle that loses the drag before it starts.
    handle: {
      width: 44,
      height: 44,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: radius.sm,
    },
    handleActive: { backgroundColor: colors.accentSoft },
    handleGlyph: { color: colors.textFaint, fontSize: 18 },
    handleGlyphActive: { color: colors.accent },

    columns: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    columnLabel: { color: colors.textFaint, fontSize: 11, textAlign: 'center' },
    columnIndex: { width: 30 },
    columnField: { flex: 1 },
    columnCheck: { width: 52 },

    rows: { gap: 6 },

    footer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
    addSet: {
      minHeight: 40,
      justifyContent: 'center',
      paddingHorizontal: 14,
      borderRadius: radius.sm,
      borderWidth: 1,
      borderStyle: 'dashed',
      borderColor: colors.borderStrong,
    },
    addSetText: { color: colors.textSecondary, fontSize: 13 },
    pressed: { opacity: 0.6 },
    volume: { color: colors.textFaint, fontSize: 12, fontVariant: ['tabular-nums'] },
  });
