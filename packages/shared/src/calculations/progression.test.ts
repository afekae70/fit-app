import { describe, expect, it } from 'vitest';

import { suggestProgression, type CompletedSet } from './progression.js';

const sets = (...pairs: [number, number][]): CompletedSet[] =>
  pairs.map(([weightKg, reps]) => ({ weightKg, reps }));

describe('suggestProgression', () => {
  describe('with a prescribed rep range', () => {
    const range = { repsMin: 6, repsMax: 8 } as const;

    it('adds weight once every set fills the range', () => {
      const advice = suggestProgression({
        lastSets: sets([80, 8], [80, 8], [80, 8]),
        ...range,
        movementPattern: 'horizontal_push',
      });
      expect(advice).toEqual({ kind: 'add_weight', weightKg: 82.5, reps: 6, fromKg: 80 });
    });

    it('holds the weight while any set is short', () => {
      // The one that matters: 8, 8, 7 is not a completed load, and adding weight to it carries
      // a failed set forward into a heavier session.
      const advice = suggestProgression({
        lastSets: sets([80, 8], [80, 8], [80, 7]),
        ...range,
        movementPattern: 'horizontal_push',
      });
      expect(advice).toEqual({ kind: 'add_reps', weightKg: 80, reps: 8, fromReps: 7 });
    });

    it('moves lower-body patterns by a full pair of plates', () => {
      // 2.5 kg on a squat is inside the noise of a good night's sleep.
      const advice = suggestProgression({
        lastSets: sets([100, 8], [100, 8]),
        ...range,
        movementPattern: 'squat',
      });
      expect(advice).toMatchObject({ kind: 'add_weight', weightKg: 105 });
    });

    it('starts the range again from the bottom after a jump', () => {
      // Adding weight AND holding the top of the range at once is two progressions in one
      // session, which is how a working set becomes a failed one.
      const advice = suggestProgression({
        lastSets: sets([80, 8], [80, 8]),
        ...range,
        movementPattern: 'horizontal_pull',
      });
      expect(advice).toMatchObject({ reps: 6 });
    });

    it('reads more reps than asked for as the range being full', () => {
      const advice = suggestProgression({
        lastSets: sets([80, 10], [80, 9]),
        ...range,
        movementPattern: 'horizontal_push',
      });
      expect(advice).toMatchObject({ kind: 'add_weight' });
    });
  });

  describe('with no plan behind the session', () => {
    it('adds weight when every set held the same reps', () => {
      // Three sets of 8 is a load that was completed, whatever nobody prescribed.
      const advice = suggestProgression({
        lastSets: sets([60, 8], [60, 8], [60, 8]),
        movementPattern: 'vertical_push',
      });
      expect(advice).toEqual({ kind: 'add_weight', weightKg: 62.5, reps: 8, fromKg: 60 });
    });

    it('repeats the load when the sets fell away', () => {
      // 8, 7, 6 is fatigue, not a completed load — and it is the shape that would otherwise be
      // read as "no target, so climb".
      const advice = suggestProgression({
        lastSets: sets([60, 8], [60, 7], [60, 6]),
        movementPattern: 'vertical_push',
      });
      expect(advice).toEqual({ kind: 'add_reps', weightKg: 60, reps: 8, fromReps: 6 });
    });

    it('says nothing about a single set', () => {
      // One set has no drop-off to read, and inventing a rep range to judge it against would be
      // a guess about somebody else's training.
      expect(
        suggestProgression({ lastSets: sets([60, 8]), movementPattern: 'vertical_push' }),
      ).toBeNull();
    });
  });

  describe('back-off sets', () => {
    it('progresses the heaviest set, not the lightest', () => {
      // A top set followed by back-offs must not suggest 62.5 — that is a suggestion to go
      // backwards, dressed as progress.
      const advice = suggestProgression({
        lastSets: sets([100, 5], [60, 10], [60, 10]),
        movementPattern: 'horizontal_push',
        repsMin: 5,
        repsMax: 5,
      });
      expect(advice).toEqual({ kind: 'add_weight', weightKg: 102.5, reps: 5, fromKg: 100 });
    });

    it('judges completion on the top sets alone', () => {
      // The back-offs are lighter by design; counting them as short sets would hold the top set
      // back forever.
      const advice = suggestProgression({
        lastSets: sets([100, 8], [100, 8], [70, 12]),
        movementPattern: 'horizontal_push',
        repsMin: 6,
        repsMax: 8,
      });
      expect(advice).toMatchObject({ kind: 'add_weight', fromKg: 100 });
    });
  });

  describe('stalling', () => {
    it('backs off about a tenth, on the grid', () => {
      const advice = suggestProgression({
        lastSets: sets([100, 5], [100, 5]),
        movementPattern: 'horizontal_push',
        isStalling: true,
      });
      expect(advice).toEqual({ kind: 'deload', weightKg: 90, reps: 5, fromKg: 100 });
    });

    it('outranks a session that otherwise earned a jump', () => {
      // Every set full, but nothing has beaten the best in weeks. Climbing again is how a
      // plateau becomes an injury.
      const advice = suggestProgression({
        lastSets: sets([100, 8], [100, 8]),
        repsMin: 6,
        repsMax: 8,
        movementPattern: 'horizontal_push',
        isStalling: true,
      });
      expect(advice).toMatchObject({ kind: 'deload' });
    });

    it('always changes the number by at least one step', () => {
      // 10% of 20 kg snaps down to 0, and a deload that moves nothing is advice nobody can act
      // on. 20 - 2.5 = 17.5.
      const advice = suggestProgression({
        lastSets: sets([20, 10], [20, 10]),
        movementPattern: 'isolation',
        isStalling: true,
      });
      expect(advice).toMatchObject({ kind: 'deload', weightKg: 17.5 });
    });

    it('has nothing to suggest below one step', () => {
      expect(
        suggestProgression({
          lastSets: sets([2.5, 12]),
          movementPattern: 'isolation',
          isStalling: true,
        }),
      ).toBeNull();
    });
  });

  describe('refusing to guess', () => {
    it('says nothing for work that is not loaded in kilograms', () => {
      // The number would be written straight into a weight field, and a pull-up does not take
      // one. Bodyweight work progresses — just not by this arithmetic.
      for (const loadType of ['bodyweight', 'bodyweight_plus', 'time', 'distance'] as const) {
        expect(
          suggestProgression({
            lastSets: sets([0, 10], [0, 10]),
            movementPattern: 'vertical_pull',
            loadType,
          }),
        ).toBeNull();
      }
    });

    it('says nothing without history', () => {
      expect(
        suggestProgression({ lastSets: [], movementPattern: 'horizontal_push' }),
      ).toBeNull();
    });

    it('ignores rows that were started and left', () => {
      // A weight with no reps is an empty row, not a set of zero.
      expect(
        suggestProgression({
          lastSets: [
            { weightKg: 80, reps: null },
            { weightKg: null, reps: 8 },
          ],
          movementPattern: 'horizontal_push',
        }),
      ).toBeNull();
    });

    it('does not drift off the grid over repeated jumps', () => {
      // Repeated 2.5 addition in floating point is exactly where 87.49999999999999 appears.
      let weight = 80;
      for (let i = 0; i < 12; i++) {
        const advice = suggestProgression({
          lastSets: sets([weight, 8], [weight, 8]),
          repsMin: 8,
          repsMax: 8,
          movementPattern: 'horizontal_push',
        });
        expect(advice?.kind).toBe('add_weight');
        weight = advice!.weightKg;
      }
      expect(weight).toBe(110);
    });
  });
});
