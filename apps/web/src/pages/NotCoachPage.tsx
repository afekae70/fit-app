/** For a signed-in account that is not a coach: what this site is, and who can change that. */

import { UserCircleMinus } from '@phosphor-icons/react';

import { useCoach } from '../coachContext.js';
import { Button, EmptyState } from '../components/ui.js';
import { he } from '../i18n/he.js';
import { hrefFor } from '../lib/router.js';

export function NotCoachPage() {
  const { status, signOut, email } = useCoach();
  return (
    <main className="signin">
      <div className="signin-card">
        <EmptyState icon={UserCircleMinus} title={he.notCoach.title}>
          <p>{he.notCoach.body}</p>
          <p dir="ltr" className="muted">
            {email}
          </p>
        </EmptyState>
        {status.isAdmin ? (
          <a className="button primary" href={hrefFor({ name: 'admin' })}>
            {he.notCoach.admin}
          </a>
        ) : null}
        <Button variant="ghost" onClick={signOut}>
          {he.nav.signOut}
        </Button>
      </div>
    </main>
  );
}
