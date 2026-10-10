/**
 * One set: `[ # ] [ − weight + ] [ − reps + ] [ ✓ ]`, 48px tall.
 *
 * The core control of the whole app, and the handoff is emphatic about why it looks like this:
 * it is operated by one thumb, mid-set, possibly sweaty. **No keyboard is ever required.** An
 * empty field shows what the set was last time and the steppers move it in the units plates
 * actually come in, so a normal set is one tap.
 *
 * ## The watermark
 *
 * A number nobody has entered is drawn faint: it is last time's, shown where today's will go.
 * It is not stored and counts toward nothing until the set is ticked, which is what writes it —
 * see `workout/ghost.ts`. A ticked set never shows one: what is recorded is what is shown.
 *
 * Ticking a set produces feedback in three places at once — this row, the header progress bar and
 * the rest timer opening. Only the first is this component's business; the other two follow from
 * `onToggle` and belong to the screen.
 *
 * ## Read at arm's length
 *
 * The numerals are larger than the rest of the app's type and the row is taller than a list row
 * needs to be, because this is read from a bench with the phone on the floor, not from a desk.
 * Everything else on the row — the chip, the unit, the rating — stays small: there is exactly one
 * thing here worth seeing from two metres away, and making its neighbours compete would undo it.
 *
 * ## Typing
 *
 * A tap on a number is typed on the phone's own numeric keyboard — but not into this row. The
 * field lives in a bar above the keys (`NumberEntryBar`), because a row is rebuilt by every reload
 * and a keystroke typed into a row that is being replaced is a keystroke lost. The row only says
 * which number was tapped; the screen owns the field.
 *
 * ## Two animation drivers, deliberately on two nodes
 *
 * Mixing `useNativeDriver: true` and `false` on one `Animated.Value` is a hard crash in React
 * Native, not a warning (see `ui.tsx`'s SegmentButton). The tint and border are colour
 * interpolations, which the native driver cannot do; the ✓ pop is a transform, which it should.
 * So there are two values on two nested nodes: the outer view animates colour off the JS driver,
 * the inner glyph animates scale off the native one.
 */

import { useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Animated,
  Easing,
  Pressable,
  StyleSheet,
  Text,
  View,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

import { stepReps, stepWeight } from '../../workout/derived.js';
import type { MeasureRow } from '../../workout/revealRow.js';

import { hapticLight, hapticSetDone } from '../../haptics.js';
import { useTheme } from '../../ThemeProvider.js';
import { useUnit } from '../../UnitsProvider.js';
import {
  displayDistanceToMetres,
  distanceUnitKey,
  kgToDisplay,
  metresToDisplay,
  weightUnitKey,
} from '../../units.js';
import { duration, radius, type ColorPalette } from '../../theme.js';

/** The handoff's timings. The tint settles before the glyph finishes popping, which is the point. */
// On the shared scale (theme.ts) rather than picked here: a tint responding at one speed on
// this row and another on the segmented control is exactly the drift the scale exists to stop.
const TINT_MS = duration.quick;
const POP_MS = duration.slow;

export interface SetRowProps {
  index: number;
  weightKg: number | null;
  reps: number | null;
  done: boolean;
  onChangeWeight: (next: number) => void;
  onChangeReps: (next: number) => void;
  onToggle: () => void;
  /**
   * What this set was last time, shown faint in a field that is still empty.
   *
   * Not values: the row never reports them as its own. The steppers start from them, because
   * "a little more than last time" is the usual next number.
   */
  ghostWeightKg?: number | null;
  ghostReps?: number | null;
  /**
   * What the two fields hold.
   *
   * `weights` is the row this component was built for. `cardio` is a walk or a ride: minutes and
   * distance, which is what that training is, and neither weight nor reps says anything about
   * it. The row keeps its shape either way — two fields, a number in each, steppers on both
   * sides — because the thumb using it is the same thumb.
   */
  fields?: 'weights' | 'cardio';
  /** Cardio only: how long, in seconds, and how far, in metres. */
  durationSeconds?: number | null;
  distanceM?: number | null;
  onChangeDuration?: (seconds: number) => void;
  onChangeDistance?: (metres: number) => void;
  /**
   * Edit one of this row's two numbers, on the keyboard.
   *
   * `field` says which, so the screen can name it above the keys — "חזה · סט 2 · ק״ג" is
   * what makes a pad over the bottom of the screen as clear as the row it came from.
   */
  //
  // `measure` lets the screen ask where this row is. The keyboard is about to rise over the
  // bottom of the list, and the screen uses this to move the row clear of it — a number is typed
  // against the rest of its set, not from memory of it.
  onEdit?: (field: 'first' | 'second', measure?: MeasureRow) => void;
  /**
   * A ramp toward the work rather than the work itself — excluded from volume, personal records
   * and the progression charts.
   */
  isWarmup?: boolean;
  /** Rated effort, 6-10, or null. Shown where the weight field shows its unit. */
  rpe?: number | null;
  /** Taken to the point another rep was not happening. */
  toFailure?: boolean;
  /** Continues the set above it, lighter, with no rest. Shown as an arrow, not a number. */
  isDrop?: boolean;
  /**
   * Open this set's menu: change its kind, or delete it.
   *
   * One tap on the index chip, and the menu names both actions. It replaces a tap that toggled
   * the warm-up flag and a long-press that deleted — two invisible gestures on a chip 30px
   * wide, where the only way to find either was to be told. Deleting a set added by mistake is
   * not a power-user move, and it should not have been the more hidden of the two.
   *
   * On the chip because that is what the chip already names: the row's place in the exercise,
   * whether it counts, and whether it should exist at all.
   */
  onOptions?: () => void;
}

export function SetRow({
  index,
  weightKg,
  reps,
  done,
  onChangeWeight,
  onChangeReps,
  onToggle,
  ghostWeightKg = null,
  ghostReps = null,
  fields = 'weights',
  durationSeconds = null,
  distanceM = null,
  onChangeDuration,
  onChangeDistance,
  onEdit,
  isWarmup = false,
  rpe = null,
  toFailure = false,
  isDrop = false,
  onOptions,
}: SetRowProps) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const unit = useUnit();
  const s = useMemo(() => createStyles(colors), [colors]);

  const tint = useRef(new Animated.Value(done ? 1 : 0)).current;
  const pop = useRef(new Animated.Value(done ? 1 : 0)).current;

  useEffect(() => {
    Animated.timing(tint, {
      toValue: done ? 1 : 0,
      duration: TINT_MS,
      easing: Easing.ease,
      // Colour cannot be driven natively. This node animates nothing else, so the split holds.
      useNativeDriver: false,
    }).start();
  }, [done, tint]);

  useEffect(() => {
    if (!done) {
      pop.setValue(0);
      return;
    }
    // .7 -> 1.12 -> 1: the overshoot is what makes a tick feel like a tick rather than a state
    // change. Curve from the handoff.
    pop.setValue(0);
    Animated.timing(pop, {
      toValue: 1,
      duration: POP_MS,
      easing: Easing.bezier(0.22, 1, 0.36, 1),
      useNativeDriver: true,
    }).start();
  }, [done, pop]);

  const rowStyle = {
    backgroundColor: tint.interpolate({
      inputRange: [0, 1],
      outputRange: ['rgba(0,0,0,0)', colors.accentSoft],
    }),
  };
  const fieldStyle = {
    borderColor: tint.interpolate({
      inputRange: [0, 1],
      outputRange: [colors.border, colors.accentBorder],
    }),
  };
  const numeralColor = done ? colors.accentLift : colors.text;

  // What each field draws, and where its steppers start: the row's own number, or failing that
  // last time's. Never last time's on a ticked set — that one is a record.
  const weightGhost = weightKg === null && !done ? ghostWeightKg : null;
  const repsGhost = reps === null && !done ? ghostReps : null;
  const shownWeightKg = weightKg ?? weightGhost;
  const shownReps = reps ?? repsGhost;

  /*
   * The fields save when an edit ends, and an edit does not reliably end: tapping the tick right
   * after typing leaves the keyboard up, and ticking an exercise's last set in focus mode removes
   * this row before the edit can end at all. The reps typed into every last set were lost to
   * that. So the row asks each field for what is pending — before the tick, and on unmount.
   */


  const distanceDisplay = distanceM === null ? 0 : metresToDisplay(distanceM, unit);

  const rowRef = useRef<View>(null);

  /**
   * Where this row is on screen, whenever it is asked.
   *
   * Reads the ref at the time of the call, not at the time of the tap, so it keeps answering for
   * as long as the row exists and goes quiet when it does not. A height of zero is a row that is
   * no longer laid out, which is not a position worth scrolling to.
   */
  const measure: MeasureRow = (done) => {
    rowRef.current?.measureInWindow((_x, y, _width, height) => {
      if (height > 0) done({ y, height });
    });
  };

  const edit = (field: 'first' | 'second') => onEdit?.(field, measure);

  const handleToggle = () => {
    // Two taps for a set logged, one for taking it back: distinguishable in a pocket.
    void (done ? hapticLight() : hapticSetDone());
    onToggle();
  };

  return (
    <Animated.View ref={rowRef} style={[s.row, rowStyle]}>
      {/* Deleting a set is a long-press on its number, not a button. The handoff's card has no
          delete control and putting one there would crowd a row built for one thumb — but the
          capability existed before this card did, and losing it silently would be worse than
          either. Hidden, reachable, and impossible to hit while tapping the stepper beside it. */}
      <Pressable
        onPress={onOptions}
        disabled={!onOptions}
        accessibilityRole={onOptions ? 'button' : undefined}
        accessibilityLabel={onOptions ? t('workout.setOptions', { index }) : undefined}
        style={[
          s.indexChip,
          isDrop && s.indexChipDrop,
          toFailure && s.indexChipFailure,
          isWarmup && s.indexChipWarmup,
          onOptions && s.indexChipTappable,
        ]}
      >
        <Text
          style={[
            s.indexText,
            isDrop && s.indexTextDrop,
            toFailure && s.indexTextFailure,
            isWarmup && s.indexTextWarmup,
          ]}
        >
          {isWarmup ? t('workout.warmupShort') : isDrop ? '↓' : index}
        </Text>
      </Pressable>

      {fields === 'cardio' ? (
        <>
      {/* Minutes, because nobody logs a walk in seconds; stored as seconds all the same. */}
      <Animated.View style={[s.field, fieldStyle]}>
        <Stepper
          label="−"
          onPress={() => onChangeDuration?.(Math.max(0, (durationSeconds ?? 0) - 60))}
        />
        <View style={s.value}>
          <Pressable
            onPress={() => edit('first')}
            disabled={!onEdit}
            accessibilityRole="button"
            style={s.valueTap}
          >
            <Text style={[s.numeral, { color: numeralColor }]}>
              {formatEntry(durationSeconds === null ? null : Math.round(durationSeconds / 60))}
            </Text>
          </Pressable>
          <Text style={s.unit}>{t('workout.minutesShort')}</Text>
        </View>
        <Stepper label="+" onPress={() => onChangeDuration?.((durationSeconds ?? 0) + 60)} />
      </Animated.View>

      <Animated.View style={[s.field, fieldStyle]}>
        <Stepper
          label="−"
          onPress={() =>
            onChangeDistance?.(
              Math.max(0, displayDistanceToMetres(Math.max(0, distanceDisplay - 0.5), unit)),
            )
          }
        />
        <View style={s.value}>
          <Pressable
            onPress={() => edit('second')}
            disabled={!onEdit}
            accessibilityRole="button"
            style={s.valueTap}
          >
            <Text style={[s.numeral, { color: numeralColor }]}>
              {formatEntry(distanceM === null ? null : distanceDisplay)}
            </Text>
          </Pressable>
          <Text style={s.unit}>{t(`common.${distanceUnitKey(unit)}`)}</Text>
        </View>
        <Stepper
          label="+"
          onPress={() => onChangeDistance?.(displayDistanceToMetres(distanceDisplay + 0.5, unit))}
        />
      </Animated.View>

        </>
      ) : (
        <>
      <Animated.View style={[s.field, fieldStyle]}>
        <Stepper label="−" onPress={() => onChangeWeight(stepWeight(shownWeightKg, -1, unit))} />
        <View style={s.value}>
          {/* Editable as well as steppable. The steppers cover the common nudge, but a weight
              two plates away is a lot of taps — and a number you cannot type into reads as a
              display rather than a field. Uncontrolled and re-keyed on the committed value, so
              typing is never fought mid-entry. */}
          <Pressable
            onPress={() => edit('first')}
            disabled={!onEdit}
            accessibilityRole="button"
            // Read out as what it is. A bare "100" would say the set already holds it.
            accessibilityLabel={
              weightGhost !== null
                ? t('workout.ghostValue', { value: kgToDisplay(weightGhost, unit) })
                : undefined
            }
            style={s.valueTap}
          >
            <Text
              style={[
                s.numeral,
                weightGhost !== null ? s.numeralGhost : { color: numeralColor },
              ]}
            >
              {formatEntry(shownWeightKg === null ? null : kgToDisplay(shownWeightKg, unit))}
            </Text>
          </Pressable>
          <Text style={s.unit}>{t(`common.${weightUnitKey(unit)}`)}</Text>
        </View>
        <Stepper label="+" onPress={() => onChangeWeight(stepWeight(shownWeightKg, 1, unit))} />
      </Animated.View>

      <Animated.View style={[s.field, fieldStyle]}>
        <Stepper label="−" onPress={() => onChangeReps(stepReps(shownReps, -1))} />
        <View style={s.value}>
          <Pressable
            onPress={() => edit('second')}
            disabled={!onEdit}
            accessibilityRole="button"
            accessibilityLabel={
              repsGhost !== null ? t('workout.ghostValue', { value: repsGhost }) : undefined
            }
            style={s.valueTap}
          >
            <Text
              style={[s.numeral, repsGhost !== null ? s.numeralGhost : { color: numeralColor }]}
            >
              {formatEntry(shownReps)}
            </Text>
          </Pressable>
          {/* The slot the weight field spends on its unit, which the reps field never used.
              `@8` is how a rating is written on paper, and it costs the row no new space. */}
          {rpe !== null ? <Text style={s.rpe}>@{rpe}</Text> : null}
        </View>
        <Stepper label="+" onPress={() => onChangeReps(stepReps(shownReps, 1))} />
      </Animated.View>

        </>
      )}

      <Pressable
        onPress={handleToggle}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: done }}
        accessibilityLabel={t('workout.setDone', { index })}
        style={[s.check, done && s.checkDone]}
      >
        <Animated.Text
          style={[
            s.checkGlyph,
            done && s.checkGlyphDone,
            {
              transform: [
                {
                  scale: pop.interpolate({
                    inputRange: [0, 0.6, 1],
                    outputRange: [0.7, 1.12, 1],
                  }),
                },
              ],
            },
          ]}
        >
          ✓
        </Animated.Text>
      </Pressable>
    </Animated.View>
  );
}

