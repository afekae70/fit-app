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
 * Dragging from left to right moves forward — היום → אימון → תוכנית → התקדמות — and back the other
 * way returns. See `tabSwipe.ts`, where the rule lives and is tested.
 *
 * ## Not during a workout
 *
 * While a workout is open, sideways belongs to the exercises: the card swipes between them, and a
 * drag that missed it by a finger's width must not throw the whole screen onto another tab. The
 * flag comes from the workout screen as it opens and closes a session, and is read from the
 * database whenever the tab changes, so it is right even when the app reopens mid-workout onto a
 * different tab.
 *
 * ## The two edges
 *
 * A drag that begins within a finger's width of either edge belongs to Android, not to the app:
 * that is where the system back gesture lives, and it takes the touch before any view sees it.
 * Nothing here can claim those strips — an app may only ask for exclusions through a native call
 * this project does not make — so the swipe starts a little inside them. The threshold is kept
 * short for that reason.
 */

import { usePathname, router, type Href } from 'expo-router';
import { useEffect, useRef, type ReactNode } from 'react';
import { PanResponder, StyleSheet, View } from 'react-native';

import { useCurrentUserId } from '../auth/CurrentUserProvider.js';
import { getExecutor } from '../db/provider.js';
import { getActiveSession } from '../db/workouts.js';
import { hapticLight } from '../haptics.js';
import { isWorkoutActive, setWorkoutActive } from '../workout/activeWorkout.js';
import { tabAfterSwipe } from './tabSwipe.js';

/** The tabs in bar order. Index 0 is the first tab, whichever side the language puts it on. */
const TABS: readonly Href[] = ['/', '/workouts', '/plan', '/progress'];

/** Clearly more sideways than up; how far it has to travel lives with the rule in tabSwipe.ts. */
const DIRECTION_RATIO = 2;

export function SwipeBetweenTabs({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const userId = useCurrentUserId();

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const db = await getExecutor();
      const open = await getActiveSession(db, userId);
      if (!cancelled) setWorkoutActive(open !== null);
    })();
    return () => {
      cancelled = true;
    };
  }, [pathname, userId]);

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
        !isWorkoutActive() &&
        Math.abs(gesture.dx) > 24 &&
        Math.abs(gesture.dx) > Math.abs(gesture.dy) * DIRECTION_RATIO,
      onPanResponderRelease: (_event, gesture) => {
        const target = tabAfterSwipe(gesture.dx, index.current, TABS.length);
        const next = target === null ? undefined : TABS[target];
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
