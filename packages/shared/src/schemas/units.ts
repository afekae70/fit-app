/**
 * Which units a person reads measurements in.
 *
 * A *display* preference and nothing more. Every stored measurement in this system is metric —
 * kilograms, centimetres, metres — on both sides of the wire, and conversion happens at the
 * edge of the UI. Storing rows in whatever unit happened to be on screen would make a history
 * that mixes kg and lb impossible to aggregate, so session volume and the weight trend would
 * both quietly stop meaning anything.
 *
 * Lives in shared because the server enforces it as a CHECK constraint on `profiles` and the
 * app has to offer exactly those values. `apps/api/src/db/schema.ts` keeps its own copy for
 * Drizzle, the same way it already does for ACTIVITY_LEVELS and GOALS; if that list and this
 * one drift, the app can write a value the database rejects on sync.
 */

export const UNIT_PREFERENCES = ['metric', 'imperial'] as const;

export type UnitPreference = (typeof UNIT_PREFERENCES)[number];

/** What an unset preference means — matches the server column's DEFAULT. */
export const DEFAULT_UNIT_PREFERENCE: UnitPreference = 'metric';

/**
 * Read a stored value into the union, falling back rather than throwing.
 *
 * The column is nullable locally (every profile row predates it) and free text, so this is the
 * one place that decides what an unrecognised value means.
 */
export function parseUnitPreference(raw: string | null | undefined): UnitPreference {
  return raw === 'imperial' ? 'imperial' : DEFAULT_UNIT_PREFERENCE;
}
