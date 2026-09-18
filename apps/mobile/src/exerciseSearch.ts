/**
 * Whether an exercise answers a search.
 *
 * Word by word, not as one phrase: people type what they would say in the gym — "יד אחורית יד יד",
 * "פשיטת מרפקים כבל" — in any order, and a phrase match finds nothing for either. Every word has to
 * appear somewhere, in either language's name or in the muscle the exercise trains, so the muscle
 * a lifter thinks in ("יד אחורית") finds exercises named after the movement ("פשיטת מרפקים").
 *
 * A repeated word only needs to appear once: "יד יד" in a query is matched by "יד יד" in a name,
 * and by "יד אחורית" too — close enough that requiring two separate hits would only hide results.
 */

export interface SearchableExercise {
  nameEn: string;
  nameHe: string;
}

export function matchesExerciseSearch(
  exercise: SearchableExercise,
  query: string,
  muscleLabels: readonly string[] = [],
): boolean {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const haystack = [exercise.nameEn, exercise.nameHe, ...muscleLabels].join(' ').toLowerCase();
  return words.every((word) => haystack.includes(word));
}
