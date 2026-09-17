/**
 * How one logged set reads back: "82.5 kg × 8", "45 sec", "400 m".
 *
 * Kept away from the screen so it can be tested. A set carries four possible measurements and
 * almost never all of them, and the rules for which to show were previously written inline in a
 * chain of conditionals that nothing could check.
 */

export interface LoggedSet {
  weight_kg: number | null;
  reps: number | null;
  duration_seconds: number | null;
  distance_m: number | null;
}

export interface SetLabels {
  /** The weight unit as it should appear — "kg" or "lb". */
  weight: string;
  /** The distance unit — "m" or "yd". */
  distance: string;
  seconds: string;
}

/**
 * The set as one short string, or the em-dash when nothing was recorded.
 *
 * Weight and reps read as a pair, because that is how a set is spoken. Anything else recorded —
 * a hold's seconds, a carry's distance — is appended rather than replacing them: a weighted carry
 * has both, and dropping either would lose half of what was done.
 *
 * The caller converts to the reader's units first; this only lays them out.
 */
export function formatSet(set: LoggedSet, labels: SetLabels): string {
  const parts: string[] = [];

  if (set.weight_kg !== null && set.reps !== null) {
    parts.push(`${set.weight_kg} ${labels.weight} × ${set.reps}`);
  } else if (set.weight_kg !== null) {
    parts.push(`${set.weight_kg} ${labels.weight}`);
  } else if (set.reps !== null) {
    parts.push(`× ${set.reps}`);
  }

  if (set.duration_seconds !== null) parts.push(`${set.duration_seconds} ${labels.seconds}`);
  if (set.distance_m !== null) parts.push(`${set.distance_m} ${labels.distance}`);

  return parts.join(' · ') || '—';
}

/**
 * Which set was the best of an exercise, by position — or null when none of them can be compared.
 *
 * The heaviest, and the most reps at that weight when two match. Warm-ups are never the best set;
 * they are a ramp toward it. Sets without a weight — a plank, a carry — have nothing to rank, so
 * an exercise made of those simply has no highlight rather than an arbitrary one.
 */
export function bestSetIndex(
  sets: readonly (LoggedSet & { is_warmup: number })[],
): number | null {
  let best: number | null = null;
  for (const [index, set] of sets.entries()) {
    if (set.is_warmup === 1 || set.weight_kg === null) continue;
    if (best === null) {
      best = index;
      continue;
    }
    const current = sets[best]!;
    const heavier = set.weight_kg > (current.weight_kg ?? 0);
    const sameWeightMoreReps =
      set.weight_kg === current.weight_kg && (set.reps ?? 0) > (current.reps ?? 0);
    if (heavier || sameWeightMoreReps) best = index;
  }
  return best;
}
