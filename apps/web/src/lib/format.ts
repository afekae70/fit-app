/**
 * Numbers and dates as the dashboard writes them, in Hebrew.
 *
 * Pure functions with the locale fixed, so a test can pin the output and a coach on an
 * English-language computer still reads the dashboard in the app's language.
 */

import { addDays, daysApart, parseDay } from '../analytics/dates.js';
import { fill, he } from '../i18n/he.js';

const LOCALE = 'he-IL';

const whole = new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 0 });
const oneDecimal = new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 1 });

export function formatNumber(value: number): string {
  return whole.format(value);
}

/** Kilograms, to the tenth where there is one: 82.5, 100. */
export function formatKg(value: number): string {
  return oneDecimal.format(value);
}

/**
 * Volume: kilograms below ten tonnes, tonnes above, so a year of training does not arrive as an
 * eight-digit number. Returns the number and its unit separately, for a tile to style.
 */
export function formatVolume(kg: number): { value: string; unit: string } {
  if (kg >= 10_000) return { value: oneDecimal.format(kg / 1000), unit: he.stats.tonnes };
  return { value: whole.format(kg), unit: he.stats.kg };
}

/** A share as a whole percentage; an em dash for none. */
export function formatPercent(share: number | null): string {
  return share === null ? '—' : `${Math.round(share * 100)}%`;
}

/**
 * Left-to-right, isolated: a number with a sign in it keeps its order inside a Hebrew line.
 * Without it the bidirectional algorithm moves the sign of "−8%" to the far end, where it
 * reads as "8%−".
 */
export const ltr = (text: string) => `\u2066${text}\u2069`;

/** A signed change: +12%, −4%. The minus is a real minus, not a hyphen. */
export function formatSignedPercent(value: number | null): string {
  if (value === null) return '—';
  if (value === 0) return '0%';
  const magnitude = oneDecimal.format(Math.abs(value));
  return ltr(value > 0 ? `+${magnitude}%` : `−${magnitude}%`);
}

/** 12 באוק׳ */
export function formatDayShort(day: string): string {
  return parseDay(day).toLocaleDateString(LOCALE, { day: 'numeric', month: 'short' });
}

/** יום ב׳, 12 באוקטובר */
export function formatDayLong(day: string): string {
  return parseDay(day).toLocaleDateString(LOCALE, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });
}

/** אוקטובר 2026 */
export function formatMonth(day: string): string {
  return parseDay(day).toLocaleDateString(LOCALE, { month: 'long', year: 'numeric' });
}

/** The day of the month and the short month, for a date badge. */
export function dateBadge(day: string): { day: string; month: string } {
  const date = parseDay(day);
  return {
    day: String(date.getDate()),
    month: date.toLocaleDateString(LOCALE, { month: 'short' }),
  };
}

/** "היום", "אתמול", "לפני 5 ימים" — or a date, past three weeks. */
export function relativeDay(day: string | null, today: string): string {
  if (day === null) return he.time.never;
  const ago = daysApart(day, today);
  if (ago === 0) return he.time.today;
  if (ago === 1) return he.time.yesterday;
  if (ago === -1) return he.time.tomorrow;
  if (ago < 0) return fill(he.time.inDays, { n: -ago });
  if (ago <= 21) return fill(he.time.daysAgo, { n: ago });
  return formatDayShort(day);
}

/** The next day's date, for "tomorrow" comparisons without a second import. */
export const nextDay = (day: string) => addDays(day, 1);

/** A person's initials for an avatar: the first letter of the first two words. */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  return words
    .slice(0, 2)
    .map((word) => word[0] ?? '')
    .join('')
    .toUpperCase();
}
