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
 *
 * The other half is further down: which rows a workout opens with in the first place
 * (`openingRows`). The two are in one file because they are one idea — today starts as last
 * time's sets, empty, each showing what it was.
 */

/** One set as it was done last time. */
export interface GhostSource {
  weightKg: number | null;
  reps: number | null;
  /** A set can hold a time or a distance instead of a weight; it was still done. */
  durationSeconds?: number | null;
  distanceM?: number | null;
  isWarmup: boolean;
}

/** What an empty row shows. A field that is null shows the usual dash. */
export interface Ghost {
  weightKg: number | null;
  reps: number | null;
}

/**
 * Whether one of last time's sets is a set that happened.
 *
 * A row left completely blank was not a set: it was a place for one. It is not shown as a
 * watermark, and it is not reproduced in the next workout — a warm-up skipped once would
 * otherwise follow its exercise around for good, as an empty row with nothing to show.
 *
 * One function, because the rows a workout opens with (`openingRows`) and the watermark those
 * rows show (`ghostsFor`) have to mean the same thing by "last time's sets". If they ever
 * disagreed, a row would be created for a set the watermark did not count, and every row
 * below it would show its neighbour's numbers.
 */
export function happened(
  set: Pick<GhostSource, 'weightKg' | 'reps' | 'durationSeconds' | 'distanceM'>,
): boolean {
  return (
    set.weightKg !== null ||
    set.reps !== null ||
    (set.durationSeconds ?? null) !== null ||
    (set.distanceM ?? null) !== null
  );
}

/**
 * Today's rows against last time's sets, by position *within their kind*.
 *
 * The second working set shows what the second working set was, however many warm-ups came
 * before either. Warm-ups line up with warm-ups in the same way. A row with no counterpart —
 * a fourth set, when last time there were three — has no watermark: there is nothing it was.
 *
 * Only sets that happened take a place in the line; see `happened`. One that held a time and
 * no weight keeps its place and shows nothing, since there is no weight for it to show.
 */
export function ghostsFor(
  rows: readonly { isWarmup: boolean }[],
  previous: readonly GhostSource[] | null | undefined,
): (Ghost | null)[] {
  const done = (previous ?? []).filter(happened);
  if (done.length === 0) return rows.map(() => null);
  const working = done.filter((set) => !set.isWarmup);
  const warmups = done.filter((set) => set.isWarmup);

  let workingSeen = 0;
  let warmupSeen = 0;
  return rows.map((row) => {
    const source = row.isWarmup ? warmups[warmupSeen++] : working[workingSeen++];
    if (!source || (source.weightKg === null && source.reps === null)) return null;
    return { weightKg: source.weightKg, reps: source.reps };
  });
}

/* -------------------------------------------------------------------------- */
/* The rows a workout opens with                                               */
/* -------------------------------------------------------------------------- */

/** What kind of row a set is — all that a new workout takes from an old one. */
export interface RowKind {
  isWarmup: boolean;
  /** Continues the set above it, lighter, with no rest. */
  isDrop: boolean;
}

/**
 * The rows an exercise opens with: the sets it had last time, kind for kind and in order.
 *
 * Not "the plan's sets, plus last time's warm-up". Someone whose plan says four sets and who
 * uses the first as a warm-up did four sets, and a workout that opens with five — a warm-up
 * row and four more — has added a set nobody did. The warm-up is one of the sets, in the place
 * it was in.
 *
 * `last` is the sets that happened (`happened`), in the order they were done. `targetSets` is
 * what the plan asks for, when there is a plan: a workout cut short last time is filled back
 * up to it with plain rows, so that stopping after two sets once does not turn a four-set
 * exercise into a two-set one. Never fewer rows than last time, and never an exercise with no
 * working set at all — that is a card with nothing to do on it.
 */
export function openingRows(last: readonly RowKind[], targetSets?: number | null): RowKind[] {
  const rows: RowKind[] = last.map(({ isWarmup, isDrop }, index) => ({
    isWarmup,
    // A drop continues the row above it. First in the list, there is nothing to continue.
    isDrop: isDrop && index > 0,
  }));

  const warmups = rows.filter((row) => row.isWarmup).length;
  const working = rows.length - warmups;
  const wanted = Math.max(working, (targetSets ?? 0) - warmups, 1);
  for (let i = working; i < wanted; i += 1) rows.push({ isWarmup: false, isDrop: false });
  return rows;
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
