import { describe, expect, it } from 'vitest';

import {
  AGE_RANGE,
  SETUP_STEPS,
  SETUP_TOTAL,
  ageFromBirthDate,
  birthDateFromAge,
  heightRange,
  indexAtOffset,
  hasMetServer,
  indexOfValue,
  isNewWeight,
  needsProfileSetup,
  ontoScale,
  parseTyped,
  setupPosition,
  setupTargets,
  tickCount,
  tickKind,
  valueAtIndex,
  weightRange,
  type SetupAnswers,
} from './profileSetup.js';

const complete = {
  height_cm: 178,
  birth_date: '1996-03-14',
  activity_level: 'moderate',
  goal: 'cut',
};

describe('whether the server has been asked first', () => {
  it('has not, on a phone with no profile row or one that sync has never touched', () => {
    // A new phone is not a new person: until the two have compared, an empty profile here
    // says nothing about whether the account answered these questions somewhere else.
    expect(hasMetServer(null)).toBe(false);
    expect(hasMetServer({ synced_json: null })).toBe(false);
  });

  it('has, once sync has written down what the two agreed on — even if that was nothing', () => {
    expect(hasMetServer({ synced_json: '{}' })).toBe(true);
    expect(hasMetServer({ synced_json: '{"goal":"cut"}' })).toBe(true);
  });
});

describe('who is asked', () => {
  it('asks a brand-new account, which has no profile row at all', () => {
    expect(needsProfileSetup(null)).toBe(true);
  });

  it('does not ask an account that already answered', () => {
    expect(needsProfileSetup(complete)).toBe(false);
  });

  it.each(['height_cm', 'birth_date', 'activity_level', 'goal'] as const)(
    'asks when %s is missing',
    (column) => {
      expect(needsProfileSetup({ ...complete, [column]: null })).toBe(true);
    },
  );

  it('does not ask again because of a row that only holds a unit preference', () => {
    // Choosing kilograms or pounds creates the profile row before anything else is known. That
    // row must not read as "set up".
    expect(
      needsProfileSetup({ height_cm: null, birth_date: null, activity_level: null, goal: null }),
    ).toBe(true);
  });
});

describe('the step count the sign-up form and the questions share', () => {
  it('counts the form and every question, and not the arrival', () => {
    expect(SETUP_TOTAL).toBe(7);
    expect(SETUP_STEPS.at(-1)).toBe('done');
  });

  it('puts the first question straight after the form', () => {
    expect(setupPosition('weight')).toBe(2);
    expect(setupPosition('goal')).toBe(SETUP_TOTAL - 1);
    // The last question is the one about training, and the bar is full on it.
    expect(setupPosition('training')).toBe(SETUP_TOTAL);
    expect(SETUP_STEPS.at(-2)).toBe('training');
  });
});

