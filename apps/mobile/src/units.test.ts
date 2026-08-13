/**
 * Unit conversion tests.
 *
 * The drift cases get the most attention. A conversion that is merely approximately right is
 * fine for one reading and corrosive over a year of them: every one of these numbers is stored
 * and re-displayed hundreds of times, and an error that compounds on each write would show up
 * as a bodyweight trend that slowly invents a gain nobody made.
 */

import { describe, expect, it } from 'vitest';

import {
  cmToDisplay,
  DEFAULT_UNIT_SYSTEM,
  displayDistanceToMetres,
  displayHeightToCm,
  displayWeightToKg,
  distanceUnitKey,
  formatHeight,
  formatVolume,
  formatWeight,
  heightUnitKey,
  isEditedWeight,
  kgToDisplay,
  metresToDisplay,
  parseUnitSystem,
  weightUnitKey,
} from './units.js';

describe('parseUnitSystem', () => {
  it('falls back to the default for anything unrecognised', () => {
    expect(parseUnitSystem('imperial')).toBe('imperial');
    expect(parseUnitSystem('metric')).toBe('metric');
    // Null is what a profile row holds before the user ever opens settings.
    expect(parseUnitSystem(null)).toBe(DEFAULT_UNIT_SYSTEM);
    expect(parseUnitSystem(undefined)).toBe(DEFAULT_UNIT_SYSTEM);
    expect(parseUnitSystem('furlongs')).toBe(DEFAULT_UNIT_SYSTEM);
  });
});

describe('weight', () => {
  it('is a no-op in metric', () => {
    expect(kgToDisplay(80, 'metric')).toBe(80);
    expect(kgToDisplay(82.5, 'metric')).toBe(82.5);
    expect(displayWeightToKg(82.5, 'metric')).toBe(82.5);
  });

  it('converts to pounds at the defined ratio', () => {
    expect(kgToDisplay(100, 'imperial')).toBe(220.5);
    expect(kgToDisplay(0, 'imperial')).toBe(0);
    // 45 lb is the standard Olympic bar; it must not render as 44.9 or 45.1.
    expect(kgToDisplay(20.4116665, 'imperial')).toBe(45);
  });

  it('converts typed pounds back without a second rounding', () => {
    // Rounding here as well as on display would compound the error on every edit.
    expect(displayWeightToKg(45, 'imperial')).toBeCloseTo(20.41166, 5);
    // 100 kg displays as 220.5 lb, which converts back to 100.017 kg — a 17 gram round-trip
    // error. Harmless once; this is precisely what isEditedWeight stops from accumulating.
    expect(displayWeightToKg(220.5, 'imperial')).toBeCloseTo(100.0172, 3);
  });

  it('rounds display to one decimal, never more', () => {
    // 220.46226… would read as a measurement error rather than a conversion.
    expect(String(kgToDisplay(100, 'imperial'))).toBe('220.5');
    expect(String(kgToDisplay(83.33333, 'metric'))).toBe('83.3');
  });

  it('names the right unit key', () => {
    expect(weightUnitKey('metric')).toBe('kg');
    expect(weightUnitKey('imperial')).toBe('lb');
  });
});

describe('isEditedWeight', () => {
  it('reports no edit when the field still shows the stored value', () => {
    // The drift guard. In imperial, 100 kg displays as 220.5 lb, which converts back to
    // 99.9977 kg — writing that on every blur is how a stored weight walks away from itself.
    expect(isEditedWeight(100, 220.5, 'imperial')).toBe(false);
    expect(isEditedWeight(82.5, 82.5, 'metric')).toBe(false);
  });

  it('reports an edit when the typed value differs', () => {
    expect(isEditedWeight(100, 225, 'imperial')).toBe(true);
    expect(isEditedWeight(82.5, 83, 'metric')).toBe(true);
  });

  it('treats clearing a field and filling an empty one as edits', () => {
    expect(isEditedWeight(82.5, null, 'metric')).toBe(true);
    expect(isEditedWeight(null, 82.5, 'metric')).toBe(true);
    expect(isEditedWeight(null, null, 'metric')).toBe(false);
  });

  it('survives repeated open-and-blur cycles without drifting', () => {
    // The actual failure mode, played out: display, write back, display again, ten times over.
    let stored = 100;
    for (let i = 0; i < 10; i += 1) {
      const shown = kgToDisplay(stored, 'imperial');
      if (isEditedWeight(stored, shown, 'imperial')) {
        stored = displayWeightToKg(shown, 'imperial');
      }
    }
    expect(stored).toBe(100);
  });
});

describe('height', () => {
  it('converts and names units', () => {
    expect(cmToDisplay(180, 'metric')).toBe(180);
    expect(cmToDisplay(180, 'imperial')).toBe(70.9);
    expect(displayHeightToCm(70.9, 'imperial')).toBeCloseTo(180.086, 3);
    expect(heightUnitKey('metric')).toBe('cm');
    expect(heightUnitKey('imperial')).toBe('inch');
  });

  it('formats imperial height the way a person says it', () => {
    expect(formatHeight(180, 'metric')).toBe('180');
    expect(formatHeight(180, 'imperial')).toBe(`5'11"`);
    // Exactly six feet must not come out as 5'12".
    expect(formatHeight(182.88, 'imperial')).toBe(`6'0"`);
  });

  it('passes null through rather than inventing a zero', () => {
    expect(formatHeight(null, 'metric')).toBeNull();
    expect(formatHeight(undefined, 'imperial')).toBeNull();
  });
});

describe('distance', () => {
  it('converts metres to yards and back', () => {
    expect(metresToDisplay(100, 'metric')).toBe(100);
    expect(metresToDisplay(100, 'imperial')).toBe(109.4);
    expect(displayDistanceToMetres(109.4, 'imperial')).toBeCloseTo(100.0354, 3);
    expect(distanceUnitKey('metric')).toBe('meters');
    expect(distanceUnitKey('imperial')).toBe('yards');
  });
});

describe('formatting', () => {
  it('drops a trailing zero decimal', () => {
    expect(formatWeight(80, 'metric')).toBe('80');
    expect(formatWeight(82.5, 'metric')).toBe('82.5');
  });

  it('rounds aggregates to whole units and groups them', () => {
    // A tenth of a kilo out of a twelve-tonne session is noise that makes the figure harder
    // to scan, not precision.
    expect(formatVolume(12480.4, 'metric')).toBe((12480).toLocaleString());
    expect(formatVolume(1000, 'imperial')).toBe((2205).toLocaleString());
  });

  it('passes null through', () => {
    expect(formatWeight(null, 'metric')).toBeNull();
    expect(formatVolume(null, 'metric')).toBeNull();
  });
});
