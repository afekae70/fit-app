/**
 * Context-builder tests.
 *
 * These matter more than they look. Every failure mode here is silent: the request succeeds,
 * the model answers confidently, and the answer is subtly about the wrong athlete or the wrong
 * numbers. Nothing crashes, so nothing tells you.
 */

import type { CoachContextPayload } from '@fit/shared/schemas';
import { describe, expect, it } from 'vitest';

import { COACH_PERSONA, hasUsableContext, renderContext } from './context.js';

function buildContext(overrides: Partial<CoachContextPayload> = {}): CoachContextPayload {
  return {
    locale: 'en',
    profile: {
      ageYears: 22,
      sex: 'male',
      heightCm: 178,
      weightKg: 71.8,
      activityLevel: 'active',
      goal: 'cut',
    },
    targets: {
      bmi: 22.7,
      bmrKcal: 1726,
      tdeeKcal: 2976,
      calorieTarget: 2381,
      proteinG: 158,
      carbsG: 238,
      fatG: 66,
    },
    weightTrend: {
      currentKg: 71.8,
      kgPerWeek: -0.45,
      isReliable: true,
      measurementCount: 18,
    },
    exercises: [],
    adherence: [],
    availableEquipment: [],
    planName: null,
    ...overrides,
  };
}

describe('COACH_PERSONA', () => {
  it('is long enough to be cacheable', () => {
    // The cache minimum on Opus 5 is 512 tokens. Below it, `cache_control` is silently
    // ignored — no error, no cache, and cost quietly doubles. ~3 chars/token is the
    // conservative estimate, so this floor keeps a safety margin.
    expect(COACH_PERSONA.length).toBeGreaterThan(1600);
  });

  it('contains nothing user-specific or time-varying', () => {
    // A single interpolated value here makes the prefix per-user and the cache never hits
    // across requests — the exact failure that makes caching look like it "doesn't work".
    expect(COACH_PERSONA).not.toMatch(/\{\{|\$\{|%s/);
    expect(COACH_PERSONA).not.toMatch(/\b(20\d\d-\d\d-\d\d|\d+\s?kg|\d+\s?kcal)\b/);
  });

  it('forbids recomputing the supplied figures', () => {
    // Without this the model re-derives e1RM from numbers it does not have and contradicts
    // the screen the user is looking at.
    expect(COACH_PERSONA).toMatch(/do not recompute/i);
  });

  it('states the BMR floor and the non-medical boundary', () => {
    expect(COACH_PERSONA).toMatch(/below the athlete's calculated BMR/i);
    expect(COACH_PERSONA).toMatch(/not a doctor/i);
  });
});

describe('renderContext', () => {
  it('includes the computed energy figures verbatim', () => {
    const rendered = renderContext(buildContext());
    expect(rendered).toContain('BMR 1726 kcal');
    expect(rendered).toContain('TDEE 2976 kcal');
    expect(rendered).toContain('2381 kcal');
  });

  it('renders nulls as em-dashes rather than zeros', () => {
    const rendered = renderContext(
      buildContext({
        profile: {
          ageYears: null,
          sex: null,
          heightCm: null,
          weightKg: null,
          activityLevel: null,
          goal: null,
        },
      }),
    );
    // A null height rendered as "0cm" invites the model to reason about a 0cm athlete.
    expect(rendered).not.toMatch(/height 0cm|weight 0\.0kg/);
    expect(rendered).toContain('height —cm');
  });

  it('flags an unreliable weight trend in words, not just a boolean', () => {
    const rendered = renderContext(
      buildContext({
        weightTrend: { currentKg: 71.8, kgPerWeek: -1.8, isReliable: false, measurementCount: 2 },
      }),
    );
    // Two measurements two days apart extrapolate to an alarming weekly rate. The model must
    // be told the slope is not yet meaningful, or it will counsel on noise.
    expect(rendered).toMatch(/NOT YET RELIABLE/);
  });

  it('marks stalling exercises and stays silent about the rest', () => {
    const rendered = renderContext(
      buildContext({
        exercises: [
          {
            exerciseKey: 'Barbell Bench Press',
            sessionCount: 8,
            latestE1rmKg: 84.1,
            bestE1rmKg: 88.0,
            e1rmDeltaKg: -1.2,
            volumeSlopePerSession: -40,
            sessionsSinceBest: 4,
            isStalling: true,
          },
          {
            exerciseKey: 'Barbell Row',
            sessionCount: 6,
            latestE1rmKg: 70.0,
            bestE1rmKg: 70.0,
            e1rmDeltaKg: 1.5,
            volumeSlopePerSession: 120,
            sessionsSinceBest: 0,
            isStalling: false,
          },
        ],
      }),
    );

    expect(rendered).toMatch(/Barbell Bench Press.*STALLING \(4 sessions since best\)/);
    // The progressing lift gets no flag — "not stalling" on every row is noise, and its
    // absence already carries the information.
    expect(rendered).toMatch(/Barbell Row(?!.*STALLING)/);
  });

  it('omits empty sections instead of rendering bare headings', () => {
    const rendered = renderContext(buildContext({ exercises: [], availableEquipment: [] }));
    // An empty "## Progression" heading reads as "measured, came back blank" and invites
    // reasoning about a zero that does not exist.
    expect(rendered).not.toContain('## Progression');
    expect(rendered).not.toContain('## Available equipment');
  });

  it('includes equipment when present, so the coach cannot prescribe a missing machine', () => {
    const rendered = renderContext(
      buildContext({ availableEquipment: ['barbell', 'dumbbells', 'pullup_bar'] }),
    );
    expect(rendered).toContain('## Available equipment');
    expect(rendered).toContain('pullup_bar');
  });

  it('renders prescribed vs actual when a plan drove the session', () => {
    const rendered = renderContext(
      buildContext({
        planName: 'Push Pull Legs',
        adherence: [
          {
            exerciseKey: 'Barbell Bench Press',
            targetSets: 3,
            targetRepsMin: 8,
            targetRepsMax: 12,
            loggedSets: 5,
          },
        ],
      }),
    );
    expect(rendered).toContain('Push Pull Legs');
    expect(rendered).toContain('planned 3x8-12, logged 5 working sets');
  });

  it('asks for Hebrew when the locale is Hebrew', () => {
    expect(renderContext(buildContext({ locale: 'he' }))).toMatch(/Reply in Hebrew/);
    expect(renderContext(buildContext({ locale: 'en' }))).toMatch(/Reply in English/);
  });

  it('stays small enough to keep the cached prefix dominant', () => {
    const rendered = renderContext(
      buildContext({
        exercises: Array.from({ length: 40 }, (_, i) => ({
          exerciseKey: `Exercise ${i}`,
          sessionCount: 10,
          latestE1rmKg: 100,
          bestE1rmKg: 105,
          e1rmDeltaKg: 1.5,
          volumeSlopePerSession: 50,
          sessionsSinceBest: 1,
          isStalling: false,
        })),
      }),
    );
    // 40 exercises is a heavily-used account. If the volatile half outgrows the persona, the
    // cache stops being the majority of the prompt and the economics invert.
    expect(rendered.length).toBeLessThan(6000);
  });
});

describe('hasUsableContext', () => {
  it('rejects a brand-new account with nothing logged', () => {
    expect(
      hasUsableContext(
        buildContext({
          exercises: [],
          weightTrend: { currentKg: null, kgPerWeek: null, isReliable: false, measurementCount: 0 },
          targets: {
            bmi: null,
            bmrKcal: null,
            tdeeKcal: null,
            calorieTarget: null,
            proteinG: null,
            carbsG: null,
            fatG: null,
          },
        }),
      ),
    ).toBe(false);
  });

  it('accepts an account with only weight logged', () => {
    expect(
      hasUsableContext(
        buildContext({
          exercises: [],
          weightTrend: { currentKg: 71.8, kgPerWeek: null, isReliable: false, measurementCount: 3 },
        }),
      ),
    ).toBe(true);
  });

  it('accepts an account with only training logged', () => {
    expect(
      hasUsableContext(
        buildContext({
          weightTrend: { currentKg: null, kgPerWeek: null, isReliable: false, measurementCount: 0 },
          targets: {
            bmi: null,
            bmrKcal: null,
            tdeeKcal: null,
            calorieTarget: null,
            proteinG: null,
            carbsG: null,
            fatG: null,
          },
          exercises: [
            {
              exerciseKey: 'Barbell Bench Press',
              sessionCount: 2,
              latestE1rmKg: 80,
              bestE1rmKg: 80,
              e1rmDeltaKg: null,
              volumeSlopePerSession: null,
              sessionsSinceBest: 0,
              isStalling: false,
            },
          ],
        }),
      ),
    ).toBe(true);
  });
});
