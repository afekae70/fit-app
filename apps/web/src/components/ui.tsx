/**
 * The dashboard's small parts: cards, stat tiles, buttons, flags, empty and failed states, and
 * a dialog. The look is in global.css; these give each part one way to be written.
 */

import {
  ArrowDownRight,
  ArrowUpRight,
  CalendarX,
  Pause,
  TrendDown,
  WarningCircle,
  type Icon,
} from '@phosphor-icons/react';
import type { CoachingError } from '@fit/shared/coaching';
import { useEffect, useRef, type ReactNode } from 'react';

import type { Flag as FlagName } from '../analytics/overview.js';
import { he } from '../i18n/he.js';
import { initials } from '../lib/format.js';

export function Card({
  title,
  sub,
  action,
  children,
  className,
}: {
  title?: string;
  sub?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`card${className ? ` ${className}` : ''}`}>
      {title || action ? (
        <header className="card-head">
          <div>
            {title ? <h2 className="card-title">{title}</h2> : null}
            {sub ? <p className="card-sub">{sub}</p> : null}
          </div>
          {action}
        </header>
      ) : null}
      {children}
    </section>
  );
}

export function StatTile({
  label,
  value,
  unit,
  hint,
  delta,
  icon: IconComponent,
}: {
  label: string;
  value: string;
  unit?: string | undefined;
  hint?: string | undefined;
  /** A signed change, with whether up is good. */
  delta?: { text: string; direction: 'up' | 'down' | 'flat' } | null | undefined;
  icon?: Icon | undefined;
}) {
  return (
    <div className="stat">
      <span className="stat-label">
        {IconComponent ? <IconComponent size={16} weight="duotone" aria-hidden /> : null}
        {label}
      </span>
      <span className="stat-value">
        {value}
        {unit ? <span className="stat-unit">{unit}</span> : null}
      </span>
      {delta && delta.direction !== 'flat' ? (
        <span className={`delta ${delta.direction}`}>
          {delta.direction === 'up' ? (
            <ArrowUpRight size={12} weight="bold" aria-hidden />
          ) : (
            <ArrowDownRight size={12} weight="bold" aria-hidden />
          )}
          {delta.text}
        </span>
      ) : null}
      {hint ? <span className="stat-hint">{hint}</span> : null}
    </div>
  );
}

export function Button({
  children,
  onClick,
  variant = 'secondary',
  small = false,
  disabled = false,
  type = 'button',
  title,
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  small?: boolean;
  disabled?: boolean;
  type?: 'button' | 'submit';
  title?: string;
}) {
  return (
    <button
      type={type}
      className={`button ${variant}${small ? ' small' : ''}`}
      onClick={onClick}
      disabled={disabled}
      title={title}
    >
      {children}
    </button>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (value: T) => void;
  label: string;
}) {
  return (
    <div className="segmented" role="group" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={option.value === value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

const FLAG_LOOK: Record<FlagName, { tone: string; icon: Icon }> = {
  inactive: { tone: 'danger', icon: Pause },
  missing: { tone: 'warning', icon: CalendarX },
  stalling: { tone: 'info', icon: TrendDown },
  unplanned: { tone: 'neutral', icon: WarningCircle },
};

/** A flag: an icon and words, never colour alone. */
export function FlagChip({ flag }: { flag: FlagName }) {
  const look = FLAG_LOOK[flag];
  const IconComponent = look.icon;
  return (
    <span className={`flag ${look.tone}`} title={he.flags[`${flag}Hint`]}>
      <IconComponent size={12} weight="bold" aria-hidden />
      {he.flags[flag]}
    </span>
  );
}

export function Avatar({ name, large = false }: { name: string; large?: boolean }) {
  return (
    <span className={`avatar${large ? ' large' : ''}`} aria-hidden>
      {initials(name) || '?'}
    </span>
  );
}

export function EmptyState({
  icon: IconComponent,
  title,
  children,
}: {
  icon: Icon;
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="empty">
      <span className="empty-icon">
        <IconComponent size={30} weight="duotone" aria-hidden />
      </span>
      <p className="empty-title">{title}</p>
      {children}
    </div>
  );
}

export function Loading({ label }: { label?: string }) {
  return (
    <div className="loading" role="status">
      <span className="spinner" aria-hidden />
      {label ? <span>{label}</span> : <span className="visually-hidden">טוען</span>}
    </div>
  );
}

export function ErrorBanner({ error, onRetry }: { error: CoachingError; onRetry?: () => void }) {
  return (
    <div className="banner error" role="alert">
      <WarningCircle size={20} weight="duotone" aria-hidden />
      <span style={{ flex: 1 }}>{he.errors[error]}</span>
      {onRetry ? (
        <Button small onClick={onRetry}>
          {he.errors.retry}
        </Button>
      ) : null}
    </div>
  );
}

/**
 * A dialog over the page. Escape and a click outside close it; focus moves into it on opening
 * and back to where it was on closing.
 */
export function Dialog({
  title,
  children,
  actions,
  onClose,
}: {
  title: string;
  children: ReactNode;
  actions: ReactNode;
  onClose: () => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    const first = box.current?.querySelector<HTMLElement>(
      'input, select, textarea, button:not([disabled])',
    );
    first?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', key);
    return () => {
      window.removeEventListener('keydown', key);
      before?.focus();
    };
  }, [onClose]);

  return (
    <div
      className="scrim"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="dialog" role="dialog" aria-modal="true" aria-label={title} ref={box}>
        <h2 className="dialog-title">{title}</h2>
        {children}
        <div className="dialog-actions">{actions}</div>
      </div>
    </div>
  );
}
