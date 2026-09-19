/**
 * The workout at a glance: a row of small pictures, one per exercise, above the card.
 *
 * It answers the two questions the ‹ › arrows could only half answer — where am I in this
 * workout, and what is left — and it is the way to get anywhere in one tap rather than one
 * exercise at a time. The one in front of you wears the accent ring; the finished ones carry a
 * tick and step back.
 *
 * It is also where the order is changed mid-workout: hold a picture until it lifts, then drag it
 * sideways to where it should go. Sideways because that is the direction the workout runs here,
 * the same as the card's own swipe — and the only direction, since the page itself no longer
 * swipes during a workout.
 *
 * Left to right in every language, like the swipe it sits above: the next exercise is to the
 * right, the same way the card slides.
 */

import type { ExerciseSeed } from '@fit/shared/catalog';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Animated,
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

import { hapticLight, hapticSuccess } from '../../haptics.js';
import { useTheme } from '../../ThemeProvider.js';
import { radius, type ColorPalette } from '../../theme.js';
import { stripDropTarget } from '../../workout/stripReorder.js';
import { ExerciseVisual } from '../ExerciseVisual.js';

export interface StripStation {
  key: string;
  seed: ExerciseSeed | undefined;
  label: string;
  done: boolean;
  /** Whether this one can be picked up and moved. A superset stays where it is. */
  movable?: boolean;
}

const SIZE = 60;
const GAP = 10;
const SLOT = SIZE + GAP;
/** How close to either end of the strip the finger has to be before it starts to scroll. */
const EDGE = 44;
const SCROLL_STEP = 12;

