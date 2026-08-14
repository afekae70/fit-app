/**
 * Profile, body-metric and nutrition-target repository.
 *
 * All the physiology comes from `@fit/shared` — this module only reads and writes rows and
 * hands the numbers to the shared functions. Duplicating a formula here would let the value
 * shown on the metrics screen drift from what the API (and later the AI coach) computes.
 */

import {
  bmi as computeBmi,
  bmr as computeBmr,
  calorieTarget,
  macroSplit,
  resolveBmrSex,
  tdee as computeTdee,
  weeklyRateOfChange,
  type ActivityLevel,
  type Goal,
} from '@fit/shared/calculations';
import type { UnitPreference } from '@fit/shared';

import type { SqlExecutor } from './executor.js';
import type { Clock, IdFactory } from './workouts.js';

const defaultClock: Clock = () => new Date().toISOString();

/* -------------------------------------------------------------------------- */
/* Profile                                                                     */
/* -------------------------------------------------------------------------- */

export interface ProfileRow {
  user_id: string;
  display_name: string | null;
  birth_date: string | null;
  sex: string | null;
  bmr_formula_sex: string | null;
  height_cm: number | null;
  activity_level: string | null;
  goal: string | null;
  unit_preference: string | null;
  updated_at: string;
}

export interface ProfileInput {
  displayName?: string | null;
  birthDate?: string | null;
  sex?: 'male' | 'female' | 'other' | null;
  /** Which Mifflin-St Jeor coefficients to use when sex is 'other'. */
  bmrFormulaSex?: 'male' | 'female' | null;
  heightCm?: number | null;
  activityLevel?: ActivityLevel | null;
  goal?: Goal | null;
  /** Display preference only — every stored measurement stays metric. See src/units.ts. */
  unitPreference?: UnitPreference | null;
}

export async function getProfile(db: SqlExecutor, userId: string): Promise<ProfileRow | null> {
  return db.get<ProfileRow>(`SELECT * FROM profile WHERE user_id = ?`, [userId]);
}

/**
 * Upsert the one profile row for this user.
 *
 * Only the supplied fields are written, so editing the goal from one screen cannot blank the
 * height entered on another.
 */
