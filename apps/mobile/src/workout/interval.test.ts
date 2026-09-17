import { describe, expect, it } from 'vitest';

import {
  advance,
  buildPhases,
  clampSeconds,
  countdownCue,
  isFinished,
  pause,
  remainingSeconds,
  resume,
  skip,
  startIntervals,
} from './interval.js';

const T0 = 1_000_000;
const s = (seconds: number) => seconds * 1000;

describe('building the phases', () => {
  it('alternates work and rest, with no rest after the last exercise', () => {
    expect(buildPhases(3, 50, 10)).toEqual([
      { kind: 'work', exercise: 0, seconds: 50 },
      { kind: 'rest', exercise: 1, seconds: 10 },
      { kind: 'work', exercise: 1, seconds: 50 },
      { kind: 'rest', exercise: 2, seconds: 10 },
      { kind: 'work', exercise: 2, seconds: 50 },
    ]);
  });

  it('gives the example workout its full length: ten exercises of 50 with 10 between', () => {
    const phases = buildPhases(10, 50, 10);
    expect(phases).toHaveLength(19);
    expect(phases.reduce((total, phase) => total + phase.seconds, 0)).toBe(10 * 50 + 9 * 10);
  });

  it('points each rest at the exercise it is preparing for', () => {
    const rests = buildPhases(4, 40, 20).filter((phase) => phase.kind === 'rest');
    expect(rests.map((phase) => phase.exercise)).toEqual([1, 2, 3]);
  });

  it('runs exercises back to back when rest is zero', () => {
    expect(buildPhases(3, 30, 0).every((phase) => phase.kind === 'work')).toBe(true);
  });

  it('has nothing to run with no exercises', () => {
    expect(buildPhases(0, 50, 10)).toEqual([]);
  });
});

describe('running the timer', () => {
  const phases = buildPhases(3, 50, 10);

  it('starts on the first work phase with its full time', () => {
    const state = startIntervals(phases, T0);
    expect(state.phase).toBe(0);
    expect(remainingSeconds(state, T0)).toBe(50);
  });

  it('counts down against the deadline and reaches zero exactly at the end', () => {
    const state = startIntervals(phases, T0);
    expect(remainingSeconds(state, T0 + 100)).toBe(50);
    expect(remainingSeconds(state, T0 + s(49) + 1)).toBe(1);
    expect(remainingSeconds(state, T0 + s(50))).toBe(0);
  });

  it('does nothing and reports nothing before the phase ends', () => {
    const state = startIntervals(phases, T0);
    const result = advance(phases, state, T0 + s(49));
    expect(result.completed).toEqual([]);
    expect(result.state).toBe(state);
  });

  it('moves from work to rest when the work ends, and reports the work as done', () => {
    const result = advance(phases, startIntervals(phases, T0), T0 + s(50));
    expect(result.completed).toEqual([{ kind: 'work', exercise: 0, seconds: 50 }]);
    expect(phases[result.state.phase]).toEqual({ kind: 'rest', exercise: 1, seconds: 10 });
    expect(remainingSeconds(result.state, T0 + s(50))).toBe(10);
  });

  it('does not hand a late tick to the next phase', () => {
    // The tick arrives 700ms after the work ended. The rest must still end 10s after the work
    // did, not 10s after the tick — otherwise lateness accumulates over the workout.
    const late = advance(phases, startIntervals(phases, T0), T0 + s(50) + 700);
    expect(late.state.endsAt).toBe(T0 + s(60));
  });

  it('catches up across several phases after the screen was off, reporting each one', () => {
    // 50 work + 10 rest + 50 work = 110s; at 115s the second rest is under way.
    const result = advance(phases, startIntervals(phases, T0), T0 + s(115));
    expect(result.completed.map((phase) => phase.kind)).toEqual(['work', 'rest', 'work']);
    expect(phases[result.state.phase]).toEqual({ kind: 'rest', exercise: 2, seconds: 10 });
    expect(remainingSeconds(result.state, T0 + s(115))).toBe(5);
  });

  it('finishes after the last work phase and stops counting', () => {
    const result = advance(phases, startIntervals(phases, T0), T0 + s(170));
    expect(result.completed).toHaveLength(5);
    expect(isFinished(phases, result.state)).toBe(true);
    expect(result.state.endsAt).toBeNull();
    expect(remainingSeconds(result.state, T0 + s(999))).toBe(0);
  });

  it('can resume a workout from a later exercise', () => {
    const state = startIntervals(phases, T0, 2);
    expect(phases[state.phase]).toEqual({ kind: 'work', exercise: 2, seconds: 50 });
  });

  it('treats starting past the last exercise as already finished', () => {
    expect(isFinished(phases, startIntervals(phases, T0, 3))).toBe(true);
  });
});

