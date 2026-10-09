/**
 * A number chosen by dragging a ruler under a fixed pointer.
 *
 * Three of the setup questions are a number with a sensible range — weight, height, age — and a
 * keyboard is a poor way to ask for any of them: it covers half the screen, it accepts 7 kg and
 * 700, and typing is the one thing on a phone that feels like filling in a form. A ruler cannot
 * be set to a value that is not on it, shows where the answer sits among the others, and takes
 * one movement of a thumb.
 *
 * ## Left to right, whatever the language
 *
 * The ruler is laid out left to right even in Hebrew, for the reason the charts are: a number
 * line running the other way is not a translation, it is a different object. The wrapper pins
 * `direction: 'ltr'`, which also keeps the arithmetic honest — scroll offset zero is the lowest
 * value, in every locale, with nothing to flip.
 *
 * ## What is and is not animated
 *
 * Nothing here is driven by `Animated`. The scroll view moves natively, and the number above it
 * is plain state set from `onScroll`; it changes a few dozen times a second at most, and only
 * when the tick under the pointer actually changes.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Minus, Plus } from 'phosphor-react-native';

import { hapticTick } from '../haptics.js';
import { isRtlLanguage, type Language } from '../i18n/index.js';
import { useTheme } from '../ThemeProvider.js';
import { fontSize, fontWeight, radius, spacing, type ColorPalette } from '../theme.js';
import {
  indexAtOffset,
  indexOfValue,
  tickCount,
  tickKind,
  valueAtIndex,
  type RulerRange,
} from './profileSetup.js';

/** The width one tick takes. Wide enough to land on with a thumb, narrow enough to travel. */
const TICK = 12;
const RULER_HEIGHT = 84;
const LABEL_WIDTH = 48;

