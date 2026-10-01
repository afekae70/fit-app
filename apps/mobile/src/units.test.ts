/**
 * Unit conversion tests.
 *
 * The drift cases get the most attention. A conversion that is merely approximately right is
 * fine for one reading and corrosive over a year of them: every one of these numbers is stored
 * and re-displayed hundreds of times, and an error that compounds on each write would surface
 * as a weight trend that slowly invents a gain nobody made.
 */

import { describe, expect, it } from 'vitest';

import {
  bodyKgToDisplay,
  cmToDisplay,
  displayDistanceToMetres,
  displayHeightToCm,
  displayWeightToKg,
  distanceUnitKey,
  formatBodyWeight,
  formatHeight,
  formatVolume,
  formatWeight,
  heightUnitKey,
  isEditedWeight,
  kgToDisplay,
  metresToDisplay,
  weightUnitKey,
} from './units.js';

describe('weight', () => {
  it('is a no-op in metric', () => {
    expect(kgToDisplay(80, 'metric')).toBe(80);
    expect(kgToDisplay(82.5, 'metric')).toBe(82.5);
    expect(displayWeightToKg(82.5, 'metric')).toBe(82.5);
  });

  it('keeps a typed quarter-kilo rather than rounding it away', () => {
    // 13.75 kg is a real dumbbell, and showing it as 13.8 read as the app having lost the number.
    expect(kgToDisplay(13.75, 'metric')).toBe(13.75);
    expect(kgToDisplay(2.25, 'metric')).toBe(2.25);
  });

  it('converts to pounds at the defined ratio', () => {
    expect(kgToDisplay(100, 'imperial')).toBe(220.5);
    expect(kgToDisplay(0, 'imperial')).toBe(0);
    // 45 lb is the standard Olympic bar; it must not render as 44.9 or 45.1.
    expect(kgToDisplay(20.4116665, 'imperial')).toBe(45);
  });

  it('converts typed pounds back without a second rounding', () => {
    expect(displayWeightToKg(45, 'imperial')).toBeCloseTo(20.41166, 5);
    // 100 kg displays as 220.5 lb, which converts back to 100.017 kg — a 17 gram round-trip
    // error. Harmless once; isEditedWeight is what stops it accumulating.
    expect(displayWeightToKg(220.5, 'imperial')).toBeCloseTo(100.0172, 3);
  });

  it('keeps kilograms to the hundredth and pounds to the tenth', () => {
    expect(String(kgToDisplay(100, 'imperial'))).toBe('220.5');
    expect(String(kgToDisplay(83.33333, 'metric'))).toBe('83.33');
  });

  it('names the right unit key', () => {
    expect(weightUnitKey('metric')).toBe('kg');
    expect(weightUnitKey('imperial')).toBe('lb');
  });
});

describe('isEditedWeight', () => {
  it('reports no edit when the field still shows the stored value', () => {
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
    expect(formatVolume(12480.4, 'metric')).toBe((12480).toLocaleString());
    expect(formatVolume(1000, 'imperial')).toBe((2205).toLocaleString());
  });

  it('passes null through', () => {
    expect(formatWeight(null, 'metric')).toBeNull();
    expect(formatVolume(null, 'metric')).toBeNull();
  });
});

describe('bodyweight precision', () => {
  it('keeps the hundredths a scale reports', () => {
    // The scale this app reads broadcasts weight in hundredths of a kilogram. Rounding 74.18 to
    // 74.2 for display would throw away precision the device actually supplied.
    expect(bodyKgToDisplay(74.18, 'metric')).toBe(74.18);
    expect(formatBodyWeight(74.18, 'metric')).toBe('74.18');
  });

  it('shows a lifted weight exactly as it was typed, and pounds to the tenth', () => {
    // Quarters are real on a bar — micro plates, fixed dumbbells, machine stacks — so a typed
    // 13.75 must come back as 13.75. Pounds are a conversion rather than a typed number, and a
    // round 100 kg rendering as 220.46 lb reads as a measurement error.
    expect(kgToDisplay(74.18, 'metric')).toBe(74.18);
    expect(kgToDisplay(100, 'imperial')).toBe(220.5);
  });

  it('does not pad a whole number with decimals it does not claim', () => {
    expect(formatBodyWeight(74, 'metric')).toBe('74');
    expect(formatBodyWeight(74.4, 'metric')).toBe('74.4');
  });

  it('converts to pounds at the same precision', () => {
    expect(bodyKgToDisplay(74.18, 'imperial')).toBeCloseTo(163.54, 2);
  });

  it('still refuses to invent a number from nothing', () => {
    expect(formatBodyWeight(null, 'metric')).toBeNull();
    expect(formatBodyWeight(undefined, 'metric')).toBeNull();
  });

  it('treats an untouched hundredths field as unedited', () => {
    // The regression this guards: comparing a 74.18 kg reading against a one-decimal render
    // makes every visit to the screen look like an edit, writing 74.2 back over the real value
    // and drifting the stored weight a little at a time.
    expect(isEditedWeight(74.18, 74.18, 'metric', 'body')).toBe(false);
    expect(isEditedWeight(74.18, 74.2, 'metric', 'body')).toBe(true);
  });

  it('defaults to lift precision, which now keeps hundredths too', () => {
    expect(isEditedWeight(74.18, 74.18, 'metric')).toBe(false);
    expect(isEditedWeight(74.18, 74.2, 'metric')).toBe(true);
  });
});
