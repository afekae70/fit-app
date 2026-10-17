/**
 * Appointing coaches, for an administrator — the web twin of the app's own screen for it.
 *
 * Who is a coach is the owner's decision (0008), made by email: the account must already exist
 * in the app. The server checks that the caller is an administrator on every call; this page
 * only draws what it is told.
 */

import { UserGear, UserMinus, UserPlus } from '@phosphor-icons/react';
import { personLabel, type AppointedCoach, type CoachingError } from '@fit/shared/coaching';
import { useState, type FormEvent } from 'react';

import { useCoach } from '../coachContext.js';
import { DemoBar } from '../components/DemoBar.js';
import {
  Avatar,
  Button,
  Card,
  Dialog,
  EmptyState,
  ErrorBanner,
  Loading,
} from '../components/ui.js';
import { fill, he } from '../i18n/he.js';
import { useLoad } from '../lib/useLoad.js';

export function AdminPage() {
  const { source, status, refreshStatus } = useCoach();
  const coaches = useLoad(() => source.coaches(), [source]);
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<CoachingError | null>(null);
  const [dismissing, setDismissing] = useState<AppointedCoach | null>(null);

  if (!status.isAdmin) {
    return (
      <div className="page">
        <ErrorBanner error="not_admin" />
      </div>
    );
  }

  const set = (address: string, on: boolean) => {
    setBusy(true);
    setError(null);
    void source.setCoach(address, on).then(async (answer) => {
      setBusy(false);
      setDismissing(null);
      if (!answer.ok) {
        setError(answer.error);
        return;
      }
      setEmail('');
      coaches.reload();
      await refreshStatus();
    });
  };

  const appoint = (event: FormEvent) => {
    event.preventDefault();
    if (email.trim()) set(email, true);
  };

  return (
    <div className="page">
      <DemoBar />
      <header className="page-head">
        <div>
          <h1 className="page-title">{he.admin.title}</h1>
          <p className="page-sub">{he.admin.sub}</p>
        </div>
      </header>

      <Card>
        <form
          onSubmit={appoint}
          style={{ display: 'flex', gap: 'var(--space-3)', flexWrap: 'wrap' }}
        >
          <input
            className="input"
            type="email"
            dir="ltr"
            style={{ flex: '1 1 260px' }}
            placeholder={he.admin.email}
            aria-label={he.admin.email}
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
          <Button type="submit" variant="primary" disabled={busy || email.trim() === ''}>
            <UserPlus size={18} aria-hidden /> {he.admin.appoint}
          </Button>
        </form>
        {error ? <ErrorBanner error={error} /> : null}
      </Card>

      <Card>
        {coaches.state === 'loading' ? (
          <Loading />
        ) : coaches.state === 'failed' ? (
          <ErrorBanner error={coaches.error} onRetry={coaches.reload} />
        ) : coaches.value.length === 0 ? (
          <EmptyState icon={UserGear} title={he.admin.none} />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <tbody>
                {coaches.value.map((coach) => (
                  <tr key={coach.id}>
                    <td>
                      <div className="person">
                        <Avatar name={personLabel(coach)} />
                        <div>
                          <div className="person-name">{personLabel(coach)}</div>
                          <div className="person-sub" dir="ltr" style={{ textAlign: 'end' }}>
                            {coach.email}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="muted">
                      {fill(he.admin.summary, { code: coach.code ?? '—', count: coach.trainees })}
                    </td>
                    <td className="num">
                      <Button small variant="ghost" onClick={() => setDismissing(coach)}>
                        <UserMinus size={14} aria-hidden /> {he.admin.dismiss}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {dismissing ? (
        <Dialog
          title={fill(he.admin.dismissTitle, { name: personLabel(dismissing) })}
          onClose={() => setDismissing(null)}
          actions={
            <>
              <Button variant="ghost" onClick={() => setDismissing(null)}>
                {he.plans.cancel}
              </Button>
              <Button variant="danger" disabled={busy} onClick={() => set(dismissing.email, false)}>
                {he.admin.dismiss}
              </Button>
            </>
          }
        >
          <p>{he.admin.dismissBody}</p>
        </Dialog>
      ) : null}
    </div>
  );
}
