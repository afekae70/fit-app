/**
 * Swiping sideways to move between the tabs.
 *
 * A bottom tab bar has no swipe of its own, and the alternatives both cost more than they are
 * worth here: a pager would mean another native module and a rebuilt navigator, and a gesture
 * library would mean the one thing this app has avoided all along. This is a `PanResponder`
 * around the navigator, which is what `SwipeableRow` and the workout's own swipe already are.
 *
 * ## Yielding to whatever is underneath
 *
 * The claim is made in the bubble phase, not the capture phase, and that is the whole design.
 * React Native offers a touch to the deepest view first and works outward, so anything with its
 * own use for a sideways drag answers before this does: the exercise swipe in a timed or focused
 * workout, the horizontal chip rows on the plan and history screens, a card being dragged into a
 * new position. Only a drag that nothing else wanted becomes a tab change. Claiming in the
 * capture phase would have taken all of those.
 *
 * Vertical scrolling is unaffected: a scroll view claims a vertical drag as its own, and the
 * thresholds below ignore anything that is not decidedly sideways.
 *
 * ## Which way is forward
 *
 * Dragging left moves to the next tab, in both languages. The tab bar mirrors with the layout —
 * in Hebrew the first tab sits on the right — so the next tab is always the one to the left of
 * the current one, and the gesture points at it. The same rule the workout's exercise strip uses.
 */

import { usePathname, router, type Href } from 'expo-router';
import { useRef, type ReactNode } from 'react';
import { PanResponder, StyleSheet, View } from 'react-native';

import { hapticLight } from '../haptics.js';

/** The tabs in bar order. Index 0 is the first tab, whichever side the language puts it on. */
const TABS: readonly Href[] = ['/', '/workouts', '/plan', '/progress'];

/** Enough travel to be a deliberate sideways drag, and clearly more sideways than up. */
const DISTANCE = 60;
const DIRECTION_RATIO = 2;

export function SwipeBetweenTabs({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  // The responder is built once; the current tab reaches it through a ref rather than the
  // closure it was created in, which would answer with whatever tab was open at startup.
  const index = useRef(0);
  index.current = Math.max(
    0,
    TABS.findIndex((tab) => tab === pathname),
  );

  const responder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_event, gesture) =>
        Math.abs(gesture.dx) > 24 && Math.abs(gesture.dx) > Math.abs(gesture.dy) * DIRECTION_RATIO,
      onPanResponderRelease: (_event, gesture) => {
        if (Math.abs(gesture.dx) < DISTANCE) return;
        const target = index.current + (gesture.dx < 0 ? 1 : -1);
        const next = TABS[target];
        // Nothing at either end: the first tab does not wrap round to the last, which would
        // turn a mis-swipe into a jump across the app.
        if (!next) return;
        void hapticLight();
        router.navigate(next);
      },
    }),
  ).current;

  return (
    <View style={styles.fill} {...responder.panHandlers}>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({ fill: { flex: 1 } });
