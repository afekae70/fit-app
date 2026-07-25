import { describe, expect, it } from 'vitest';

import { ageInYears, bmi, bmiCategory, leanBodyMassKg } from './anthropometry.js';
import {
  bmr,
  calorieTarget,
  katchMcArdleBmr,
  macroSplit,
  resolveBmrSex,
  tdee,
} from './energy.js';
import {
  assessStall,
  bestEstimated1RM,
  epley1RM,
  isReliableRepRange,
  leastSquaresSlope,
  sessionVolumeLoad,
  volumeLoad,
} from './strength.js';
import {
  calorieAdjustmentFromDrift,
  collapseToDailyAverages,
  expectedKgPerWeek,
  movingAverage,
  weeklyRateOfChange,
} from './trends.js';

const day = (iso: string) => new Date(`${iso}T12:00:00.000Z`);

describe('anthropometry', () => {
  it('derives age without counting an un-reached birthday', () => {
    // Birthday is tomorrow — still 29.
    expect(ageInYears(day('1996-07-26'), day('2026-07-25'))).toBe(29);
    // Birthday is today — now 30.
    expect(ageInYears(day('1996-07-25'), day('2026-07-25'))).toBe(30);
    // Birthday was yesterday.
    expect(ageInYears(day('1996-07-24'), day('2026-07-25'))).toBe(30);
  });

  it('computes BMI as kg/m²', () => {
    // 80 / 1.80² = 80 / 3.24 = 24.6913...
    expect(bmi(80, 180)).toBeCloseTo(24.6914, 4);
  });

  it('rejects impossible inputs rather than returning Infinity', () => {
    expect(() => bmi(80, 0)).toThrow(RangeError);
    expect(() => bmi(0, 180)).toThrow(RangeError);
  });

  it('categorises BMI on WHO cutoffs', () => {
    expect(bmiCategory(18.4)).toBe('underweight');
    expect(bmiCategory(18.5)).toBe('normal');
    expect(bmiCategory(24.9)).toBe('normal');
    expect(bmiCategory(25)).toBe('overweight');
    expect(bmiCategory(30)).toBe('obese');
  });

  it('computes lean body mass', () => {
    expect(leanBodyMassKg(80, 15)).toBeCloseTo(68, 6);
    expect(() => leanBodyMassKg(80, 100)).toThrow(RangeError);
  });
});

describe('BMR (Mifflin-St Jeor)', () => {
  it('matches the hand-computed male figure', () => {
    // (10×80) + (6.25×180) − (5×30) + 5 = 800 + 1125 − 150 + 5 = 1780
    expect(bmr({ weightKg: 80, heightCm: 180, ageYears: 30, sex: 'male' })).toBeCloseTo(
      1780,
      6,
    );
  });

  it('matches the hand-computed female figure', () => {
    // (10×65) + (6.25×165) − (5×28) − 161 = 650 + 1031.25 − 140 − 161 = 1380.25
    expect(bmr({ weightKg: 65, heightCm: 165, ageYears: 28, sex: 'female' })).toBeCloseTo(
      1380.25,
      6,
    );
  });

  it('differs between the two coefficient sets by exactly 166 kcal', () => {
    const shared = { weightKg: 75, heightCm: 175, ageYears: 30 } as const;
    const male = bmr({ ...shared, sex: 'male' });
    const female = bmr({ ...shared, sex: 'female' });
    // This is why 'other' must not be silently defaulted — the gap is material.
    expect(male - female).toBeCloseTo(166, 6);
  });

  it('computes Katch-McArdle from lean mass', () => {
    // 370 + (21.6 × 68) = 370 + 1468.8 = 1838.8
    expect(katchMcArdleBmr(68)).toBeCloseTo(1838.8, 6);
  });
});

describe('resolveBmrSex', () => {
  it('passes through male and female', () => {
    expect(resolveBmrSex('male')).toBe('male');
    expect(resolveBmrSex('female')).toBe('female');
  });

  it('returns null for "other" with no explicit choice, so the caller must ask', () => {
    expect(resolveBmrSex('other')).toBeNull();
  });

  it('honours an explicit formula choice for "other"', () => {
    expect(resolveBmrSex('other', 'female')).toBe('female');
  });

  it('ignores an explicit choice when sex is already unambiguous', () => {
    expect(resolveBmrSex('male', 'female')).toBe('male');
  });
});

