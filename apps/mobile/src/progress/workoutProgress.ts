/**
 * Progress, one workout at a time.
 *
 * The rest of the progress screen measures the body of work as a whole — volume per week, sets
 * per muscle — or one lift across everything. Neither answers the question a person actually
 * asks walking out of the gym: was today's leg day better than the last leg day?
 *
 * That needs like compared with like, so the unit here is a workout *by its name*. Every
 * finished "Legs" is a point on one line; the latest is compared with the one before it, and
 * each month with the month before.
 *
 * ## What makes two workouts the same
 *
 * The name, and only the name: trimmed, and ignoring capitals. A workout started from a plan
 * carries its plan day's name; one repeated from history carries the name of what it repeats;
 * one named by hand is called whatever it was called. A workout with no name at all belongs to
 * no line — there is nothing to say it is the same as.
 *
 * This is deliberately looser than the rule the workout screen uses for "last time" (see
 * `db/sessionType.ts`, which keeps a plan's lineage apart from a same-named unplanned one).
 * That rule protects a comparison of single lifts across different gyms. This one is the
 * owner's own definition of the feature: by the workout's name.
 *
 * ## What is measured
 *
 * One number per workout, chosen for the whole line so that every point on it is the same
 * kind of number: the weight moved (weight x reps over the working sets) if the workout ever
 * moved any; otherwise the distance covered, if it ever covered any; otherwise how long it
 * took. A lifting day, a run and a timed circuit each get the measure that means something
 * for them.
 *
 * Pure functions. The database half is `db/workoutProgress.ts`.
 */

export interface SessionPoint {
  id: string;
  /** The workout's name as it should be shown. */
  name: string;
  startedAt: string;
  endedAt: string | null;
  /** Weight x reps over the sets that were done and were not warm-ups, in kilograms. */
  volumeKg: number;
  /** How many such sets. */
  sets: number;
  /** Metres covered, over the same sets. */
  distanceM: number;
}

export type Metric = 'volume' | 'distance' | 'time';

export interface WorkoutLine {
  /** What the name is compared by. Never shown. */
  key: string;
  /** The name as most recently written. */
  name: string;
  /** Oldest first. Never empty. */
  sessions: SessionPoint[];
}

/** The form a name is compared in: no stray spaces, no capitals. */
export function workoutKey(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toLocaleLowerCase();
}

/**
 * Every named workout as a line of its sessions, the most recently done workout first.
 *
 * The name shown for a line is the newest spelling of it: someone who renamed "legs" to "Legs"
 * meant the second one.
 */
export function groupByWorkout(points: readonly SessionPoint[]): WorkoutLine[] {
  const lines = new Map<string, WorkoutLine>();
  const ordered = [...points].sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt));
  for (const point of ordered) {
    const key = workoutKey(point.name);
    if (key === '') continue;
    const line = lines.get(key) ?? { key, name: point.name.trim(), sessions: [] };
    line.sessions.push(point);
    line.name = point.name.trim();
    lines.set(key, line);
  }
  return [...lines.values()].sort(
    (a, b) => Date.parse(b.sessions.at(-1)!.startedAt) - Date.parse(a.sessions.at(-1)!.startedAt),
  );
}

/** Which number this workout is measured by. See the top of the file. */
export function metricOf(line: Pick<WorkoutLine, 'sessions'>): Metric {
  if (line.sessions.some((session) => session.volumeKg > 0)) return 'volume';
  if (line.sessions.some((session) => session.distanceM > 0)) return 'distance';
  return 'time';
}

/** How long a workout took, in whole minutes; 0 if it has no end. */
export function minutesOf(point: Pick<SessionPoint, 'startedAt' | 'endedAt'>): number {
  if (!point.endedAt) return 0;
  const minutes = Math.round((Date.parse(point.endedAt) - Date.parse(point.startedAt)) / 60000);
  return minutes > 0 ? minutes : 0;
}

/** One workout's number: kilograms, metres or minutes, according to the line's measure. */
export function valueOf(point: SessionPoint, metric: Metric): number {
  if (metric === 'volume') return point.volumeKg;
  if (metric === 'distance') return point.distanceM;
  return minutesOf(point);
}

/**
 * How much bigger `current` is than `previous`, as a fraction: 0.05 is five per cent more.
 *
 * Null when there is nothing to be a fraction of. "Infinitely more than nothing" is not a
 * number anyone should be shown, and a first workout has no previous at all.
 */
export function changeFrom(current: number, previous: number | null | undefined): number | null {
  if (previous === null || previous === undefined || previous <= 0) return null;
  return (current - previous) / previous;
}

export interface Comparison {
  metric: Metric;
  latest: SessionPoint;
  /** The one before it, of the same workout. Null the first time a workout is done. */
  previous: SessionPoint | null;
  latestValue: number;
  previousValue: number | null;
  change: number | null;
}

