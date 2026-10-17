/**
 * The frame around every page: the menu on the inline-start side, the page beside it.
 *
 * The menu carries the three things a coach reaches for from anywhere: the list of trainees,
 * the code a new trainee types into the app, and the way out.
 */

import {
  Check,
  Copy,
  Desktop,
  Moon,
  SignOut,
  SquaresFour,
  Sun,
  UserGear,
  Users,
} from '@phosphor-icons/react';
import { useEffect, useState, type ReactNode } from 'react';

import { useCoach } from '../coachContext.js';
import { he } from '../i18n/he.js';
import { hrefFor, type Route } from '../lib/router.js';
import {
  applyTheme,
  followSystem,
  readThemeChoice,
  saveThemeChoice,
  type ThemeChoice,
} from '../theme/theme.js';
import { Button } from './ui.js';

const THEMES: { value: ThemeChoice; label: string; icon: typeof Sun }[] = [
  { value: 'system', label: he.nav.themeSystem, icon: Desktop },
  { value: 'light', label: he.nav.themeLight, icon: Sun },
  { value: 'dark', label: he.nav.themeDark, icon: Moon },
];

export function Shell({ route, children }: { route: Route; children: ReactNode }) {
  const { status, email, signOut, source } = useCoach();
  const [theme, setTheme] = useState<ThemeChoice>(readThemeChoice);
  const [copied, setCopied] = useState(false);

  useEffect(() => followSystem(() => theme), [theme]);

  const chooseTheme = (choice: ThemeChoice) => {
    setTheme(choice);
    saveThemeChoice(choice);
    applyTheme(choice);
  };

  const copyCode = () => {
    if (!status.code) return;
    void navigator.clipboard?.writeText(status.code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    });
  };

  const onTrainee = route.name === 'trainee';

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <img src="./icon.png" alt="" />
          <div>
            <div className="brand-name">{he.appName}</div>
            <div className="brand-sub">{he.appSub}</div>
          </div>
        </div>

        <nav className="nav" aria-label={he.appName}>
          <a
            className="nav-item"
            href={hrefFor({ name: 'overview' })}
            aria-current={route.name === 'overview' || onTrainee ? 'page' : undefined}
          >
            <SquaresFour size={20} weight="duotone" aria-hidden />
            {he.nav.overview}
            <span className="nav-count" title={he.nav.trainees}>
              <Users size={14} aria-hidden /> {status.trainees.length}
            </span>
          </a>
          {status.isAdmin ? (
            <a
              className="nav-item"
              href={hrefFor({ name: 'admin' })}
              aria-current={route.name === 'admin' ? 'page' : undefined}
            >
              <UserGear size={20} weight="duotone" aria-hidden />
              {he.nav.admin}
            </a>
          ) : null}
        </nav>

        <div className="sidebar-foot">
          {status.code ? (
            <div className="code-card">
              <div className="label">{he.nav.yourCode}</div>
              <div
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
              >
                <span className="code">{status.code}</span>
                <button
                  type="button"
                  className="icon-button"
                  onClick={copyCode}
                  title={copied ? he.nav.copied : he.nav.copyCode}
                  aria-label={copied ? he.nav.copied : he.nav.copyCode}
                >
                  {copied ? <Check size={18} weight="bold" /> : <Copy size={18} />}
                </button>
              </div>
            </div>
          ) : null}

          <div className="segmented" role="group" aria-label={he.nav.theme}>
            {THEMES.map((option) => {
              const IconComponent = option.icon;
              return (
                <button
                  key={option.value}
                  type="button"
                  aria-pressed={theme === option.value}
                  onClick={() => chooseTheme(option.value)}
                  title={option.label}
                  aria-label={option.label}
                >
                  <IconComponent size={16} weight={theme === option.value ? 'fill' : 'regular'} />
                </button>
              );
            })}
          </div>

          <div className="account">
            <span dir="ltr">{email}</span>
          </div>
          <Button variant="ghost" small onClick={signOut}>
            <SignOut size={16} aria-hidden />
            {source.mode === 'demo' ? he.demo.leave : he.nav.signOut}
          </Button>
        </div>
      </aside>

      <main className="main">{children}</main>
    </div>
  );
}
