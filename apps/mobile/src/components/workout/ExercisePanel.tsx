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

import { useMemo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View, type TextStyle, type ViewStyle } from 'react-native';

import { exerciseVolume, labelSets, type DerivedSet } from '../../workout/derived.js';
import { useTheme } from '../../ThemeProvider.js';
import type { UnitPreference } from '@fit/shared';
import { formatPlates, OLYMPIC_BAR, OLYMPIC_BAR_LB, platesPerSide } from '@fit/shared/calculations';

import { useUnit } from '../../UnitsProvider.js';
import { formatVolume, kgToDisplay, metresToDisplay, weightUnitKey } from '../../units.js';
import type { ProgressionAdvice } from '@fit/shared/calculations';
import { radius, shadow, type ColorPalette } from '../../theme.js';
import type { DragHandleProps } from '../DragReorderList.js';
import { CardioSession } from './CardioSession.js';
import { SetRow } from './SetRow.js';

export interface PreviousSet {
  weightKg: number | null;
  reps: number | null;
  durationSeconds?: number | null;
  distanceM?: number | null;
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
  /** Open one set's menu — change its kind, or delete it. Omitted where sets are read-only. */
  onSetOptions?: (setIndex: number) => void;
  /**
   * This exercise runs straight into the next one, with no rest between them.
   *
   * Drawn as a tail below the card rather than as a badge on it: a superset is a relationship
   * between two cards, and a mark that lives inside one of them says nothing about which.
   */
  supersetWithNext?: boolean;
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
   * What last session says to do today, or null when the history cannot support a suggestion.
   *
   * Passed as the verdict rather than a formatted string so the panel can put it in the
   * reader's units and language, the same as it already does for `previous` and `target`.
   */
  advice?: ProgressionAdvice | null;
  /**
   * Write the suggestion into the unfinished sets. Omitted when there is nothing to write to,
   * which turns the row from a button into a plain line of text — still worth reading, just
   * not worth pressing.
   */
  onApplyAdvice?: () => void;
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
  /**
   * A picture of the movement, passed in rather than looked up here.
   *
   * The panel works in plain values — a name, sets, numbers — and knowing how to turn an
   * exercise key into a photo would make it the second place that has to be right about the
   * catalogue. The caller already holds the seed, so it builds the visual and this lays it out.
   */
  visual?: ReactNode;
  /**
   * How much room the picture gets.
   *
   * A thumbnail beside the name is enough in the full list, where the question is which card is
   * which. In focus mode there is one exercise on the screen and the picture is the fastest
   * answer to "is this the machine in front of me" — worth the width there, wasted in a list.
   */
  visualLayout?: 'thumb' | 'banner';
  /** A quiet line under the name — the equipment and the muscle, in the reader's language. */
  subtitle?: string;
  /** Swap this exercise for another. Shown as its own button in the banner layout. */
  onSwap?: () => void;
  /** Show which muscles this works. */
  onShowMuscles?: () => void;
  /** Take the last set off — the other half of "+ set". Omitted when there is none to take. */
  onRemoveSet?: () => void;
  /**
   * Cardio: the sets hold minutes and distance rather than weight and reps.
   *
   * A walk or a ride is measured in how long and how far, and a row of weight fields for one is
   * a row nobody can fill in truthfully.
   */
  cardio?: boolean;
  onChangeDuration?: (setIndex: number, seconds: number) => void;
  onChangeDistance?: (setIndex: number, metres: number) => void;
  /** Cardio: this exercise's own key, so a run in progress survives the app being closed. */
  cardioKey?: string;
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
  onSetOptions,
  supersetWithNext = false,
  onOptions,
  advice = null,
  onApplyAdvice,
  dragHandle,
  onBarbell = false,
  onAddWarmup,
  canAddWarmup = false,
  visual,
  visualLayout = 'thumb',
  subtitle,
  onSwap,
  onShowMuscles,
  onRemoveSet,
  cardio = false,
  onChangeDuration,
  onChangeDistance,
  cardioKey,
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
  const previousLabel =
    previous && previous.length > 0 ? formatPrevious(previous, unit, cardio) : null;

  // Working sets numbered as if the warm-ups were not there — the same count the volume and the
  // charts already use, so the label agrees with the arithmetic rather than the array index.
  const labels = useMemo(() => labelSets(sets), [sets]);
  const banner = visualLayout === 'banner';

