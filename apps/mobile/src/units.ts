/**
 * Display-unit conversion.
 *
 * The database is metric, always — kg, cm, m — regardless of what the user has selected. Only
 * the edge of the UI converts. That is the whole design: if rows were stored in whatever unit
 * was on screen when they were written, a history containing both kg and lb rows could not be
 * summed, and the volume totals and the weight trend would both quietly become meaningless.
 *
 * Everything here is a pure function so the round-trip behaviour is testable, which matters
 * more than it looks: display values are rounded, so converting out and back is lossy, and a
 * screen that writes back on every blur would let a user's bodyweight drift by a gram each
 * time they opened the tab. See `roundTripsCleanly` and the note on `displayWeightToKg`.
 */

export type UnitSystem = 'metric' | 'imperial';

export const UNIT_SYSTEMS: readonly UnitSystem[] = ['metric', 'imperial'] as const;

/** What an unset preference means. Metric, because the app's first users are Israeli. */
export const DEFAULT_UNIT_SYSTEM: UnitSystem = 'metric';

/** Exact by definition: one pound is 0.45359237 kg. */
const KG_PER_LB = 0.45359237;
const CM_PER_IN = 2.54;
const M_PER_YD = 0.9144;

/** A stored value that is null stays null — "not measured" is not zero. */
type Maybe = number | null | undefined;

export function parseUnitSystem(raw: string | null | undefined): UnitSystem {
  return raw === 'imperial' ? 'imperial' : DEFAULT_UNIT_SYSTEM;
}

/* -------------------------------------------------------------------------- */
/* Rounding                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * One decimal everywhere.
 *
 * Enough to express the half-kilo and half-pound increments that plates actually come in, and
 * few enough digits that a weight reads at a glance mid-set. Two decimals would show 220.46 lb
 * for a round 100 kg, which looks like a measurement error rather than a conversion.
 */
function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

/* -------------------------------------------------------------------------- */
/* Weight                                                                      */
/* -------------------------------------------------------------------------- */

export function kgToDisplay(kg: number, system: UnitSystem): number {
  return round1(system === 'imperial' ? kg / KG_PER_LB : kg);
}

/**
 * Convert a value the user typed back to kilograms for storage.
 *
 * Deliberately NOT rounded: the display side already rounded, and rounding again here would
 * compound the error on every edit. The stored value is the most faithful kilogram figure the
 * typed number can produce.
 */
export function displayWeightToKg(value: number, system: UnitSystem): number {
  return system === 'imperial' ? value * KG_PER_LB : value;
}

/** Translation key suffix for the active weight unit — screens call t(`common.${...}`). */
export function weightUnitKey(system: UnitSystem): 'kg' | 'lb' {
  return system === 'imperial' ? 'lb' : 'kg';
}

/* -------------------------------------------------------------------------- */
/* Height                                                                      */
/* -------------------------------------------------------------------------- */

export function cmToDisplay(cm: number, system: UnitSystem): number {
  return round1(system === 'imperial' ? cm / CM_PER_IN : cm);
}

export function displayHeightToCm(value: number, system: UnitSystem): number {
  return system === 'imperial' ? value * CM_PER_IN : value;
}

export function heightUnitKey(system: UnitSystem): 'cm' | 'inch' {
  return system === 'imperial' ? 'inch' : 'cm';
}

/**
 * Height as a person would say it: `180` or `5'11"`.
 *
 * Read-only. The editable field stays a single number (inches), because a two-box feet/inches
 * input is a lot of interface for a value entered once and then never touched again.
 */
export function formatHeight(cm: Maybe, system: UnitSystem): string | null {
  if (cm === null || cm === undefined) return null;
  if (system !== 'imperial') return String(Math.round(cm));

  const totalInches = Math.round(cm / CM_PER_IN);
  const feet = Math.floor(totalInches / 12);
  const inches = totalInches % 12;
  return `${feet}'${inches}"`;
}

/* -------------------------------------------------------------------------- */
/* Distance                                                                    */
/* -------------------------------------------------------------------------- */

export function metresToDisplay(metres: number, system: UnitSystem): number {
  return round1(system === 'imperial' ? metres / M_PER_YD : metres);
}

export function displayDistanceToMetres(value: number, system: UnitSystem): number {
  return system === 'imperial' ? value * M_PER_YD : value;
}

export function distanceUnitKey(system: UnitSystem): 'meters' | 'yards' {
  return system === 'imperial' ? 'yards' : 'meters';
}

/* -------------------------------------------------------------------------- */
/* Formatting                                                                  */
/* -------------------------------------------------------------------------- */

/** A weight for display, without a unit label — the caller appends the translated one. */
export function formatWeight(kg: Maybe, system: UnitSystem): string | null {
  if (kg === null || kg === undefined) return null;
  return String(kgToDisplay(kg, system));
}

/**
 * A large aggregate such as session volume, grouped with thousands separators.
 *
 * Rounded to whole units: nobody needs a tenth of a kilo out of a 12,480 kg session, and the
 * decimal makes the number harder to scan.
 */
export function formatVolume(kg: Maybe, system: UnitSystem): string | null {
  if (kg === null || kg === undefined) return null;
  const display = system === 'imperial' ? kg / KG_PER_LB : kg;
  return Math.round(display).toLocaleString();
}

/**
 * Whether a typed display value differs from what a stored value renders as.
 *
 * Input components call this before writing on blur. Because display values are rounded, a
 * field the user never touched converts back to a slightly different kilogram figure — and
 * writing that back every time a screen is opened is exactly how a stored bodyweight drifts
 * over months. Comparing in display space instead means an untouched field never writes.
 */
export function isEditedWeight(storedKg: Maybe, typed: number | null, system: UnitSystem): boolean {
  const rendered = storedKg === null || storedKg === undefined ? null : kgToDisplay(storedKg, system);
  return typed !== rendered;
}