describe('TDEE', () => {
  it('applies the activity multiplier', () => {
    expect(tdee(1780, 'sedentary')).toBeCloseTo(2136, 6); // ×1.2
    expect(tdee(1780, 'moderate')).toBeCloseTo(2759, 6); // ×1.55
    expect(tdee(1780, 'very_active')).toBeCloseTo(3382, 6); // ×1.9
  });
});

describe('calorieTarget', () => {
  it('applies a 20% deficit for a cut', () => {
    expect(calorieTarget(2759, 'cut').calories).toBe(2207); // 2759 × 0.8 = 2207.2
  });

  it('leaves maintenance at TDEE', () => {
    expect(calorieTarget(2759, 'maintain').calories).toBe(2759);
  });

  it('applies a 10% surplus for a bulk', () => {
    expect(calorieTarget(2759, 'bulk').calories).toBe(3035); // 2759 × 1.1 = 3034.9
  });

  it('refuses to prescribe below BMR and reports the clamp', () => {
    // A sedentary person: TDEE 2000, BMR 1900. A 20% cut would be 1600 — below BMR.
    const result = calorieTarget(2000, 'cut', { bmrKcal: 1900 });
    expect(result.calories).toBe(1900);
    expect(result.clampedToBmr).toBe(true);
  });

  it('does not clamp when the deficit stays above BMR', () => {
    const result = calorieTarget(3000, 'cut', { bmrKcal: 1800 });
    expect(result.calories).toBe(2400);
    expect(result.clampedToBmr).toBe(false);
  });

  it('honours an explicit gentler multiplier', () => {
    expect(calorieTarget(3000, 'cut', { multiplier: 0.9 }).calories).toBe(2700);
  });
});

describe('macroSplit', () => {
  it('splits a cut target with protein prioritised and carbs taking the remainder', () => {
    // 80 kg cutting on 2200 kcal:
    //   protein 2.2 × 80          = 176 g → 704 kcal
    //   fat max(2200×0.25/9=61.1, 0.8×80=64) = 64 g → 576 kcal
    //   carbs (2200 − 1280) / 4   = 230 g → 920 kcal
    const split = macroSplit(2200, 80, 'cut');
    expect(split.proteinG).toBe(176);
    expect(split.fatG).toBe(64);
    expect(split.carbsG).toBe(230);
    expect(split.totalKcal).toBe(2200);
  });

  it('enforces the fat floor when the percentage would go under it', () => {
    // 100 kg on a low 1800 kcal: 1800×0.25/9 = 50 g, but the floor is 0.8×100 = 80 g.
    expect(macroSplit(1800, 100, 'cut').fatG).toBe(80);
  });

  it('floors carbs at zero instead of returning a negative gram figure', () => {
    // Deliberately impossible: 120 kg on 1000 kcal. Protein+fat alone exceed the target.
    const split = macroSplit(1000, 120, 'cut');
    expect(split.carbsG).toBe(0);
    // totalKcal exceeding the target is the signal the caller must act on.
    expect(split.totalKcal).toBeGreaterThan(1000);
  });
});