describe('rulers', () => {
  it('has a tick for both ends', () => {
    expect(tickCount(AGE_RANGE)).toBe(78);
    expect(valueAtIndex(AGE_RANGE, 0)).toBe(13);
    expect(valueAtIndex(AGE_RANGE, 77)).toBe(90);
  });

  it('reads half kilos without floating-point crumbs', () => {
    const kg = weightRange('metric');
    // 30 + 81 × 0.5, which arithmetic alone gives as 70.5 only by luck.
    expect(valueAtIndex(kg, 81)).toBe(70.5);
    expect(valueAtIndex(kg, 145)).toBe(102.5);
    for (let index = 0; index < tickCount(kg); index++) {
      expect(String(valueAtIndex(kg, index)).length).toBeLessThanOrEqual(5);
    }
  });

  it('opens on a value that is on the scale', () => {
    for (const range of [
      weightRange('metric'),
      weightRange('imperial'),
      heightRange('metric'),
      heightRange('imperial'),
      AGE_RANGE,
    ]) {
      expect(valueAtIndex(range, indexOfValue(range, range.initial))).toBe(range.initial);
    }
  });

  it('snaps a value between two ticks to the nearer one', () => {
    const kg = weightRange('metric');
    expect(valueAtIndex(kg, indexOfValue(kg, 82.3))).toBe(82.5);
    expect(valueAtIndex(kg, indexOfValue(kg, 82.2))).toBe(82);
  });

  it('holds a value from off the scale at the end of it', () => {
    const kg = weightRange('metric');
    expect(valueAtIndex(kg, indexOfValue(kg, 12))).toBe(30);
    expect(valueAtIndex(kg, indexOfValue(kg, 400))).toBe(250);
  });

  it('reads the tick under the pointer from a scroll offset', () => {
    const cm = heightRange('metric');
    expect(valueAtIndex(cm, indexAtOffset(cm, 0, 12))).toBe(120);
    expect(valueAtIndex(cm, indexAtOffset(cm, 600, 12))).toBe(170);
    // Just short of the next tick is still this one's neighbour, not a value in between.
    expect(valueAtIndex(cm, indexAtOffset(cm, 605, 12))).toBe(170);
    expect(valueAtIndex(cm, indexAtOffset(cm, 607, 12))).toBe(171);
  });

  it('never reads past the ends while the scroll view overscrolls', () => {
    const cm = heightRange('metric');
    expect(valueAtIndex(cm, indexAtOffset(cm, -80, 12))).toBe(120);
    expect(valueAtIndex(cm, indexAtOffset(cm, 99_999, 12))).toBe(230);
  });

  it('puts its numbers on round values, wherever the scale happens to start', () => {
    const labelled = (range: Parameters<typeof tickKind>[0]) =>
      Array.from({ length: tickCount(range) }, (_, index) => index)
        .filter((index) => tickKind(range, index) === 'major')
        .map((index) => valueAtIndex(range, index));

    // Ages start at 13 and pounds at 66; neither is where a number belongs.
    expect(labelled(AGE_RANGE)).toEqual([20, 30, 40, 50, 60, 70, 80, 90]);
    expect(labelled(weightRange('imperial')).slice(0, 3)).toEqual([70, 80, 90]);
    expect(labelled(weightRange('metric')).slice(0, 4)).toEqual([30, 35, 40, 45]);
    expect(labelled(heightRange('metric')).slice(0, 3)).toEqual([120, 130, 140]);
    // Every half foot.
    expect(labelled(heightRange('imperial')).slice(0, 3)).toEqual([48, 54, 60]);
  });

  it('marks whole kilos between the numbers, and halves as the smallest ticks', () => {
    const kg = weightRange('metric');
    expect(tickKind(kg, indexOfValue(kg, 71))).toBe('medium');
    expect(tickKind(kg, indexOfValue(kg, 71.5))).toBe('minor');
    expect(tickKind(kg, indexOfValue(kg, 75))).toBe('major');
  });

  it('does not divide by a tick width it has not measured yet', () => {
    expect(indexAtOffset(AGE_RANGE, 120, 0)).toBe(0);
  });
});

describe('a number that is typed instead of dragged', () => {
  const kg = weightRange('metric');

  it('is kept to the tenth it was typed in, not moved to the nearest half kilo', () => {
    expect(parseTyped(kg, '82.3')).toBe(82.3);
    // The ruler rests on the nearest mark; the value is still what was typed.
    expect(valueAtIndex(kg, indexOfValue(kg, 82.3))).toBe(82.5);
  });

  it('takes a comma for a decimal point', () => {
    expect(parseTyped(kg, '82,3')).toBe(82.3);
  });

  it('drops precision the scale does not show', () => {
    expect(parseTyped(kg, '82.349')).toBe(82.3);
    expect(parseTyped(heightRange('metric'), '178.6')).toBe(179);
    expect(parseTyped(AGE_RANGE, '31.9')).toBe(32);
  });

  it('holds a number from off the scale at the end of it', () => {
    expect(parseTyped(kg, '7')).toBe(30);
    expect(parseTyped(kg, '700')).toBe(250);
    expect(parseTyped(AGE_RANGE, '5')).toBe(13);
  });

  it.each(['', '   ', '.', 'abc', '8..2', '-'])('gives nothing back for %j', (text) => {
    expect(parseTyped(kg, text)).toBeNull();
  });

  it('brings a saved weigh-in onto the scale without rounding it to a tick', () => {
    expect(ontoScale(kg, 82.34)).toBe(82.3);
    expect(ontoScale(kg, 12)).toBe(30);
  });
});

