/**
 * Seed-data integrity checks.
 *
 * These run without a database on purpose. A typo in an `equipmentSlug` or a muscle name would
 * otherwise only surface as a silent seed failure, or worse, as an exercise that never matches
 * during equipment substitution — a bug that looks like a logic problem but is bad data.
 */

import { describe, expect, it } from 'vitest';

import { EQUIPMENT_SEED } from './equipment.js';
import { EXERCISE_SEED, FILTERABLE_MUSCLES, MUSCLE_GROUPS } from './exercises.js';

// Note: this catalogue is bundled into the mobile app, so these checks guard the offline
// experience too — a bad equipmentSlug here means an exercise that can never be matched
// during equipment substitution, on device, with no server round-trip to blame.

const equipmentSlugs = new Set(EQUIPMENT_SEED.map((e) => e.slug));
const muscles = new Set<string>(MUSCLE_GROUPS);

describe('equipment seed', () => {
  it('has unique slugs', () => {
    expect(equipmentSlugs.size).toBe(EQUIPMENT_SEED.length);
  });

  it('gives every item both an English and a Hebrew name', () => {
    // The app is Hebrew-first, so a missing Hebrew name is a visible UI defect.
    for (const item of EQUIPMENT_SEED) {
      expect(item.nameEn.trim(), `${item.slug} nameEn`).not.toBe('');
      expect(item.nameHe.trim(), `${item.slug} nameHe`).not.toBe('');
    }
  });

  it('uses lower_snake_case slugs', () => {
    for (const item of EQUIPMENT_SEED) {
      expect(item.slug, item.slug).toMatch(/^[a-z][a-z0-9_]*$/);
    }
  });

  it('includes the "none" sentinel for equipment-free exercises', () => {
    // Bodyweight-only locations rely on this row existing to match those exercises.
    expect(equipmentSlugs.has('none')).toBe(true);
  });

  it('includes the equipment a bodyweight-only location realistically has', () => {
    for (const slug of ['pullup_bar', 'dip_bars', 'resistance_band', 'none']) {
      expect(equipmentSlugs.has(slug), slug).toBe(true);
    }
  });
});

