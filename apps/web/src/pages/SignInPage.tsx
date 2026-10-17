/**
 * Signing in: the email and password of the coach's account in the app.
 *
 * There is no sign-up here. A coach is an app account that an administrator has appointed
 * (0008), so the account exists before this page is ever opened; and a password is reset from
 * the app, which already has the screens and the email links for it.
 */

import { SignIn } from '@phosphor-icons/react';
import { useState, type FormEvent } from 'react';

import { Button } from '../components/ui.js';
import { he } from '../i18n/he.js';
import { readSignInError, type Failure } from '../lib/signInErrors.js';
import { getSupabase } from '../lib/supabase.js';

const FAILURE_TEXT: Record<Failure, string> = {
  credentials: he.signIn.errorCredentials,
  unconfirmed: he.signIn.errorUnconfirmed,
  offline: he.signIn.errorOffline,
  other: he.signIn.errorOther,
  notConfigured: he.signIn.notConfigured,
};

export function SignInPage({ onDemo }: { onDemo: () => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const supabase = getSupabase();
    if (!supabase) {
      setFailure('notConfigured');
      return;
    }
    setBusy(true);
    setFailure(null);
    void supabase.auth
      .signInWithPassword({ email: email.trim(), password })
      .then(({ error }) => {
        // Success needs nothing here: the session change is heard by App, which moves on.
        if (error) setFailure(readSignInError(error));
      })
      .catch(() => setFailure('offline'))
      .finally(() => setBusy(false));
  };

  return (
    <main className="signin">
      <div className="signin-card">
        <img className="signin-logo" src="./icon.png" alt="" />
        <div>
          <h1 className="signin-title">{he.signIn.title}</h1>
          <p className="page-sub">{he.signIn.lead}</p>
        </div>

        <form className="signin-form" onSubmit={submit}>
          <div className="field">
            <label htmlFor="email">{he.signIn.email}</label>
            <input
              id="email"
              className="input"
              type="email"
              dir="ltr"
              autoComplete="username"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="password">{he.signIn.password}</label>
            <input
              id="password"
              className="input"
              type="password"
              dir="ltr"
              autoComplete="current-password"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </div>
          {failure ? (
            <div className="banner error" role="alert">
              {FAILURE_TEXT[failure]}
            </div>
          ) : null}
          <Button type="submit" variant="primary" disabled={busy}>
            <SignIn size={18} weight="bold" aria-hidden />
            {busy ? he.signIn.signingIn : he.signIn.submit}
          </Button>
          <p className="muted" style={{ fontSize: 'var(--text-xs)' }}>
            {he.signIn.forgot}
          </p>
        </form>

        <div className="signin-or">{he.signIn.or}</div>
        <Button variant="ghost" onClick={onDemo}>
          {he.signIn.demo}
        </Button>
      </div>
    </main>
  );
}
