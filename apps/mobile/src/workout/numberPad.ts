/**
 * The app's own number pad, as a string and the keys pressed into it.
 *
 * The system keyboard was the wrong tool for a set row twice over: on Android it swallowed the
 * first keystroke after the keys slid up — every weight had to be typed twice — and it covered
 * the very row being filled in. Both are the keyboard's own behaviour, not something a screen
 * can reliably talk it out of.
 *
 * So the app brings its own: six big keys per row, in a sheet that says which set it is editing,
 * with the number shown at a size that is readable at arm's length. Nothing can be typed that is
 * not a number, nothing is swallowed, and the row underneath is never the thing being covered —
 * the sheet names what it is editing instead.
 *
 * The logic lives here, apart from the view, because what a keypress means is exactly the part
 * worth testing: a second decimal point, a leading zero, a backspace on an empty string.
 */

export type PadKey = '0' | '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '.' | 'back' | 'clear';

export interface PadOptions {
  /** Whether a decimal point may be entered at all — reps are whole, weights are not. */
  decimals?: boolean;
  /** How many digits after the point. Two, for the quarter-kilo plates that exist. */
  maxDecimals?: number;
}

/**
 * The text after a key is pressed.
 *
 * Refuses rather than corrects: a key that would make the number unreadable simply does nothing,
 * which is what every calculator does and what nobody has to learn.
 */
export function pressKey(current: string, key: PadKey, options: PadOptions = {}): string {
  const { decimals = true, maxDecimals = 2 } = options;

  if (key === 'clear') return '';
  if (key === 'back') return current.slice(0, -1);

  if (key === '.') {
    if (!decimals || current.includes('.')) return current;
    return current === '' ? '0.' : `${current}.`;
  }

  // A second leading zero says nothing — "007" is a number nobody writes on a bar.
  if (current === '0') return key === '0' ? current : key;

  const [whole, fraction] = current.split('.');
  if (fraction !== undefined && fraction.length >= maxDecimals) return current;
  // Four digits is heavier than anything anyone lifts and longer than any rep count.
  if (fraction === undefined && (whole?.length ?? 0) >= 4) return current;

  return current + key;
}

/** What the text means, or null while it means nothing yet — "", "0." and "." all mean nothing. */
export function padValue(text: string): number | null {
  if (text === '' || text === '.') return null;
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
}

/** How a committed value opens in the pad, so editing starts from what is already there. */
export function padText(value: number | null): string {
  return value === null ? '' : String(value);
}
