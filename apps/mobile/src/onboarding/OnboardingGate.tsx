/**
 * Stands between a signed-in account and the app until the setup questions have been answered.
 *
 * It reads the profile once, when the account is known, and decides: an account that still
 * needs asking gets the questions in place of the app; any other account never sees this exist.
 * See `needsProfileSetup` for where that line is.
 *
 * ## It fails open
 *
 * If the profile cannot be read, the app is shown. Someone locked out of their training log by
 * a question about their height is a far worse outcome than someone who was not asked it, and
 * the nutrition screen will still take those answers from anyone who goes looking.
 *
 * ## The moment before it knows
 *
 * Reading the profile takes a few milliseconds, and for those it renders nothing — the ground
 * the whole app sits on, with no screen over it. Showing the app and then replacing it with a
 * question would be a flash of somewhere the user is not yet allowed to be; showing a spinner
 * would be a loading screen for something faster than a frame or two. On a cold start the
 * splash is still over everything at this point anyway.
 *
 * ## A new phone is not a new person
 *
 * An empty profile on this phone has two explanations: an account that was just created, or an
 * account that has been used for a year and has just been signed in to somewhere new. The
 * second has answered all of this already, and the answers are on the server.
 *
 * So before asking, a phone that has never compared its profile with the server does that
 * first, and only asks if there is still something missing afterwards. That is a request, so
 * for once there is something to wait for and a spinner is shown; it is given a few seconds
 * and no more. With no signal the questions are asked after all — the app must open — and what
 * is answered then is kept, like anything else typed on this phone.
 */

import { useEffect, useState, type ReactNode } from 'react';
import { ActivityIndicator, View } from 'react-native';

import { LetThroughOnError } from '../components/LetThroughOnError.js';
import { getProfile } from '../db/metrics.js';
import { listPlans } from '../db/plans.js';
import { getExecutor } from '../db/provider.js';
import { StarterWelcome } from '../plans/StarterProgramPicker.js';
import { syncProfileNow } from '../sync/profileSyncRunner.js';
import { useTheme } from '../ThemeProvider.js';
import { OnboardingFlow } from './OnboardingFlow.js';
import { hasMetServer, needsProfileSetup } from './profileSetup.js';

type Standing = 'checking' | 'fetching' | 'asking' | 'offering' | 'through';

/** How long the server is given to say what it knows before the questions are asked anyway. */
const SERVER_WAIT_MS = 8000;

/** Resolves when `work` does, or after `ms`, whichever is first. Never rejects. */
function withinTime(work: Promise<unknown>, ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    void work
      .catch(() => undefined)
      .then(() => {
        clearTimeout(timer);
        resolve();
      });
  });
}

export function OnboardingGate({ userId, children }: { userId: string; children: ReactNode }) {
  // The pseudo-user of a build with no accounts has nobody to ask and nowhere to sign up from.
  const [standing, setStanding] = useState<Standing>(userId === 'local' ? 'through' : 'checking');
  const { colors } = useTheme();

  useEffect(() => {
    if (userId === 'local') return;
    let cancelled = false;
    void (async () => {
      try {
        const db = await getExecutor();
        let profile = await getProfile(db, userId);
        if (needsProfileSetup(profile) && !hasMetServer(profile)) {
          if (!cancelled) setStanding('fetching');
          await withinTime(syncProfileNow(userId), SERVER_WAIT_MS);
          profile = await getProfile(db, userId);
        }
        if (!cancelled) setStanding(needsProfileSetup(profile) ? 'asking' : 'through');
      } catch {
        if (!cancelled) setStanding('through');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [userId]);

  if (standing === 'checking') return <View style={{ flex: 1 }} />;
  if (standing === 'fetching') {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }
  if (standing === 'asking') {
    return (
      <LetThroughOnError what="Profile setup" onError={() => setStanding('through')}>
        <OnboardingFlow
          userId={userId}
          onDone={() => {
            // The answers exist only on this phone at this moment, and they are the one thing
            // a new account has. Sent now rather than whenever the app is next reopened.
            void syncProfileNow(userId);
            // One more thing before the app, for an account with nothing to train from: a
            // programme to start with. Someone who already has plans — they answered these
            // questions on a phone whose plans came down first — is not offered another.
            void (async () => {
              try {
                const plans = await listPlans(await getExecutor(), userId);
                setStanding(plans.length === 0 ? 'offering' : 'through');
              } catch {
                setStanding('through');
              }
            })();
          }}
        />
      </LetThroughOnError>
    );
  }
  if (standing === 'offering') {
    return (
      <LetThroughOnError what="The starter programmes" onError={() => setStanding('through')}>
        <StarterWelcome userId={userId} onDone={() => setStanding('through')} />
      </LetThroughOnError>
    );
  }
  return <>{children}</>;
}