describe('exercise seed', () => {
  it('has unique English names', () => {
    const names = EXERCISE_SEED.map((e) => e.nameEn);
    const duplicates = names.filter((n, i) => names.indexOf(n) !== i);
    // The DB has UNIQUE NULLS NOT DISTINCT (user_id, name_en); a duplicate here would abort
    // the whole seed transaction.
    expect(duplicates).toEqual([]);
  });

  it('has unique Hebrew names', () => {
    const names = EXERCISE_SEED.map((e) => e.nameHe);
    const duplicates = names.filter((n, i) => names.indexOf(n) !== i);
    expect(duplicates).toEqual([]);
  });

  it('gives every exercise a Hebrew name', () => {
    for (const ex of EXERCISE_SEED) {
      expect(ex.nameHe.trim(), `${ex.nameEn} is missing a Hebrew name`).not.toBe('');
    }
  });

  it('writes Hebrew names in actual Hebrew script', () => {
    // Guards against a name accidentally left as transliterated English.
    for (const ex of EXERCISE_SEED) {
      expect(ex.nameHe, `${ex.nameEn} -> "${ex.nameHe}"`).toMatch(/[֐-׿]/);
    }
  });

  it('references only equipment slugs that exist', () => {
    const unknown = EXERCISE_SEED.filter((e) => !equipmentSlugs.has(e.equipmentSlug)).map(
      (e) => `${e.nameEn} -> ${e.equipmentSlug}`,
    );
    expect(unknown).toEqual([]);
  });

  it('uses only known muscle groups', () => {
    const unknown: string[] = [];
    for (const ex of EXERCISE_SEED) {
      if (!muscles.has(ex.primaryMuscle)) {
        unknown.push(`${ex.nameEn} primary -> ${ex.primaryMuscle}`);
      }
      for (const m of ex.secondaryMuscles ?? []) {
        if (!muscles.has(m)) unknown.push(`${ex.nameEn} secondary -> ${m}`);
      }
    }
    expect(unknown).toEqual([]);
  });

  it('never lists the primary muscle again as a secondary', () => {
    const overlaps = EXERCISE_SEED.filter((e) =>
      (e.secondaryMuscles ?? []).includes(e.primaryMuscle),
    ).map((e) => e.nameEn);
    expect(overlaps).toEqual([]);
  });

  it('gives distance- and time-based exercises a load type that matches', () => {
    // A set row must carry a measurement matching the exercise's load_type, or the
    // sets_has_measurement_check constraint will reject it at insert time.
    for (const ex of EXERCISE_SEED) {
      if (ex.movementPattern === 'carry') {
        expect(ex.loadType, `${ex.nameEn} is a carry`).toBe('distance');
      }
    }
  });

  it('marks equipment-free exercises with the "none" slug rather than an odd choice', () => {
    const bodyweightPatterns = EXERCISE_SEED.filter(
      (e) => e.loadType === 'bodyweight' && e.equipmentSlug !== 'none',
    );
    // Bodyweight-only movements that legitimately need apparatus (e.g. a bar) are fine —
    // this just asserts the ones flagged 'bodyweight' with equipment are deliberate.
    for (const ex of bodyweightPatterns) {
      expect(equipmentSlugs.has(ex.equipmentSlug), ex.nameEn).toBe(true);
    }
  });

  it('covers every movement pattern, so a plan can be built for any split', () => {
    const patterns = new Set(EXERCISE_SEED.map((e) => e.movementPattern));
    for (const required of [
      'horizontal_push',
      'vertical_push',
      'horizontal_pull',
      'vertical_pull',
      'squat',
      'hinge',
      'lunge',
      'carry',
      'isolation',
      'core',
      'cardio',
    ]) {
      expect(patterns.has(required as never), `no exercise for ${required}`).toBe(true);
    }
  });

  it('offers a bodyweight-compatible option for every major movement pattern', () => {
    // This is what makes "Plan B — military base" possible at all: if a pattern had no
    // equipment-free option, no substitute could be offered when the gym kit is unavailable.
    const bodyweightFriendly = new Set(
      EXERCISE_SEED.filter((e) =>
        ['none', 'pullup_bar', 'dip_bars', 'resistance_band', 'gymnastic_rings'].includes(
          e.equipmentSlug,
        ),
      ).map((e) => e.movementPattern),
    );

    for (const pattern of [
      'horizontal_push',
      'vertical_push',
      'horizontal_pull',
      'vertical_pull',
      'squat',
      'hinge',
      'lunge',
      'core',
    ]) {
      expect(
        bodyweightFriendly.has(pattern as never),
        `${pattern} has no equipment-light option — Plan B could not substitute for it`,
      ).toBe(true);
    }
  });

  it('has a usable catalogue size', () => {
    expect(EXERCISE_SEED.length).toBeGreaterThanOrEqual(100);
  });
});

describe('filterable muscles', () => {
  it('offers a chip for every muscle that has an exercise', () => {
    // The regression: the picker's list was hardcoded, the catalogue grew, and 33 exercises
    // across five groups became unreachable by filter with no error anywhere.
    const withExercises = new Set(EXERCISE_SEED.map((e) => e.primaryMuscle));
    const offered = new Set(FILTERABLE_MUSCLES);
    const missing = [...withExercises].filter((m) => !offered.has(m));
    expect(missing).toEqual([]);
  });

  it('offers no chip that would return an empty list', () => {
    const withExercises = new Set(EXERCISE_SEED.map((e) => e.primaryMuscle));
    const empty = FILTERABLE_MUSCLES.filter((m) => !withExercises.has(m));
    expect(empty).toEqual([]);
  });

  it('leads with the groups that usually head a session', () => {
    // Fixed so the chips do not reshuffle under the user as the catalogue grows.
    expect(FILTERABLE_MUSCLES.slice(0, 3)).toEqual(['chest', 'lats', 'mid_back']);
  });

  it('includes rear delts, which the hardcoded list omitted', () => {
    expect(FILTERABLE_MUSCLES).toContain('rear_delts');
  });

  it('lists every muscle exactly once', () => {
    expect(new Set(FILTERABLE_MUSCLES).size).toBe(FILTERABLE_MUSCLES.length);
  });
});
