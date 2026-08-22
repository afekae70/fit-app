import { describe, expect, it } from 'vitest';

import { EXERCISE_BY_KEY } from '../catalog/exercises.js';
import { restAfterWarmup, restSecondsFor } from './rest.js';

describe('restSecondsFor', () => {
  it('gives the whole-body lifts minutes', () => {
    expect(restSecondsFor('squat')).toBe(180);
    expect(restSecondsFor('hinge')).toBe(180);
  });

  it('gives an isolation lift about a minute', () => {
    expect(restSecondsFor('isolation')).toBe(60);
  });

  it('puts presses and pulls between the two', () => {
    for (const pattern of ['horizontal_push', 'vertical_pull'] as const) {
      expect(restSecondsFor(pattern)).toBe(120);
    }
  });

  it('rests longer, not shorter, for a pattern it does not know', () => {
    // Being sent back to the bar too early is the worse failure of the two, and an unrecognised
    // pattern is likelier to be a big lift than a curl.
    expect(restSecondsFor(null)).toBe(120);
    expect(restSecondsFor(undefined)).toBe(120);
  });

  it('has an answer for every pattern the catalogue actually uses', () => {
    // The gap this closes: a pattern with no entry silently falls back, and the fallback looks
    // deliberate rather than missing.
    const patterns = new Set([...EXERCISE_BY_KEY.values()].map((s) => s.movementPattern));
    expect(patterns.size).toBeGreaterThan(5);
    for (const pattern of patterns) {
      expect(restSecondsFor(pattern), pattern).toBeGreaterThanOrEqual(60);
    }
  });

  it('never suggests a rest that would make a squat session unusable', () => {
    expect(restSecondsFor('squat')).toBeLessThanOrEqual(300);
  });
});

describe('restAfterWarmup', () => {
  it('is short, because a ramp is not the work', () => {
    expect(restAfterWarmup()).toBeLessThan(restSecondsFor('squat'));
  });
});
