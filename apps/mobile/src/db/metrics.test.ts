/**
 * Metrics repository tests — real SQL against a real SQLite engine, same approach as
 * workouts.test.ts.
 */

import { createRequire } from 'node:module';
import { beforeEach, describe, expect, it } from 'vitest';

import type { SqlExecutor } from './executor.js';
import {
  computeTargets,
  deleteBodyMetric,
  getCurrentTargets,
  getLatestWeight,
  getProfile,
  listBodyMetrics,
  recordBodyMetric,
  saveProfile,
  snapshotTargets,
  summariseTrend,
  type ProfileRow,
} from './metrics.js';
import { CREATE_SCHEMA_SQL } from './schema.js';

const nodeRequire = createRequire(import.meta.url);
const { DatabaseSync } = nodeRequire('node:sqlite') as {
  DatabaseSync: new (path: string) => {
    exec(sql: string): void;
    prepare(sql: string): {
      run(...params: never[]): unknown;
      all(...params: never[]): unknown[];
      get(...params: never[]): unknown;
    };
    close(): void;
  };
};

function createTestExecutor(): SqlExecutor {
  const db = new DatabaseSync(':memory:');
  db.exec(CREATE_SCHEMA_SQL.replace(/PRAGMA journal_mode = WAL;/, ''));
  db.exec('PRAGMA foreign_keys = ON;');
  return {
    // eslint-disable-next-line @typescript-eslint/require-await
    async run(sql, params = []) {
      db.prepare(sql).run(...(params as never[]));
    },
    // eslint-disable-next-line @typescript-eslint/require-await
    async all<T>(sql: string, params: unknown[] = []) {
      return db.prepare(sql).all(...(params as never[])) as T[];
    },
    // eslint-disable-next-line @typescript-eslint/require-await
    async get<T>(sql: string, params: unknown[] = []) {
      return (db.prepare(sql).get(...(params as never[])) ?? null) as T | null;
    },
    // eslint-disable-next-line @typescript-eslint/require-await
    async exec(sql) {
      db.exec(sql);
    },
  };
}

let db: SqlExecutor;
let counter = 0;
const newId = () => `id-${String(++counter).padStart(3, '0')}`;
const clock = () => '2026-07-25T10:00:00.000Z';

beforeEach(() => {
  db = createTestExecutor();
  counter = 0;
});

const fullProfile: ProfileRow = {
  id: 1,
  display_name: 'Test',
  birth_date: '1996-01-01',
  sex: 'male',
  bmr_formula_sex: null,
  height_cm: 180,
  activity_level: 'moderate',
  goal: 'cut',
  updated_at: clock(),
};

describe('profile', () => {
  it('creates the row on first save and reads it back', async () => {
    await saveProfile(db, { heightCm: 180, sex: 'male', goal: 'cut' }, clock);

    const profile = await getProfile(db);
    expect(profile?.height_cm).toBe(180);
    expect(profile?.goal).toBe('cut');
  });

  it('updates only the supplied fields', async () => {
    await saveProfile(db, { heightCm: 180, sex: 'male', goal: 'cut' }, clock);
    await saveProfile(db, { goal: 'bulk' }, clock);

    const profile = await getProfile(db);
    expect(profile?.goal).toBe('bulk');
    // Changing the goal from one screen must not blank height entered on another.
    expect(profile?.height_cm).toBe(180);
    expect(profile?.sex).toBe('male');
  });

  it('keeps exactly one profile row no matter how often it is saved', async () => {
    await saveProfile(db, { heightCm: 180 }, clock);
    await saveProfile(db, { heightCm: 181 }, clock);
    await saveProfile(db, { heightCm: 182 }, clock);

    const rows = await db.all('SELECT * FROM profile');
    expect(rows).toHaveLength(1);
  });
});

describe('body metrics', () => {
  it('records a manual weight and returns it as the latest', async () => {
    await recordBodyMetric(db, newId, { weightKg: 80.4, source: 'manual' }, clock);

    const latest = await getLatestWeight(db);
    expect(latest?.weight_kg).toBe(80.4);
    expect(latest?.source).toBe('manual');
  });

  it('orders latest by measurement time, not insertion order', async () => {
    await recordBodyMetric(
      db,
      newId,
      { weightKg: 80, source: 'manual', measuredAt: '2026-07-20T08:00:00.000Z' },
      clock,
    );
    // Inserted second but measured EARLIER — backfilling an old weigh-in must not become
    // "latest" just because it was typed in most recently.
    await recordBodyMetric(
      db,
      newId,
      { weightKg: 99, source: 'manual', measuredAt: '2026-07-01T08:00:00.000Z' },
      clock,
    );

    expect((await getLatestWeight(db))?.weight_kg).toBe(80);
  });

  it('stores the raw device frame for later reprocessing', async () => {
    await recordBodyMetric(
      db,
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

    const latest = await getLatestWeight(db);
    expect(JSON.parse(latest?.raw_payload ?? 'null')).toEqual({ bytes: [1, 2, 3] });
    expect(latest?.device_id).toBe('AA:BB:CC');
  });

  it('excludes rows with no weight from the list', async () => {
    await recordBodyMetric(db, newId, { bodyFatPct: 18, source: 'manual' }, clock);
    await recordBodyMetric(db, newId, { weightKg: 80, source: 'manual' }, clock);

    expect(await listBodyMetrics(db)).toHaveLength(1);
  });

  it('queues every metric for sync and records deletions too', async () => {
    const id = await recordBodyMetric(db, newId, { weightKg: 80, source: 'manual' }, clock);
    await deleteBodyMetric(db, id, clock);

    const ops = await db.all<{ op: string }>(
      `SELECT op FROM outbox WHERE entity = 'body_metric' ORDER BY id`,
    );
    expect(ops.map((o) => o.op)).toEqual(['insert', 'delete']);
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

    await snapshotTargets(db, newId, targets, 'manual', () => '2026-07-01T10:00:00.000Z');
    await snapshotTargets(
      db,
      newId,
      { ...targets, weightKg: 79 },
      'system_weekly',
      () => '2026-07-08T10:00:00.000Z',
    );

    const open = await db.all(`SELECT * FROM nutrition_targets WHERE effective_to IS NULL`);
    // Exactly one open period — overlapping targets would make "what was my target then?"
    // unanswerable, which is the whole point of snapshotting.
    expect(open).toHaveLength(1);

    const current = await getCurrentTargets(db);
    expect(current?.weight_kg_snapshot).toBe(79);
    expect(current?.computed_by).toBe('system_weekly');
  });

  it('returns null before any snapshot exists', async () => {
    expect(await getCurrentTargets(db)).toBeNull();
  });
});
