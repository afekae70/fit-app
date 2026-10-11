/**
 * What goes on the picture of a workout.
 *
 * `shareText.ts` is the workout as a message: lines someone reads in a chat. This is the same
 * workout as a card — an image for a story or a group — and a card has less room and is read
 * at a glance, so it says less: three numbers across the top, and the best set of the first
 * few lifts.
 *
 * The picture itself is `components/workout/WorkoutShareCard.tsx`. This is the part that can
 * be tested without a screen: which numbers appear, in what order, and where the list stops.
 */

import type { ShareExercise } from './shareText.js';

export interface ShareCardInput {
  /** The workout's name, or what to call one that has none. */
  title: string;
  /** When, already formatted for the language: "Thursday, 8 October". */
  when: string;
  minutes: number | null;
  /** Working sets done. */
  sets: number;
  /** The total lifted as a number in the reader's units — "12,400" — or null when unweighted. */
  volume: string | null;
  exercises: readonly ShareExercise[];
}

export interface ShareCardLabels {
  /** The word under the number of minutes. */
  minutes: string;
  /** The word under the number of sets. */
  sets: string;
  /** The unit under the volume: "kg". */
  volumeUnit: string;
  /** "3 sets" — what a lift with no best set is told by. */
  setCount: (count: number) => string;
  /** "and 3 more" — for the lifts past the cut-off. */
  more: (count: number) => string;
}

export interface ShareCardStat {
  key: 'minutes' | 'sets' | 'volume';
  value: string;
  label: string;
}

export interface ShareCardRow {
  name: string;
  /** The lift's best set, or failing that how many sets it was. */
  detail: string;
}

export interface ShareCardModel {
  title: string;
  when: string;
  stats: ShareCardStat[];
  rows: ShareCardRow[];
  /** "and 3 more", or null when every lift fitted. */
  more: string | null;
}

/**
 * How many lifts are listed before the rest become a count.
 *
 * Six, where the message lists eight: a card is a fixed shape, and past six rows it is either
 * taller than a phone screen or set in type too small to read in a story.
 */
export const CARD_EXERCISE_LIMIT = 6;

export function shareCardModel(input: ShareCardInput, labels: ShareCardLabels): ShareCardModel {
  // In the order they are read: how long, how much work, how heavy. A number that does not
  // exist is left out rather than shown as zero — a walk has no volume, and "0 kg" on a
  // picture of it would be the app saying nothing was lifted, which nobody asked.
  const stats: ShareCardStat[] = [];
  if (input.minutes !== null && input.minutes > 0) {
    stats.push({ key: 'minutes', value: String(input.minutes), label: labels.minutes });
  }
  if (input.sets > 0) stats.push({ key: 'sets', value: String(input.sets), label: labels.sets });
  if (input.volume) stats.push({ key: 'volume', value: input.volume, label: labels.volumeUnit });

  // An exercise with nothing done in it is not something that was done — the message's rule.
  const done = input.exercises.filter((exercise) => exercise.sets > 0);
  const listed = done.slice(0, CARD_EXERCISE_LIMIT);
  const left = done.length - listed.length;

  return {
    title: input.title,
    when: input.when,
    stats,
    rows: listed.map((exercise) => ({
      name: exercise.name,
      detail: exercise.best ?? labels.setCount(exercise.sets),
    })),
    more: left > 0 ? labels.more(left) : null,
  };
}
