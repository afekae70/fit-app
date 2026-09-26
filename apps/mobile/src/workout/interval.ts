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
 * Work, rest, work, rest … work. No rest after the last exercise of the last round: the workout
 * is over, and a ten-second countdown to nothing would be the timer inventing a phase.
 *
 * A rest of zero is allowed and means straight into the next exercise — a genuine format
 * (a circuit done back to back), not an error.
 *
 * `rounds` runs the whole list again from the top, which is how a circuit is actually trained:
 * ten exercises three times through, not thirty exercises. The rest between the last exercise of
 * one round and the first of the next is a rest like any other — a round boundary is not a
 * reason to stand still longer, and the sets it logs are the same sets.
 */
export function buildPhases(
  exerciseCount: number,
  workSeconds: number,
  restSeconds: number,
  rounds = 1,
): Phase[] {
  const phases: Phase[] = [];
  const total = Math.max(1, Math.floor(rounds));
  for (let round = 0; round < total; round += 1) {
    for (let exercise = 0; exercise < exerciseCount; exercise += 1) {
      phases.push({ kind: 'work', exercise, seconds: workSeconds });
      const isLastOfRound = exercise === exerciseCount - 1;
      const isLastOverall = isLastOfRound && round === total - 1;
      if (!isLastOverall && restSeconds > 0) {
        phases.push({
          kind: 'rest',
          exercise: isLastOfRound ? 0 : exercise + 1,
          seconds: restSeconds,
        });
      }
    }
  }
  return phases;
}

/**
 * Which time through the list a phase belongs to, counting from 1.
 *
 * Counted from the work phases before it rather than tracked as state: the phases are the list
 * repeated, so how many have been reached is the round. A rest belongs to the round it leads
 * into, which is what someone standing there waiting is about to do.
 */
export function roundOfPhase(
  phases: readonly Phase[],
  phaseIndex: number,
  exerciseCount: number,
): number {
  if (exerciseCount <= 0) return 1;
  const phase = phases[phaseIndex];
  if (!phase) return 1;
  const workBefore = phases.slice(0, phaseIndex).filter((p) => p.kind === 'work').length;
  return Math.floor(workBefore / exerciseCount) + 1;
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

/** How many seconds before the end of a phase the countdown starts sounding. */
export const COUNTDOWN_SECONDS = 3;

/**
 * Whether a countdown tone is due right now, and which one.
 *
 * One tone for each of the last three whole seconds of a phase — 3, 2, 1 — and then the phase's
 * own end sound at zero. `lastKey` is the key of the tone already played; a tone is due only
 * when the second has changed, because the screen ticks four times a second and each whole
 * second would otherwise sound four times.
 *
 * Nothing while paused, and nothing on the phase's very first second: a phase only three
 * seconds long would otherwise start with a countdown tone in the same instant as the end sound
 * of the phase before it, and the two would be heard as one noise. After the screen was off,
 * only the second that is current is announced — the ones missed are gone, and replaying them
 * late would count down to a moment that has already passed.
 */
export function countdownCue(
  phases: readonly Phase[],
  state: IntervalState,
  now: number,
  lastKey: string | null,
): string | null {
  if (state.endsAt === null) return null;
  const phase = phases[state.phase];
  if (!phase) return null;
  const left = remainingSeconds(state, now);
  if (left < 1 || left > COUNTDOWN_SECONDS || left >= phase.seconds) return null;
  const key = `${state.phase}:${left}`;
  return key === lastKey ? null : key;
}

/** How long before the next exercise starts that its name is announced. */
export const ANNOUNCE_SECONDS = 5;

/**
 * Minimum time into a rest before announcing. A rest of five seconds or less would otherwise
 * announce in the same instant the exercise-end chime plays, and the two would be heard as one.
 */
const ANNOUNCE_AFTER_REST_STARTS_MS = 700;

/**
 * Whether the upcoming exercise should be announced now, and for which rest.
 *
 * Only during a rest: it is the rest that is spent getting into position, and the name is what
 * tells you which position. Nothing before the first exercise, which has no rest in front of
 * it — the start screen already shows what it is. Once per rest, nothing while paused, and in a
 * rest of five seconds or less, as early as the chime allows.
 *
 * Returns the rest's phase index — the key for "already announced" — or null.
 */
export function announcementDue(
  phases: readonly Phase[],
  state: IntervalState,
  now: number,
  lastAnnounced: number | null,
): number | null {
  if (state.endsAt === null || state.phase === lastAnnounced) return null;
  const phase = phases[state.phase];
  if (!phase || phase.kind !== 'rest') return null;
  const remainingMs = state.endsAt - now;
  const elapsedMs = phase.seconds * 1000 - remainingMs;
  if (remainingMs > ANNOUNCE_SECONDS * 1000 || remainingMs <= 0) return null;
  if (elapsedMs < ANNOUNCE_AFTER_REST_STARTS_MS) return null;
  return state.phase;
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
