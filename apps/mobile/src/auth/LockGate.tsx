/**
 * Shuts the door on the way in, and again after the app has been left for a while.
 *
 * `lockPolicy.ts` says when; this is what acts on it. `LockScreen.tsx` is what is seen.
 *
 * ## Two ways of being in front
 *
 * **At launch** the lock screen is drawn *instead of* the app. Nothing behind it is mounted, so
 * nothing of the account — a name on a header, a number on a card — is drawn for a frame before
 * the door closes, and no screen starts loading data for someone who has not been let in.
 *
 * **On coming back** the app is already running: there is a screen open, perhaps a form half
 * filled in. Unmounting it to show the lock would throw that away. So the app stays mounted and
 * the lock goes over it, in a window of its own — a `Modal` — because the app may itself have a
 * sheet or a dialog open, and those are windows too: a plain view on top of the app would sit
 * underneath them.
 *
 * ## It fails open
 *
 * If the setting cannot be read, if the workout check throws, if the lock screen will not
 * draw: the app is shown. This is a convenience that keeps a glance off a training log, and no
 * failure of it is worth keeping the log's owner out. There is also always the password —
 * signing out from the lock screen and back in is never followed by the lock.
 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { AppState, BackHandler, Modal, View, type AppStateStatus } from 'react-native';

import { LetThroughOnError } from '../components/LetThroughOnError.js';
import { getExecutor } from '../db/provider.js';
import { getActiveSession } from '../db/workouts.js';
import { biometricsAvailable, loadLockEnabled } from './appLock.js';
import { locksOnOpen, locksOnReturn } from './lockPolicy.js';
import { LockScreen } from './LockScreen.js';

type Standing = 'deciding' | 'locked' | 'open';

/** What the policy needs to know about this account on this phone, right now. */
async function circumstances(userId: string) {
  const available = biometricsAvailable();
  // Nothing further is worth asking on a phone that cannot lock at all.
  if (!available) return { available, enabled: false, workoutInProgress: false };
  const enabled = await loadLockEnabled(userId);
  if (!enabled) return { available, enabled, workoutInProgress: false };
  const workoutInProgress = (await getActiveSession(await getExecutor(), userId)) !== null;
  return { available, enabled, workoutInProgress };
}

export function LockGate({
  userId,
  signedInJustNow,
  children,
}: {
  userId: string;
  /** The sign-in screen was up during this run of the app: this session came from a password. */
  signedInJustNow: boolean;
  children: ReactNode;
}) {
  const exempt = userId === 'local' || signedInJustNow;
  const [standing, setStanding] = useState<Standing>(exempt ? 'open' : 'deciding');
  // Once the app has been shown it stays mounted, and any later lock goes over it.
  const shown = useRef(exempt);
  if (standing === 'open') shown.current = true;

  // The listener below outlives any one render and must see where things stand now.
  const standingNow = useRef(standing);
  standingNow.current = standing;

  const open = useCallback(() => setStanding('open'), []);

  // Opening the app.
  useEffect(() => {
    if (exempt) return;
    let cancelled = false;
    void (async () => {
      try {
        const state = await circumstances(userId);
        if (cancelled) return;
        setStanding(locksOnOpen({ ...state, signedInJustNow: false }) ? 'locked' : 'open');
      } catch {
        if (!cancelled) setStanding('open');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [userId, exempt]);

  // Coming back to it.
  useEffect(() => {
    if (userId === 'local') return;
    let leftAt: number | null = null;
    const subscription = AppState.addEventListener('change', (next: AppStateStatus) => {
      if (next !== 'active') {
        // The first moment it left, not the last: Android reports more than one step on the
        // way out, and the later ones must not restart the clock.
        leftAt ??= Date.now();
        return;
      }
      const awayMs = leftAt === null ? 0 : Date.now() - leftAt;
      leftAt = null;
      // Already locked, or not yet decided: there is no door to shut.
      if (standingNow.current !== 'open') return;
      void (async () => {
        try {
          const state = await circumstances(userId);
          if (locksOnReturn({ ...state, awayMs }) && standingNow.current === 'open') {
            setStanding('locked');
          }
        } catch {
          // Fails open: stays as it was.
        }
      })();
    });
    return () => subscription.remove();
  }, [userId]);

  if (standing === 'deciding') return <View style={{ flex: 1 }} />;

  if (standing === 'locked' && !shown.current) {
    return (
      <LetThroughOnError what="The lock screen" onError={open}>
        <LockScreen userId={userId} onUnlocked={open} />
      </LetThroughOnError>
    );
  }

  return (
    <>
      {children}
      <Modal
        visible={standing === 'locked'}
        animationType="fade"
        // Edge to edge, like the app it covers: without these the window stops short of the
        // status and navigation bars and the screen underneath shows in the gaps.
        statusBarTranslucent
        navigationBarTranslucent
        // Back, with the door shut, leaves the app. It must not reach the screen underneath,
        // which would be navigating an app the person has not been let into.
        onRequestClose={() => BackHandler.exitApp()}
      >
        <LetThroughOnError what="The lock screen" onError={open}>
          <LockScreen userId={userId} onUnlocked={open} solid />
        </LetThroughOnError>
      </Modal>
    </>
  );
}
