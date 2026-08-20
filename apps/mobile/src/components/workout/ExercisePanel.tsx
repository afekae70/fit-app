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

import { useUnit } from '../../UnitsProvider.js';
import { formatVolume, kgToDisplay, weightUnitKey } from '../../units.js';
import { radius, type ColorPalette } from '../../theme.js';
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
  /** Long-press the exercise name. */
  onRemoveExercise?: () => void;
  /**
   * Move this exercise one place earlier or later in the session.
   *
   * Arrows rather than drag, matching how the plan's days and exercises are reordered and for
   * the reason written there: a drag inside a vertical ScrollView has to win a gesture race
   * against the scroll, and the loser is always the user. Doubly so here, where the panel is
   * full of text inputs that also want the touch.
   */
  onMove?: (delta: -1 | 1) => void;
  /** Whether this panel is already at the top or bottom, which greys the matching arrow. */
  canMoveUp?: boolean;
  canMoveDown?: boolean;
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
  onRemoveExercise,
  onMove,
  canMoveUp = false,
  canMoveDown = false,
}: ExercisePanelProps) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const unit = useUnit();
  const s = useMemo(() => createStyles(colors), [colors]);

  const volume = exerciseVolume(sets);
  const targetLabel = target ? formatTarget(target, t) : null;
  const previousLabel = previous && previous.length > 0 ? formatPrevious(previous, unit) : null;

  return (
    <View style={s.card}>
      <View style={s.header}>
        <View style={s.headerText}>
          {/* Same reasoning as the set number: the card the handoff drew has no remove control,
              and the capability predates the card. */}
          <Pressable onLongPress={onRemoveExercise} disabled={!onRemoveExercise}>
            <Text style={s.name}>{name}</Text>
          </Pressable>
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

        {/* Placed in the header rather than beside the sets: this moves the whole exercise, and
            sitting it next to a set's controls would read as moving that one row. */}
        {onMove ? (
          <View style={s.reorder}>
            <Pressable
              onPress={() => onMove(-1)}
              disabled={!canMoveUp}
              accessibilityRole="button"
              accessibilityLabel={t('plan.moveExerciseUp')}
              hitSlop={6}
            >
              <Text style={[s.moveText, !canMoveUp && s.moveTextOff]}>↑</Text>
            </Pressable>
            <Pressable
              onPress={() => onMove(1)}
              disabled={!canMoveDown}
              accessibilityRole="button"
              accessibilityLabel={t('plan.moveExerciseDown')}
              hitSlop={6}
            >
              <Text style={[s.moveText, !canMoveDown && s.moveTextOff]}>↓</Text>
            </Pressable>
          </View>
        ) : null}
      </View>

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
    reorder: ViewStyle;
    moveText: TextStyle;
    moveTextOff: TextStyle;
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
    // Column, not row: two arrows side by side at this size are one target to a thumb.
    reorder: { justifyContent: 'center', gap: 2 },
    moveText: { color: colors.textSecondary, fontSize: 15 },
    moveTextOff: { color: colors.textFaint },

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
