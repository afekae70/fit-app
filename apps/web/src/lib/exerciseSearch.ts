import { EXERCISE_SEED } from '@fit/shared/catalog';

/** The catalogue's exercises matching a search, in either language, the closest first. */
export function searchExercises(query: string) {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  return EXERCISE_SEED.filter((seed) => {
    const names = `${seed.nameHe} ${seed.nameEn}`.toLowerCase();
    return words.every((word) => names.includes(word));
  })
    .sort((a, b) => {
      const first = words[0]!;
      const starts = (seed: (typeof EXERCISE_SEED)[number]) =>
        seed.nameHe.startsWith(first) || seed.nameEn.toLowerCase().startsWith(first) ? 0 : 1;
      return starts(a) - starts(b);
    })
    .slice(0, 10);
}
