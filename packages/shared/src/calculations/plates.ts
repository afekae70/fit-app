/**
 * What to hang on each end of the bar to reach a target weight.
 *
 * Arithmetic anyone can do and nobody wants to do standing in front of a rack between sets, in
 * a gym, out of breath. The mistake it prevents is the ordinary one: loading 100 kg as if the
 * bar weighed nothing, or halving the wrong number.
 */

/** A loadable bar, and what it weighs bare. */
export interface BarSpec {
  kg: number;
  /** Plates available, heaviest first. Only these denominations will be suggested. */
  plates: readonly number[];
}

/**
 * A standard Olympic barbell and the plate set almost every commercial gym has.
 *
 * Only the straight barbell gets a default. An EZ bar is anywhere from 6.5 to 10 kg, a trap bar
 * from 20 to 32, and a Smith machine's sled is counterbalanced by an amount the manufacturer
 * rarely prints — for those, a confidently wrong bar weight is worse than no suggestion, since
 * it would silently shift every number the user reads off the screen.
 */
export const OLYMPIC_BAR: BarSpec = {
  kg: 20,
  plates: [25, 20, 15, 10, 5, 2.5, 1.25],
};

/** The same idea in pounds, for a gym that racks its plates that way. */
export const OLYMPIC_BAR_LB: BarSpec = {
  kg: 45,
  plates: [45, 35, 25, 10, 5, 2.5],
};

export interface PlateLoad {
  plate: number;
  count: number;
}

export interface PlateBreakdown {
  /** Heaviest first, for one end of the bar. The other end is the same. */
  perSide: PlateLoad[];
  /** What the bar and these plates actually weigh together. */
  achieved: number;
  /**
   * Target minus achieved, and it is not always zero.
   *
   * A 2.5 kg jump on a bar with no 1.25s is unreachable, and so is anything below the bare bar.
   * Reported rather than rounded away: the honest answer to "how do I load 61 kg" is that you
   * cannot, and a breakdown that silently loaded 60 would have the user believe otherwise.
   */
  remainder: number;
}

/**
 * Greedy from the heaviest plate down, which is also how a person loads a bar.
 *
 * Greedy is not optimal for arbitrary denominations — 20 does not divide 25, so this is not the
 * textbook case where it is provably exact. It happens to be exact for the standard set, whose
 * large plates are all multiples of five and whose 2.5 and 1.25 cover the rest, so every
 * reachable multiple of 1.25 is reached.
 *
 * A gym stocking something unusual can defeat it: with only 25s and 20s, 40 per side is
 * 20 + 20, and greedy takes a 25 first and strands 15. That is left as it is rather than solved
 * properly, because `remainder` makes the shortfall visible instead of hiding it, and a
 * suggestion the lifter can see is short is one they can finish themselves.
 */
export function platesPerSide(target: number, bar: BarSpec = OLYMPIC_BAR): PlateBreakdown {
  // Below the bare bar there is nothing to suggest. The bar itself is already too heavy, and
  // saying "no plates" would read as agreement rather than as the warning it should be.
  if (!Number.isFinite(target) || target < bar.kg) {
    return { perSide: [], achieved: bar.kg, remainder: Number(((target || 0) - bar.kg).toFixed(2)) };
  }

  let perSideRemaining = (target - bar.kg) / 2;
  const perSide: PlateLoad[] = [];

  for (const plate of bar.plates) {
    // A hair of tolerance: 0.1 kg of floating-point drift must not cost a 1.25 plate.
    const count = Math.floor((perSideRemaining + 1e-9) / plate);
    if (count <= 0) continue;
    perSide.push({ plate, count });
    perSideRemaining -= count * plate;
  }

  const achieved = bar.kg + (target - bar.kg - perSideRemaining * 2);
  return {
    perSide,
    achieved: Number(achieved.toFixed(2)),
    remainder: Number((target - achieved).toFixed(2)),
  };
}

/**
 * The loading as one short string: `20 + 10 + 2.5`, per side.
 *
 * Repeats a plate rather than writing `2×20`, because the eye reading it is about to pick up
 * that many plates, and counting symbols is faster than parsing a multiplier mid-set.
 */
export function formatPlates(breakdown: PlateBreakdown): string {
  return breakdown.perSide
    .flatMap(({ plate, count }) => Array<number>(count).fill(plate))
    .join(' + ');
}