describe('pausing', () => {
  const phases = buildPhases(2, 50, 10);

  it('freezes the remaining time, however long the pause lasts', () => {
    const paused = pause(startIntervals(phases, T0), T0 + s(20));
    expect(remainingSeconds(paused, T0 + s(20))).toBe(30);
    expect(remainingSeconds(paused, T0 + s(500))).toBe(30);
  });

  it('never ends a phase while paused', () => {
    const paused = pause(startIntervals(phases, T0), T0 + s(20));
    expect(advance(phases, paused, T0 + s(500)).completed).toEqual([]);
  });

  it('picks up where it stopped when resumed', () => {
    const paused = pause(startIntervals(phases, T0), T0 + s(20));
    const resumed = resume(phases, paused, T0 + s(300));
    expect(remainingSeconds(resumed, T0 + s(300))).toBe(30);
    expect(resumed.endsAt).toBe(T0 + s(330));
  });

  it('ignores a second pause and a resume while running', () => {
    const running = startIntervals(phases, T0);
    const paused = pause(running, T0 + s(10));
    expect(pause(paused, T0 + s(20))).toBe(paused);
    expect(resume(phases, running, T0 + s(5))).toBe(running);
  });
});

describe('skipping', () => {
  const phases = buildPhases(3, 50, 10);

  it('moves to the next phase at its full length', () => {
    const skipped = skip(phases, startIntervals(phases, T0), T0 + s(12));
    expect(phases[skipped.phase]).toEqual({ kind: 'rest', exercise: 1, seconds: 10 });
    expect(remainingSeconds(skipped, T0 + s(12))).toBe(10);
  });

  it('keeps a paused timer paused', () => {
    const paused = pause(startIntervals(phases, T0), T0 + s(12));
    const skipped = skip(phases, paused, T0 + s(40));
    expect(skipped.endsAt).toBeNull();
    expect(remainingSeconds(skipped, T0 + s(90))).toBe(10);
  });

  it('finishes the workout when skipping the last phase', () => {
    let state = startIntervals(phases, T0, 2);
    state = skip(phases, state, T0 + s(1));
    expect(isFinished(phases, state)).toBe(true);
  });
});

describe('keeping the settings sane', () => {
  it('rounds and bounds work time, which cannot be zero', () => {
    expect(clampSeconds(49.6, 'work')).toBe(50);
    expect(clampSeconds(0, 'work')).toBe(5);
    expect(clampSeconds(5000, 'work')).toBe(600);
  });

  it('lets rest be zero, but not negative', () => {
    expect(clampSeconds(0, 'rest')).toBe(0);
    expect(clampSeconds(-3, 'rest')).toBe(0);
  });

  it('falls back to the defaults for a value that is not a number', () => {
    expect(clampSeconds(Number.NaN, 'work')).toBe(50);
    expect(clampSeconds(Number.NaN, 'rest')).toBe(10);
  });
});

describe('the countdown before a phase ends', () => {
  const phases = buildPhases(2, 50, 10);

  it('is silent until the last three seconds', () => {
    const state = startIntervals(phases, T0);
    expect(countdownCue(phases, state, T0 + s(40), null)).toBeNull();
    expect(countdownCue(phases, state, T0 + s(46) + 500, null)).toBeNull();
  });

  it('sounds on 3, 2 and 1, once each', () => {
    const state = startIntervals(phases, T0);
    let last: string | null = null;
    const heard: string[] = [];
    // Ticks four times a second through the end of the phase, as the screen does.
    for (let ms = s(46); ms < s(50); ms += 250) {
      const cue = countdownCue(phases, state, T0 + ms, last);
      if (cue) {
        heard.push(cue);
        last = cue;
      }
    }
    expect(heard).toEqual(['0:3', '0:2', '0:1']);
  });

  it('counts down the rest the same way', () => {
    const resting = advance(phases, startIntervals(phases, T0), T0 + s(50)).state;
    expect(countdownCue(phases, resting, T0 + s(57) + 100, null)).toBe('1:3');
  });

  it('stays quiet while paused', () => {
    const paused = pause(startIntervals(phases, T0), T0 + s(48));
    expect(countdownCue(phases, paused, T0 + s(48), null)).toBeNull();
  });

  it('does not start a very short phase with a countdown tone', () => {
    // A three-second phase would otherwise sound its first tone together with the end of the
    // phase before it.
    const short = buildPhases(1, 3, 0);
    const state = startIntervals(short, T0);
    expect(countdownCue(short, state, T0, null)).toBeNull();
    expect(countdownCue(short, state, T0 + 1500, null)).toBe('0:2');
  });

  it('is silent once the workout is over', () => {
    const done = advance(phases, startIntervals(phases, T0), T0 + s(200)).state;
    expect(countdownCue(phases, done, T0 + s(200), null)).toBeNull();
  });
});
