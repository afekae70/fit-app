/**
 * What goes on the picture of a workout.
 *
 * `shareText.ts` is the workout as a message: lines someone reads in a chat. This is the same
 * workout as a card — an image for a story or a group — read at a glance.
 *
 * The owner's brief for it (2026-11-13), in order: where the workout progressed and where it
 * stopped, "to know where to push"; clean and pretty, without a lot of words; the weights of last
 * time beside this time's, and how much each exercise really moved — as a percentage of the
 * weight, or in reps; the app's logo and its colours. And no total of kilograms across the top.
 *
 * ## Against what
 *
 * The previous finished workout with the same name (`compareWithPreviousSameWorkout`), never
 * simply the last time each exercise was done: the same lift in another gym is another machine,
 * and the card would credit or blame a change of address. Each exercise's verdict is the app's
 * set-by-set reading (`setBySet.ts`): up is progressed; down, the same or a mix of both is "to
 * push", the ones that went down first; one not in the previous workout is new.
 *
 * ## How much it moved
 *
 * Told by the exercise's best set — the heaviest, or with no weight the one with the most reps —
 * now against last time. The first of these that changed is the one shown:
 *
 *  1. the weight, as a percentage of last time's ("+6%");
 *  2. at the same weight, the reps ("+2 reps");
 *  3. with the best set unchanged, the number of sets ("+1 set") — a verdict of "up" can come from
 *     a set more, and the card must not then say nothing moved;
 *  4. otherwise nothing moved ("=").
 *
 * Signed numbers and sets are wrapped in a left-to-right isolate: inside Hebrew the bidi
 * algorithm is otherwise free to carry a "+" to the far side of its number, so "+6%" reads "6%+".
 *
 * The picture itself is `components/workout/WorkoutShareCard.tsx`. This is the part that can be
 * tested without a screen.
 */

import {
  topSet,
  WEIGHT_EPSILON,
  type SetPair,
  type Tally,
  type Verdict,
  type WorkingSet,
} from '../progress/setBySet.js';

const ISOLATE = String.fromCharCode(0x2066);
const END_ISOLATE = String.fromCharCode(0x2069);
const MINUS = String.fromCharCode(0x2212);

/** Left-to-right, whatever the language around it. */
export const ltr = (text: string) => `${ISOLATE}${text}${END_ISOLATE}`;

const signed = (n: number) => `${n < 0 ? MINUS : '+'}${Math.abs(n)}`;

export interface ShareCardExercise {
  /** The catalogue key, which the comparison is keyed by. */
  key: string;
  name: string;
  /** Working sets done, in order. An exercise with none is left off the card. */
  sets: readonly WorkingSet[];
}

/** One exercise against the same exercise in the previous workout of the kind. */
export interface ShareCardChange {
  exerciseKey: string;
  verdict: Verdict;
  tally: Tally;
  pairs: readonly SetPair[];
}

/** This workout against the previous one of the same kind. */
export interface ShareCardComparison {
  /** When the previous one was, already formatted: "5.11". */
  when: string;
  /** How satisfied with the previous one, 1 to 10, if it was said. */
  satisfaction: number | null;
  changes: readonly ShareCardChange[];
}

export interface ShareCardInput {
  /** The workout's name, or what to call one that has none. */
  title: string;
  /** When, already formatted for the language: "Thursday, 13.11". */
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
  minutes: string;
  sets: string;
  satisfaction: string;
  /** A set, compactly, in the reader's units: "85×8", "12" for bodyweight; null for none. */
  formatSet: (set: WorkingSet) => string | null;
  /** "last 80×8". */
  previous: (set: string) => string;
  /** "same as last time". */
  sameAsBefore: string;
  /** "{{value}} reps", "{{value}} sets" — given the signed number. */
  reps: (signedValue: string) => string;
  setsChange: (signedValue: string) => string;
  /** "3 sets" — what a lift is told by when there is nothing to compare it with. */
  setCount: (count: number) => string;
  /** "from 6" — under the satisfaction, against the previous workout's. */
  satisfactionFrom: (then: number) => string;
  /** "vs the previous workout · 5.11". */
  comparedWith: (when: string) => string;
  progressedTitle: string;
  pushTitle: string;
  newTitle: string;
  /** The heading of the plain list, when there is nothing to compare with. */
  exercisesTitle: string;
}

export type Direction = 'up' | 'down' | 'same';

export interface ShareCardStat {
  key: 'minutes' | 'sets' | 'satisfaction';
  value: string;
  /** "/10", set smaller beside the value. */
  unit?: string;
  label: string;
  /** Which way the label points, when it is a comparison ("↑ from 6"). */
  direction?: Direction;
}

export interface ShareCardRow {
  name: string;
  /** "85×8 · last 80×8", "60×15 · same as last time", or "4 sets" on the plain list. */
  detail: string | null;
  /** "+6%", "+2 reps", "=" — or null where there is nothing to set it against. */
  change: string | null;
  /** For colour. Null on the plain list. */
  direction: Direction | 'new' | null;
}

export type ShareCardGroupKey = 'progressed' | 'push' | 'new' | 'all';

export interface ShareCardGroup {
  key: ShareCardGroupKey;
  title: string;
  rows: ShareCardRow[];
}

export interface ShareCardModel {
  title: string;
  when: string;
  stats: ShareCardStat[];
  /** Exercises that went up, stayed (or mixed) and went down; null without a comparison. */
  counts: { up: number; same: number; down: number } | null;
  /** "vs the previous workout · 5.11"; null without one. */
  comparedWith: string | null;
  /** Never empty groups, every exercise listed. */
  groups: ShareCardGroup[];
}

