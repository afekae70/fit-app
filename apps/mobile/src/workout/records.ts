/**
 * Which set of an exercise, in the workout being done, is a personal record.
 *
 * A record has always been announced the moment it happened — a toast and a buzz — and then
 * was gone: thirty seconds later the row that made it looked like every other row. This says
 * which row it was, so the mark can stay on it for the rest of the workout.
 *
 * The rule is the one the toast has always used, and both now read it from here so they cannot
 * disagree: more weight than ever before, or the same weight for more reps. A first time counts
 * — there is nothing it failed to beat.
 */

export interface Best {
  weightKg: number;
  reps: number;
}

/** A lift, as far as a record cares: what was on the bar and how many times it moved. */
export interface Lifted {
  weightKg: number | null;
  reps: number | null;
  done: boolean;
  isWarmup: boolean;
}

/** Whether a lift beats the best there was before it. With no best before, it does. */
export function beats(lift: Best, previous: Best | null): boolean {
  return (
    previous === null ||
    lift.weightKg > previous.weightKg ||
    (lift.weightKg === previous.weightKg && lift.reps > previous.reps)
  );
}

/**
 * The index of the set that holds this workout's record for the exercise, or null.
 *
 * One mark at most: the best set of the workout, if it beats what came before. Three sets that
 * all pass the old best are one record, and it belongs to the heaviest of them.
 *
 * Only sets that were done count — a number typed into a row is an intention until it is
 * ticked — and never a warm-up, which is not the work. `previous` is `undefined` while the
 * history is still being read: unknown is not "no history", and nothing is marked on a guess.
 */
export function recordSetIndex(
  sets: readonly Lifted[],
  previous: Best | null | undefined,
): number | null {
  if (previous === undefined) return null;

  let top: { index: number; lift: Best } | null = null;
  for (const [index, set] of sets.entries()) {
    if (!set.done || set.isWarmup || set.weightKg === null || set.reps === null) continue;
    if (set.reps <= 0) continue;
    const lift = { weightKg: set.weightKg, reps: set.reps };
    // Strictly better than the best so far, so of two equal sets the first keeps the mark:
    // it was the record when it was done, and the second only matched it.
    if (top === null || beats(lift, top.lift)) top = { index, lift };
  }

  return top !== null && beats(top.lift, previous) ? top.index : null;
}
