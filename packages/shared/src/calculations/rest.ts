/**
 * How long to rest, decided by what was just lifted.
 *
 * The app rested 90 seconds after everything — after a set of squats and after a set of lateral
 * raises. Ninety seconds is too little for the first and more than double what the second needs,
 * so the number was wrong nearly all the time and in both directions at once.
 *
 * The driver is how much of the body the movement uses, which the catalogue already records as
 * `movementPattern`. A squat recruits everything and needs minutes for the effort to come back;
 * a curl recovers in about a minute because there is far less of it working.
 *
 * These are starting points, not prescriptions. Rest is one of the most individual variables in
 * training, which is why they are round numbers rather than the output of a formula — a precise
 * figure here would be false precision dressed up as science.
 */

import type { MovementPattern } from '../catalog/exercises.js';

/** Squat, hinge and lunge move the whole body against the floor. */
const HEAVY_COMPOUND_SECONDS = 180;

/** Presses, pulls and carries: large muscles, but less of the body at once. */
const COMPOUND_SECONDS = 120;

/** One joint, one muscle, back quickly. */
const ISOLATION_SECONDS = 60;

const BY_PATTERN: Partial<Record<MovementPattern, number>> = {
  squat: HEAVY_COMPOUND_SECONDS,
  hinge: HEAVY_COMPOUND_SECONDS,
  lunge: HEAVY_COMPOUND_SECONDS,

  horizontal_push: COMPOUND_SECONDS,
  vertical_push: COMPOUND_SECONDS,
  horizontal_pull: COMPOUND_SECONDS,
  vertical_pull: COMPOUND_SECONDS,
  carry: COMPOUND_SECONDS,

  isolation: ISOLATION_SECONDS,
  core: ISOLATION_SECONDS,
  cardio: ISOLATION_SECONDS,
};

/**
 * The rest a movement pattern suggests.
 *
 * Falls back to the compound figure for an unknown pattern rather than the shortest one: being
 * told to start again too early is a worse failure than waiting longer than necessary, and a
 * pattern this does not recognise is more likely to be a big lift than a curl.
 */
export function restSecondsFor(pattern: MovementPattern | null | undefined): number {
  if (!pattern) return COMPOUND_SECONDS;
  return BY_PATTERN[pattern] ?? COMPOUND_SECONDS;
}

/** A warm-up is a ramp, and standing around after one is how a session takes two hours. */
export function restAfterWarmup(): number {
  return ISOLATION_SECONDS;
}
