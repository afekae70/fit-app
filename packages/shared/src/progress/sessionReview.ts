/**
 * One finished workout's summary: for each of its exercises, whether it got better than the last
 * time that exercise was done, stayed the same, or went down.
 *
 * Asked for by the owner (2026-11-08): a summary on every finished workout's card of "what I
 * improved in, what not, and what stayed the same" — and for the coach, "to see how the trainee
 * improved from one workout to the next".
 *
 * "The last time" is the last session of that exercise before this one, whichever workout it was
 * in: a bench press done on push day and again on chest day is one line. Opening an old workout
 * compares it with the one before *it*, not with the latest.
 *
 * Set by set with the app's one rule (`setBySet.ts`): heavier, then more reps at the same weight;
 * a set more counts as better and a set fewer as worse. More sets better than worse is improved,
 * the reverse declined, otherwise the same. An exercise never done before is new.
 *
 * Pure. Fed the same per-exercise history as the monthly review (`SessionSets` lines, oldest
 * first): the phone reads it from its database, the coach website from the coach functions.
 */

import type { SessionSets } from './monthlyReview.js';
import {
  improved,
  NO_TALLY,
  pairSets,
  tallyOf,
  worse,
  type SetPair,
  type Tally,
  type WorkingSet,
} from './setBySet.js';

export type SessionVerdict = 'improved' | 'same' | 'declined' | 'new';

/** The order the summary lists them in. */
export const SESSION_VERDICT_ORDER: readonly SessionVerdict[] = [
  'improved',
  'same',
  'declined',
  'new',
];

export interface ExerciseSessionChange {
  exerciseKey: string;
  status: SessionVerdict;
  /** This workout's working sets of the exercise. */
  sets: WorkingSet[];
  /** The last session of the exercise before this workout, or null for the first time. */
  previous: SessionSets | null;
  /** `sets` against `previous`, place by place. Empty the first time. */
  pairs: SetPair[];
  tally: Tally;
}

export interface SessionReview {
  /** In the workout's own order where it is given, otherwise as found. */
  exercises: ExerciseSessionChange[];
  counts: Record<SessionVerdict, number>;
}

const at = (session: SessionSets) => new Date(session.startedAt).getTime();

/**
 * The summary of the workout `sessionId`, from every exercise's history. An exercise of the
 * workout with no working set ticked off has nothing to say and is left out.
 */
export function reviewSession(
  history: ReadonlyMap<string, readonly SessionSets[]>,
  sessionId: string,
  /** The workout's exercises in the order it did them, to list the summary the same way. */
  order: readonly string[] = [],
): SessionReview {
  const exercises: ExerciseSessionChange[] = [];
  for (const [exerciseKey, line] of history) {
    const sorted = [...line].sort((a, b) => at(a) - at(b));
    const index = sorted.findIndex((session) => session.sessionId === sessionId);
    const current = sorted[index];
    if (!current || current.sets.length === 0) continue;
    const previous = index > 0 ? sorted[index - 1]! : null;
    const pairs = previous ? pairSets(current.sets, previous.sets) : [];
    const tally = previous ? tallyOf(pairs) : { ...NO_TALLY };
    const net = improved(tally) - worse(tally);
    exercises.push({
      exerciseKey,
      status: !previous ? 'new' : net > 0 ? 'improved' : net < 0 ? 'declined' : 'same',
      sets: current.sets,
      previous,
      pairs,
      tally,
    });
  }

  const place = (key: string) => {
    const index = order.indexOf(key);
    return index === -1 ? Number.MAX_SAFE_INTEGER : index;
  };
  exercises.sort((a, b) => place(a.exerciseKey) - place(b.exerciseKey));

  const counts = Object.fromEntries(SESSION_VERDICT_ORDER.map((status) => [status, 0])) as Record<
    SessionVerdict,
    number
  >;
  for (const exercise of exercises) counts[exercise.status] += 1;
  return { exercises, counts };
}
