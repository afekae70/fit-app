/**
 * Where the workout tab is in a workout's life, as one value.
 *
 * It used to be five: `loading`, `sessionId`, `finishing`, `finishReview` and the order the
 * setters happened to run in. Most of their combinations meant nothing — a summary open with no
 * finished workout behind it, "finishing" with no workout — and the screen kept them apart by
 * hand, with conditions like `finishReview && !finishing` at the place the pop-up was drawn.
 * Here each stage carries exactly what it needs, and an event that does not belong to the
 * current stage changes nothing.
 *
 *   loading ──LOADED──▶ home ◀────────────── SUMMARY_CLOSED ──┐
 *      │                  │                                    │
 *   ADOPTED        STARTED / ADOPTED                    home + summary
 *      ▼                  ▼                                    ▲
 *    active ◀─────────────┘                                    │
 *      │ FINISH_TAPPED                                          │
 *      ▼                                                        │
 *   finishing (trophy over the workout) ──TROPHY_DONE──────────┘
 *
 * The summary is read while the trophy plays (REVIEW_READY). It usually lands first; when it
 * does not, the trophy goes, the home screen comes up with the summary still `pending`, and the
 * pop-up opens over it the moment the reading arrives.
 */

import type { SessionReview } from '@fit/shared/progress';

/** The pop-up after a finished workout, over the home screen. */
export interface FinishSummary {
  sessionId: string;
  /** `pending` while it is still being read; it opens once it is a review. */
  review: SessionReview | 'pending';
  /** How satisfied with the workout, 1 to 10; null while not said. */
  satisfaction: number | null;
}

export type WorkoutPhase =
  /** Before the first read of whether a workout is open. */
  | { kind: 'loading' }
  /** No workout open: the history list, and possibly the summary of the one just finished. */
  | { kind: 'home'; summary: FinishSummary | null }
  /** A workout open and being trained. */
  | { kind: 'active'; sessionId: string }
  /**
   * Finish tapped: the workout is saved and the trophy plays over it. `review` is null when
   * there turned out to be nothing to say (no exercise had a set ticked off, or the reading
   * failed), and the summary is then skipped.
   */
  | { kind: 'finishing'; sessionId: string; review: SessionReview | 'pending' | null };

export type WorkoutEvent =
  /** The first read found no open workout. */
  | { type: 'LOADED' }
  /** An open workout was found — on first load, or started elsewhere (a plan day). */
  | { type: 'ADOPTED'; sessionId: string }
  /** A workout was started here. */
  | { type: 'STARTED'; sessionId: string }
  | { type: 'FINISH_TAPPED' }
  /** The summary of `sessionId` has been read; null when there is nothing to show. */
  | { type: 'REVIEW_READY'; sessionId: string; review: SessionReview | null }
  /** The trophy has had its couple of seconds. */
  | { type: 'TROPHY_DONE' }
  | { type: 'SUMMARY_CLOSED' }
  | { type: 'SATISFACTION'; sessionId: string; value: number | null };

export const INITIAL_WORKOUT_PHASE: WorkoutPhase = { kind: 'loading' };

export function workoutPhaseReducer(phase: WorkoutPhase, event: WorkoutEvent): WorkoutPhase {
  switch (event.type) {
    case 'LOADED':
      return phase.kind === 'loading' ? { kind: 'home', summary: null } : phase;

    case 'ADOPTED':
      // Not over a workout already on screen, or one being finished: the open session the
      // read found is that same one, or about to stop being open.
      if (phase.kind === 'active' || phase.kind === 'finishing') return phase;
      return { kind: 'active', sessionId: event.sessionId };

    case 'STARTED':
      return phase.kind === 'home' ? { kind: 'active', sessionId: event.sessionId } : phase;

    case 'FINISH_TAPPED':
      // The guard against a second tap on Finish while the first is saving.
      return phase.kind === 'active'
        ? { kind: 'finishing', sessionId: phase.sessionId, review: 'pending' }
        : phase;

    case 'REVIEW_READY':
      if (phase.kind === 'finishing' && phase.sessionId === event.sessionId) {
        return { ...phase, review: event.review };
      }
      // Arrived after the trophy went: open it now, or drop the empty slot.
      if (
        phase.kind === 'home' &&
        phase.summary?.sessionId === event.sessionId &&
        phase.summary.review === 'pending'
      ) {
        return {
          kind: 'home',
          summary: event.review ? { ...phase.summary, review: event.review } : null,
        };
      }
      return phase;

    case 'TROPHY_DONE':
      if (phase.kind !== 'finishing') return phase;
      return {
        kind: 'home',
        summary:
          phase.review === null
            ? null
            : { sessionId: phase.sessionId, review: phase.review, satisfaction: null },
      };

    case 'SUMMARY_CLOSED':
      return phase.kind === 'home' && phase.summary ? { kind: 'home', summary: null } : phase;

    case 'SATISFACTION':
      if (phase.kind !== 'home' || phase.summary?.sessionId !== event.sessionId) return phase;
      return { kind: 'home', summary: { ...phase.summary, satisfaction: event.value } };
  }
}

/** The workout on screen, under the trophy too; null on the home screen and while loading. */
export function openSessionId(phase: WorkoutPhase): string | null {
  return phase.kind === 'active' || phase.kind === 'finishing' ? phase.sessionId : null;
}

/** The summary to draw, once it has been read; null while there is none or it is pending. */
export function shownSummary(
  phase: WorkoutPhase,
): (FinishSummary & { review: SessionReview }) | null {
  if (phase.kind !== 'home' || !phase.summary || phase.summary.review === 'pending') return null;
  return phase.summary as FinishSummary & { review: SessionReview };
}
