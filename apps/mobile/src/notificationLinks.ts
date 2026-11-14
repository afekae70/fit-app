/**
 * Which screens a tapped notification may open. Pure, so it is tested without the native module.
 *
 * An allow-list rather than "any path": what a notification carries is whatever was scheduled
 * with it, and only this app's own reminders should be able to send someone somewhere. Today
 * that is one place — the Saturday reminder, to the week's summary.
 */

import { WEEK_SUMMARY_URL } from './notificationPaths.js';

const ALLOWED = new Set<string>([WEEK_SUMMARY_URL]);

/** The screen a notification's data points at, or null when it points nowhere we open. */
export function notificationTarget(data: unknown): string | null {
  if (!data || typeof data !== 'object') return null;
  const url = (data as { url?: unknown }).url;
  return typeof url === 'string' && ALLOWED.has(url) ? url : null;
}
