/**
 * A cardio effort: one stretch of training measured in time and distance rather than in sets.
 *
 * A walk or a ride is not reps. You start, it runs, you stop — and what it leaves behind is how
 * long it took, how far it went, and the pace that follows from the two. This holds that state
 * and the arithmetic; the screen holds the buttons.
 *
 * Elapsed time is derived from wall-clock stamps, never accumulated by a ticking counter. The
 * phone locks, a call arrives, Android evicts the app — a counter loses all three, and the
 * duration of a workout is the one number nobody can reconstruct afterwards. `startedAt` is when
 * the current run began and `accumulatedMs` is everything banked before the last pause, so the
 * answer is always a subtraction.
 */

export interface CardioRun {
  /** When the current run began, or null while paused. */
  startedAt: number | null;
  /** Milliseconds banked by earlier runs, before the latest pause. */
  accumulatedMs: number;
}

export const IDLE_RUN: CardioRun = { startedAt: null, accumulatedMs: 0 };

export function startRun(now: number, from: CardioRun = IDLE_RUN): CardioRun {
  return from.startedAt === null ? { ...from, startedAt: now } : from;
}

export function pauseRun(run: CardioRun, now: number): CardioRun {
  if (run.startedAt === null) return run;
  return { startedAt: null, accumulatedMs: run.accumulatedMs + Math.max(0, now - run.startedAt) };
}

export function isRunning(run: CardioRun): boolean {
  return run.startedAt !== null;
}

/** Milliseconds trained so far, running or paused. */
export function elapsedMs(run: CardioRun, now: number): number {
  const live = run.startedAt === null ? 0 : Math.max(0, now - run.startedAt);
  return run.accumulatedMs + live;
}

/** Whole seconds, which is what a set records. */
export function elapsedSeconds(run: CardioRun, now: number): number {
  return Math.round(elapsedMs(run, now) / 1000);
}

/** A run rebuilt from a duration already recorded, so editing an old effort resumes from it. */
export function runFromSeconds(seconds: number | null): CardioRun {
  return { startedAt: null, accumulatedMs: Math.max(0, seconds ?? 0) * 1000 };
}

/** `1:04:12` past an hour, `12:30` below it — read at a glance while moving. */
export function formatDuration(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;
  const mm = `${minutes}`.padStart(hours > 0 ? 2 : 1, '0');
  return `${hours > 0 ? `${hours}:` : ''}${mm}:${`${rest}`.padStart(2, '0')}`;
}

/**
 * Minutes per unit of distance, as `5:42`, or null when there is nothing to divide.
 *
 * Pace is how runners and walkers actually talk about effort — "five and a half a kilometre" —
 * and it is the number that says whether today was faster than last time.
 */
export function pacePerUnit(seconds: number, distanceUnits: number): string | null {
  if (seconds <= 0 || distanceUnits <= 0) return null;
  const perUnit = Math.round(seconds / distanceUnits);
  const minutes = Math.floor(perUnit / 60);
  return `${minutes}:${`${perUnit % 60}`.padStart(2, '0')}`;
}

/** Distance units per hour, to one decimal, or null when there is nothing to divide. */
export function speedPerHour(seconds: number, distanceUnits: number): number | null {
  if (seconds <= 0 || distanceUnits <= 0) return null;
  return Math.round((distanceUnits / (seconds / 3600)) * 10) / 10;
}