/**
 * 34×48. Wider than it looks like it needs to be, because the handoff's floor is a 44pt target
 * and these two sit shoulder to shoulder either side of a number — the pair is what clears it.
 */
function Stepper({ label, onPress }: { label: string; onPress: () => void }) {
  const { colors } = useTheme();
  const s = useMemo(() => createStyles(colors), [colors]);
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [s.stepper, pressed && s.stepperPressed]}
    >
      <Text style={s.stepperText}>{label}</Text>
    </Pressable>
  );
}

const createStyles = (colors: ColorPalette) =>
  StyleSheet.create<{
    row: ViewStyle;
    indexChip: ViewStyle;
    indexChipTappable: ViewStyle;
    indexChipDrop: ViewStyle;
    indexChipFailure: ViewStyle;
    indexChipWarmup: ViewStyle;
    indexText: TextStyle;
    indexTextDrop: TextStyle;
    indexTextFailure: TextStyle;
    indexTextWarmup: TextStyle;
    rpe: TextStyle;
    field: ViewStyle;
    value: ViewStyle;
    numeral: TextStyle;
    numeralGhost: TextStyle;
    valueTap: ViewStyle;
    numeralInput: TextStyle;
    unit: TextStyle;
    stepper: ViewStyle;
    stepperPressed: ViewStyle;
    stepperText: TextStyle;
    check: ViewStyle;
    checkDone: ViewStyle;
    checkGlyph: TextStyle;
    checkGlyphDone: TextStyle;
  }>({
    row: {
      height: 56,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      borderRadius: radius.sm,
    },
    indexChip: {
      width: 30,
      height: 56,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: radius.sm,
      backgroundColor: colors.bg,
    },
    // A hairline, so the chip reads as something to press rather than a printed number. The
    // menu behind it is the only route to deleting a set, and an unmarked target is one nobody
    // finds.
    indexChipTappable: { borderWidth: 1, borderColor: colors.border },
    // Amber rather than the accent: a warm-up is neither the work nor a problem, and the two
    // colours the app already uses for rows both say one of those.
    indexChipWarmup: { backgroundColor: colors.warningSoft },
    indexText: { color: colors.textFaint, fontSize: 12, fontVariant: ['tabular-nums'] },
    indexTextWarmup: { color: colors.warning, fontWeight: '700' },
    // Listed before the warm-up styles above so a ramp still reads as a ramp: nobody takes a
    // warm-up to failure, and if both flags somehow land on one set, "warm-up" is the one that
    // decides whether it counts.
    // An arrow rather than a number, because a drop set is not a new set — it continues the one
    // above it, and the volume and the labels both count it that way.
    indexChipDrop: { backgroundColor: colors.accentSoft },
    indexTextDrop: { color: colors.accent, fontWeight: '700' },
    indexChipFailure: { backgroundColor: colors.dangerSoft },
    indexTextFailure: { color: colors.danger, fontWeight: '700' },
    rpe: { color: colors.textFaint, fontSize: 10, fontVariant: ['tabular-nums'] },

    field: {
      flex: 1,
      height: 56,
      flexDirection: 'row',
      alignItems: 'center',
      borderRadius: radius.sm,
      borderWidth: 1,
      backgroundColor: colors.bg,
      overflow: 'hidden',
    },
    value: { flex: 1, flexDirection: 'row', alignItems: 'baseline', justifyContent: 'center', gap: 2 },
    // Tabular so the row does not shift as the number ticks between 8 and 10.
    numeral: { fontSize: 26, fontWeight: '600', fontVariant: ['tabular-nums'] },
    // Last time's number in an empty field. The same size and place as an entered one, so the
    // row does not move when it is replaced — told apart by weight and colour alone, and by
    // enough of both that it cannot be mistaken for something that was typed.
    numeralGhost: { color: colors.textFaint, fontWeight: '400', opacity: 0.6 },
    // The number is the target: a tap anywhere on it opens the keyboard, a far bigger thing
    // to hit mid-set than the glyphs themselves.
    valueTap: { flex: 1, height: 56, alignItems: 'center', justifyContent: 'center' },
    // A TextInput carries platform padding and a minimum height a Text does not. Zeroed so
    // swapping one for the other does not change the 48px row the handoff specifies.
    numeralInput: {
      padding: 0,
      margin: 0,
      minHeight: 0,
      textAlign: 'center',
    },
    unit: { color: colors.textFaint, fontSize: 10 },

    stepper: { width: 34, height: 56, alignItems: 'center', justifyContent: 'center' },
    stepperPressed: { backgroundColor: colors.surfaceRaised },
    stepperText: { color: colors.textSecondary, fontSize: 18 },

    check: {
      width: 52,
      height: 56,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: radius.sm,
      borderWidth: 1,
      borderColor: colors.borderStrong,
    },
    // The one place a fill is allowed: it is the success state the accent is reserved for.
    checkDone: { borderColor: colors.accent, backgroundColor: colors.accentSoft },
    checkGlyph: { color: colors.textFaint, fontSize: 17 },
    checkGlyphDone: { color: colors.accent },
  });

/** An em dash for a number nobody has entered: the field is empty, not zero. */
function formatEntry(value: number | null): string {
  return value === null ? '—' : String(value);
}
