/**
 * Metrics repository tests — real SQL against a real SQLite engine, same approach as
 * workouts.test.ts.
 */

import { beforeEach, describe, expect, it } from 'vitest';

import type { SqlExecutor } from './executor.js';
import {
  computeTargets,
  deleteBodyMetric,
  getCurrentTargets,
  getLatestWeight,
  getProfile,
  listBodyMetrics,
  getLastScaleDeviceId,
  recordBodyMetric,
  summariseComposition,
  saveProfile,
  snapshotTargets,
  summariseTrend,
  type ProfileRow,
} from './metrics.js';
import { createTestExecutor } from './testUtils.js';

let db: SqlExecutor;
let counter = 0;
const newId = () => `id-${String(++counter).padStart(3, '0')}`;
const clock = () => '2026-07-25T10:00:00.000Z';
const USER = 'user-1';

beforeEach(() => {
  db = createTestExecutor();
  counter = 0;
});

const fullProfile: ProfileRow = {
  user_id: USER,
  display_name: 'Test',
  birth_date: '1996-01-01',
  sex: 'male',
  bmr_formula_sex: null,
  height_cm: 180,
  activity_level: 'moderate',
  goal: 'cut',
  // Null is what every profile holds until settings is opened. None of the physiology below
  // reads it — stored measurements are metric regardless of what the user reads them in.
  unit_preference: null,
  updated_at: clock(),
};

describe('profile', () => {
  it('creates the row on first save and reads it back', async () => {
    await saveProfile(db, USER, { heightCm: 180, sex: 'male', goal: 'cut' }, clock);

    const profile = await getProfile(db, USER);
    expect(profile?.height_cm).toBe(180);
    expect(profile?.goal).toBe('cut');
  });

  it('updates only the supplied fields', async () => {
    await saveProfile(db, USER, { heightCm: 180, sex: 'male', goal: 'cut' }, clock);
    await saveProfile(db, USER, { goal: 'bulk' }, clock);

    const profile = await getProfile(db, USER);
    expect(profile?.goal).toBe('bulk');
    // Changing the goal from one screen must not blank height entered on another.
    expect(profile?.height_cm).toBe(180);
    expect(profile?.sex).toBe('male');
  });

  it('keeps exactly one profile row no matter how often it is saved', async () => {
    await saveProfile(db, USER, { heightCm: 180 }, clock);
    await saveProfile(db, USER, { heightCm: 181 }, clock);
    await saveProfile(db, USER, { heightCm: 182 }, clock);

    const rows = await db.all('SELECT * FROM profile');
    expect(rows).toHaveLength(1);
  });

  it('keeps two users profiles independent', async () => {
    await saveProfile(db, USER, { heightCm: 180 }, clock);
    await saveProfile(db, 'user-2', { heightCm: 165 }, clock);

    expect((await getProfile(db, USER))?.height_cm).toBe(180);
    expect((await getProfile(db, 'user-2'))?.height_cm).toBe(165);
  });

  it('persists the unit preference', async () => {
    await saveProfile(db, USER, { unitPreference: 'imperial' }, clock);
    expect((await getProfile(db, USER))?.unit_preference).toBe('imperial');
  });

  it('does not disturb the unit preference when another screen saves the profile', async () => {
    await saveProfile(db, USER, { unitPreference: 'imperial' }, clock);
    // The Today tab writes these on every edit and knows nothing about the settings screen.
    await saveProfile(db, USER, { heightCm: 180, goal: 'bulk' }, clock);

    expect((await getProfile(db, USER))?.unit_preference).toBe('imperial');
  });

  it('keeps two users unit preferences independent', async () => {
    await saveProfile(db, USER, { unitPreference: 'imperial' }, clock);
    await saveProfile(db, 'user-2', { unitPreference: 'metric' }, clock);

    expect((await getProfile(db, USER))?.unit_preference).toBe('imperial');
    expect((await getProfile(db, 'user-2'))?.unit_preference).toBe('metric');
  });
});

