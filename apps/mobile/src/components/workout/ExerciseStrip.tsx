/**
 * The workout at a glance: a row of small pictures, one per exercise, above the card.
 *
 * It answers the two questions the ‹ › arrows could only half answer — where am I in this
 * workout, and what is left — and it is the way to get anywhere in one tap rather than one
 * exercise at a time. The one in front of you wears the accent ring; the finished ones carry a
 * tick and step back.
 *
 * Left to right in every language, like the swipe it sits above: the next exercise is to the
 * right, the same way the card slides.
 */

import type { ExerciseSeed } from '@fit/shared/catalog';
import { useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

import { useTheme } from '../../ThemeProvider.js';
import { radius, type ColorPalette } from '../../theme.js';
import { ExerciseVisual } from '../ExerciseVisual.js';

export interface StripStation {
  key: string;
  seed: ExerciseSeed | undefined;
  label: string;
  done: boolean;
}

const SIZE = 60;
const GAP = 10;

export function ExerciseStrip({
  stations,
  active,
  onSelect,
}: {
  stations: readonly StripStation[];
  active: number;
  onSelect: (index: number) => void;
}) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const s = useMemo(() => createStyles(colors), [colors]);
  const { width } = useWindowDimensions();
  const scroll = useRef<ScrollView | null>(null);

  // Keep the current exercise in view, centred where the row allows it.
  useEffect(() => {
    const x = active * (SIZE + GAP) - (width - SIZE) / 2;
    scroll.current?.scrollTo({ x: Math.max(0, x), animated: true });
  }, [active, width]);

  return (
    <View style={s.wrap}>
      <ScrollView
        ref={scroll}
        horizontal
        showsHorizontalScrollIndicator={false}
        // Pinned left to right, like the swipe below it — see the note above.
        style={s.ltr}
        contentContainerStyle={s.row}
      >
        {stations.map((station, index) => {
          const current = index === active;
          return (
            <Pressable
              key={station.key}
              onPress={() => onSelect(index)}
              accessibilityRole="button"
              accessibilityState={{ selected: current }}
              accessibilityLabel={`${index + 1}. ${station.label}`}
              style={({ pressed }) => [
                s.thumb,
                current && s.thumbCurrent,
                station.done && !current && s.thumbDone,
                pressed && s.pressed,
              ]}
            >
              <View style={s.clip}>
                {station.seed ? (
                  <ExerciseVisual exercise={station.seed} height={SIZE - 4} />
                ) : (
                  <Text style={s.fallback}>{index + 1}</Text>
                )}
              </View>
              {station.done ? (
                <View style={s.tick}>
                  <Text style={s.tickGlyph}>✓</Text>
                </View>
              ) : null}
            </Pressable>
          );
        })}
      </ScrollView>
      <Text style={s.count}>
        {t('workout.stationOf', { current: active + 1, total: stations.length })}
        {stations[active] ? ` · ${stations[active].label}` : ''}
      </Text>
    </View>
  );
}

const createStyles = (colors: ColorPalette) =>
  StyleSheet.create<{
    wrap: ViewStyle;
    ltr: ViewStyle;
    row: ViewStyle;
    thumb: ViewStyle;
    thumbCurrent: ViewStyle;
    thumbDone: ViewStyle;
    clip: ViewStyle;
    fallback: TextStyle;
    tick: ViewStyle;
    tickGlyph: TextStyle;
    count: TextStyle;
    pressed: ViewStyle;
  }>({
    wrap: { gap: 6 },
    ltr: { direction: 'ltr' },
    row: { gap: GAP, paddingVertical: 4, paddingHorizontal: 2 },
    thumb: {
      width: SIZE,
      height: SIZE,
      borderRadius: radius.md,
      borderWidth: 2,
      borderColor: colors.borderSubtle,
      backgroundColor: colors.surfaceRaised,
    },
    thumbCurrent: { borderColor: colors.accent },
    // Done and behind you: still there to tap back to, but no longer asking for attention.
    thumbDone: { opacity: 0.55 },
    clip: { flex: 1, borderRadius: radius.md - 2, overflow: 'hidden', justifyContent: 'center' },
    fallback: { color: colors.textMuted, fontSize: 16, textAlign: 'center' },
    tick: {
      position: 'absolute',
      top: -6,
      right: -6,
      width: 20,
      height: 20,
      borderRadius: 10,
      backgroundColor: colors.accent,
      alignItems: 'center',
      justifyContent: 'center',
    },
    tickGlyph: { color: colors.bg, fontSize: 11, fontWeight: '700' },
    count: { color: colors.textMuted, fontSize: 12, textAlign: 'center' },
    pressed: { opacity: 0.7 },
  });
