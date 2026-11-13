/**
 * What goes on the picture of a workout.
 *
 * `shareText.ts` is the workout as a message: lines someone reads in a chat. This is the same
 * workout as a card — an image for a story or a group — read at a glance.
 *
 * Reworked at the owner's request (2026-11-13): the card says **where the workout progressed and
 * where it did not**, set against the previous workout of the same kind; it carries **no
 * kilograms**; and it carries the person's own **satisfaction with the workout, 1 to 10**, beside
 * the same number for that previous workout when there is one.
 *
 * ## Against what
 *
 * The previous finished workout with the same name (`compareWithPreviousSameWorkout`), never
 * simply the last time each exercise was done: the same lift in another gym is another machine,
 * and the card would credit or blame a change of address. Each exercise is read set by set with
 * the app's one rule (`setBySet.ts`): up is progressed; the same, down or a mix of both is not;
 * one that was not in the previous workout is new.
 *
 * With no previous workout of the kind — the first one, or one with no name — there is nothing to
 * say progressed, and the card lists what was done, by how many sets.
 *
 * ## No kilograms
 *
 * Asked for in so many words. The total lifted is gone from the numbers across the top, and no
 * row shows a weight: an exercise is told by its verdict, or by its number of sets.
 *
 * The picture itself is `components/workout/WorkoutShareCard.tsx`. This is the part that can
 * be tested without a screen.
 */

import {
  addTallies,
  improved,
  NO_TALLY,
  worse,
  type Tally,
  type Verdict,
} from '../progress/setBySet.js';

export interface ShareCardExercise {
  /** The catalogue key, which the comparison is keyed by. */
  key: string;
  name: string;
  /** Working sets done. An exercise with none is left off the card. */
  sets: number;
}

/** This workout against the previous one of the same kind. */
export interface ShareCardComparison {
  /** When the previous one was, already formatted: "5.11". */
  when: string;
  /** How satisfied with the previous one, 1 to 10, if it was said. */
  satisfaction: number | null;
  changes: readonly { exerciseKey: string; verdict: Verdict; tally: Tally }[];
}

export interface ShareCardInput {
  /** The workout's name, or what to call one that has none. */
  title: string;
  /** When, already formatted for the language: "Thursday, 8 October". */
  when: string;
  minutes: number | null;
  /** Working sets done. */
  sets: number;
  /** How satisfied with this workout, 1 to 10; null while not said. */
  satisfaction: number | null;
  exercises: readonly ShareCardExercise[];
  /** Null when there is no previous workout of the same kind. */
  comparison: ShareCardComparison | null;
}

export interface ShareCardLabels {
  /** The word under the number of minutes. */
  minutes: string;
  /** The word under the number of sets. */
  sets: string;
  /** The word under the satisfaction number. */
  satisfaction: string;
  /** "8/10". */
  satisfactionValue: (value: number) => string;
  /** "3 sets" — what a lift is told by when there is nothing to compare it with. */
  setCount: (count: number) => string;
  /** "and 3 more" — for the lifts past the cut-off. */
  more: (count: number) => string;
  /** What each verdict is called on a row. */
  verdict: Record<Verdict, string>;
  progressedTitle: string;
  notProgressedTitle: string;
  newTitle: string;
  /** The heading of the plain list, when there is nothing to compare with. */
  exercisesTitle: string;
  /** "Against the last one (5.11): 6 sets better · 3 the same · 1 worse". */
  comparedWith: (args: { when: string; improved: number; same: number; worse: number }) => string;
  /** "Satisfaction 8 · last time 6". */
  satisfactionVs: (now: number, then: number) => string;
}

export interface ShareCardStat {
  key: 'minutes' | 'sets' | 'satisfaction';
  value: string;
  label: string;
}

export interface ShareCardRow {
  name: string;
  /** The verdict against the previous workout, or how many sets it was. */
  detail: string;
  /** For colour: how it went. `null` on the plain list. */
  verdict: Verdict | null;
}

export type ShareCardGroupKey = 'progressed' | 'notProgressed' | 'new' | 'all';

export interface ShareCardGroup {
  key: ShareCardGroupKey;
  title: string;
  rows: ShareCardRow[];
}