  return (
    <View style={s.card}>
      {banner ? (
        <>
          {visual ? <View style={s.hero}>{visual}</View> : null}

          <View style={s.titleBlock}>
            <View style={s.titleRow}>
              <Text style={s.bannerName}>{name}</Text>
              {targetLabel ? (
                <View style={s.targetPill}>
                  <Text style={s.targetText}>{targetLabel}</Text>
                </View>
              ) : null}
            </View>
            {subtitle ? <Text style={s.subtitle}>{subtitle}</Text> : null}
          </View>

          {/* The things one does to an exercise mid-workout, each a named button rather than an
              entry in a menu — the menu keeps only what is rarely needed. */}
          <View style={s.chips}>
            {onSwap ? <Chip label={`⇄ ${t('workout.swapShort')}`} onPress={onSwap} /> : null}
            {onShowMuscles ? (
              <Chip label={`◎ ${t('workout.musclesShort')}`} onPress={onShowMuscles} />
            ) : null}
            {onAddWarmup && canAddWarmup ? (
              <Chip label={`↗ ${t('workout.warmupChip')}`} onPress={onAddWarmup} />
            ) : null}
            {onOptions ? (
              <Chip label="⋯" onPress={onOptions} accessibilityLabel={t('workout.exerciseOptions')} />
            ) : null}
          </View>
        </>
      ) : (
        <View style={s.header}>
          {visual && visualLayout === 'thumb' ? <View style={s.visualThumb}>{visual}</View> : null}
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
      )}

      {plateHint ? (
        <Text style={s.plateHint}>
          {t('workout.plateHint', { bar: plateHint.bar, plates: plateHint.plates })}
        </Text>
      ) : null}

      {/* What last session says to do today. A `Pressable` only when there is somewhere to write
          it — with every set already ticked off, the same words are still worth reading and
          pressing them would do nothing visible, which reads as a broken button. */}
      {advice ? (
        <Pressable
          onPress={onApplyAdvice}
          disabled={!onApplyAdvice}
          accessibilityRole={onApplyAdvice ? 'button' : 'text'}
          accessibilityLabel={
            onApplyAdvice
              ? t('workout.advice.apply', {
                  weight: kgToDisplay(advice.weightKg, unit),
                  reps: advice.reps,
                })
              : undefined
          }
          style={({ pressed }) => [
            s.advice,
            advice.kind === 'deload' && s.adviceDeload,
            pressed && s.pressed,
          ]}
        >
          <Text style={[s.adviceGlyph, advice.kind === 'deload' && s.adviceGlyphDeload]}>
            {advice.kind === 'add_weight' ? '↑' : advice.kind === 'deload' ? '↓' : '→'}
          </Text>
          <Text style={[s.adviceNumbers, advice.kind === 'deload' && s.adviceGlyphDeload]}>
            {kgToDisplay(advice.weightKg, unit)} {t(unit === 'imperial' ? 'common.lb' : 'common.kg')}
            {' × '}
            {advice.reps}
          </Text>
          {/* The reason, not just the number. A suggestion whose basis is invisible is one the
              user has to either trust blindly or ignore. */}
          <Text style={s.adviceReason} numberOfLines={1}>
            {advice.kind === 'add_weight'
              ? t('workout.advice.addWeight', { from: kgToDisplay(advice.fromKg, unit) })
              : advice.kind === 'deload'
                ? t('workout.advice.deload')
                : t('workout.advice.addReps', { from: advice.fromReps })}
          </Text>
        </Pressable>
      ) : null}

      {/* A walk or a ride is one continuous effort, not a list of sets: a clock, a distance,
          and the pace the two of them make. */}
      {cardio ? (
        <CardioSession
          storageKey={cardioKey ?? name}
          durationSeconds={sets[0]?.durationSeconds ?? null}
          distanceM={sets[0]?.distanceM ?? null}
          done={sets[0]?.done ?? false}
          onChangeDuration={(seconds) => onChangeDuration?.(0, seconds)}
          onChangeDistance={(metres) => onChangeDistance?.(0, metres)}
          onToggleDone={() => onToggle(0)}
        />
      ) : (
        <>
        <View style={s.table}>
        {banner ? (
          <Text style={s.tablePrevious} numberOfLines={1}>
            {previousLabel ? `${t('workout.lastTime')} · ${previousLabel}` : t('workout.firstTime')}
          </Text>
        ) : null}
        <View style={s.columns}>
          <Text style={[s.columnLabel, s.columnIndex]}>#</Text>
          <Text style={[s.columnLabel, s.columnField]}>
            {cardio ? t('workout.duration') : t('workout.weight')}
          </Text>
          <Text style={[s.columnLabel, s.columnField]}>
            {cardio ? t('workout.distance') : t('workout.reps')}
          </Text>
          <View style={s.columnCheck} />
        </View>

        <View style={s.rows}>
          {sets.map((set, index) => (
            <SetRow
              // Index as key: these rows have no stable id of their own here, and the list only ever
              // grows at the end — appending never reorders what is above it.
              key={index}
              index={labels[index]?.ordinal ?? index + 1}
              isWarmup={labels[index]?.kind === 'warmup'}
              isDrop={labels[index]?.kind === 'drop'}
              rpe={set.rpe}
              toFailure={set.toFailure}
              onOptions={onSetOptions ? () => onSetOptions(index) : undefined}
              weightKg={set.weightKg}
              reps={set.reps}
              done={set.done}
              fields={cardio ? 'cardio' : 'weights'}
              durationSeconds={set.durationSeconds ?? null}
              distanceM={set.distanceM ?? null}
              onChangeWeight={(next) => onChangeWeight(index, next)}
              onChangeReps={(next) => onChangeReps(index, next)}
              onChangeDuration={(seconds) => onChangeDuration?.(index, seconds)}
              onChangeDistance={(metres) => onChangeDistance?.(index, metres)}
              onToggle={() => onToggle(index)}
            />
          ))}
        </View>

        {/* Take one off, put one on — the pair the sets are adjusted with, side by side under them. */}
        <View style={s.footer}>
          <Pressable
            onPress={onRemoveSet}
            disabled={!onRemoveSet}
            accessibilityRole="button"
            accessibilityLabel={t('workout.removeLastSet')}
            style={({ pressed }) => [s.setButton, !onRemoveSet && s.setButtonOff, pressed && s.pressed]}
          >
            <Text style={s.setButtonText}>− {t('workout.setShort')}</Text>
          </Pressable>
          <Pressable
            onPress={onAddSet}
            accessibilityRole="button"
            accessibilityLabel={t('workout.addSet')}
            style={({ pressed }) => [s.setButton, s.setButtonAdd, pressed && s.pressed]}
          >
            <Text style={[s.setButtonText, s.setButtonAddText]}>+ {t('workout.setShort')}</Text>
          </Pressable>
        </View>
        </View>
        </>
      )}

      {/* In the list there are no chips, so the warm-up keeps a quiet line of its own. */}
      {!banner && onAddWarmup && canAddWarmup ? (
        <Pressable onPress={onAddWarmup} accessibilityRole="button" style={s.warmupLink}>
          <Text style={s.warmupLinkText}>+ {t('workout.addWarmup')}</Text>
        </Pressable>
      ) : null}

      {/* Only once something has been lifted. A live "0 kg" beside an untouched card is a score
          nobody asked for. */}
      {volume > 0 ? (
        <Text style={s.volume}>
          {formatVolume(volume, unit)} {t(`common.${weightUnitKey(unit)}`)} {t('workout.volume')}
        </Text>
      ) : null}

      {/* The link, drawn leaving the bottom of the card toward the next one. Says which two
          exercises are joined, which a badge inside one card could not. */}
      {supersetWithNext ? (
        <View style={s.supersetTail}>
          <View style={s.supersetLine} />
          <Text style={s.supersetLabel}>{t('workout.superset')}</Text>
          <View style={s.supersetLine} />
        </View>
      ) : null}
    </View>
  );
}