describe('estimated 1RM', () => {
  it('applies Epley above one rep', () => {
    // 100 × (1 + 5/30) = 116.666...
    expect(epley1RM(100, 5)).toBeCloseTo(116.6667, 4);
  });

  it('returns the weight unchanged at one rep', () => {
    // Epley would say 103.33, which is wrong by definition: a single is already a 1RM.
    expect(epley1RM(100, 1)).toBe(100);
  });

  it('flags high-rep sets as unreliable for estimation', () => {
    expect(isReliableRepRange(5)).toBe(true);
    expect(isReliableRepRange(12)).toBe(true);
    expect(isReliableRepRange(20)).toBe(false);
  });

  it('rejects zero reps', () => {
    expect(() => epley1RM(100, 0)).toThrow(RangeError);
  });

  it('picks the best reliable set and ignores warmups', () => {
    const sets = [
      { weightKg: 60, reps: 10, isWarmup: true }, // warmup, ignored
      { weightKg: 100, reps: 5 }, // 116.67
      { weightKg: 110, reps: 3 }, // 121.0  ← best
      { weightKg: 50, reps: 20 }, // unreliable rep range, ignored
    ];
    expect(bestEstimated1RM(sets)).toBeCloseTo(121, 4);
  });

  it('returns null when there is nothing reliable to estimate from', () => {
    expect(bestEstimated1RM([{ weightKg: 50, reps: 20 }])).toBeNull();
    expect(bestEstimated1RM([])).toBeNull();
  });
});

describe('volume load', () => {
  it('multiplies weight by reps', () => {
    expect(volumeLoad(100, 5)).toBe(500);
  });

  it('sums working sets and excludes warmups', () => {
    const sets = [
      { weightKg: 60, reps: 10, isWarmup: true }, // excluded
      { weightKg: 100, reps: 5 }, // 500
      { weightKg: 100, reps: 4 }, // 400
    ];
    expect(sessionVolumeLoad(sets)).toBe(900);
  });
});

describe('leastSquaresSlope', () => {
  it('recovers a unit slope', () => {
    expect(leastSquaresSlope([1, 2, 3, 4])).toBeCloseTo(1, 6);
  });

  it('returns zero for a flat series', () => {
    expect(leastSquaresSlope([10, 10, 10])).toBeCloseTo(0, 6);
  });

  it('returns a negative slope for a declining series', () => {
    expect(leastSquaresSlope([100, 90, 80])).toBeCloseTo(-10, 6);
  });

  it('returns null when a slope is undefined', () => {
    expect(leastSquaresSlope([5])).toBeNull();
    expect(leastSquaresSlope([])).toBeNull();
  });
});

describe('assessStall', () => {
  const point = (iso: string, e1rm: number, volume = 1000) => ({
    date: day(iso),
    bestE1rmKg: e1rm,
    totalVolumeLoad: volume,
  });

  it('does not call a stall while e1RM is still climbing', () => {
    const result = assessStall([
      point('2026-06-01', 100),
      point('2026-06-08', 102),
      point('2026-06-15', 104),
      point('2026-06-22', 106),
    ]);
    expect(result.isStalling).toBe(false);
    expect(result.sessionsSinceBest).toBe(0);
    expect(result.e1rmDeltaKg).toBeCloseTo(6, 6);
  });

  it('flags a stall once enough sessions pass without a new best', () => {
    const result = assessStall([
      point('2026-06-01', 100),
      point('2026-06-08', 110), // best
      point('2026-06-15', 108),
      point('2026-06-22', 109),
      point('2026-06-29', 107),
    ]);
    expect(result.isStalling).toBe(true);
    expect(result.sessionsSinceBest).toBe(3);
    expect(result.bestE1rmKg).toBe(110);
    expect(result.currentE1rmKg).toBe(107);
  });

  it('tolerates one ordinary session after a personal best', () => {
    // A single down session is training variance, not a plateau.
    const result = assessStall([
      point('2026-06-01', 100),
      point('2026-06-08', 110), // best
      point('2026-06-15', 108), // only 1 session since best
    ]);
    expect(result.isStalling).toBe(false);
  });

  it('detects falling volume via the slope', () => {
    const result = assessStall([
      point('2026-06-01', 100, 3000),
      point('2026-06-08', 100, 2500),
      point('2026-06-15', 100, 2000),
      point('2026-06-22', 100, 1500),
    ]);
    expect(result.volumeSlopePerSession).toBeCloseTo(-500, 6);
  });

  it('sorts unordered input by date', () => {
    const result = assessStall([
      point('2026-06-22', 106),
      point('2026-06-01', 100),
      point('2026-06-08', 102),
    ]);
    expect(result.currentE1rmKg).toBe(106);
    expect(result.e1rmDeltaKg).toBeCloseTo(6, 6);
  });

  it('handles an empty history without throwing', () => {
    const result = assessStall([]);
    expect(result.isStalling).toBe(false);
    expect(result.bestE1rmKg).toBeNull();
  });
});

