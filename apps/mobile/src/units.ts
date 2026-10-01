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
 * One decimal for anything you lift.
 *
 * Enough for the half-kilo and half-pound increments plates actually come in, and few enough
 * digits that a weight reads at a glance mid-set. Two decimals would render a round 100 kg as
 * 220.46 lb, which looks like a measurement error rather than a conversion.
 */
function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

/**
 * Two decimals for bodyweight, which is a different kind of number.
 *
 * A barbell is loaded in half-kilo steps, so hundredths there are noise. A body is measured,
 * and the scale this app reads reports hundredths — rounding 74.18 to 74.2 throws away
 * precision the device actually supplied. It also matters more: a cut moves roughly 0.5 kg a
 * week, so a tenth is a meaningful share of a week's progress in a way it never is on a bar.
 */
function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/* -------------------------------------------------------------------------- */
/* Weight                                                                      */
/* -------------------------------------------------------------------------- */

export function kgToDisplay(kg: number, unit: UnitPreference): number {
  /*
   * Kilograms are shown exactly as they were entered, to the hundredth.
   *
   * They used to be rounded to a tenth, on the reasoning that plates come in half-kilo steps —
   * true of the plates, false of the bar: micro plates, a loaded dumbbell and the fixed weights
   * on a machine all land on quarters, and someone who typed 13.75 was shown 13.8 and told,
   * wrongly, that the app had not kept what they wrote. It had; only the display rounded.
   *
   * Pounds stay at a tenth. They are a conversion rather than a number anybody typed, and 100 kg
   * reading as 220.46 lb looks like a measurement error instead of a unit change.
   */
  return unit === 'imperial' ? round1(kg / KG_PER_LB) : round2(kg);
}

/**
 * A bodyweight for display, keeping the hundredths a scale reports.
 *
 * Separate from `kgToDisplay` rather than a flag on it, so that every call site declares which
 * kind of weight it is showing. A shared function with a default would quietly give set rows
 * two decimals the first time someone forgot to pass it.
 */
export function bodyKgToDisplay(kg: number, unit: UnitPreference): number {
  return round2(unit === 'imperial' ? kg / KG_PER_LB : kg);
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

/** A lifted weight for display, without a unit label — the caller appends the translated one. */
export function formatWeight(kg: Maybe, unit: UnitPreference): string | null {
  if (kg === null || kg === undefined) return null;
  return String(kgToDisplay(kg, unit));
}

/**
 * A bodyweight for display, to hundredths.
 *
 * Trailing zeros are trimmed by `String`, so a scale reading of exactly 74 shows as "74" rather
 * than "74.00" — padding it would imply a precision the number does not claim on its own.
 */
export function formatBodyWeight(kg: Maybe, unit: UnitPreference): string | null {
  if (kg === null || kg === undefined) return null;
  return String(bodyKgToDisplay(kg, unit));
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
  kind: 'lift' | 'body' = 'lift',
): boolean {
  const toDisplay = kind === 'body' ? bodyKgToDisplay : kgToDisplay;
  const rendered =
    storedKg === null || storedKg === undefined ? null : toDisplay(storedKg, unit);
  return typed !== rendered;
}
