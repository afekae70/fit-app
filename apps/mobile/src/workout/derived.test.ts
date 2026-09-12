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
  firstUnfinishedStation,
  isExerciseDone,
  labelSets,
  stations,
  swipeTarget,
  type DerivedExercise,
} from './derived.js';

const set = (weightKg: number | null, reps: number | null, done = false, isWarmup = false) => ({
  weightKg,
  reps,
  done,
  isWarmup,
  rpe: null,
  toFailure: false,
  isDrop: false,
});

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

describe('labelSets', () => {
  const warm = { isWarmup: true };
  const work = { isWarmup: false };

  it('numbers the working sets as if the warm-ups were not there', () => {
    // The bug this exists to fix: ramping toward a lift turned three sets of eight into sets
    // four, five and six, while the volume and the charts went on counting three.
    expect(labelSets([warm, warm, work, work, work])).toEqual([
      { kind: 'warmup', ordinal: 1 },
      { kind: 'warmup', ordinal: 2 },
      { kind: 'working', ordinal: 1 },
      { kind: 'working', ordinal: 2 },
      { kind: 'working', ordinal: 3 },
    ]);
  });

  it('numbers plain sets from one', () => {
    expect(labelSets([work, work]).map((l) => l.ordinal)).toEqual([1, 2]);
  });

  it('keeps a warm-up in the middle where it happened', () => {
    // Unusual, but it is what was logged, and renumbering it away would be the screen editing
    // the record rather than showing it.
    expect(labelSets([work, warm, work])).toEqual([
      { kind: 'working', ordinal: 1 },
      { kind: 'warmup', ordinal: 1 },
      { kind: 'working', ordinal: 2 },
    ]);
  });

  it('has nothing to say about no sets', () => {
    expect(labelSets([])).toEqual([]);
  });
});

describe('labelSets and drop sets', () => {
  const warm = { isWarmup: true };
  const work = { isWarmup: false };
  const drop = { isWarmup: false, isDrop: true };

  it('does not number a drop set as a new working set', () => {
    // Three sets of curls with two drops is still three sets. Numbering the drops would make it
    // read as five and disagree with the volume, which counts them as work but not as sets.
    expect(labelSets([work, drop, drop, work, work]).map((l) => l.kind)).toEqual([
      'working',
      'drop',
      'drop',
      'working',
      'working',
    ]);
    expect(labelSets([work, drop, drop, work, work]).map((l) => l.ordinal)).toEqual([1, 1, 1, 2, 3]);
  });

  it('carries the parent ordinal so a drop says which set it came from', () => {
    expect(labelSets([work, work, drop])[2]).toEqual({ kind: 'drop', ordinal: 2 });
  });

  it('still numbers warm-ups separately alongside drops', () => {
    expect(labelSets([warm, work, drop]).map((l) => l.kind)).toEqual(['warmup', 'working', 'drop']);
  });
});

describe('stations', () => {
  it('makes a station of every exercise when nothing is linked', () => {
    expect(stations([false, false, false])).toEqual([[0], [1], [2]]);
  });

  it('keeps a superset together', () => {
    // The pair is performed with no rest between them, so a screen showing one of them alone
    // would be arguing with the training.
    expect(stations([true, false, false])).toEqual([[0, 1], [2]]);
  });

  it('keeps a chain of three together', () => {
    expect(stations([true, true, false])).toEqual([[0, 1, 2]]);
  });

  it('treats a link on the last exercise as the end of the run', () => {
    // The flag can outlive the exercise that used to follow it, and a group reaching past the
    // end would index nothing.
    expect(stations([false, true])).toEqual([[0], [1]]);
  });

  it('has no stations for no exercises', () => {
    expect(stations([])).toEqual([]);
  });
});

describe('isExerciseDone', () => {
  const working = (done: boolean) => ({ done, isWarmup: false });
  const warmup = (done: boolean) => ({ done, isWarmup: true });

  it('is done when every working set is ticked', () => {
    expect(isExerciseDone([working(true), working(true)])).toBe(true);
  });

  it('is not done while one working set is left', () => {
    expect(isExerciseDone([working(true), working(false)])).toBe(false);
  });

  it('ignores warm-ups in both directions', () => {
    // A ramp is not the work: an unticked warm-up must not hold the exercise open, and a ticked
    // one must not stand in for work that has not happened.
    expect(isExerciseDone([warmup(false), working(true)])).toBe(true);
    expect(isExerciseDone([warmup(true), working(false)])).toBe(false);
  });

  it('is not done when there is nothing to do yet', () => {
    // An empty card is something still to come. Calling it finished would march straight past
    // the exercise somebody has only just added.
    expect(isExerciseDone([])).toBe(false);
    expect(isExerciseDone([warmup(true)])).toBe(false);
  });
});

describe('firstUnfinishedStation', () => {
  const groups = [[0], [1, 2], [3]];

  it('finds the first station with work left', () => {
    expect(firstUnfinishedStation(groups, [true, false, false, false])).toBe(1);
  });

  it('skips stations that are finished', () => {
    expect(firstUnfinishedStation(groups, [true, true, true, false])).toBe(2);
  });

  it('holds a superset open until every member is done', () => {
    // Half a superset is not a finished station — the second exercise is the rest.
    expect(firstUnfinishedStation(groups, [true, true, false, false])).toBe(1);
  });

  it('is null once everything is finished', () => {
    // A real answer, not a fallback: it is what the screen uses to offer finishing instead.
    expect(firstUnfinishedStation(groups, [true, true, true, true])).toBeNull();
  });

  it('is null when there are no stations at all', () => {
    expect(firstUnfinishedStation([], [])).toBeNull();
  });
});

describe('swiping between exercises', () => {
  const WIDTH = 400;

  it('goes forward on a drag to the left and back on a drag to the right', () => {
    expect(swipeTarget(-100, 1, 5, WIDTH)).toBe(2);
    expect(swipeTarget(100, 1, 5, WIDTH)).toBe(0);
  });

  it('ignores a drag too short to have been meant', () => {
    expect(swipeTarget(-20, 1, 5, WIDTH)).toBeNull();
    expect(swipeTarget(20, 1, 5, WIDTH)).toBeNull();
    expect(swipeTarget(0, 1, 5, WIDTH)).toBeNull();
  });

  it('stops at both ends instead of wrapping around', () => {
    expect(swipeTarget(100, 0, 5, WIDTH)).toBeNull();
    expect(swipeTarget(-100, 4, 5, WIDTH)).toBeNull();
  });

  it('never asks a wide screen for a longer swipe than a thumb makes', () => {
    // 22% of a tablet would be far past what a thumb reaches without shifting grip.
    expect(swipeTarget(-85, 1, 5, 1200)).toBe(2);
    expect(swipeTarget(-79, 1, 5, 1200)).toBeNull();
  });

  it('scales down on a narrow screen rather than holding at 80px', () => {
    expect(swipeTarget(-50, 1, 5, 200)).toBe(2);
  });

  it('has nowhere to go in a workout of one exercise', () => {
    expect(swipeTarget(-100, 0, 1, WIDTH)).toBeNull();
    expect(swipeTarget(100, 0, 1, WIDTH)).toBeNull();
  });
});
