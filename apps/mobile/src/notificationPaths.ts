/**
 * Where the app's own notifications lead. Kept apart from `notifications.ts`, which loads the
 * native module, so the pure code that reads these can be tested without it.
 */

/** The Saturday reminder: the week's summary. */
export const WEEK_SUMMARY_URL = '/week-summary';
