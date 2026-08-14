/**
 * Display-unit conversion.
 *
 * The contract itself (`UnitPreference`, the allowed values, what an unset one means) lives in
 * `@fit/shared` because the server enforces it as a CHECK constraint. This module is the app
 * side: turning stored metric values into what the user reads, and back again.
 *
 * Everything here is pure so the round-trip behaviour is testable, which matters more than it
 * looks. Display values are rounded, so converting out and back is lossy — a screen that wrote
 * back on every blur would let a stored bodyweight drift by grams each time the tab was opened.
 * See `isEditedWeight`, which exists solely to stop that.
 */

import { type UnitPreference } from '@fit/shared';

/** Exact by definition: one pound is 0.45359237 kg. */
const KG_PER_LB = 0.45359237;
const CM_PER_IN = 2.54;
const M_PER_YD = 0.9144;

/** A stored value that is null stays null — "not measured" is not zero. */
type Maybe = number | null | undefined;

/**
 * One decimal everywhere.
 *
 * Enough for the half-kilo and half-pound increments plates actually come in, and few enough
 * digits that a weight reads at a glance mid-set. Two decimals would render a round 100 kg as
 * 220.46 lb, which looks like a measurement error rather than a conversion.
 */
function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

/* -------------------------------------------------------------------------- */
/* Weight                                                                      */
/* -------------------------------------------------------------------------- */

export function kgToDisplay(kg: number, unit: UnitPreference): number {
  return round1(unit === 'imperial' ? kg / KG_PER_LB : kg);
}

/**
 * Convert a typed value back to kilograms for storage.
 *
 * Deliberately NOT rounded: the display side already rounded, and rounding again here would
 * compound the error on every edit.
 */
export function displayWeightToKg(value: number, unit: UnitPreference): number {
  return unit === 'imperial' ? value * KG_PER_LB : value;
}

/** Translation key suffix for the active weight unit — screens call t(`common.${...}`). */
export function weightUnitKey(unit: UnitPreference): 'kg' | 'lb' {
  return unit === 'imperial' ? 'lb' : 'kg';
}

/* -------------------------------------------------------------------------- */
/* Height                                                                      */
/* -------------------------------------------------------------------------- */

export function cmToDisplay(cm: number, unit: UnitPreference): number {
  return round1(unit === 'imperial' ? cm / CM_PER_IN : cm);
}

export function displayHeightToCm(value: number, unit: UnitPreference): number {
  return unit === 'imperial' ? value * CM_PER_IN : value;
}

export function heightUnitKey(unit: UnitPreference): 'cm' | 'inch' {
  return unit === 'imperial' ? 'inch' : 'cm';
}

/**
 * Height as a person would say it: `180` or `5'11"`.
 *
 * Read-only. The editable field stays a single number (inches), because a two-box feet/inches
 * input is a lot of interface for a value entered once and never touched again.
 */
export function formatHeight(cm: Maybe, unit: UnitPreference): string | null {
  if (cm === null || cm === undefined) return null;
  if (unit !== 'imperial') return String(Math.round(cm));

  const totalInches = Math.round(cm / CM_PER_IN);
  const feet = Math.floor(totalInches / 12);
  const inches = totalInches % 12;
  return `${feet}'${inches}"`;
}

/* -------------------------------------------------------------------------- */
/* Distance                                                                    */
/* -------------------------------------------------------------------------- */

export function metresToDisplay(metres: number, unit: UnitPreference): number {
  return round1(unit === 'imperial' ? metres / M_PER_YD : metres);
}

export function displayDistanceToMetres(value: number, unit: UnitPreference): number {
  return unit === 'imperial' ? value * M_PER_YD : value;
}

export function distanceUnitKey(unit: UnitPreference): 'meters' | 'yards' {
  return unit === 'imperial' ? 'yards' : 'meters';
}

/* -------------------------------------------------------------------------- */
/* Formatting                                                                  */
/* -------------------------------------------------------------------------- */

/** A weight for display, without a unit label — the caller appends the translated one. */
export function formatWeight(kg: Maybe, unit: UnitPreference): string | null {
  if (kg === null || kg === undefined) return null;
  return String(kgToDisplay(kg, unit));
}

/**
 * A large aggregate such as session volume, grouped with thousands separators.
 *
 * Rounded to whole units: nobody needs a tenth of a kilo out of a 12,480 kg session, and the
 * decimal makes the number harder to scan.
 */
export function formatVolume(kg: Maybe, unit: UnitPreference): string | null {
  if (kg === null || kg === undefined) return null;
  const display = unit === 'imperial' ? kg / KG_PER_LB : kg;
  return Math.round(display).toLocaleString();
}

/**
 * Whether a typed display value differs from what a stored value renders as.
 *
 * Input components call this before writing on blur. Because display values are rounded, a
 * field the user never touched converts back to a slightly different kilogram figure — and
 * writing that back every time a screen opens is how a stored bodyweight drifts over months.
 * Comparing in display space instead means an untouched field never writes.
 */
export function isEditedWeight(
  storedKg: Maybe,
  typed: number | null,
  unit: UnitPreference,
): boolean {
  const rendered =
    storedKg === null || storedKg === undefined ? null : kgToDisplay(storedKg, unit);
  return typed !== rendered;
}
