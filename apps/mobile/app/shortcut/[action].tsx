/**
 * Where an app-icon shortcut lands: `fitapp://shortcut/<action>`.
 *
 * Never seen for longer than it takes to write a row. It does the shortcut's work
 * (`runShortcut`), then replaces itself with the screen that shows the result — so the back
 * button and the system's back never return to it.
 */

import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef } from 'react';

import { useCurrentUserId } from '../../src/auth/CurrentUserProvider.js';
import { SkeletonScreen } from '../../src/components/ui.js';
import { getExecutor, newId } from '../../src/db/provider.js';
import { localDate } from '../../src/db/schedule.js';
import { hapticSuccess } from '../../src/haptics.js';
import { runShortcut } from '../../src/shortcuts/appShortcuts.js';
import { spacing } from '../../src/theme.js';

export default function ShortcutScreen() {
  const { action } = useLocalSearchParams<{ action?: string }>();
  const userId = useCurrentUserId();
  // Once per landing: a re-render must not add a second glass of water.
  const done = useRef(false);

  useEffect(() => {
    if (done.current) return;
    done.current = true;
    void (async () => {
      try {
        const outcome = await runShortcut(
          await getExecutor(),
          userId,
          newId,
          action,
          localDate(new Date()),
        );
        if (outcome.addedMl) hapticSuccess();
        router.replace(outcome.replace);
        if (outcome.push) router.push(outcome.push);
      } catch {
        // Whatever went wrong, not a blank screen: the home screen, where everything starts.
        router.replace('/');
      }
    })();
  }, [action, userId]);

  return <SkeletonScreen paddingTop={spacing.xxl} />;
}
