/**
 * Drag-to-reorder for a vertical list of variable-height cards.
 *
 * Built on `PanResponder`, not `react-native-gesture-handler`: gesture-handler is a native
 * module, and adding one would sit inert until the next native rebuild rather than loading on
 * the build already on the phone. Same reasoning as `SwipeableRow`.
 *
 * ## Why a handle, and not the whole card
 *
 * The plan screens reorder with arrows, and the comment there gives the reason: a drag inside a
 * vertical ScrollView has to win a gesture race against the scroll, and the loser is always the
 * user. That is still true — so the race is not entered. Only the handle claims the responder,
 * which is a small target nobody scrolls from, while the rest of the card behaves exactly as it
 * did. That matters more here than anywhere else in the app, because an exercise card is full
 * of text inputs that also want the touch.
 *
 * The whole card travels, sets and all. The handle is where you grab it, not what moves.
 *
 * ## Driver mode
 *
 * Every animated value here drives `transform` only, so all of them stay native-driven for
 * their whole lives — `setValue` during the drag, `spring` on release, exactly as SwipeableRow
 * does. Mixing driver modes on one node is a hard crash, not a warning; see `SegmentButton`.
 */

import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  Animated,
  PanResponder,
  StyleSheet,
  View,
  type GestureResponderHandlers,
  type LayoutChangeEvent,
} from 'react-native';

import { resolveDropIndex, restingOffset, shiftForIndex } from './dragMath.js';

export interface DragHandleProps {
  /** Spread onto the View that should be grabbable. */
  handlers: GestureResponderHandlers;
  /** True while this row is the one being dragged. */
  active: boolean;
  /** The route for anyone who cannot drag — a screen reader, or a shaky hand. */
  moveUp: () => void;
  moveDown: () => void;
  canMoveUp: boolean;
  canMoveDown: boolean;
}

export interface DragReorderListProps<T> {
  data: readonly T[];
  keyExtractor: (item: T, index: number) => string;
  renderItem: (item: T, index: number, handle: DragHandleProps) => ReactNode;
  /** Both indices are positions in `data`. Called once, on drop. */
  onReorder: (fromIndex: number, toIndex: number) => void;
  /** Lets the parent freeze its ScrollView while a card is in the air. */
  onDragStateChange?: (dragging: boolean) => void;
  /** The finger's Y in screen coordinates, so the parent can scroll toward the edges. */
  onDragMove?: (screenY: number) => void;
}

