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
 */

import { Component, useEffect, useState, type ReactNode } from 'react';
import { View } from 'react-native';

import { getProfile } from '../db/metrics.js';
import { getExecutor } from '../db/provider.js';
import { OnboardingFlow } from './OnboardingFlow.js';
import { needsProfileSetup } from './profileSetup.js';

type Standing = 'checking' | 'asking' | 'through';

/**
 * Failing open has to cover a crash as well as a failed read.
 *
 * The app's own error boundary sits inside what this gate lets through, so a fault while the
 * questions are on screen would have nothing above it to catch it. A setup screen that will not
 * draw must cost the questions, not the app: this lets the account straight in, exactly as if
 * the profile could not be read.
 */
class LetThroughOnError extends Component<
  { onError: () => void; children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  componentDidCatch(error: Error) {
    console.error('Profile setup could not be shown, so it was skipped:', error);
    this.props.onError();
  }

  render() {
    return this.state.failed ? null : this.props.children;
  }
}

export function OnboardingGate({ userId, children }: { userId: string; children: ReactNode }) {
  // The pseudo-user of a build with no accounts has nobody to ask and nowhere to sign up from.
  const [standing, setStanding] = useState<Standing>(userId === 'local' ? 'through' : 'checking');

  useEffect(() => {
    if (userId === 'local') return;
    let cancelled = false;
    void (async () => {
      try {
        const profile = await getProfile(await getExecutor(), userId);
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
  if (standing === 'asking') {
    return (
      <LetThroughOnError onError={() => setStanding('through')}>
        <OnboardingFlow userId={userId} onDone={() => setStanding('through')} />
      </LetThroughOnError>
    );
  }
  return <>{children}</>;
}
