/**
 * The questions asked once, straight after an account is made — and everything about them that
 * can be decided without drawing anything.
 *
 * Weight, height, age and sex, how active someone is and what they are training for. Those are
 * the inputs of every calorie figure the app shows, and until now nothing asked for them: the
 * nutrition screen opened on a made-up 80 kg, 180 cm, thirty-year-old man and quietly saved him
 * as the user's profile. A number computed for somebody else is worse than no number, because
 * it looks like an answer.
 *
 * Kept free of React and of the database on purpose. Which rows count as "not set up yet", what
 * a ruler reads at a given scroll position, what gets written at the end — these are the parts
 * that are wrong silently when they are wrong, and the parts a test can pin down. The screens
 * that use them cannot run under vitest; this can.
 */

import {
  bmr as computeBmr,
  calorieTarget,
  macroSplit,
  tdee as computeTdee,
  type ActivityLevel,
  type Goal,
} from '@fit/shared/calculations';
import type { UnitPreference } from '@fit/shared';

/** In the order they are asked. `done` is not a question: it shows what the answers add up to. */
export const SETUP_STEPS = ['weight', 'height', 'age', 'activity', 'goal', 'done'] as const;
export type SetupStep = (typeof SETUP_STEPS)[number];

/**
 * How many steps the progress bar counts, sign-up form included.
 *
 * The form that makes the account is step one of the same journey, so the bar on it and the bar
 * here have to agree on the total: the form, then every question. `done` is the arrival, not a
 * step, and is not counted.
 */
export const SETUP_TOTAL = 1 + (SETUP_STEPS.length - 1);

/** Where a setup step sits in that count. The sign-up form is 1, so the first question is 2. */
export function setupPosition(step: SetupStep): number {
  return SETUP_STEPS.indexOf(step) + 2;
}

/* -------------------------------------------------------------------------- */
/* Who still has to be asked                                                   */
/* -------------------------------------------------------------------------- */

/** The profile columns the questions fill. A subset, so a test need not build a whole row. */
export interface SetupProfile {
  height_cm: number | null;
  birth_date: string | null;
  activity_level: string | null;
  goal: string | null;
}

/**
 * Does this account still need the questions?
 *
 * Yes when any of the four answers a calorie target cannot be worked out without is missing.
 * Weight is deliberately not part of the test: it lives in the weigh-in history rather than on
 * the profile, and someone who has been using the app for months without ever stepping on a
 * scale has not thereby failed to set it up.
 *
 * An account from before this existed passes if it ever opened the nutrition screen, which
 * saved all four. One that never did is asked once, which is the right outcome rather than an
 * accident: it has been shown targets built on someone else's body.
 */
/**
 * Has this phone ever compared its profile with the server's?
 *
 * Until it has, an empty profile says nothing about the account — only about the phone. See
 * `OnboardingGate` for what is done about that.
 */
export function hasMetServer(profile: { synced_json: string | null } | null): boolean {
  return profile !== null && profile.synced_json !== null;
}

export function needsProfileSetup(profile: SetupProfile | null): boolean {
  if (!profile) return true;
  return (
    profile.height_cm === null ||
    profile.birth_date === null ||
    profile.activity_level === null ||
    profile.goal === null
  );
}

/* -------------------------------------------------------------------------- */
/* Rulers                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * One scale on a ruler: where it starts and stops, how fine it is, and how it is marked.
 *
 * `step` is what one tick is worth. `mediumEvery` and `majorEvery` are counted in ticks, and a
 * major tick is the one that carries a number.
 */
export interface RulerRange {
  min: number;
  max: number;
  step: number;
  /** Where the ruler rests before anything has been chosen. */
  initial: number;
  decimals: number;
  mediumEvery: number;
  majorEvery: number;
}

/**
 * Half a kilo is as fine as this needs to be. It is a starting point for a calorie estimate
 * that is itself good to a hundred kilocalories or so, and the precise figure arrives the first
 * time a scale is connected. A ruler in tenths would be five times as long to drag across.
 */
export function weightRange(unit: UnitPreference): RulerRange {
  return unit === 'imperial'
    ? { min: 66, max: 550, step: 1, initial: 154, decimals: 0, mediumEvery: 5, majorEvery: 10 }
    : { min: 30, max: 250, step: 0.5, initial: 70, decimals: 1, mediumEvery: 2, majorEvery: 10 };
}

export function heightRange(unit: UnitPreference): RulerRange {
  return unit === 'imperial'
    ? { min: 48, max: 90, step: 0.5, initial: 67, decimals: 1, mediumEvery: 2, majorEvery: 12 }
    : { min: 120, max: 230, step: 1, initial: 170, decimals: 0, mediumEvery: 5, majorEvery: 10 };
}

/** Thirteen is the youngest the app's store listing allows, not an opinion about training. */
export const AGE_RANGE: RulerRange = {
  min: 13,
  max: 90,
  step: 1,
  initial: 25,
  decimals: 0,
  mediumEvery: 5,
  majorEvery: 10,
};

/** How many ticks the ruler has, both ends included. */
export function tickCount(range: RulerRange): number {
  return Math.round((range.max - range.min) / range.step) + 1;
}

/** The value a tick stands for. Rounded, because 30 + 81 × 0.5 should not be 70.50000000001. */
export function valueAtIndex(range: RulerRange, index: number): number {
  const clamped = Math.max(0, Math.min(tickCount(range) - 1, Math.round(index)));
  return Number((range.min + clamped * range.step).toFixed(range.decimals));
}

/**
 * The nearest tick to a value. Anything off the ends lands on the end.
 *
 * The value need not be on a tick itself — see `ontoScale`. This is where the ruler rests for
 * it, not what it is.
 */
