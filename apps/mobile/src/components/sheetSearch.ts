/**
 * Narrowing a sheet's choices by what has been typed.
 *
 * Kept apart from the sheet so it can be tested without rendering one, and so the rule for what
 * counts as a match lives in one place.
 */

export interface Searchable {
  label: string;
}

/**
 * Lower-cased, trimmed, with Hebrew vowel points and punctuation-like marks removed.
 *
 * Points matter because a name pasted from elsewhere can carry them while the one typed never
 * does, and "בֶּטֶן" not finding "בטן" would read as the search being broken. The geresh and
 * gershayim go for the same reason: "ק״ג" and "קג" are the same word to the person typing.
 */
export function normaliseForSearch(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/[֑-ׇ]/g, '')
    .replace(/[׳״'"`]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * The choices whose label contains every word typed, each paired with its position in the
 * original list.
 *
 * The position travels with the choice because the sheet answers with an index into the list
 * the caller passed, not into the filtered one — returning the filtered index would pick the
 * wrong workout whenever a search was active.
 *
 * Every word rather than the whole phrase, so "רגליים יום" finds "יום רגליים". An empty query
 * matches everything.
 */
export function filterChoices<T extends Searchable>(
  choices: readonly T[],
  query: string,
): { choice: T; index: number }[] {
  const words = normaliseForSearch(query).split(' ').filter(Boolean);
  return choices
    .map((choice, index) => ({ choice, index }))
    .filter(({ choice }) => {
      if (words.length === 0) return true;
      const label = normaliseForSearch(choice.label);
      return words.every((word) => label.includes(word));
    });
}