describe('weight trends', () => {
  it('averages duplicate same-day weigh-ins into one point', () => {
    const collapsed = collapseToDailyAverages([
      { date: new Date('2026-07-01T06:00:00Z'), weightKg: 80 },
      { date: new Date('2026-07-01T20:00:00Z'), weightKg: 81 },
      { date: new Date('2026-07-02T06:00:00Z'), weightKg: 80.5 },
    ]);
    expect(collapsed).toHaveLength(2);
    expect(collapsed[0]?.weightKg).toBeCloseTo(80.5, 6);
  });

  it('smooths daily noise with a trailing moving average', () => {
    // Oscillating readings around 80 kg — the kind of water-weight noise that misleads.
    const raw = [
      { date: day('2026-07-01'), weightKg: 79 },
      { date: day('2026-07-02'), weightKg: 81 },
      { date: day('2026-07-03'), weightKg: 79 },
      { date: day('2026-07-04'), weightKg: 81 },
    ];
    const smoothed = movingAverage(raw, 7);
    // The final point averages all four: (79+81+79+81)/4 = 80
    expect(smoothed[3]?.weightKg).toBeCloseTo(80, 6);
    // The first point has only itself in its window.
    expect(smoothed[0]?.weightKg).toBeCloseTo(79, 6);
  });

  it('estimates a weekly rate of loss by regression', () => {
    // Exactly 0.5 kg/week down over 28 days: 80.0 → 78.0
    const points = Array.from({ length: 29 }, (_, i) => ({
      date: new Date(Date.UTC(2026, 5, 1 + i, 12)),
      weightKg: 80 - (0.5 / 7) * i,
    }));
    const rate = weeklyRateOfChange(points);
    expect(rate).not.toBeNull();
    expect(rate?.kgPerWeek).toBeCloseTo(-0.5, 6);
    expect(rate?.isReliable).toBe(true);
    expect(rate?.spanDays).toBe(28);
  });

  it('marks a short window unreliable rather than reporting a confident trend', () => {
    const points = [
      { date: day('2026-07-01'), weightKg: 80 },
      { date: day('2026-07-02'), weightKg: 79 },
      { date: day('2026-07-03'), weightKg: 78 },
    ];
    const rate = weeklyRateOfChange(points);
    // Slope is steep, but 3 days cannot distinguish fat loss from water.
    expect(rate?.isReliable).toBe(false);
  });

  it('returns null when there is not enough data for any slope', () => {
    expect(weeklyRateOfChange([{ date: day('2026-07-01'), weightKg: 80 }])).toBeNull();
    expect(weeklyRateOfChange([])).toBeNull();
  });
});

describe('self-correcting calorie adjustment', () => {
  it('converts a daily deficit into an expected weekly change', () => {
    // −500 kcal/day × 7 / 7700 = −0.4545 kg/week
    expect(expectedKgPerWeek(-500)).toBeCloseTo(-0.4545, 4);
  });

  it('cuts calories when weight is not falling as fast as prescribed', () => {
    // Expected −0.5 kg/wk, observed 0. Drift +0.5 kg/wk → −275 kcal/day after 50% damping.
    expect(calorieAdjustmentFromDrift(0, -0.5)).toBe(-275);
  });

  it('adds calories when weight is falling faster than intended', () => {
    // Expected −0.5, observed −1.0. Drift −0.5 → +275 kcal/day.
    expect(calorieAdjustmentFromDrift(-1.0, -0.5)).toBe(275);
  });

  it('makes no change when observed matches expected', () => {
    expect(calorieAdjustmentFromDrift(-0.5, -0.5)).toBe(0);
  });

  it('clamps extreme corrections so one noisy week cannot swing the target wildly', () => {
    expect(calorieAdjustmentFromDrift(5, -0.5)).toBe(-300);
    expect(calorieAdjustmentFromDrift(-5, -0.5)).toBe(300);
  });
});
