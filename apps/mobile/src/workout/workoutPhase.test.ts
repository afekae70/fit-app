import type { SessionReview } from '@fit/shared/progress';
import { describe, expect, it } from 'vitest';

import {
  INITIAL_WORKOUT_PHASE,
  openSessionId,
  shownSummary,
  workoutPhaseReducer,
  type WorkoutEvent,
  type WorkoutPhase,
} from './workoutPhase.js';

const review: SessionReview = {
  exercises: [],
  counts: { improved: 1, same: 0, declined: 0, new: 0 },
};

const run = (events: WorkoutEvent[], from: WorkoutPhase = INITIAL_WORKOUT_PHASE) =>
  events.reduce(workoutPhaseReducer, from);

describe('the workout tab, from opening to the summary', () => {
  it('opens on home, or on a workout left open', () => {
    expect(run([{ type: 'LOADED' }])).toEqual({ kind: 'home', summary: null });
    expect(run([{ type: 'ADOPTED', sessionId: 's1' }])).toEqual({
      kind: 'active',
      sessionId: 's1',
    });
  });

  it('finishes: trophy over the workout, then the summary over home', () => {
    const finishing = run([
      { type: 'LOADED' },
      { type: 'STARTED', sessionId: 's1' },
      { type: 'FINISH_TAPPED' },
    ]);
    expect(finishing).toEqual({ kind: 'finishing', sessionId: 's1', review: 'pending' });
    // Still the workout on screen under the trophy.
    expect(openSessionId(finishing)).toBe('s1');
    expect(shownSummary(finishing)).toBeNull();

    const home = run(
      [{ type: 'REVIEW_READY', sessionId: 's1', review }, { type: 'TROPHY_DONE' }],
      finishing,
    );
    expect(openSessionId(home)).toBeNull();
    expect(shownSummary(home)).toEqual({ sessionId: 's1', review, satisfaction: null });

    expect(run([{ type: 'SUMMARY_CLOSED' }], home)).toEqual({ kind: 'home', summary: null });
  });

  it('opens the summary late when it is read after the trophy has gone', () => {
    const home = run([
      { type: 'ADOPTED', sessionId: 's1' },
      { type: 'FINISH_TAPPED' },
      { type: 'TROPHY_DONE' },
    ]);
    expect(home).toEqual({
      kind: 'home',
      summary: { sessionId: 's1', review: 'pending', satisfaction: null },
    });
    expect(shownSummary(home)).toBeNull();
    expect(
      shownSummary(run([{ type: 'REVIEW_READY', sessionId: 's1', review }], home)),
    ).not.toBeNull();
    // Nothing to say after all: the waiting slot goes, nothing opens.
    expect(run([{ type: 'REVIEW_READY', sessionId: 's1', review: null }], home)).toEqual({
      kind: 'home',
      summary: null,
    });
  });

  it('skips the summary when there is nothing to say', () => {
    expect(
      run([
        { type: 'ADOPTED', sessionId: 's1' },
        { type: 'FINISH_TAPPED' },
        { type: 'REVIEW_READY', sessionId: 's1', review: null },
        { type: 'TROPHY_DONE' },
      ]),
    ).toEqual({ kind: 'home', summary: null });
  });

  it('keeps the satisfaction with its own workout only', () => {
    const home: WorkoutPhase = {
      kind: 'home',
      summary: { sessionId: 's1', review, satisfaction: null },
    };
    expect(
      shownSummary(run([{ type: 'SATISFACTION', sessionId: 's1', value: 8 }], home))?.satisfaction,
    ).toBe(8);
    expect(run([{ type: 'SATISFACTION', sessionId: 'other', value: 8 }], home)).toBe(home);
  });
});

describe('events that do not belong to the stage change nothing', () => {
  const active: WorkoutPhase = { kind: 'active', sessionId: 's1' };
  const finishing: WorkoutPhase = { kind: 'finishing', sessionId: 's1', review: 'pending' };

  it('ignores a second tap on Finish', () => {
    expect(run([{ type: 'FINISH_TAPPED' }], finishing)).toBe(finishing);
  });

  it('does not let the open-workout read replace the workout on screen or being finished', () => {
    // Both the mount read and the focus read can land; the second must not reset anything.
    expect(run([{ type: 'ADOPTED', sessionId: 's1' }], active)).toBe(active);
    expect(run([{ type: 'ADOPTED', sessionId: 's1' }], finishing)).toBe(finishing);
    expect(run([{ type: 'LOADED' }], active)).toBe(active);
  });

  it('ignores a late review of some other workout, and the trophy outside finishing', () => {
    expect(run([{ type: 'REVIEW_READY', sessionId: 'old', review }], finishing)).toBe(finishing);
    expect(run([{ type: 'TROPHY_DONE' }], active)).toBe(active);
  });

  it('starts nothing over a workout already open', () => {
    expect(run([{ type: 'STARTED', sessionId: 's2' }], active)).toBe(active);
  });

  it('closes a waiting summary when another workout is adopted from home', () => {
    const waiting: WorkoutPhase = {
      kind: 'home',
      summary: { sessionId: 's1', review: 'pending', satisfaction: null },
    };
    expect(run([{ type: 'ADOPTED', sessionId: 's2' }], waiting)).toEqual({
      kind: 'active',
      sessionId: 's2',
    });
  });
});