export function DragReorderList<T>({
  data,
  keyExtractor,
  renderItem,
  onReorder,
  onDragStateChange,
  onDragMove,
}: DragReorderListProps<T>) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);

  // Refs shadow the state because the PanResponder handlers are created once and would
  // otherwise read whatever these values were at creation time, for the life of the component.
  const activeIndexRef = useRef<number | null>(null);
  const targetIndexRef = useRef<number | null>(null);
  const heights = useRef<number[]>([]);

  const dragY = useRef(new Animated.Value(0)).current;
  const shifts = useRef<Animated.Value[]>([]);
  const shiftAt = useCallback((index: number) => {
    const existing = shifts.current[index];
    if (existing) return existing;
    const created = new Animated.Value(0);
    shifts.current[index] = created;
    return created;
  }, []);

  const applyShifts = useCallback(
    (from: number, to: number) => {
      const activeHeight = heights.current[from] ?? 0;
      for (let i = 0; i < data.length; i++) {
        // A spring rather than a jump: the gap opening up is the only thing telling the user
        // where the card will land if they let go now.
        Animated.spring(shiftAt(i), {
          toValue: shiftForIndex(i, from, to, activeHeight),
          useNativeDriver: true,
          bounciness: 0,
          speed: 20,
        }).start();
      }
    },
    [data.length, shiftAt],
  );

  const startDrag = useCallback(
    (index: number) => {
      activeIndexRef.current = index;
      targetIndexRef.current = index;
      dragY.setValue(0);
      setActiveIndex(index);
      onDragStateChange?.(true);
    },
    [dragY, onDragStateChange],
  );

  const moveDrag = useCallback(
    (dy: number, screenY: number) => {
      const from = activeIndexRef.current;
      if (from === null) return;

      dragY.setValue(dy);
      onDragMove?.(screenY);

      const target = resolveDropIndex(heights.current, from, dy);
      if (target !== targetIndexRef.current) {
        targetIndexRef.current = target;
        applyShifts(from, target);
      }
    },
    [dragY, applyShifts, onDragMove],
  );

  const endDrag = useCallback(() => {
    const from = activeIndexRef.current;
    const to = targetIndexRef.current;
    activeIndexRef.current = null;
    targetIndexRef.current = null;
    onDragStateChange?.(false);

    if (from === null || to === null) {
      setActiveIndex(null);
      return;
    }

    Animated.spring(dragY, {
      // Settles into the gap rather than staying under the finger, which can be anywhere inside
      // the target slot when it lifts.
      toValue: restingOffset(heights.current, from, to),
      useNativeDriver: true,
      bounciness: 0,
      speed: 20,
    }).start(() => {
      // Reset and reorder together, so the card is never drawn at its old offset against the
      // new data — that reads as the row snapping back and then jumping.
      dragY.setValue(0);
      for (const shift of shifts.current) shift?.setValue(0);
      setActiveIndex(null);
      if (to !== from) onReorder(from, to);
    });
  }, [dragY, onReorder, onDragStateChange]);

  const nudge = useCallback(
    (index: number, delta: -1 | 1) => {
      const to = index + delta;
      if (to < 0 || to >= data.length) return;
      onReorder(index, to);
    },
    [data.length, onReorder],
  );

  return (
    <View>
      {data.map((item, index) => (
        <DragRow
          key={keyExtractor(item, index)}
          index={index}
          isActive={activeIndex === index}
          dragY={dragY}
          shift={shiftAt(index)}
          onMeasure={(height) => {
            heights.current[index] = height;
          }}
          onStart={startDrag}
          onMove={moveDrag}
          onEnd={endDrag}
        >
          {(handlers, active) =>
            renderItem(item, index, {
              handlers,
              active,
              moveUp: () => nudge(index, -1),
              moveDown: () => nudge(index, 1),
              canMoveUp: index > 0,
              canMoveDown: index < data.length - 1,
            })
          }
        </DragRow>
      ))}
    </View>
  );
}

/* -------------------------------------------------------------------------- */

function DragRow({
  index,
  isActive,
  dragY,
  shift,
  onMeasure,
  onStart,
  onMove,
  onEnd,
  children,
}: {
  index: number;
  isActive: boolean;
  dragY: Animated.Value;
  shift: Animated.Value;
  onMeasure: (height: number) => void;
  onStart: (index: number) => void;
  onMove: (dy: number, screenY: number) => void;
  onEnd: () => void;
  children: (handlers: GestureResponderHandlers, active: boolean) => ReactNode;
}) {
  // A row's position changes as the list is reordered, while the PanResponder below is created
  // exactly once. Reading the index through a ref is what keeps the two in step.
  const indexRef = useRef(index);
  indexRef.current = index;

  const responder = useMemo(
    () =>
      PanResponder.create({
        // Claimed from the first touch. These handlers reach only the handle, so nothing is
        // taken from the ScrollView that anyone would have wanted to scroll with.
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: () => onStart(indexRef.current),
        onPanResponderMove: (_event, gesture) => onMove(gesture.dy, gesture.moveY),
        onPanResponderRelease: onEnd,
        onPanResponderTerminate: onEnd,
        // A drag must not be stolen mid-flight by an ancestor, or the card is left in the air
        // with no gesture left to put it down with.
        onPanResponderTerminationRequest: () => false,
      }),
    [onStart, onMove, onEnd],
  );

  return (
    <Animated.View
      onLayout={(event: LayoutChangeEvent) => onMeasure(event.nativeEvent.layout.height)}
      style={[
        isActive && styles.lifted,
        { transform: [{ translateY: isActive ? dragY : shift }] },
      ]}
    >
      {children(responder.panHandlers, isActive)}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  // Raised so the travelling card passes over its neighbours rather than under them. Both
  // properties are needed: Android honours elevation, iOS honours zIndex.
  lifted: { zIndex: 10, elevation: 10 },
});
