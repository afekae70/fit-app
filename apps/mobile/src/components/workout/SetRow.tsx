/**
 * One set: `[ # ] [ − weight + ] [ − reps + ] [ ✓ ]`, 48px tall.
 *
 * The core control of the whole app, and the handoff is emphatic about why it looks like this:
 * it is operated by one thumb, mid-set, possibly sweaty. **No keyboard is ever required.** Values
 * pre-fill from the previous session and the steppers move them in the units plates actually come
 * in, so a normal set is one tap or none.
 *
 * Ticking a set produces feedback in three places at once — this row, the header progress bar and
 * the rest timer opening. Only the first is this component's business; the other two follow from
 * `onToggle` and belong to the screen.
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
import { hapticLight, hapticSuccess } from '../../haptics.js';
import { useTheme } from '../../ThemeProvider.js';
import { useUnit } from '../../UnitsProvider.js';
import { kgToDisplay, weightUnitKey } from '../../units.js';
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
  /** Long-press the index chip. Absent on a card that cannot lose sets. */
  onRemove?: () => void;
}

export function SetRow({
  index,
  weightKg,
  reps,
  done,
  onChangeWeight,
  onChangeReps,
  onToggle,
  onRemove,
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

  const handleToggle = () => {
    void (done ? hapticLight() : hapticSuccess());
    onToggle();
  };

  return (
    <Animated.View style={[s.row, rowStyle]}>
      {/* Deleting a set is a long-press on its number, not a button. The handoff's card has no
          delete control and putting one there would crowd a row built for one thumb — but the
          capability existed before this card did, and losing it silently would be worse than
          either. Hidden, reachable, and impossible to hit while tapping the stepper beside it. */}
      <Pressable
        onLongPress={onRemove}
        disabled={!onRemove}
        accessibilityRole={onRemove ? 'button' : undefined}
        accessibilityLabel={onRemove ? t('workout.removeSet') : undefined}
        style={s.indexChip}
      >
        <Text style={s.indexText}>{index}</Text>
      </Pressable>

      <Animated.View style={[s.field, fieldStyle]}>
        <Stepper label="−" onPress={() => onChangeWeight(stepWeight(weightKg, -1, unit))} />
        <View style={s.value}>
          <Text style={[s.numeral, { color: numeralColor }]} numberOfLines={1}>
            {weightKg === null ? '—' : kgToDisplay(weightKg, unit)}
          </Text>
          <Text style={s.unit}>{t(`common.${weightUnitKey(unit)}`)}</Text>
        </View>
        <Stepper label="+" onPress={() => onChangeWeight(stepWeight(weightKg, 1, unit))} />
      </Animated.View>

      <Animated.View style={[s.field, fieldStyle]}>
        <Stepper label="−" onPress={() => onChangeReps(stepReps(reps, -1))} />
        <View style={s.value}>
          <Text style={[s.numeral, { color: numeralColor }]} numberOfLines={1}>
            {reps ?? '—'}
          </Text>
        </View>
        <Stepper label="+" onPress={() => onChangeReps(stepReps(reps, 1))} />
      </Animated.View>

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
    indexText: TextStyle;
    field: ViewStyle;
    value: ViewStyle;
    numeral: TextStyle;
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
      height: 48,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      borderRadius: radius.sm,
    },
    indexChip: {
      width: 30,
      height: 48,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: radius.sm,
      backgroundColor: colors.bg,
    },
    indexText: { color: colors.textFaint, fontSize: 12, fontVariant: ['tabular-nums'] },

    field: {
      flex: 1,
      height: 48,
      flexDirection: 'row',
      alignItems: 'center',
      borderRadius: radius.sm,
      borderWidth: 1,
      backgroundColor: colors.bg,
      overflow: 'hidden',
    },
    value: { flex: 1, flexDirection: 'row', alignItems: 'baseline', justifyContent: 'center', gap: 2 },
    // Tabular so the row does not shift as the number ticks between 8 and 10.
    numeral: { fontSize: 21, fontWeight: '500', fontVariant: ['tabular-nums'] },
    unit: { color: colors.textFaint, fontSize: 10 },

    stepper: { width: 34, height: 48, alignItems: 'center', justifyContent: 'center' },
    stepperPressed: { backgroundColor: colors.surfaceRaised },
    stepperText: { color: colors.textSecondary, fontSize: 18 },

    check: {
      width: 52,
      height: 48,
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
