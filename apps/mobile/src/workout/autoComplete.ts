/**
 * When typing a set's numbers is the same thing as having done it.
 *
 * The tick was always a separate tap: fill in the weight, fill in the reps, then say that you did
 * the thing you just described. This decides when the third tap is implied by the first two.
 *
 * It is not "the set has both numbers", because it nearly always does — a new set copies the one
 * before it, so every row is born complete. A rule that simple would tick the row the moment it
 * appeared. What matters is which number was *just typed*, and whether the set needed it:
 *
 *  - **The entry that completes the set ticks it.** An empty row filled in either order is done
 *    when its last missing number goes in.
 *  - **On a row that already had both, only the reps tick it.** The weight is what you set up
 *    before lifting and the reps are what you find out afterwards: changing 60 to 62.5 is
 *    loading the bar, and ticking the set then would start the rest timer before the lift.
 *  - **Nothing changed, nothing happens.** The pad saves on the way out, so opening it and
 *    closing it again commits the number that was already there. That is a look, not an entry.
 *
 * Never the other way: clearing a number does not untick a set. Unticking is a correction, and a
 * correction should be something somebody did on purpose.
 */

import type { LoadType } from '@fit/shared/catalog';

/** The two numbers a strength row carries. */
export interface SetNumbers {
  weightKg: number | null;
  reps: number | null;
}

/**
 * Whether the exercise needs a weight for a set to mean anything.
 *
 * A bench press without a weight is not a recorded set. A pull-up without one is — the added
 * weight is optional, and most people never add any — and a plank has no weight at all. Anything
 * the catalogue does not describe is treated as an ordinary lift, which is what it defaults to
 * everywhere else.
 */
function needsWeight(loadType: LoadType | undefined): boolean {
  return loadType === undefined || loadType === 'weight_reps';
}

/** True when the row says everything it has to say about a set. */
export function isSetComplete(set: SetNumbers, loadType: LoadType | undefined): boolean {
  if (set.reps === null || !(set.reps > 0)) return false;
  if (!needsWeight(loadType)) return true;
  return set.weightKg !== null && set.weightKg >= 0;
}

export interface AutoCompleteInput {
  /** Already ticked: there is nothing to do, and ticking twice would restart the rest. */
  done: boolean;
  /** Which number the pad was editing. */
  field: 'weight' | 'reps';
  /** The row as it was when the pad opened, and as it is with the committed value in place. */
  before: SetNumbers;
  after: SetNumbers;
  loadType: LoadType | undefined;
}

/** Whether committing this entry should tick the set. See the note at the top of the file. */
export function shouldAutoComplete({
  done,
  field,
  before,
  after,
  loadType,
}: AutoCompleteInput): boolean {
  if (done) return false;
  if (!isSetComplete(after, loadType)) return false;

  const changed = field === 'weight' ? before.weightKg !== after.weightKg : before.reps !== after.reps;
  if (!changed) return false;

  // The number that was missing has gone in, whichever of the two it was.
  if (!isSetComplete(before, loadType)) return true;

  return field === 'reps';
}
