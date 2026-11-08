/**
 * How progress is judged: set by set (`setBySet.ts`), month by month (`monthlyReview.ts`), and
 * by part of the body (`bodyAreas.ts`).
 *
 * Shared so the trainee's phone and the coach's website read one verdict, not two that happen
 * to agree. Pure functions only — the phone feeds them from its database, the website from the
 * coach functions on the server.
 *
 * Not re-exported from the package root: `setBySet.ts` names its own `WorkingSet`, distinct from
 * the one in `calculations`. Import from `@fit/shared/progress`.
 */

export * from './bodyAreas.js';
export * from './monthlyReview.js';
export * from './sessionReview.js';
export * from './setBySet.js';
