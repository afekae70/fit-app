/**
 * Single source of truth for every physiological calculation in the app.
 *
 * Imported by BOTH the Expo app (optimistic display) and the Fastify API (authoritative
 * values, and the numbers fed to the AI coach's context). Keeping one implementation is what
 * guarantees the TDEE shown on the dashboard is the same TDEE the coach reasons about.
 */

export * from './constants.js';
export * from './anthropometry.js';
export * from './energy.js';
export * from './strength.js';
export * from './plates.js';
export * from './warmup.js';
export * from './trends.js';
