/**
 * What was typed into a set's number field, and what it means.
 *
 * The numbers on a set are typed on the phone's own numeric keyboard, into a field that sits
 * directly above it. This is the part between the keys and the database: a keyboard hands over a
 * string, and a string is not a weight until something has decided what "12,5", "7." and "" mean.
 *
 * A system keyboard is less strict than a pad of our own keys was. Which decimal separator it
 * offers depends on the phone's language, some layouts let a second one through, and a paste can
 * put anything at all in the field. So this reads generously and never throws: whatever arrives,
 * the answer is a number or it is nothing.
 */

export interface EntryOptions {
  /** Whether a fraction is allowed at all — reps are whole, weights are not. */
  decimals?: boolean;
  /** How many digits after the point. Two, for the quarter-kilo plates that exist. */
  maxDecimals?: number;
}

/**
 * The number a typed string stands for, or null when it stands for nothing.
 *
 * Null is "leave it empty", not "zero": a cleared field is a set with no weight recorded, which is
 * a different thing from a set lifted with an empty bar.
 *
 * Extra digits are cut off rather than rounded. Someone who types 13.756 into a field that holds
 * two decimals meant 13.75 and one stray key, not 13.76 — rounding would save a number that never
 * appeared on the screen.
 */
export function parseEntry(text: string, options: EntryOptions = {}): number | null {
  const { decimals = true, maxDecimals = 2 } = options;

  // A comma is a decimal point on any keyboard set to a language that writes it that way.
  const cleaned = text.replace(/,/g, '.').replace(/[^0-9.]/g, '');

  const [whole = '', ...rest] = cleaned.split('.');
  // Everything after the first point is the fraction; a second point is a slip of the thumb.
  const fraction = decimals ? rest.join('').slice(0, maxDecimals) : '';

  if (whole === '' && fraction === '') return null;

  const value = Number(`${whole === '' ? '0' : whole}${fraction === '' ? '' : `.${fraction}`}`);
  return Number.isFinite(value) ? value : null;
}

/** How a recorded value is written into the field when it opens. */
export function entryText(value: number | null): string {
  return value === null ? '' : String(value);
}

/**
 * The longest thing worth letting into the field.
 *
 * Four whole digits is heavier than anything anyone lifts and longer than any rep count; with a
 * fraction that is four, a point and two more. A field that stops accepting keys is clearer than
 * one that takes them and then saves something else.
 */
export function entryMaxLength({ decimals = true, maxDecimals = 2 }: EntryOptions = {}): number {
  return decimals ? 4 + 1 + maxDecimals : 4;
}