/** The latest of a workout against the one before it. */
export function latestComparison(line: WorkoutLine): Comparison {
  const metric = metricOf(line);
  const latest = line.sessions.at(-1)!;
  const previous = line.sessions.at(-2) ?? null;
  const latestValue = valueOf(latest, metric);
  const previousValue = previous ? valueOf(previous, metric) : null;
  return {
    metric,
    latest,
    previous,
    latestValue,
    previousValue,
    change: changeFrom(latestValue, previousValue),
  };
}

/** The calendar month a moment falls in where this phone is, as `YYYY-MM`. */
export function localMonth(moment: string): string {
  const date = new Date(moment);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

export interface MonthPoint {
  /** `YYYY-MM`. */
  month: string;
  /** How many times the workout was done that month. */
  sessions: number;
  /** The typical workout that month: the mean of its number. */
  average: number;
  best: number;
  /** Against the previous month *in which the workout was done at all*. */
  change: number | null;
}

/**
 * A workout month by month, oldest first: the last `limit` months it was done in.
 *
 * The average per workout, not the month's total. A month with five leg days moved more weight
 * than a month with three whatever happened in each of them; the question is whether the leg
 * day itself got better, and the count is shown beside it for the other one.
 *
 * A month the workout was skipped in is left out rather than drawn as zero, and each month is
 * compared with the last month that has one: coming back from a month off should read as
 * "against where I left it", not as an improvement on nothing.
 */
export function byMonth(line: WorkoutLine, metric: Metric, limit = 6): MonthPoint[] {
  const months = new Map<string, number[]>();
  for (const session of line.sessions) {
    const month = localMonth(session.startedAt);
    months.set(month, [...(months.get(month) ?? []), valueOf(session, metric)]);
  }

  const points: MonthPoint[] = [];
  for (const month of [...months.keys()].sort()) {
    const values = months.get(month)!;
    const average = values.reduce((sum, value) => sum + value, 0) / values.length;
    points.push({
      month,
      sessions: values.length,
      average,
      best: Math.max(...values),
      change: changeFrom(average, points.at(-1)?.average),
    });
  }
  return points.slice(-limit);
}

/** Each session beside the change from the one before it, newest first — for a list. */
export function sessionsWithChange(
  line: WorkoutLine,
  metric: Metric,
): { session: SessionPoint; value: number; change: number | null }[] {
  return line.sessions
    .map((session, index) => {
      const value = valueOf(session, metric);
      const before = index > 0 ? valueOf(line.sessions[index - 1]!, metric) : null;
      return { session, value, change: changeFrom(value, before) };
    })
    .reverse();
}

/* -------------------------------------------------------------------------- */
/* Lift by lift                                                                */
/* -------------------------------------------------------------------------- */

/** The best working set of one exercise in one workout. */
export interface ExerciseBest {
  exerciseKey: string;
  weightKg: number | null;
  reps: number | null;
}

export type Direction = 'up' | 'down' | 'same' | 'new';

export interface ExerciseChange {
  exerciseKey: string;
  latest: ExerciseBest;
  previous: ExerciseBest | null;
  direction: Direction;
}

/**
 * Whether a best set is better than another: heavier, or the same weight for more reps.
 *
 * An exercise done without weight compares on reps alone. One that went from no weight to
 * some weight has gone up, whatever the reps did.
 */
function compare(latest: ExerciseBest, previous: ExerciseBest): Direction {
  const weightNow = latest.weightKg ?? 0;
  const weightThen = previous.weightKg ?? 0;
  if (weightNow !== weightThen) return weightNow > weightThen ? 'up' : 'down';
  const repsNow = latest.reps ?? 0;
  const repsThen = previous.reps ?? 0;
  if (repsNow !== repsThen) return repsNow > repsThen ? 'up' : 'down';
  return 'same';
}

/**
 * The lifts of the latest workout, each against the same lift the time before.
 *
 * In the latest workout's order. An exercise that was not in the previous one is `new`; one
 * that was in the previous and not the latest is not listed — this is a reading of today's
 * workout, not a list of what was left out of it.
 */
export function exerciseChanges(
  latest: readonly ExerciseBest[],
  previous: readonly ExerciseBest[],
): ExerciseChange[] {
  const before = new Map(previous.map((best) => [best.exerciseKey, best]));
  const seen = new Set<string>();
  const changes: ExerciseChange[] = [];
  for (const best of latest) {
    // The same exercise twice in one workout is told once, by its first appearance.
    if (seen.has(best.exerciseKey)) continue;
    seen.add(best.exerciseKey);
    const then = before.get(best.exerciseKey) ?? null;
    changes.push({
      exerciseKey: best.exerciseKey,
      latest: best,
      previous: then,
      direction: then ? compare(best, then) : 'new',
    });
  }
  return changes;
}
