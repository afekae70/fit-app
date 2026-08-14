import { describe, expect, it } from 'vitest';

import {
  exerciseVolume,
  formatRemaining,
  nextSet,
  restRingOffset,
  sessionVolume,
  setProgress,
  stepReps,
  stepWeight,
  type DerivedExercise,
} from './derived.js';

const set = (weightKg: number | null, reps: number | null, done = false) => ({ weightKg, reps, done });

const bench: DerivedExercise = {
  name: 'לחיצת חזה במוט',
  sets: [set(80, 8, true), set(80, 7, true), set(80, 6)],
};
const rows: DerivedExercise = { name: 'חתירה', sets: [set(60, 10), set(60, 10)] };

describe('setProgress', () => {
  it('counts done against total across every exercise', () => {
    expect(setProgress([bench, rows])).toEqual({ done: 2, total: 5, fraction: 2 / 5 });
  });

  it('reads as zero for an empty workout rather than NaN', () => {
    // NaN renders as a zero-width bar, which looks correct by accident right up until someone
    // interpolates it.
    expect(setProgress([])).toEqual({ done: 0, total: 0, fraction: 0 });
    expect(setProgress([{ name: 'x', sets: [] }]).fraction).toBe(0);
  });

  it('reaches exactly 1 when everything is ticked', () => {
    const all: DerivedExercise = { name: 'x', sets: [set(50, 5, true), set(50, 5, true)] };
    expect(setProgress([all]).fraction).toBe(1);
  });
});

describe('exerciseVolume', () => {
  it('sums weight by reps over completed sets only', () => {
    expect(exerciseVolume(bench.sets)).toBe(80 * 8 + 80 * 7);
  });

  it('ignores a planned set, so adding empty sets does not inflate it', () => {
    expect(exerciseVolume(rows.sets)).toBe(0);
  });

  it('skips a completed set with no weight instead of counting it as zero', () => {
    // Bodyweight work is the common case and genuinely has no load. Treating null as 0 would be
    // the same number, but treating null as 1 rep or 1 kg elsewhere would not — this pins intent.
    expect(exerciseVolume([set(null, 12, true), set(40, 10, true)])).toBe(400);
  });

  it('skips a completed set with no reps', () => {
    expect(exerciseVolume([set(100, null, true)])).toBe(0);
  });

  it('totals across exercises for the finish summary', () => {
    expect(sessionVolume([bench, rows])).toBe(80 * 8 + 80 * 7);
  });
});

describe('nextSet', () => {
  it('names the first unfinished set in order', () => {
    expect(nextSet([bench, rows])).toEqual({ exerciseName: bench.name, setNumber: 3 });
  });

  it('moves on to the next exercise once one is complete', () => {
    const finished: DerivedExercise = { name: 'לחיצה', sets: [set(80, 8, true)] };
    expect(nextSet([finished, rows])).toEqual({ exerciseName: 'חתירה', setNumber: 1 });
  });

  it('finds a set skipped earlier rather than only looking forward', () => {
    // People work out of order. Naming "the set after the one just ticked" would skip this one
    // permanently; scanning from the top always names something real.
    const skipped: DerivedExercise = { name: 'x', sets: [set(50, 5), set(50, 5, true)] };
    expect(nextSet([skipped])).toEqual({ exerciseName: 'x', setNumber: 1 });
  });

  it('is null when everything is done, so the banner stops promising a next set', () => {
    const all: DerivedExercise = { name: 'x', sets: [set(50, 5, true)] };
    expect(nextSet([all])).toBeNull();
    expect(nextSet([])).toBeNull();
  });
});

