/**
 * A timed workout: each exercise done for a fixed number of seconds, with a fixed rest between.
 *
 * Kept free of React, timers and the clock so it can be tested to the millisecond. The screen
 * owns `setInterval` and `Date.now()`; everything that decides what the timer shows lives here.
 *
 * Time is measured against wall-clock deadlines, never by counting ticks. JavaScript timers on a
 * phone are not a clock: Android throttles them the moment the screen dims or another app comes
 * forward, and a timer that decremented a counter once a second would quietly stretch a 50-second
 * plank into 70. A deadline cannot drift — however late the next tick arrives, the remaining time
 * is still the deadline minus now, and a phase that ended while nobody was looking has ended.
 */

export type PhaseKind = 'work' | 'rest';

export interface Phase {
  kind: PhaseKind;
  /**
   * Which exercise this phase belongs to. For rest, the one coming up next — rest exists to get
   * ready for it, so that is what the screen should be showing while it runs.
   */
  exercise: number;
  seconds: number;
}

export interface IntervalState {
  /** Index into the phase list; equal to its length once the workout is over. */
  phase: number;
  /** Epoch milliseconds the current phase ends at, or null while paused or finished. */
  endsAt: number | null;
  /** What is left of the current phase while paused. Meaningless while running. */
  remainingMs: number;
}

/** The shortest phase the timer accepts. Anything under this is a typo, not a workout. */
export const MIN_PHASE_SECONDS = 5;
export const MAX_PHASE_SECONDS = 600;

export const DEFAULT_WORK_SECONDS = 50;
export const DEFAULT_REST_SECONDS = 10;

/**
 * Work, rest, work, rest … work. No rest after the last exercise: the workout is over, and a
 * ten-second countdown to nothing would be the timer inventing a phase.
 *
 * A rest of zero is allowed and means straight into the next exercise — a genuine format
 * (a circuit done back to back), not an error.
 */
export function buildPhases(
  exerciseCount: number,
  workSeconds: number,
  restSeconds: number,
): Phase[] {
  const phases: Phase[] = [];
  for (let exercise = 0; exercise < exerciseCount; exercise += 1) {
    phases.push({ kind: 'work', exercise, seconds: workSeconds });
    const isLast = exercise === exerciseCount - 1;
    if (!isLast && restSeconds > 0) {
      phases.push({ kind: 'rest', exercise: exercise + 1, seconds: restSeconds });
    }
  }
  return phases;
}

/**
 * Begin at an exercise's work phase.
 *
 * Not always the first: a workout interrupted by a phone call or a closed app is resumed from
 * the first exercise not yet done, rather than making someone repeat the ones already logged.
 */
export function startIntervals(
  phases: readonly Phase[],
  now: number,
  fromExercise = 0,
): IntervalState {
  const index = phases.findIndex(
    (phase) => phase.kind === 'work' && phase.exercise === fromExercise,
  );
  if (index < 0) return finished(phases);
  const phase = phases[index]!;
  return { phase: index, endsAt: now + phase.seconds * 1000, remainingMs: phase.seconds * 1000 };
}

/**
 * Move the timer up to `now`, reporting every phase that ended on the way.
 *
 * Usually that is zero or one. It is more after the screen was off for longer than a phase, and
 * each one is returned rather than only the last — a work phase that ran out while the phone was
 * in a pocket was still done, and the caller logs it.
 *
 * The next deadline is chained from the one that just passed, not from `now`. A tick that
 * arrives 300ms late must not hand those 300ms to the following exercise, or the lateness would
 * accumulate across the workout.
 */
export function advance(
  phases: readonly Phase[],
  state: IntervalState,
  now: number,
): { state: IntervalState; completed: Phase[] } {
  const completed: Phase[] = [];
  let { phase, endsAt } = state;

  while (endsAt !== null && endsAt <= now && phase < phases.length) {
    completed.push(phases[phase]!);
    phase += 1;
    const next = phases[phase];
    endsAt = next ? endsAt + next.seconds * 1000 : null;
  }

  if (phase >= phases.length) return { state: finished(phases), completed };
  if (completed.length === 0) return { state, completed };
  return { state: { phase, endsAt, remainingMs: Math.max(0, (endsAt ?? now) - now) }, completed };
}

export function pause(state: IntervalState, now: number): IntervalState {
  if (state.endsAt === null) return state;
  return { phase: state.phase, endsAt: null, remainingMs: Math.max(0, state.endsAt - now) };
}

export function resume(phases: readonly Phase[], state: IntervalState, now: number): IntervalState {
  if (state.endsAt !== null || state.phase >= phases.length) return state;
  return { phase: state.phase, endsAt: now + state.remainingMs, remainingMs: state.remainingMs };
}

/**
 * Jump to the next phase at its full length.
 *
 * Deliberately reports nothing as completed. Skipping an exercise is not doing it, and logging a
 * 50-second set for work that never happened would put a lie into the history the progress
 * screens are built on. Skipping keeps a paused timer paused, too — the skip was a request to
 * move, not to start.
 */
export function skip(phases: readonly Phase[], state: IntervalState, now: number): IntervalState {
  const phase = state.phase + 1;
  const next = phases[phase];
  if (!next) return finished(phases);
  const full = next.seconds * 1000;
  return { phase, endsAt: state.endsAt === null ? null : now + full, remainingMs: full };
}

/** Whole seconds left, rounded up, so the display reaches 0 exactly when the phase ends. */
export function remainingSeconds(state: IntervalState, now: number): number {
  const ms = state.endsAt === null ? state.remainingMs : state.endsAt - now;
  return Math.max(0, Math.ceil(ms / 1000));
}

export function isFinished(phases: readonly Phase[], state: IntervalState): boolean {
  return state.phase >= phases.length;
}

/**
 * Bring a typed or stepped value into range.
 *
 * Rest may be zero; work may not — a zero-second exercise is not a format, it is an empty field.
 */
export function clampSeconds(value: number, kind: PhaseKind): number {
  const floor = kind === 'rest' ? 0 : MIN_PHASE_SECONDS;
  if (!Number.isFinite(value)) return kind === 'rest' ? DEFAULT_REST_SECONDS : DEFAULT_WORK_SECONDS;
  return Math.min(MAX_PHASE_SECONDS, Math.max(floor, Math.round(value)));
}

function finished(phases: readonly Phase[]): IntervalState {
  return { phase: phases.length, endsAt: null, remainingMs: 0 };
}