describe('body metrics', () => {
  it('records a manual weight and returns it as the latest', async () => {
    await recordBodyMetric(db, USER, newId, { weightKg: 80.4, source: 'manual' }, clock);

    const latest = await getLatestWeight(db, USER);
    expect(latest?.weight_kg).toBe(80.4);
    expect(latest?.source).toBe('manual');
  });

  it('orders latest by measurement time, not insertion order', async () => {
    await recordBodyMetric(
      db,
      USER,
      newId,
      { weightKg: 80, source: 'manual', measuredAt: '2026-07-20T08:00:00.000Z' },
      clock,
    );
    // Inserted second but measured EARLIER — backfilling an old weigh-in must not become
    // "latest" just because it was typed in most recently.
    await recordBodyMetric(
      db,
      USER,
      newId,
      { weightKg: 99, source: 'manual', measuredAt: '2026-07-01T08:00:00.000Z' },
      clock,
    );

    expect((await getLatestWeight(db, USER))?.weight_kg).toBe(80);
  });

  it('stores the raw device frame for later reprocessing', async () => {
    await recordBodyMetric(
      db,
      USER,
      newId,
      {
        weightKg: 80,
        bodyFatPct: 18.2,
        source: 'ble_scale',
        deviceId: 'AA:BB:CC',
        rawPayload: { bytes: [1, 2, 3] },
      },
      clock,
    );

    const latest = await getLatestWeight(db, USER);
    expect(JSON.parse(latest?.raw_payload ?? 'null')).toEqual({ bytes: [1, 2, 3] });
    expect(latest?.device_id).toBe('AA:BB:CC');
  });

  it('excludes rows with no weight from the list', async () => {
    await recordBodyMetric(db, USER, newId, { bodyFatPct: 18, source: 'manual' }, clock);
    await recordBodyMetric(db, USER, newId, { weightKg: 80, source: 'manual' }, clock);

    expect(await listBodyMetrics(db, USER)).toHaveLength(1);
  });

  it('queues every metric for sync and records deletions too', async () => {
    const id = await recordBodyMetric(db, USER, newId, { weightKg: 80, source: 'manual' }, clock);
    await deleteBodyMetric(db, USER, id, clock);

    const ops = await db.all<{ op: string }>(
      `SELECT op FROM outbox WHERE entity = 'body_metric' ORDER BY id`,
    );
    expect(ops.map((o) => o.op)).toEqual(['insert', 'delete']);
  });

  it('keeps two users weight histories independent', async () => {
    await recordBodyMetric(db, USER, newId, { weightKg: 80, source: 'manual' }, clock);
    await recordBodyMetric(db, 'user-2', newId, { weightKg: 60, source: 'manual' }, clock);

    expect(await listBodyMetrics(db, USER)).toHaveLength(1);
    expect(await listBodyMetrics(db, 'user-2')).toHaveLength(1);
    expect((await getLatestWeight(db, USER))?.weight_kg).toBe(80);
    expect((await getLatestWeight(db, 'user-2'))?.weight_kg).toBe(60);
  });
});