export interface ShareCardModel {
  title: string;
  when: string;
  stats: ShareCardStat[];
  /** The whole workout against the previous one of its kind, or null without one. */
  compareLine: string | null;
  /** This satisfaction against the previous one, when both were said. */
  satisfactionLine: string | null;
  /** Never empty groups; in the order progressed, not progressed, new — or the one plain list. */
  groups: ShareCardGroup[];
  /** "and 3 more", or null when every lift fitted. */
  more: string | null;
}

/**
 * How many lifts are listed before the rest become a count.
 *
 * Six: a card is a fixed shape, and past six rows it is either taller than a phone screen or set
 * in type too small to read in a story. Shared across the groups, in their order, so the lifts
 * that progressed are the last to be cut.
 */
export const CARD_EXERCISE_LIMIT = 6;

const groupOf = (verdict: Verdict): Exclude<ShareCardGroupKey, 'all'> =>
  verdict === 'up' ? 'progressed' : verdict === 'new' ? 'new' : 'notProgressed';

export function shareCardModel(input: ShareCardInput, labels: ShareCardLabels): ShareCardModel {
  // A number that does not exist is left out rather than shown as zero.
  const stats: ShareCardStat[] = [];
  if (input.minutes !== null && input.minutes > 0) {
    stats.push({ key: 'minutes', value: String(input.minutes), label: labels.minutes });
  }
  if (input.sets > 0) stats.push({ key: 'sets', value: String(input.sets), label: labels.sets });
  if (input.satisfaction !== null) {
    stats.push({
      key: 'satisfaction',
      value: labels.satisfactionValue(input.satisfaction),
      label: labels.satisfaction,
    });
  }

  // An exercise with nothing done in it is not something that was done.
  const done = input.exercises.filter((exercise) => exercise.sets > 0);
  const comparison = input.comparison;

  let groups: ShareCardGroup[];
  let compareLine: string | null = null;
  let satisfactionLine: string | null = null;
  let total: number;

  if (comparison) {
    const verdicts = new Map(comparison.changes.map((change) => [change.exerciseKey, change.verdict]));
    const buckets: Record<Exclude<ShareCardGroupKey, 'all'>, ShareCardRow[]> = {
      progressed: [],
      notProgressed: [],
      new: [],
    };
    for (const exercise of done) {
      const verdict = verdicts.get(exercise.key) ?? 'new';
      buckets[groupOf(verdict)].push({
        name: exercise.name,
        detail: labels.verdict[verdict],
        verdict,
      });
    }
    total = done.length;
    groups = (
      [
        ['progressed', labels.progressedTitle],
        ['notProgressed', labels.notProgressedTitle],
        ['new', labels.newTitle],
      ] as const
    ).map(([key, title]) => ({ key, title, rows: buckets[key] }));

    // Every exercise that was in both workouts; a new one has nothing to be counted against.
    const tally = comparison.changes.reduce(
      (sum, c) => (c.verdict === 'new' ? sum : addTallies(sum, c.tally)),
      { ...NO_TALLY },
    );
    compareLine = labels.comparedWith({
      when: comparison.when,
      improved: improved(tally),
      same: tally.same,
      worse: worse(tally),
    });
    if (input.satisfaction !== null && comparison.satisfaction !== null) {
      satisfactionLine = labels.satisfactionVs(input.satisfaction, comparison.satisfaction);
    }
  } else {
    total = done.length;
    groups = [
      {
        key: 'all',
        title: labels.exercisesTitle,
        rows: done.map((exercise) => ({
          name: exercise.name,
          detail: labels.setCount(exercise.sets),
          verdict: null,
        })),
      },
    ];
  }

  // One budget of rows across the groups, in their order.
  let room = CARD_EXERCISE_LIMIT;
  const shown = groups
    .map((group) => {
      const rows = group.rows.slice(0, Math.max(0, room));
      room -= rows.length;
      return { ...group, rows };
    })
    .filter((group) => group.rows.length > 0);
  const listed = shown.reduce((sum, group) => sum + group.rows.length, 0);
  const left = total - listed;

  return {
    title: input.title,
    when: input.when,
    stats,
    compareLine,
    satisfactionLine,
    groups: shown,
    more: left > 0 ? labels.more(left) : null,
  };
}
