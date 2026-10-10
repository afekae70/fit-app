/**
 * The watermark in an empty set: what that set was last time.
 *
 * A workout started from a plan opens with its sets blank, on purpose — a target is what you
 * are aiming at, not a record of what you lifted, and filling it in would put numbers in the
 * log that never happened. But a blank field also asks the lifter to remember what they did
 * last week, which is the one thing the app is there to remember for them.
 *
 * So an empty field shows last time's number, faint. It is not a value: nothing is stored,
 * nothing counts toward the workout, and typing or stepping replaces it. It becomes a value in
 * exactly one way — by ticking the set, which is the lifter saying "yes, that, again". The
 * same convention the well-known logging apps use, and the reason a normal set is one tap.
 *
 * "Last time" is the previous workout of the same kind (see `db/sessionType.ts`): the same
 * plan day, or failing that the same name. Not the last time the exercise was done anywhere.
 *
 * Pure, so that the lining-up of today's rows against last time's can be tested: it is easy
 * to get subtly wrong, and wrong here means a warm-up's weight offered as the first working
 * set's.
 */

/** One set as it was done last time. */
export interface GhostSource {
  weightKg: number | null;
  reps: number | null;
  isWarmup: boolean;
}

/** What an empty row shows. A field that is null shows the usual dash. */
export interface Ghost {
  weightKg: number | null;
  reps: number | null;
}

/**
 * Today's rows against last time's sets, by position *within their kind*.
 *
 * The second working set shows what the second working set was, however many warm-ups came
 * before either. Warm-ups line up with warm-ups in the same way. A row with no counterpart —
 * a fourth set, when last time there were three — has no watermark: there is nothing it was.
 *
 * Only sets that held something count as having been there. A row left blank last time was a
 * set that did not happen, and it must not take a place in the line: a warm-up skipped last
 * week would otherwise sit between today's warm-up row and the one that was actually done.
 * This is the same rule `countPreviousWarmups` uses to decide how many warm-up rows a new
 * workout opens with, so every row it adds has something to show.
 */
export function ghostsFor(
  rows: readonly { isWarmup: boolean }[],
  previous: readonly GhostSource[] | null | undefined,
): (Ghost | null)[] {
  const held = (previous ?? []).filter((set) => set.weightKg !== null || set.reps !== null);
  if (held.length === 0) return rows.map(() => null);
  const working = held.filter((set) => !set.isWarmup);
  const warmups = held.filter((set) => set.isWarmup);

  let workingSeen = 0;
  let warmupSeen = 0;
  return rows.map((row) => {
    const source = row.isWarmup ? warmups[warmupSeen++] : working[workingSeen++];
    return source ? { weightKg: source.weightKg, reps: source.reps } : null;
  });
}

/**
 * What ticking a set should write first, if anything: the watermark, into the fields that are
 * still empty.
 *
 * Only the empty ones. A weight the lifter changed stays as they changed it, and the reps they
 * did not touch are taken from last time — which is what they were looking at when they
 * ticked. Null when there is nothing to fill, so the caller can skip the write.
 */
export function adoptGhost(
  set: { weightKg: number | null; reps: number | null },
  ghost: Ghost | null | undefined,
): { weightKg?: number; reps?: number } | null {
  if (!ghost) return null;
  const fill: { weightKg?: number; reps?: number } = {};
  if (set.weightKg === null && ghost.weightKg !== null) fill.weightKg = ghost.weightKg;
  if (set.reps === null && ghost.reps !== null) fill.reps = ghost.reps;
  return Object.keys(fill).length > 0 ? fill : null;
}
