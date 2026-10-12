/**
 * The coach request, where it grew a food log.
 *
 * The app and the function are not released together: the function is pasted into a dashboard
 * by hand, the app arrives as a build. So for a while each side is talking to an older or a
 * newer version of the other, and the request has to be valid in both directions.
 */

import { describe, expect, it } from 'vitest';

import { coachChatRequestSchema, coachContextSchema, coachIntakeSchema } from './coach.js';

const CONTEXT = {
  locale: 'he',
  profile: {
    ageYears: 31,
    sex: 'male',
    heightCm: 178,
    weightKg: 82,
    activityLevel: 'moderate',
    goal: 'cut',
  },
  targets: {
    bmi: 25.9,
    bmrKcal: 1790,
    tdeeKcal: 2770,
    calorieTarget: 2270,
    proteinG: 164,
    carbsG: 230,
    fatG: 76,
  },
  weightTrend: { currentKg: 82, kgPerWeek: -0.4, isReliable: true, measurementCount: 12 },
  exercises: [],
};

const DAY = {
  date: '2026-10-12',
  calories: 2140,
  proteinG: 120.4,
  carbsG: 210,
  fatG: 61.5,
  macrosPartial: false,
  entryCount: 5,
};

describe('a request from before there was a food log', () => {
  it('is still a valid request, with an empty log', () => {
    const parsed = coachContextSchema.parse(CONTEXT);
    expect(parsed.intake).toEqual({ days: [], today: [], water: [] });
  });

  it('fills in whichever parts of the log were left out', () => {
    const parsed = coachContextSchema.parse({ ...CONTEXT, intake: { days: [DAY] } });
    expect(parsed.intake).toEqual({ days: [DAY], today: [], water: [] });
  });
});

describe('a request to a function from before there was a food log', () => {
  it('drops what it does not know rather than refusing the request', () => {
    // The old schema is this one without `intake`. Unknown keys are stripped, not errors —
    // which is what lets the app be installed before the function is pasted.
    const older = coachContextSchema.omit({ intake: true });
    const parsed = older.safeParse({ ...CONTEXT, intake: { days: [DAY], today: [], water: [] } });
    expect(parsed.success).toBe(true);
    expect(parsed.success && 'intake' in parsed.data).toBe(false);
  });
});

describe('what a food log may hold', () => {
  it('takes a week of days, today by name, and water', () => {
    const intake = {
      days: [DAY],
      today: [{ name: 'ביצה קשה', calories: 155 }],
      water: [{ date: '2026-10-12', ml: 1750 }],
    };
    expect(coachIntakeSchema.parse(intake)).toEqual(intake);
  });

  it.each([
    ['a day that is not a calendar day', { days: [{ ...DAY, date: 'yesterday' }] }],
    ['calories that are not a whole number', { days: [{ ...DAY, calories: 2140.5 }] }],
    ['calories below zero', { days: [{ ...DAY, calories: -1 }] }],
    ['a day with no entries in it', { days: [{ ...DAY, entryCount: 0 }] }],
    ['a macro that is not a number', { days: [{ ...DAY, proteinG: Number.NaN }] }],
    ['more days than a fortnight', { days: Array.from({ length: 15 }, () => DAY) }],
    ['a food with no name', { today: [{ name: '', calories: 100 }] }],
    ['a name past the length bound', { today: [{ name: 'x'.repeat(121), calories: 100 }] }],
    [
      'more of today than can be named',
      { today: Array.from({ length: 41 }, () => ({ name: 'x', calories: 1 })) },
    ],
    ['water below zero', { water: [{ date: '2026-10-12', ml: -250 }] }],
  ])('refuses %s', (_label, intake) => {
    expect(coachIntakeSchema.safeParse(intake).success).toBe(false);
  });

  it('refuses a whole request whose log is malformed, rather than quietly dropping the log', () => {
    const request = {
      context: { ...CONTEXT, intake: { days: [{ ...DAY, calories: 'many' }] } },
      messages: [{ role: 'user', content: 'hello' }],
    };
    expect(coachChatRequestSchema.safeParse(request).success).toBe(false);
  });
});