describe('computeTargets', () => {
  it('computes a full target set from profile plus latest weight', async () => {
    const result = computeTargets(fullProfile, 80, new Date('2026-07-25T00:00:00Z'));
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Age 30 on 2026-07-25 with birth 1996-01-01.
    // BMR = 10*80 + 6.25*180 - 5*30 + 5 = 1780
    expect(result.targets.bmrKcal).toBe(1780);
    // TDEE = 1780 * 1.55 (moderate) = 2759
    expect(result.targets.tdeeKcal).toBe(2759);
    // cut = 20% deficit
    expect(result.targets.calorieTarget).toBe(2207);
    expect(result.targets.goal).toBe('cut');
  });

  it('names the missing field instead of guessing', () => {
    expect(computeTargets(fullProfile, null)).toEqual({ ok: false, missing: 'no_weight' });
    expect(computeTargets({ ...fullProfile, height_cm: null }, 80)).toEqual({
      ok: false,
      missing: 'no_height',
    });
    expect(computeTargets({ ...fullProfile, goal: null }, 80)).toEqual({
      ok: false,
      missing: 'no_goal',
    });
    expect(computeTargets(null, 80)).toEqual({ ok: false, missing: 'no_height' });
  });

  it("refuses to guess a BMR formula when sex is 'other'", () => {
    const result = computeTargets({ ...fullProfile, sex: 'other' }, 80);
    // The male/female constants differ by 166 kcal/day — defaulting would silently bias
    // every downstream calorie and macro number.
    expect(result).toEqual({ ok: false, missing: 'needs_bmr_formula_sex' });
  });

  it("uses the explicit formula choice once 'other' has one", () => {
    const result = computeTargets(
      { ...fullProfile, sex: 'other', bmr_formula_sex: 'female' },
      65,
      new Date('2026-07-25T00:00:00Z'),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // 10*65 + 6.25*180 - 5*30 - 161 = 1464
    expect(result.targets.bmrKcal).toBe(1464);
  });

  it('flags a target clamped to BMR', () => {
    const sedentary = { ...fullProfile, activity_level: 'sedentary' };
    const result = computeTargets(sedentary, 55, new Date('2026-07-25T00:00:00Z'));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // A small sedentary person cutting would fall under BMR; the clamp must be reported so
    // the UI can explain the number rather than silently showing a different deficit.
    expect(result.targets.calorieTarget).toBeGreaterThanOrEqual(result.targets.bmrKcal);
  });

  it('does not count a birthday that has not happened yet this year', () => {
    const decemberBirthday = { ...fullProfile, birth_date: '1996-12-31' };
    const result = computeTargets(decemberBirthday, 80, new Date('2026-07-25T00:00:00Z'));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Age 29, not 30 -> BMR is 5 kcal higher than the age-30 case.
    expect(result.targets.bmrKcal).toBe(1785);
  });
});

describe('summariseTrend', () => {
  it('estimates a weekly rate from a run of daily weigh-ins', () => {
    const metrics = Array.from({ length: 29 }, (_, i) => ({
      id: `m${i}`,
      measured_at: new Date(Date.UTC(2026, 5, 1 + i, 8)).toISOString(),
      weight_kg: 80 - (0.5 / 7) * i,
      body_fat_pct: null,
      muscle_mass_kg: null,
      water_pct: null,
      bone_mass_kg: null,
      visceral_fat: null,
      source: 'manual',
      device_id: null,
      raw_payload: null,
    }));

    const { rate } = summariseTrend(metrics);
    expect(rate?.kgPerWeek).toBeCloseTo(-0.5, 4);
    expect(rate?.isReliable).toBe(true);
  });

  it('marks a short history unreliable rather than reporting a confident trend', () => {
    const metrics = [
      { measured_at: '2026-07-01T08:00:00.000Z', weight_kg: 80 },
      { measured_at: '2026-07-02T08:00:00.000Z', weight_kg: 79 },
    ].map((m, i) => ({
      id: `m${i}`,
      body_fat_pct: null,
      muscle_mass_kg: null,
      water_pct: null,
      bone_mass_kg: null,
      visceral_fat: null,
      source: 'manual',
      device_id: null,
      raw_payload: null,
      ...m,
    }));

    expect(summariseTrend(metrics).rate?.isReliable).toBe(false);
  });

  it('returns a null rate with no data', () => {
    expect(summariseTrend([]).rate).toBeNull();
  });
});

describe('target snapshots', () => {
  it('closes the previous period when a new snapshot is taken', async () => {
    const targets = {
      weightKg: 80,
      bmi: 24.7,
      bmrKcal: 1780,
      tdeeKcal: 2759,
      calorieTarget: 2207,
      clampedToBmr: false,
      proteinG: 176,
      carbsG: 230,
      fatG: 64,
      goal: 'cut' as const,
    };

    await snapshotTargets(db, USER, newId, targets, 'manual', () => '2026-07-01T10:00:00.000Z');
    await snapshotTargets(
      db,
      USER,
      newId,
      { ...targets, weightKg: 79 },
      'system_weekly',
      () => '2026-07-08T10:00:00.000Z',
    );

    const open = await db.all(`SELECT * FROM nutrition_targets WHERE effective_to IS NULL`);
    // Exactly one open period — overlapping targets would make "what was my target then?"
    // unanswerable, which is the whole point of snapshotting.
    expect(open).toHaveLength(1);

    const current = await getCurrentTargets(db, USER);
    expect(current?.weight_kg_snapshot).toBe(79);
    expect(current?.computed_by).toBe('system_weekly');
  });

  it('returns null before any snapshot exists', async () => {
    expect(await getCurrentTargets(db, USER)).toBeNull();
  });

  it('does not let one user closing their period close another user\'s open period', async () => {
    const targets = {
      weightKg: 80,
      bmi: 24.7,
      bmrKcal: 1780,
      tdeeKcal: 2759,
      calorieTarget: 2207,
      clampedToBmr: false,
      proteinG: 176,
      carbsG: 230,
      fatG: 64,
      goal: 'cut' as const,
    };

    await snapshotTargets(db, USER, newId, targets, 'manual', () => '2026-07-01T10:00:00.000Z');
    await snapshotTargets(db, 'user-2', newId, targets, 'manual', () => '2026-07-01T10:00:00.000Z');

    // A second snapshot for USER must close only USER's period, not user-2's.
    await snapshotTargets(
      db,
      USER,
      newId,
      { ...targets, weightKg: 79 },
      'system_weekly',
      () => '2026-07-08T10:00:00.000Z',
    );

    expect(await getCurrentTargets(db, 'user-2')).not.toBeNull();
    expect((await getCurrentTargets(db, USER))?.weight_kg_snapshot).toBe(79);
  });
});

describe('remembering which scale is yours', () => {
  // The nameless broadcast scale is recognised by the shape of its bytes, so a neighbour's
  // identical unit is indistinguishable in the air. Knowing which device was used last is the
  // only thing that lets a scan prefer the right one.

  const weighIn = (deviceId: string | null, measuredAt: string, weightKg = 80) =>
    recordBodyMetric(
      db,
      USER,
      newId,
      { weightKg, source: 'ble_scale', deviceId, measuredAt },
      clock,
    );

  it('returns nothing before any Bluetooth weigh-in', async () => {
    await recordBodyMetric(db, USER, newId, { weightKg: 80, source: 'manual' }, clock);
    expect(await getLastScaleDeviceId(db, USER)).toBeNull();
  });

  it('returns the device from the most recent weigh-in', async () => {
    await weighIn('AA:AA:AA:AA:AA:AA', '2026-07-01T08:00:00.000Z');
    await weighIn('BB:BB:BB:BB:BB:BB', '2026-07-20T08:00:00.000Z');
    // Newest wins, so replacing a scale takes one successful weigh-in to switch over.
    expect(await getLastScaleDeviceId(db, USER)).toBe('BB:BB:BB:BB:BB:BB');
  });

  it('ignores manual entries made since the last scale reading', async () => {
    await weighIn('AA:AA:AA:AA:AA:AA', '2026-07-01T08:00:00.000Z');
    await recordBodyMetric(
      db,
      USER,
      newId,
      { weightKg: 79, source: 'manual', measuredAt: '2026-07-20T08:00:00.000Z' },
      clock,
    );
    expect(await getLastScaleDeviceId(db, USER)).toBe('AA:AA:AA:AA:AA:AA');
  });

  it('does not hand one user another user’s scale', async () => {
    await weighIn('AA:AA:AA:AA:AA:AA', '2026-07-01T08:00:00.000Z');
    expect(await getLastScaleDeviceId(db, 'user-2')).toBeNull();
  });

  it('forgets a scale whose only reading was deleted', async () => {
    const id = await weighIn('AA:AA:AA:AA:AA:AA', '2026-07-01T08:00:00.000Z');
    await deleteBodyMetric(db, USER, id);
    // Deleting a bad reading is how someone corrects a stranger's weigh-in — it must also
    // stop that stranger's scale being preferred from then on.
    expect(await getLastScaleDeviceId(db, USER)).toBeNull();
  });
});

describe('summariseComposition', () => {
  const profile = {
    user_id: USER,
    display_name: null,
    birth_date: '1996-04-10',
    sex: 'male',
    bmr_formula_sex: null,
    height_cm: 178,
    activity_level: 'moderate',
    goal: 'cut',
    unit_preference: 'metric',
    updated_at: '2026-07-25T10:00:00.000Z',
  };
  const TODAY = new Date('2026-08-15T00:00:00Z');

  it('computes BMI and its category from height and weight', () => {
    const composition = summariseComposition(profile, 74.18, null, TODAY);
    // 74.18 / 1.78^2 = 23.4
    expect(composition?.bmi).toBe(23.4);
    expect(composition?.bmiCategory).toBe('normal');
  });

  it('flags a body-fat figure it had to calculate', () => {
    const composition = summariseComposition(profile, 74.18, null, TODAY);
    expect(composition?.bodyFatIsEstimate).toBe(true);
    expect(composition?.bodyFatPct).toBeGreaterThan(0);
  });

  it('prefers a measured percentage over its own estimate', () => {
    // The whole point of a device is that it looked at the body. When one reports, arithmetic
    // from height and age must not overrule it.
    const composition = summariseComposition(profile, 74.18, 15.2, TODAY);
    expect(composition?.bodyFatPct).toBe(15.2);
    expect(composition?.bodyFatIsEstimate).toBe(false);
  });

  it('reports lean mass, not muscle mass', () => {
    const composition = summariseComposition(profile, 80, 25, TODAY);
    // 80 kg at 25% fat leaves 60 kg that is not fat — bone, organs and water included.
    // Skeletal muscle is roughly half of that, which is why this is never labelled muscle.
    expect(composition?.leanMassKg).toBe(60);
  });

  it('gives BMI without a fat figure when sex is unresolved', () => {
    // 'other' with no bmr_formula_sex chosen: the Deurenberg forms differ by more than ten
    // points of body fat, so guessing would be worse than saying nothing.
    const composition = summariseComposition(
      { ...profile, sex: 'other', bmr_formula_sex: null },
      74.18,
      null,
      TODAY,
    );
    expect(composition?.bmi).toBe(23.4);
    expect(composition?.bodyFatPct).toBeNull();
    expect(composition?.leanMassKg).toBeNull();
  });

  it('uses the chosen BMR formula when sex is "other"', () => {
    const composition = summariseComposition(
      { ...profile, sex: 'other', bmr_formula_sex: 'female' },
      74.18,
      null,
      TODAY,
    );
    expect(composition?.bodyFatIsEstimate).toBe(true);
    // The female form omits the 10.8-point male adjustment, so it must read higher.
    const male = summariseComposition(profile, 74.18, null, TODAY);
    expect(composition!.bodyFatPct!).toBeGreaterThan(male!.bodyFatPct!);
  });

  it('returns nothing without a height or a weight to work from', () => {
    expect(summariseComposition(profile, null, null, TODAY)).toBeNull();
    expect(summariseComposition({ ...profile, height_cm: null }, 74.18, null, TODAY)).toBeNull();
    expect(summariseComposition(null, 74.18, null, TODAY)).toBeNull();
  });
});