export function ExerciseStrip({
  stations,
  active,
  onSelect,
  onReorder,
}: {
  stations: readonly StripStation[];
  active: number;
  onSelect: (index: number) => void;
  /** Move the station at `from` to `to`. Omitted, and nothing can be picked up. */
  onReorder?: (from: number, to: number) => void;
}) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const s = useMemo(() => createStyles(colors), [colors]);
  const { width } = useWindowDimensions();
  const scroll = useRef<ScrollView | null>(null);

  const [drag, setDrag] = useState<{ from: number; target: number } | null>(null);
  const dragX = useRef(new Animated.Value(0)).current;

  // Everything the gesture reads, through refs: it is built once, on mount.
  const live = useRef({
    drag: null as { from: number; target: number } | null,
    count: 0,
    scrollX: 0,
    contentWidth: 0,
    scrollAtStart: 0,
    frame: { left: 0, width: 0 },
    onReorder,
  });
  live.current.count = stations.length;
  live.current.onReorder = onReorder;
  const frameRef = useRef<View | null>(null);

  // Keep the current exercise in view, centred where the row allows it.
  useEffect(() => {
    if (drag) return;
    const x = active * SLOT - (width - SIZE) / 2;
    scroll.current?.scrollTo({ x: Math.max(0, x), animated: true });
  }, [active, width, drag]);

  const beginDrag = (index: number) => {
    if (!onReorder || stations[index]?.movable === false) return;
    void hapticSuccess();
    dragX.setValue(0);
    live.current.scrollAtStart = live.current.scrollX;
    live.current.drag = { from: index, target: index };
    setDrag({ from: index, target: index });
    frameRef.current?.measureInWindow((left, _top, frameWidth) => {
      live.current.frame = { left, width: frameWidth };
    });
  };

  const endDrag = (commit: boolean) => {
    const current = live.current.drag;
    live.current.drag = null;
    setDrag(null);
    dragX.setValue(0);
    if (commit && current && current.target !== current.from) {
      live.current.onReorder?.(current.from, current.target);
    }
  };

  const gesture = useRef(
    PanResponder.create({
      // Only once a picture has been picked up; before that a touch belongs to the strip's own
      // scrolling and to the tap that jumps to an exercise.
      onStartShouldSetPanResponderCapture: () => live.current.drag !== null,
      onMoveShouldSetPanResponderCapture: () => live.current.drag !== null,
      onPanResponderTerminationRequest: () => false,
      onPanResponderMove: (_event, move) => {
        const state = live.current;
        if (!state.drag) return;

        // Near either end, carry the strip along so an exercise off screen can be reached.
        const { left, width: frameWidth } = state.frame;
        if (frameWidth > 0) {
          let step = 0;
          if (move.moveX < left + EDGE) step = -SCROLL_STEP;
          else if (move.moveX > left + frameWidth - EDGE) step = SCROLL_STEP;
          if (step !== 0) {
            const maxScroll = Math.max(0, state.contentWidth - frameWidth);
            const next = Math.max(0, Math.min(maxScroll, state.scrollX + step));
            if (next !== state.scrollX) {
              state.scrollX = next;
              scroll.current?.scrollTo({ x: next, animated: false });
            }
          }
        }

        const travelled = move.dx + (state.scrollX - state.scrollAtStart);
        dragX.setValue(travelled);
        const target = stripDropTarget(state.drag.from, travelled, SLOT, state.count);
        if (target !== state.drag.target) {
          void hapticLight();
          state.drag = { ...state.drag, target };
          setDrag(state.drag);
        }
      },
      onPanResponderRelease: () => endDrag(true),
      onPanResponderTerminate: () => endDrag(false),
    }),
  ).current;

  /** How far a picture steps aside to make room for the one being carried past it. */
  const shiftFor = (index: number): number => {
    if (!drag || index === drag.from) return 0;
    if (drag.from < drag.target && index > drag.from && index <= drag.target) return -SLOT;
    if (drag.target < drag.from && index >= drag.target && index < drag.from) return SLOT;
    return 0;
  };

  return (
    <View style={s.wrap}>
      <View ref={frameRef} {...gesture.panHandlers}>
        <ScrollView
          ref={scroll}
          horizontal
          scrollEnabled={drag === null}
          showsHorizontalScrollIndicator={false}
          scrollEventThrottle={16}
          onScroll={(event) => {
            live.current.scrollX = event.nativeEvent.contentOffset.x;
          }}
          onContentSizeChange={(contentWidth) => {
            live.current.contentWidth = contentWidth;
          }}
          onLayout={(event) => {
            live.current.frame.width = event.nativeEvent.layout.width;
          }}
          // Pinned left to right, like the swipe below it — see the note above.
          style={s.ltr}
          contentContainerStyle={s.row}
        >
          {stations.map((station, index) => {
            const current = index === active;
            const carried = drag?.from === index;
            return (
              <Animated.View
                key={station.key}
                style={[
                  carried
                    ? { transform: [{ translateX: dragX }, { scale: 1.1 }], zIndex: 10, elevation: 6 }
                    : { transform: [{ translateX: shiftFor(index) }] },
                ]}
              >
                <Pressable
                  onPress={() => onSelect(index)}
                  onLongPress={() => beginDrag(index)}
                  delayLongPress={300}
                  accessibilityRole="button"
                  accessibilityState={{ selected: current }}
                  accessibilityLabel={`${index + 1}. ${station.label}`}
                  accessibilityHint={onReorder ? t('workout.stripReorderHint') : undefined}
                  style={({ pressed }) => [
                    s.thumb,
                    current && s.thumbCurrent,
                    station.done && !current && !carried && s.thumbDone,
                    carried && s.thumbCarried,
                    pressed && !drag && s.pressed,
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
              </Animated.View>
            );
          })}
        </ScrollView>
      </View>
      <Text style={s.count} numberOfLines={1}>
        {drag
          ? t('workout.stripDropHint')
          : `${t('workout.stationOf', { current: active + 1, total: stations.length })}${
              stations[active] ? ` · ${stations[active].label}` : ''
            }`}
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
    thumbCarried: ViewStyle;
    clip: ViewStyle;
    fallback: TextStyle;
    tick: ViewStyle;
    tickGlyph: TextStyle;
    count: TextStyle;
    pressed: ViewStyle;
  }>({
    wrap: { gap: 6 },
    ltr: { direction: 'ltr' },
    row: { gap: GAP, paddingVertical: 6, paddingHorizontal: 4 },
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
    thumbCarried: { borderColor: colors.accent, backgroundColor: colors.surface },
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