/** One of the buttons under the exercise's name. */
function Chip({
  label,
  onPress,
  accessibilityLabel,
}: {
  label: string;
  onPress: () => void;
  accessibilityLabel?: string;
}) {
  const { colors } = useTheme();
  const s = useMemo(() => createStyles(colors), [colors]);
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      hitSlop={4}
      style={({ pressed }) => [s.chip, pressed && s.pressed]}
    >
      <Text style={s.chipText}>{label}</Text>
    </Pressable>
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

/**
 * `82.5×8 · 82.5×7 · 80×7` — every set of the last session, in order, in the reader's units.
 * For cardio it is what that training is instead: `32 min · 4.1 km`.
 */
function formatPrevious(
  previous: readonly PreviousSet[],
  unit: UnitPreference,
  cardio: boolean,
): string {
  if (cardio) {
    return previous
      .map((p) =>
        [
          p.durationSeconds ? `${Math.round(p.durationSeconds / 60)}′` : null,
          p.distanceM ? `${metresToDisplay(p.distanceM, unit)}` : null,
        ]
          .filter(Boolean)
          .join(' · '),
      )
      .filter((entry) => entry !== '')
      .join(' | ');
  }
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
    visualBanner: ViewStyle;
    visualThumb: ViewStyle;
    header: ViewStyle;
    headerText: ViewStyle;
    name: TextStyle;
    previous: TextStyle;
    targetPill: ViewStyle;
    targetText: TextStyle;
    plateHint: TextStyle;
    supersetTail: ViewStyle;
    supersetLine: ViewStyle;
    supersetLabel: TextStyle;
    advice: ViewStyle;
    adviceDeload: ViewStyle;
    adviceGlyph: TextStyle;
    adviceGlyphDeload: TextStyle;
    adviceNumbers: TextStyle;
    adviceReason: TextStyle;
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
    hero: ViewStyle;
    titleBlock: ViewStyle;
    titleRow: ViewStyle;
    bannerName: TextStyle;
    subtitle: TextStyle;
    chips: ViewStyle;
    chip: ViewStyle;
    chipText: TextStyle;
    table: ViewStyle;
    tablePrevious: TextStyle;
    setButton: ViewStyle;
    setButtonOff: ViewStyle;
    setButtonAdd: ViewStyle;
    setButtonText: TextStyle;
    setButtonAddText: TextStyle;
    warmupLink: ViewStyle;
    warmupLinkText: TextStyle;
    pressed: ViewStyle;
    volume: TextStyle;
  }>({
    visualBanner: { alignSelf: 'stretch' },
    visualThumb: { width: 56 },
    card: {
      backgroundColor: colors.surface,
      borderRadius: radius.xl,
      ...shadow(colors.shadow).card,
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
    supersetTail: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      marginTop: 10,
      marginBottom: -6,
    },
    supersetLine: { flex: 1, height: 1, backgroundColor: colors.accentBorder },
    supersetLabel: {
      color: colors.accent,
      fontSize: 10,
      fontWeight: '700',
      letterSpacing: 0.4,
    },
    advice: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      marginTop: 6,
      paddingVertical: 6,
      paddingHorizontal: 10,
      borderRadius: radius.sm,
      backgroundColor: colors.accentSoft,
      borderWidth: 1,
      borderColor: colors.accentBorder,
    },
    // A back-off is the one suggestion that is not an advance, and it should not wear the same
    // colour as one.
    adviceDeload: { backgroundColor: colors.dangerSoft, borderColor: colors.danger },
    adviceGlyph: { color: colors.accent, fontSize: 13, fontWeight: '700' },
    adviceGlyphDeload: { color: colors.danger },
    adviceNumbers: {
      color: colors.accent,
      fontSize: 13,
      fontWeight: '700',
      fontVariant: ['tabular-nums'],
    },
    adviceReason: {
      color: colors.textMuted,
      fontSize: 11,
      textAlign: 'auto',
      // Takes what is left and truncates itself rather than pushing the numbers off the row.
      flexShrink: 1,
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

    footer: { flexDirection: 'row', gap: 8, marginTop: 4 },

    // The picture leads in focus mode: it is the fastest answer to "is this the machine".
    hero: { borderRadius: radius.lg, overflow: 'hidden' },
    titleBlock: { gap: 4 },
    titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
    bannerName: {
      color: colors.text,
      fontSize: 20,
      fontWeight: '700',
      textAlign: 'auto',
      flexShrink: 1,
    },
    subtitle: { color: colors.textMuted, fontSize: 13, textAlign: 'auto' },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    chip: {
      minHeight: 34,
      paddingHorizontal: 14,
      justifyContent: 'center',
      borderRadius: radius.pill,
      backgroundColor: colors.surfaceRaised,
      borderWidth: 1,
      borderColor: colors.borderSubtle,
    },
    chipText: { color: colors.textSecondary, fontSize: 13, fontWeight: '500' },

    // The sets sit in a panel of their own, a shade off the card — the part of the screen that
    // is filled in, set apart from the part that is read.
    table: {
      gap: 8,
      padding: 10,
      borderRadius: radius.md,
      backgroundColor: colors.surfaceRaised,
      borderWidth: 1,
      borderColor: colors.borderSubtle,
    },
    tablePrevious: {
      color: colors.textFaint,
      fontSize: 12,
      textAlign: 'auto',
      fontVariant: ['tabular-nums'],
    },
    setButton: {
      flex: 1,
      minHeight: 42,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: radius.sm,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
    },
    setButtonOff: { opacity: 0.4 },
    setButtonAdd: { borderColor: colors.accentBorder, backgroundColor: colors.accentSoft },
    setButtonText: { color: colors.textSecondary, fontSize: 14, fontWeight: '600' },
    setButtonAddText: { color: colors.accent },
    warmupLink: { alignSelf: 'flex-start', paddingVertical: 4 },
    warmupLinkText: { color: colors.textSecondary, fontSize: 13 },
    pressed: { opacity: 0.6 },
    volume: {
      color: colors.textFaint,
      fontSize: 12,
      fontVariant: ['tabular-nums'],
      textAlign: 'center',
    },
  });
