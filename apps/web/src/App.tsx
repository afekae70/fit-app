/**
 * Who is looking, and what they get.
 *
 * Signed out: the sign-in page, with the way into the demonstration. Signed in: the coach's
 * status from the server decides the rest — a coach gets the dashboard, an administrator who is
 * not a coach gets the page for appointing coaches, and anyone else is told plainly that this
 * account is not a coach's. The server checks every call for itself regardless; this only
 * decides what is worth drawing.
 */

import type { Session } from '@supabase/supabase-js';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { localDate } from './analytics/dates.js';
import { CoachContext, type CoachSession } from './coachContext.js';
import { Shell } from './components/Shell.js';
import { Button, ErrorBanner, Loading } from './components/ui.js';
import { demoSource } from './data/demoSource.js';
import type { CoachData } from './data/source.js';
import { supabaseSource } from './data/supabaseSource.js';
import { he } from './i18n/he.js';
import { useLoad } from './lib/useLoad.js';
import { navigate, useRoute } from './lib/router.js';
import { getSupabase } from './lib/supabase.js';
import { AdminPage } from './pages/AdminPage.js';
import { NotCoachPage } from './pages/NotCoachPage.js';
import { OverviewPage } from './pages/OverviewPage.js';
import { SignInPage } from './pages/SignInPage.js';
import { TraineePage } from './pages/TraineePage.js';

type Mode =
  | { kind: 'checking' }
  | { kind: 'signedOut' }
  | { kind: 'live'; session: Session }
  | { kind: 'demo' };

/**
 * `?demo` in the address opens the demonstration straight away — a link that can be sent to a
 * coach who has not signed up yet, to show them what they would get.
 */
const startsInDemo = () => new URLSearchParams(window.location.search).has('demo');

export function App() {
  const [mode, setMode] = useState<Mode>(() =>
    startsInDemo() ? { kind: 'demo' } : { kind: 'checking' },
  );
  const today = useMemo(() => localDate(new Date()), []);

  useEffect(() => {
    const supabase = getSupabase();
    if (!supabase) {
      setMode({ kind: 'signedOut' });
      return;
    }
    void supabase.auth.getSession().then(({ data }) => {
      setMode((current) =>
        current.kind === 'demo'
          ? current
          : data.session
            ? { kind: 'live', session: data.session }
            : { kind: 'signedOut' },
      );
    });
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      setMode((current) => {
        if (current.kind === 'demo') return current;
        if (!session) return { kind: 'signedOut' };
        // A token refresh is the same coach: keep the object, so nothing reloads for it.
        if (current.kind === 'live' && current.session.user.id === session.user.id) return current;
        return { kind: 'live', session };
      });
    });
    return () => data.subscription.unsubscribe();
  }, []);

  const source = useMemo<CoachData | null>(() => {
    if (mode.kind === 'demo') return demoSource(today);
    if (mode.kind === 'live') {
      const supabase = getSupabase();
      return supabase ? supabaseSource(supabase) : null;
    }
    return null;
  }, [mode, today]);

  const signOut = useCallback(() => {
    navigate({ name: 'overview' });
    if (mode.kind === 'demo') {
      setMode({ kind: 'signedOut' });
      return;
    }
    void getSupabase()?.auth.signOut();
  }, [mode.kind]);

  if (mode.kind === 'checking') return <Loading />;
  if (mode.kind === 'signedOut' || !source) {
    return <SignInPage onDemo={() => setMode({ kind: 'demo' })} />;
  }

  return (
    <Dashboard
      key={mode.kind === 'live' ? mode.session.user.id : 'demo'}
      source={source}
      email={mode.kind === 'live' ? (mode.session.user.email ?? '') : 'coach@example.com'}
      today={today}
      signOut={signOut}
    />
  );
}

function Dashboard({
  source,
  email,
  today,
  signOut,
}: {
  source: CoachData;
  email: string;
  today: string;
  signOut: () => void;
}) {
  const route = useRoute();
  const status = useLoad(() => source.status(), [source]);

  // An expired session is a sign-in, not an error to read.
  useEffect(() => {
    if (status.state === 'failed' && status.error === 'not_signed_in') signOut();
  }, [status, signOut]);

  const refreshStatus = useCallback(async () => {
    status.reload();
    await Promise.resolve();
  }, [status]);

  if (status.state === 'loading') return <Loading />;
  if (status.state === 'failed') {
    return (
      <main className="signin">
        <div className="signin-card">
          <ErrorBanner error={status.error} onRetry={status.reload} />
          <Button variant="ghost" onClick={signOut}>
            {he.nav.signOut}
          </Button>
        </div>
      </main>
    );
  }

  const value: CoachSession = {
    source,
    status: status.value,
    email,
    today,
    refreshStatus,
    signOut,
  };

  const isCoach = status.value.role === 'coach';
  if (!isCoach && !(status.value.isAdmin && route.name === 'admin')) {
    return (
      <CoachContext.Provider value={value}>
        <NotCoachPage />
      </CoachContext.Provider>
    );
  }

  return (
    <CoachContext.Provider value={value}>
      <Shell route={route}>
        {route.name === 'admin' ? (
          <AdminPage />
        ) : route.name === 'trainee' ? (
          <TraineePage key={route.id} traineeId={route.id} tab={route.tab} />
        ) : (
          <OverviewPage />
        )}
      </Shell>
    </CoachContext.Provider>
  );
}
