import { describe, expect, it } from 'vitest';

import { EXERCISE_BY_KEY } from '../catalog/exercises.js';
import { setsPerMuscle, untrainedMuscles, volumeVerdict } from './muscleVolume.js';

// Real catalogue entries, so the test breaks if the catalogue's idea of these lifts changes.
const BENCH = 'Barbell Bench Press';
const CURL = 'Barbell Curl';
const PUSHDOWN = 'Cable Tricep Pushdown';

describe('the fixtures are real catalogue entries', () => {
  it('finds them, so the rest of this file is testing something', () => {
    // Without this, a renamed exercise would make every assertion below pass on an empty result.
    expect(EXERCISE_BY_KEY.get(BENCH)?.primaryMuscle).toBe('chest');
    expect(EXERCISE_BY_KEY.get(CURL)?.primaryMuscle).toBe('biceps');
    expect(EXERCISE_BY_KEY.get(PUSHDOWN)?.primaryMuscle).toBe('triceps');
    expect(EXERCISE_BY_KEY.get('Incline Barbell Bench Press')).toBeDefined();
  });
});

describe('setsPerMuscle', () => {
  it('counts a set fully for the muscle the exercise is for', () => {
    const work = setsPerMuscle([{ exerciseKey: BENCH, sets: 4 }]);
    const chest = work.find((w) => w.muscle === 'chest');

    expect(chest?.direct).toBe(4);
    expect(chest?.indirect).toBe(0);
    expect(chest?.total).toBe(4);
  });

  it('counts half a set for a helper', () => {
    // Bench presses the chest and works the triceps on the way. Counting that as full triceps
    // work would tell a heavy presser to drop the pushdowns they actually need.
    const work = setsPerMuscle([{ exerciseKey: BENCH, sets: 4 }]);
    expect(work.find((w) => w.muscle === 'triceps')?.total).toBe(2);
  });

  it('keeps direct and indirect apart', () => {
    // Half a set is a convention, not a measurement, so a reader has to be able to see how much
    // of a total is indirect before deciding anything from it.
    const work = setsPerMuscle([
      { exerciseKey: BENCH, sets: 4 },
      { exerciseKey: PUSHDOWN, sets: 3 },
    ]);
    const triceps = work.find((w) => w.muscle === 'triceps');

    expect(triceps?.direct).toBe(3);
    expect(triceps?.indirect).toBe(2);
    expect(triceps?.total).toBe(5);
  });

  it('adds up across exercises that share a muscle', () => {
    const work = setsPerMuscle([
      { exerciseKey: BENCH, sets: 3 },
      { exerciseKey: 'Incline Barbell Bench Press', sets: 3 },
    ]);
    expect(work.find((w) => w.muscle === 'chest')?.total).toBe(6);
  });

  it('puts the busiest muscle first', () => {
    const work = setsPerMuscle([
      { exerciseKey: CURL, sets: 2 },
      { exerciseKey: BENCH, sets: 8 },
    ]);
    expect(work[0]?.muscle).toBe('chest');
  });

  it('skips an exercise the catalogue does not know', () => {
    // A custom lift has no muscle attached. Bucketing it under "other" would put a number on
    // screen that no amount of training could move.
    expect(setsPerMuscle([{ exerciseKey: 'Some Invented Lift', sets: 5 }])).toEqual([]);
  });

  it('keeps cardio out of a list of muscles', () => {
    const cardio = [...EXERCISE_BY_KEY.values()].find((s) => s.primaryMuscle === 'cardio');
    expect(cardio).toBeDefined();
    expect(setsPerMuscle([{ exerciseKey: cardio!.nameEn, sets: 3 }])).toEqual([]);
  });

  it('ignores entries with no sets', () => {
    expect(setsPerMuscle([{ exerciseKey: BENCH, sets: 0 }])).toEqual([]);
    expect(setsPerMuscle([{ exerciseKey: BENCH, sets: Number.NaN }])).toEqual([]);
  });

  it('has nothing to say about an empty week', () => {
    expect(setsPerMuscle([])).toEqual([]);
  });

  it('does not let a muscle assist itself', () => {
    // A seed listing its own primary among its secondaries would count one set one and a half
    // times, and the error would look like a rounding problem rather than a bug.
    for (const seed of EXERCISE_BY_KEY.values()) {
      expect(seed.secondaryMuscles ?? [], seed.nameEn).not.toContain(seed.primaryMuscle);
    }
  });
});

describe('untrainedMuscles', () => {
  it('names what got nothing', () => {
    const worked = setsPerMuscle([{ exerciseKey: CURL, sets: 4 }]);
    const missing = untrainedMuscles(worked);

    expect(missing).toContain('chest');
    expect(missing).toContain('quads');
    expect(missing).not.toContain('biceps');
  });

  it('never lists cardio as an untrained muscle', () => {
    expect(untrainedMuscles([])).not.toContain('cardio');
  });

  it('lists everything when nothing was trained', () => {
    expect(untrainedMuscles([]).length).toBeGreaterThan(10);
  });
});

describe('volumeVerdict', () => {
  it('reads the usual range coarsely', () => {
    expect(volumeVerdict(6)).toBe('low');
    expect(volumeVerdict(14)).toBe('enough');
    expect(volumeVerdict(26)).toBe('high');
  });

  it('treats the boundaries as inside the range', () => {
    // 10 and 20 are the ends of a broad band, not a cliff. Calling 10 "low" would nag someone
    // who is doing exactly what the evidence suggests.
    expect(volumeVerdict(10)).toBe('enough');
    expect(volumeVerdict(20)).toBe('enough');
  });
});