describe('restRingOffset', () => {
  const C = 100;

  it('is a full circle at the start and empty at zero', () => {
    expect(restRingOffset(90, 90, C)).toBe(0);
    expect(restRingOffset(0, 90, C)).toBe(C);
  });

  it('is half drawn at half time', () => {
    expect(restRingOffset(45, 90, C)).toBe(50);
  });

  it('clamps when the phone slept past the end', () => {
    // `remaining` is a deadline minus now, so it goes negative while the screen is off. Past the
    // circumference the stroke wraps and starts drawing itself back on.
    expect(restRingOffset(-30, 90, C)).toBe(C);
    expect(restRingOffset(120, 90, C)).toBe(0);
  });

  it('does not divide by zero', () => {
    expect(restRingOffset(10, 0, C)).toBe(C);
  });
});

describe('formatRemaining', () => {
  it('pads the seconds', () => {
    expect(formatRemaining(90)).toBe('1:30');
    expect(formatRemaining(65)).toBe('1:05');
    expect(formatRemaining(9)).toBe('0:09');
  });

  it('rounds up, so a timer never shows 0:00 with time left on it', () => {
    expect(formatRemaining(0.4)).toBe('0:01');
  });

  it('never goes negative', () => {
    expect(formatRemaining(-7)).toBe('0:00');
  });
});

describe('steppers', () => {
  it('moves weight in 2.5kg steps', () => {
    expect(stepWeight(80, 1)).toBe(82.5);
    expect(stepWeight(80, -1)).toBe(77.5);
  });

  it('snaps an off-grid value back onto the grid', () => {
    // 83 came from a previous session or a keypad. One tap should reach a loadable number, not
    // carry the 0.5 offset through the rest of the workout.
    expect(stepWeight(83, 1)).toBe(85);
    expect(stepWeight(83, -1)).toBe(80);
  });

  it('does not accumulate binary drift', () => {
    let w = stepWeight(null, 1);
    for (let i = 0; i < 20; i += 1) w = stepWeight(w, 1);
    expect(w).toBe(52.5);
  });

  it('never goes below zero', () => {
    expect(stepWeight(0, -1)).toBe(0);
    expect(stepWeight(1, -1)).toBe(0);
  });

  it('starts an empty weight at one step up', () => {
    expect(stepWeight(null, 1)).toBe(2.5);
  });

  it('moves reps one at a time and starts an empty field at one', () => {
    expect(stepReps(8, 1)).toBe(9);
    expect(stepReps(8, -1)).toBe(7);
    expect(stepReps(null, 1)).toBe(1);
    expect(stepReps(null, -1)).toBe(0);
    expect(stepReps(0, -1)).toBe(0);
  });

  describe('in imperial', () => {
    /** What the user reads, which is the space the grid is supposed to live in. */
    const asLb = (kg: number) => Math.round((kg / 0.45359237) * 10) / 10;

    it('moves in whole 5 lb steps, not a converted 2.5 kg', () => {
      // 225 lb is a rack number. A 2.5 kg step would take it to 230.5, which no pair of plates
      // in an American gym can make.
      const from225 = 225 * 0.45359237;
      expect(asLb(stepWeight(from225, 1, 'imperial'))).toBe(230);
      expect(asLb(stepWeight(from225, -1, 'imperial'))).toBe(220);
    });

    it('snaps an off-grid value onto the pound grid', () => {
      // 100 kg reads as 220.5 lb — one tap up should reach 225, not 225.5.
      expect(asLb(stepWeight(100, 1, 'imperial'))).toBe(225);
      expect(asLb(stepWeight(100, -1, 'imperial'))).toBe(215);
    });

    it('does not accumulate drift across many taps', () => {
      // Each step re-snaps in display space, so the kilogram rounding cannot compound.
      let w = stepWeight(null, 1, 'imperial');
      for (let i = 0; i < 20; i += 1) w = stepWeight(w, 1, 'imperial');
      expect(asLb(w)).toBe(105);
    });

    it('never goes below zero', () => {
      expect(stepWeight(0, -1, 'imperial')).toBe(0);
      expect(stepWeight(1, -1, 'imperial')).toBe(0);
    });

    it('still defaults to the metric grid when no unit is given', () => {
      // Every existing caller passes two arguments; none of them may silently change behaviour.
      expect(stepWeight(80, 1)).toBe(82.5);
    });
  });
});
