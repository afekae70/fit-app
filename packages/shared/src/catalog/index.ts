/**
 * The global exercise and equipment catalogue.
 *
 * Lives in `shared` rather than in the API because BOTH sides need it:
 *  - the API seeds it into Postgres, where user-created exercises join it;
 *  - the mobile app ships it in the bundle so a workout can be logged with no network and
 *    no prior sync — which matters, since the gym and the base are exactly where signal is
 *    worst.
 *
 * Because the app carries this list offline, treat `nameEn` as a stable key: renaming an
 * exercise here after release orphans any locally logged rows that reference the old name.
 */

export * from './equipment.js';
export * from './exerciseImages.js';
export * from './exercises.js';
