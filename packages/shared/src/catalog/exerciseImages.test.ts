/**
 * Guards the generated image map against the one failure it is actually prone to: drift.
 *
 * The map is keyed by `nameEn`, which is also the key stored in every logged row. Rename an
 * exercise and the map silently stops matching — no crash, no warning, the photo just quietly
 * disappears. These tests turn that into a failing build instead.
 */

import { describe, expect, it } from 'vitest';

import { EXERCISE_IMAGE_KEYS, exerciseImageUrl, hasExerciseImage } from './exerciseImages.js';
import { EXERCISE_SEED } from './exercises.js';

const CATALOGUE_KEYS = new Set(EXERCISE_SEED.map((e) => e.nameEn));

describe('exercise image map', () => {
  it('has no entry for an exercise the catalogue no longer contains', () => {
    // The drift check. Renaming an exercise leaves its key here pointing at nothing, and the
    // photo vanishes with no error — so an orphan must fail the build instead.
    const orphans = EXERCISE_IMAGE_KEYS.filter((key) => !CATALOGUE_KEYS.has(key));
    expect(orphans).toEqual([]);
  });

  it('returns null rather than a broken URL for an unmatched exercise', () => {
    // The muscle map depends on this being null, not an empty string or a partial URL.
    expect(exerciseImageUrl('Definitely Not A Real Exercise')).toBeNull();
  });

  it('builds an absolute https URL for a covered exercise', () => {
    const covered = EXERCISE_SEED.find((e) => hasExerciseImage(e.nameEn));
    expect(covered).toBeDefined();
    const url = exerciseImageUrl(covered?.nameEn ?? '');
    expect(url).toMatch(/^https:\/\/.+\.(jpg|jpeg|png)$/i);
  });

  it('agrees with hasExerciseImage', () => {
    for (const exercise of EXERCISE_SEED) {
      const has = hasExerciseImage(exercise.nameEn);
      const url = exerciseImageUrl(exercise.nameEn);
      expect(has, exercise.nameEn).toBe(url !== null);
    }
  });

  it('covers a meaningful share of the catalogue', () => {
    // Not a quality bar so much as a tripwire: if a future regeneration collapses to a handful
    // of matches, that is a broken matcher rather than a genuinely emptier dataset.
    const covered = EXERCISE_SEED.filter((e) => hasExerciseImage(e.nameEn)).length;
    expect(covered / EXERCISE_SEED.length).toBeGreaterThan(0.35);
  });

  it('resolves every key it lists', () => {
    for (const key of EXERCISE_IMAGE_KEYS) {
      expect(exerciseImageUrl(key), key).not.toBeNull();
    }
  });
});