export function RulerPicker({
  range,
  value,
  onChange,
  unitLabel,
  accessibilityLabel,
}: {
  range: RulerRange;
  value: number;
  onChange: (next: number) => void;
  unitLabel: string;
  accessibilityLabel: string;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { i18n } = useTranslation();
  // The ruler runs left to right in every language; "70 kg" does not. In Hebrew the unit is
  // read after the number, which puts it on the number's left.
  const unitFirst = isRtlLanguage(i18n.language as Language);

  const scroll = useRef<ScrollView>(null);
  const [width, setWidth] = useState(0);
  // The tick the pointer is on, as last reported upward. A ref, because `onScroll` fires far
  // more often than the tick changes and must not re-render to find that out.
  const shown = useRef(indexOfValue(range, value));
  // Whether the ruler has been put on its starting value yet. Until it has, the scroll view
  // sits at offset zero and reporting that would overwrite the value it is about to show.
  const placed = useRef(false);

  const count = tickCount(range);
  const ticks = useMemo(() => Array.from({ length: count }, (_, index) => index), [count]);

  const place = useCallback(
    (index: number, animated: boolean) => {
      scroll.current?.scrollTo({ x: index * TICK, animated });
    },
    [],
  );

  /*
   * Put the ruler on its starting value — once the content has its final width, and not before.
   *
   * The gutters either side depend on the ruler's own measured width, so the content is laid out
   * twice: once with none, once with them. A `scrollTo` issued in between is clamped to a
   * content that is not yet long enough and lands short. `onContentSizeChange` fires after each
   * of those layouts, and the first one with a width behind it is the one to act on.
   */
  const onContentSizeChange = () => {
    if (width === 0) return;
    place(shown.current, false);
    placed.current = true;
  };

  // And again if the value is changed from outside — a saved weigh-in arriving late, say.
  useEffect(() => {
    const index = indexOfValue(range, value);
    if (index === shown.current) return;
    shown.current = index;
    if (placed.current) place(index, true);
  }, [range, value, place]);

  const onLayout = (event: LayoutChangeEvent) => setWidth(event.nativeEvent.layout.width);

  const onScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (!placed.current) return;
    const index = indexAtOffset(range, event.nativeEvent.contentOffset.x, TICK);
    if (index === shown.current) return;
    shown.current = index;
    hapticTick();
    onChange(valueAtIndex(range, index));
  };

  const nudge = (by: number) => {
    const index = Math.max(0, Math.min(count - 1, shown.current + by));
    if (index === shown.current) return;
    // The scroll that follows reports the new value itself; setting it here as well would
    // announce it twice.
    place(index, true);
  };

  // Half the ruler's width of empty space at each end, so the first and last ticks can reach
  // the pointer in the middle.
  const gutter = Math.max(0, width / 2 - TICK / 2);

  return (
    <View style={styles.block}>
      <View style={styles.readout}>
        <Pressable
          onPress={() => nudge(-1)}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel="−"
          style={({ pressed }) => [styles.nudge, pressed && styles.nudgePressed]}
        >
          <Minus size={18} color={colors.accent} weight="bold" />
        </Pressable>

        <View
          style={[styles.valueRow, unitFirst && styles.valueRowReversed]}
          accessible
          accessibilityRole="adjustable"
          accessibilityLabel={accessibilityLabel}
          accessibilityValue={{ text: `${value.toFixed(range.decimals)} ${unitLabel}` }}
          accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
          onAccessibilityAction={(event) => nudge(event.nativeEvent.actionName === 'increment' ? 1 : -1)}
        >
          <Text style={styles.value}>{value.toFixed(range.decimals)}</Text>
          <Text style={styles.unit}>{unitLabel}</Text>
        </View>

        <Pressable
          onPress={() => nudge(1)}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel="+"
          style={({ pressed }) => [styles.nudge, pressed && styles.nudgePressed]}
        >
          <Plus size={18} color={colors.accent} weight="bold" />
        </Pressable>
      </View>

      <View style={styles.ruler} onLayout={onLayout}>
        <ScrollView
          ref={scroll}
          horizontal
          showsHorizontalScrollIndicator={false}
          snapToInterval={TICK}
          decelerationRate="fast"
          scrollEventThrottle={16}
          onScroll={onScroll}
          onContentSizeChange={onContentSizeChange}
          // Not announced as a list of a few hundred unlabelled views: the readout above is the
          // adjustable control a screen reader is given.
          importantForAccessibility="no-hide-descendants"
          contentContainerStyle={{ paddingHorizontal: gutter }}
        >
          {ticks.map((index) => {
            const kind = tickKind(range, index);
            const major = kind === 'major';
            return (
              <View key={index} style={styles.tick}>
                <View
                  style={[
                    styles.line,
                    major
                      ? styles.lineMajor
                      : kind === 'medium'
                        ? styles.lineMedium
                        : styles.lineMinor,
                  ]}
                />
                {major ? (
                  <Text style={styles.label} numberOfLines={1}>
                    {valueAtIndex(range, index).toFixed(0)}
                  </Text>
                ) : null}
              </View>
            );
          })}
        </ScrollView>

        {/* The ends fade into the card, so the ruler reads as passing behind it rather than
            being cut off by it. */}
        <LinearGradient
          colors={[colors.surface, `${colors.surface}00`]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={[styles.fade, styles.fadeLeft]}
          pointerEvents="none"
        />
        <LinearGradient
          colors={[`${colors.surface}00`, colors.surface]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={[styles.fade, styles.fadeRight]}
          pointerEvents="none"
        />

        <View style={styles.pointer} pointerEvents="none">
          <View style={styles.pointerHead} />
          <View style={styles.pointerLine} />
        </View>
      </View>
    </View>
  );
}

const createStyles = (colors: ColorPalette) =>
  StyleSheet.create<{
    block: ViewStyle;
    readout: ViewStyle;
    valueRow: ViewStyle;
    valueRowReversed: ViewStyle;
    value: TextStyle;
    unit: TextStyle;
    nudge: ViewStyle;
    nudgePressed: ViewStyle;
    ruler: ViewStyle;
    tick: ViewStyle;
    line: ViewStyle;
    lineMinor: ViewStyle;
    lineMedium: ViewStyle;
    lineMajor: ViewStyle;
    label: TextStyle;
    fade: ViewStyle;
    fadeLeft: ViewStyle;
    fadeRight: ViewStyle;
    pointer: ViewStyle;
    pointerHead: ViewStyle;
    pointerLine: ViewStyle;
  }>({
    // Left to right in every language — see the note at the top of the file.
    block: { direction: 'ltr', gap: spacing.lg },

    readout: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: spacing.sm,
    },
    valueRow: { flexDirection: 'row', alignItems: 'baseline', gap: spacing.sm },
    valueRowReversed: { flexDirection: 'row-reverse' },
    value: {
      color: colors.text,
      fontSize: 56,
      fontWeight: fontWeight.bold,
      fontVariant: ['tabular-nums'],
      // Every digit the same width, so the number does not shuffle sideways as it changes.
      minWidth: 132,
      textAlign: 'center',
    },
    unit: { color: colors.textMuted, fontSize: fontSize.md, fontWeight: fontWeight.medium },
    nudge: {
      width: 44,
      height: 44,
      borderRadius: radius.pill,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.accentSoft,
    },
    nudgePressed: { backgroundColor: colors.surfaceHigh },

    ruler: { height: RULER_HEIGHT, justifyContent: 'flex-start' },
    tick: { width: TICK, height: RULER_HEIGHT, alignItems: 'center' },
    line: { width: 2, borderRadius: 1 },
    lineMinor: { height: 16, backgroundColor: colors.borderStrong },
    lineMedium: { height: 26, backgroundColor: colors.textFaint },
    lineMajor: { height: 38, backgroundColor: colors.textMuted },
    // Wider than its tick on purpose: the number belongs to the line above it and is centred
    // on that, overhanging the neighbours either side.
    label: {
      position: 'absolute',
      top: 46,
      start: (TICK - LABEL_WIDTH) / 2,
      width: LABEL_WIDTH,
      textAlign: 'center',
      color: colors.textFaint,
      fontSize: fontSize.xs,
      fontVariant: ['tabular-nums'],
    },

    fade: { position: 'absolute', top: 0, bottom: 0, width: 56 },
    // `start` is the left here and `end` the right: the block above pins the direction.
    fadeLeft: { start: 0 },
    fadeRight: { end: 0 },

    pointer: { position: 'absolute', top: 0, start: 0, end: 0, alignItems: 'center' },
    pointerHead: {
      width: 10,
      height: 10,
      borderRadius: radius.pill,
      backgroundColor: colors.accent,
      marginTop: -5,
    },
    pointerLine: {
      width: 3,
      height: 46,
      borderRadius: 2,
      backgroundColor: colors.accent,
      marginTop: -2,
    },
  });