export function indexOfValue(range: RulerRange, value: number): number {
  const index = Math.round((value - range.min) / range.step);
  return Math.max(0, Math.min(tickCount(range) - 1, index));
}

/**
 * Any number, brought onto a scale: held between its ends and cut to the precision it shows.
 *
 * Not the same as snapping to a tick. The ruler moves in half kilos because a finer one would
 * take five times as long to drag across, but a number that was typed, or read off a scale
 * this morning, is finer than that and should be kept as it is: 82.3 stays 82.3, and the ruler
 * simply rests on the nearest mark.
 */
export function ontoScale(range: RulerRange, value: number): number {
  const held = Math.max(range.min, Math.min(range.max, value));
  return Number(held.toFixed(range.decimals));
}

/**
 * What someone typed, as a value on the scale — or null if it is not a number at all.
 *
 * A comma is taken as a decimal point, since that is what half the world's keyboards offer.
 * Out of range is held at the end rather than refused: typing 300 on a scale that stops at 250
 * shows 250, which says what the limit is more plainly than an error would.
 */
export function parseTyped(range: RulerRange, text: string): number | null {
  const normalised = text.replace(',', '.').trim();
  if (normalised === '' || normalised === '.') return null;
  const value = Number(normalised);
  if (!Number.isFinite(value)) return null;
  return ontoScale(range, value);
}

export type TickKind = 'major' | 'medium' | 'minor';

/**
 * How tall a tick is drawn, and whether it carries a number.
 *
 * Decided by the value the tick stands for, not by its position on the ruler: a scale that
 * starts at 13 or at 66 should still put its numbers on 20 and on 70. Counted in whole steps so
 * that half-kilo scales are not at the mercy of floating-point remainders.
 */
export function tickKind(range: RulerRange, index: number): TickKind {
  const steps = Math.round(valueAtIndex(range, index) / range.step);
  if (steps % range.majorEvery === 0) return 'major';
  if (steps % range.mediumEvery === 0) return 'medium';
  return 'minor';
}

/**
 * The tick under the pointer at a given scroll offset.
 *
 * Clamped, because a scroll view reports offsets beyond its ends while it is being overscrolled
 * and while it bounces back, and a ruler that reads 29.5 on a scale starting at 30 for the
 * length of a bounce is a number that was never on offer.
 */
export function indexAtOffset(range: RulerRange, offset: number, tickWidth: number): number {
  if (tickWidth <= 0) return 0;
  return Math.max(0, Math.min(tickCount(range) - 1, Math.round(offset / tickWidth)));
}

/* -------------------------------------------------------------------------- */
/* Age                                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Convert an entered age to a date of birth.
 *
 * The profile stores a birth date rather than an age so the value cannot go stale — a stored
 * age silently becomes wrong on the user's birthday and skews every BMR calculation from then
 * on. Anchoring to today's month and day keeps the derived age correct for a full year.
 */
export function birthDateFromAge(ageYears: number, today = new Date()): string {
  const birth = new Date(
    Date.UTC(today.getUTCFullYear() - ageYears, today.getUTCMonth(), today.getUTCDate()),
  );
  return birth.toISOString().slice(0, 10);
}

export function ageFromBirthDate(birthDate: string, today = new Date()): number {
  const birth = new Date(birthDate);
  let age = today.getUTCFullYear() - birth.getUTCFullYear();
  const monthDelta = today.getUTCMonth() - birth.getUTCMonth();
  if (monthDelta < 0 || (monthDelta === 0 && today.getUTCDate() < birth.getUTCDate())) age -= 1;
  return age;
}

/* -------------------------------------------------------------------------- */
/* What the answers add up to                                                  */
/* -------------------------------------------------------------------------- */

export type SetupSex = 'male' | 'female';

/** Everything asked, in the units the database keeps. */
export interface SetupAnswers {
  weightKg: number;
  heightCm: number;
  ageYears: number;
  sex: SetupSex;
  activityLevel: ActivityLevel;
  goal: Goal;
}

export interface SetupTargets {
  calories: number;
  proteinG: number;
}

/**
 * The daily target these answers produce — the same arithmetic the nutrition screen does, from
 * the same shared functions, so the figure shown at the end of setup is the one that screen
 * opens on.
 *
 * Null rather than a throw for anything the formulas reject. Every value here comes off a ruler
 * with sane ends, so it should not happen; a setup that crashes on its last screen because it
 * did is not an acceptable way of finding out.
 */
export function setupTargets(answers: SetupAnswers): SetupTargets | null {
  const { weightKg, heightCm, ageYears, sex, activityLevel, goal } = answers;
  if (!(weightKg > 0 && weightKg < 500) || !(heightCm > 50 && heightCm < 260) || ageYears < 0) {
    return null;
  }
  const bmrKcal = computeBmr({ weightKg, heightCm, ageYears, sex });
  const target = calorieTarget(computeTdee(bmrKcal, activityLevel), goal, { bmrKcal });
  if (!(target.calories > 0)) return null;
  return {
    calories: target.calories,
    proteinG: macroSplit(target.calories, weightKg, goal).proteinG,
  };
}

/**
 * Is the weight given here news to the weigh-in history?
 *
 * It is on a new account. It is not when the account already has history — signing in on a new
 * phone asks the questions again, since the profile does not travel, and the ruler opens on the
 * last weigh-in. Leaving it there must not add a manual reading to a chart of scale readings.
 * The ruler opens on that weigh-in to a tenth of a kilo, so "left alone" is a difference of
 * less than that — anything more was dragged or typed, and is a reading in its own right.
 */
export function isNewWeight(latestKg: number | null, answeredKg: number): boolean {
  if (latestKg === null) return true;
  return Math.abs(latestKg - answeredKg) >= 0.05;
}