/** The set a row is told by: the heaviest, or without a weight the one with the most reps. */
export function bestSet(sets: readonly WorkingSet[]): WorkingSet | null {
  return (
    topSet(sets) ??
    sets.reduce<WorkingSet | null>(
      (best, set) => (set.reps !== null && (!best || set.reps > (best.reps ?? 0)) ? set : best),
      null,
    )
  );
}

/** How much one exercise moved, by its best set and then its number of sets. See the file comment. */
export function changeOf(
  now: readonly WorkingSet[],
  then: readonly WorkingSet[],
  labels: Pick<ShareCardLabels, 'reps' | 'setsChange'>,
): string {
  const a = bestSet(now);
  const b = bestSet(then);
  if (a && b) {
    const wa = a.weightKg ?? 0;
    const wb = b.weightKg ?? 0;
    if (wa > 0 && wb > 0 && Math.abs(wa - wb) > WEIGHT_EPSILON) {
      const raw = ((wa - wb) / wb) * 100;
      // Never "+0%" for a weight that did move: at least one per cent either way.
      const pct = Math.sign(raw) * Math.max(1, Math.round(Math.abs(raw)));
      return ltr(`${signed(pct)}%`);
    }
    const reps = (a.reps ?? 0) - (b.reps ?? 0);
    if ((wa > 0) === (wb > 0) && reps !== 0) return labels.reps(ltr(signed(reps)));
  }
  const sets = now.length - then.length;
  if (sets !== 0) return labels.setsChange(ltr(signed(sets)));
  return '=';
}

const directionOf = (verdict: Verdict): Direction | 'new' =>
  verdict === 'up' ? 'up' : verdict === 'down' ? 'down' : verdict === 'new' ? 'new' : 'same';

export function shareCardModel(input: ShareCardInput, labels: ShareCardLabels): ShareCardModel {
  const comparison = input.comparison;

  // A number that does not exist is left out rather than shown as zero.
  const stats: ShareCardStat[] = [];
  if (input.minutes !== null && input.minutes > 0) {
    stats.push({ key: 'minutes', value: String(input.minutes), label: labels.minutes });
  }
  if (input.sets > 0) stats.push({ key: 'sets', value: String(input.sets), label: labels.sets });
  if (input.satisfaction !== null) {
    const then = comparison?.satisfaction ?? null;
    const direction: Direction | undefined =
      then === null
        ? undefined
        : input.satisfaction > then
          ? 'up'
          : input.satisfaction < then
            ? 'down'
            : 'same';
    stats.push({
      key: 'satisfaction',
      value: String(input.satisfaction),
      unit: '/10',
      label: then === null ? labels.satisfaction : labels.satisfactionFrom(then),
      direction,
    });
  }

  // An exercise with nothing done in it is not something that was done.
  const done = input.exercises.filter((exercise) => exercise.sets.length > 0);
  const setText = (set: WorkingSet | null) => {
    const text = set ? labels.formatSet(set) : null;
    return text === null ? null : ltr(text);
  };

  if (!comparison) {
    return {
      title: input.title,
      when: input.when,
      stats,
      counts: null,
      comparedWith: null,
      groups:
        done.length === 0
          ? []
          : [
              {
                key: 'all',
                title: labels.exercisesTitle,
                rows: done.map((exercise) => ({
                  name: exercise.name,
                  detail: setText(bestSet(exercise.sets)) ?? labels.setCount(exercise.sets.length),
                  change: null,
                  direction: null,
                })),
              },
            ],
    };
  }

  const byKey = new Map(comparison.changes.map((change) => [change.exerciseKey, change]));
  const progressed: ShareCardRow[] = [];
  const down: ShareCardRow[] = [];
  const same: ShareCardRow[] = [];
  const fresh: ShareCardRow[] = [];

  for (const exercise of done) {
    const change = byKey.get(exercise.key);
    const verdict: Verdict = change?.verdict ?? 'new';
    const direction = directionOf(verdict);
    const nowText = setText(bestSet(exercise.sets));

    if (!change || verdict === 'new') {
      fresh.push({ name: exercise.name, detail: nowText, change: null, direction: 'new' });
      continue;
    }

    const then = change.pairs.flatMap((pair) => (pair.then ? [pair.then] : []));
    const moved = changeOf(exercise.sets, then, labels);
    const thenText = setText(bestSet(then));
    const detail =
      moved === '='
        ? [nowText, labels.sameAsBefore].filter(Boolean).join(' · ')
        : [nowText, thenText ? labels.previous(thenText) : null].filter(Boolean).join(' · ');
    const row: ShareCardRow = { name: exercise.name, detail: detail || null, change: moved, direction };

    if (direction === 'up') progressed.push(row);
    else if (direction === 'down') down.push(row);
    else same.push(row);
  }

  const groups: ShareCardGroup[] = [
    { key: 'progressed' as const, title: labels.progressedTitle, rows: progressed },
    // What to push next: what went down first, then what stood still.
    { key: 'push' as const, title: labels.pushTitle, rows: [...down, ...same] },
    { key: 'new' as const, title: labels.newTitle, rows: fresh },
  ].filter((group) => group.rows.length > 0);

  return {
    title: input.title,
    when: input.when,
    stats,
    counts: { up: progressed.length, same: same.length, down: down.length },
    comparedWith: labels.comparedWith(comparison.when),
    groups,
  };
}