export async function saveProfile(
  db: SqlExecutor,
  userId: string,
  input: ProfileInput,
  clock: Clock = defaultClock,
): Promise<void> {
  const existing = await getProfile(db, userId);
  const now = clock();

  if (!existing) {
    await db.run(
      `INSERT INTO profile
         (user_id, display_name, birth_date, sex, bmr_formula_sex, height_cm, activity_level,
          goal, unit_preference, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        userId,
        input.displayName ?? null,
        input.birthDate ?? null,
        input.sex ?? null,
        input.bmrFormulaSex ?? null,
        input.heightCm ?? null,
        input.activityLevel ?? null,
        input.goal ?? null,
        input.unitPreference ?? null,
        now,
      ],
    );
    return;
  }

  const assignments: string[] = [];
  const params: unknown[] = [];
  const set = (column: string, value: unknown) => {
    if (value !== undefined) {
      assignments.push(`${column} = ?`);
      params.push(value);
    }
  };
  set('display_name', input.displayName);
  set('birth_date', input.birthDate);
  set('sex', input.sex);
  set('bmr_formula_sex', input.bmrFormulaSex);
  set('height_cm', input.heightCm);
  set('activity_level', input.activityLevel);
  set('goal', input.goal);
  set('unit_preference', input.unitPreference);

  assignments.push('updated_at = ?');
  params.push(now);

  params.push(userId);
  await db.run(`UPDATE profile SET ${assignments.join(', ')} WHERE user_id = ?`, params);
}

/* -------------------------------------------------------------------------- */
/* Body metrics                                                                */
/* -------------------------------------------------------------------------- */

export type MetricSource = 'manual' | 'ble_scale' | 'ai_assistant' | 'health_platform';

export interface BodyMetricRow {
  id: string;
  measured_at: string;
  weight_kg: number | null;
  body_fat_pct: number | null;
  muscle_mass_kg: number | null;
  water_pct: number | null;
  bone_mass_kg: number | null;
  visceral_fat: number | null;
  source: string;
  device_id: string | null;
  raw_payload: string | null;
}

export interface BodyMetricInput {
  weightKg?: number | null;
  bodyFatPct?: number | null;
  muscleMassKg?: number | null;
  waterPct?: number | null;
  boneMassKg?: number | null;
  visceralFat?: number | null;
  source: MetricSource;
  deviceId?: string | null;
  /** Raw device frame, stored so a parser fix can reprocess history. */
  rawPayload?: unknown;
  measuredAt?: string;
}

export async function recordBodyMetric(
  db: SqlExecutor,
  userId: string,
  newId: IdFactory,
  input: BodyMetricInput,
  clock: Clock = defaultClock,
): Promise<string> {
  const id = newId();
  const measuredAt = input.measuredAt ?? clock();

  await db.run(
    `INSERT INTO body_metrics
       (id, user_id, measured_at, weight_kg, body_fat_pct, muscle_mass_kg, water_pct, bone_mass_kg,
        visceral_fat, source, device_id, raw_payload, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      userId,
      measuredAt,
      input.weightKg ?? null,
      input.bodyFatPct ?? null,
      input.muscleMassKg ?? null,
      input.waterPct ?? null,
      input.boneMassKg ?? null,
      input.visceralFat ?? null,
      input.source,
      input.deviceId ?? null,
      input.rawPayload === undefined ? null : JSON.stringify(input.rawPayload),
      clock(),
    ],
  );

  await db.run(
    `INSERT INTO outbox (user_id, entity, entity_id, op, payload, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
    [userId, 'body_metric', id, 'insert', JSON.stringify({ ...input, measuredAt }), clock()],
  );

  return id;
}

export async function listBodyMetrics(
  db: SqlExecutor,
  userId: string,
  limit = 180,
): Promise<BodyMetricRow[]> {
  return db.all<BodyMetricRow>(
    `SELECT * FROM body_metrics
      WHERE user_id = ? AND weight_kg IS NOT NULL AND deleted_at IS NULL
      ORDER BY measured_at DESC LIMIT ?`,
    [userId, limit],
  );
}

export async function getLatestWeight(db: SqlExecutor, userId: string): Promise<BodyMetricRow | null> {
  return db.get<BodyMetricRow>(
    `SELECT * FROM body_metrics
      WHERE user_id = ? AND weight_kg IS NOT NULL AND deleted_at IS NULL
      ORDER BY measured_at DESC LIMIT 1`,
    [userId],
  );
}

export async function deleteBodyMetric(
  db: SqlExecutor,
  userId: string,
  id: string,
  clock: Clock = defaultClock,
): Promise<void> {
  // Marked, not removed: a row that simply vanished would be invisible to the next sync, and
  // the server would hand it straight back on the following pull.
  const at = clock();
  await db.run(
    `UPDATE body_metrics SET deleted_at = ?, updated_at = ? WHERE id = ? AND user_id = ?`,
    [at, at, id, userId],
  );
  await db.run(
    `INSERT INTO outbox (user_id, entity, entity_id, op, payload, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
    [userId, 'body_metric', id, 'delete', null, clock()],
  );
}

/* -------------------------------------------------------------------------- */
/* Derived targets                                                             */
/* -------------------------------------------------------------------------- */

export interface ComputedTargets {
  weightKg: number;
  bmi: number;
  bmrKcal: number;
  tdeeKcal: number;
  calorieTarget: number;
  clampedToBmr: boolean;
  proteinG: number;
  carbsG: number;
  fatG: number;
  goal: Goal;
}

/** Reason a target could not be computed, so the UI can say what is missing. */
export type TargetsGap =
  | 'no_weight'
  | 'no_height'
  | 'no_birth_date'
  | 'no_activity_level'
  | 'no_goal'
  | 'needs_bmr_formula_sex';

export type TargetsResult =
  | { ok: true; targets: ComputedTargets }
  | { ok: false; missing: TargetsGap };

/**
 * Compute current targets from the profile and the most recent weight.
 *
 * Returns a typed gap rather than throwing or silently defaulting, so the screen can prompt
 * for the one missing field. That matters most for `needs_bmr_formula_sex`: the Mifflin-St
 * Jeor constants differ by 166 kcal/day between the male and female forms, so guessing for a
 * user who selected 'other' would bias every downstream number.
 */
export function computeTargets(
  profile: ProfileRow | null,
  latestWeightKg: number | null,
  today = new Date(),
): TargetsResult {
  if (latestWeightKg === null) return { ok: false, missing: 'no_weight' };
  if (!profile?.height_cm) return { ok: false, missing: 'no_height' };
  if (!profile.birth_date) return { ok: false, missing: 'no_birth_date' };
  if (!profile.activity_level) return { ok: false, missing: 'no_activity_level' };
  if (!profile.goal) return { ok: false, missing: 'no_goal' };

  const bmrSex = resolveBmrSex(
    (profile.sex ?? 'other') as 'male' | 'female' | 'other',
    (profile.bmr_formula_sex ?? undefined) as 'male' | 'female' | undefined,
  );
  if (bmrSex === null) return { ok: false, missing: 'needs_bmr_formula_sex' };

  const birth = new Date(profile.birth_date);
  let ageYears = today.getUTCFullYear() - birth.getUTCFullYear();
  const monthDelta = today.getUTCMonth() - birth.getUTCMonth();
  if (monthDelta < 0 || (monthDelta === 0 && today.getUTCDate() < birth.getUTCDate())) {
    ageYears -= 1;
  }

  const goal = profile.goal as Goal;
  const bmrKcal = computeBmr({
    weightKg: latestWeightKg,
    heightCm: profile.height_cm,
    ageYears,
    sex: bmrSex,
  });
  const tdeeKcal = computeTdee(bmrKcal, profile.activity_level as ActivityLevel);
  const target = calorieTarget(tdeeKcal, goal, { bmrKcal });
  const macros = macroSplit(target.calories, latestWeightKg, goal);

  return {
    ok: true,
    targets: {
      weightKg: latestWeightKg,
      bmi: computeBmi(latestWeightKg, profile.height_cm),
      bmrKcal: Math.round(bmrKcal),
      tdeeKcal: Math.round(tdeeKcal),
      calorieTarget: target.calories,
      clampedToBmr: target.clampedToBmr,
      proteinG: macros.proteinG,
      carbsG: macros.carbsG,
      fatG: macros.fatG,
      goal,
    },
  };
}

/** Weight-trend summary for the metrics screen. */
export function summariseTrend(metrics: BodyMetricRow[]) {
  const points = metrics
    .filter((m): m is BodyMetricRow & { weight_kg: number } => m.weight_kg !== null)
    .map((m) => ({ date: new Date(m.measured_at), weightKg: m.weight_kg }));

  return {
    points,
    rate: weeklyRateOfChange(points),
  };
}

/**
 * Close the open target period and record a new one.
 *
 * Snapshotting rather than recomputing on read is what lets the AI later see what the target
 * *was* in a given week when judging whether it was actually followed.
 */
export async function snapshotTargets(
  db: SqlExecutor,
  userId: string,
  newId: IdFactory,
  targets: ComputedTargets,
  computedBy: 'system_weekly' | 'manual' | 'ai',
  clock: Clock = defaultClock,
): Promise<string> {
  const now = clock();
  const today = now.slice(0, 10);

  // Unscoped, this would close out every user's open target period, not just this one's.
  await db.run(
    `UPDATE nutrition_targets SET effective_to = ? WHERE effective_to IS NULL AND user_id = ?`,
    [today, userId],
  );

  const id = newId();
  await db.run(
    `INSERT INTO nutrition_targets
       (id, user_id, effective_from, effective_to, weight_kg_snapshot, bmi, bmr_kcal, tdee_kcal,
        goal, calorie_target, protein_g, carbs_g, fat_g, computed_by, created_at)
     VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      userId,
      today,
      targets.weightKg,
      targets.bmi,
      targets.bmrKcal,
      targets.tdeeKcal,
      targets.goal,
      targets.calorieTarget,
      targets.proteinG,
      targets.carbsG,
      targets.fatG,
      computedBy,
      now,
    ],
  );
  return id;
}

export interface NutritionTargetRow {
  id: string;
  effective_from: string;
  effective_to: string | null;
  weight_kg_snapshot: number;
  bmi: number | null;
  bmr_kcal: number | null;
  tdee_kcal: number | null;
  goal: string;
  calorie_target: number | null;
  protein_g: number | null;
  carbs_g: number | null;
  fat_g: number | null;
  computed_by: string;
  created_at: string;
}

export async function getCurrentTargets(
  db: SqlExecutor,
  userId: string,
): Promise<NutritionTargetRow | null> {
  return db.get<NutritionTargetRow>(
    `SELECT * FROM nutrition_targets WHERE user_id = ? AND effective_to IS NULL
      ORDER BY effective_from DESC LIMIT 1`,
    [userId],
  );
}