describe('age', () => {
  const today = new Date('2026-10-09T12:00:00.000Z');

  it('stores a birth date the same age can be read back from', () => {
    for (const age of [13, 25, 41, 90]) {
      expect(ageFromBirthDate(birthDateFromAge(age, today), today)).toBe(age);
    }
  });

  it('keeps the age right for the whole year that follows', () => {
    const birth = birthDateFromAge(30, today);
    expect(ageFromBirthDate(birth, new Date('2027-10-08T12:00:00.000Z'))).toBe(30);
    expect(ageFromBirthDate(birth, new Date('2027-10-09T12:00:00.000Z'))).toBe(31);
  });
});

describe('what the answers add up to', () => {
  const answers: SetupAnswers = {
    weightKg: 80,
    heightCm: 180,
    ageYears: 30,
    sex: 'male',
    activityLevel: 'moderate',
    goal: 'maintain',
  };

  it('is the Mifflin-St Jeor figure the nutrition screen shows for the same person', () => {
    // BMR 10×80 + 6.25×180 − 5×30 + 5 = 1780; × 1.55 for moderate activity = 2759.
    expect(setupTargets(answers)?.calories).toBe(2759);
  });

  it('moves with the goal', () => {
    const cut = setupTargets({ ...answers, goal: 'cut' });
    const bulk = setupTargets({ ...answers, goal: 'bulk' });
    expect(cut!.calories).toBeLessThan(2759);
    expect(bulk!.calories).toBeGreaterThan(2759);
  });

  it('is lower for a woman of the same build, as the formula has it', () => {
    expect(setupTargets({ ...answers, sex: 'female' })!.calories).toBeLessThan(2759);
  });

  it('gives a protein figure that follows body weight', () => {
    const light = setupTargets({ ...answers, weightKg: 60 });
    const heavy = setupTargets({ ...answers, weightKg: 100 });
    expect(heavy!.proteinG).toBeGreaterThan(light!.proteinG);
  });

  it('returns nothing rather than throwing on a value the formulas reject', () => {
    expect(setupTargets({ ...answers, heightCm: 0 })).toBeNull();
    expect(setupTargets({ ...answers, weightKg: 0 })).toBeNull();
  });

  it('works at every corner of the rulers', () => {
    const kg = weightRange('metric');
    const cm = heightRange('metric');
    for (const weightKg of [kg.min, kg.max]) {
      for (const heightCm of [cm.min, cm.max]) {
        for (const ageYears of [AGE_RANGE.min, AGE_RANGE.max]) {
          const targets = setupTargets({ ...answers, weightKg, heightCm, ageYears });
          expect(targets?.calories).toBeGreaterThan(0);
        }
      }
    }
  });
});

describe('whether the weight is recorded as a weigh-in', () => {
  it('is, on an account with no history', () => {
    expect(isNewWeight(null, 70)).toBe(true);
  });

  it('is not when the ruler was left on the last weigh-in', () => {
    // It opens on that weigh-in to the tenth, so untouched means the same number back.
    expect(isNewWeight(82.3, 82.3)).toBe(false);
    expect(isNewWeight(82.34, ontoScale(weightRange('metric'), 82.34))).toBe(false);
  });

  it('is when it was dragged or typed to something else', () => {
    expect(isNewWeight(82.3, 82.5)).toBe(true);
    expect(isNewWeight(82.3, 82.2)).toBe(true);
    expect(isNewWeight(82.3, 81.5)).toBe(true);
  });
});
