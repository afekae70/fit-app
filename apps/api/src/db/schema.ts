/**
 * Drizzle schema — the single source of truth for the database.
 *
 * Scope boundary: Drizzle owns the `public` schema. It deliberately does NOT model
 * Supabase's `auth` schema, because drizzle-kit would then try to create and manage
 * `auth.users`, which Supabase owns. The foreign key from `profiles.id` to `auth.users.id`,
 * the RLS policies, the EXCLUDE constraint on nutrition_targets, and the analysis view are
 * all applied by the hand-written migration in `drizzle/0001_platform_objects.sql`.
 *
 * Numeric columns use `mode: 'number'` so TypeScript sees plain numbers rather than strings,
 * while Postgres still enforces the declared precision/scale. Range validity (no negative
 * weights, RPE within 1-10) is enforced by CHECK constraints — the database is the last line
 * of defence, since an offline client could sync anything.
 */

import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

/* -------------------------------------------------------------------------- */
/* Enumerated value sets                                                       */
/*                                                                             */
/* Modelled as text + CHECK rather than Postgres ENUM types. ENUMs are painful  */
/* to evolve (you cannot remove a value, and older PG can't ALTER TYPE inside a */
/* transaction), and several of these lists will grow.                          */
/* -------------------------------------------------------------------------- */

export const SEXES = ['male', 'female', 'other'] as const;
export const ACTIVITY_LEVELS = [
  'sedentary',
  'light',
  'moderate',
  'active',
  'very_active',
] as const;
export const GOALS = ['cut', 'maintain', 'bulk'] as const;
export const UNIT_PREFERENCES = ['metric', 'imperial'] as const;
export const LOCATION_KINDS = [
  'commercial_gym',
  'home',
  'military_base',
  'outdoor',
  'other',
] as const;
export const LOAD_TYPES = [
  'weight_reps',
  'bodyweight',
  'bodyweight_plus',
  'time',
  'distance',
] as const;
export const METRIC_SOURCES = [
  'ble_scale',
  'manual',
  'ai_assistant',
  'health_platform',
] as const;
export const TARGET_AUTHORS = ['system_weekly', 'ai', 'manual'] as const;
export const AI_ROLES = ['user', 'assistant'] as const;
export const AI_PLAN_KINDS = ['workout', 'nutrition'] as const;

/** Build a CHECK constraint restricting a text column to a fixed set of values. */
const oneOf = (column: unknown, values: readonly string[]) =>
  sql`${column} in (${sql.join(
    values.map((v) => sql`${v}`),
    sql`, `,
  )})`;

/* -------------------------------------------------------------------------- */
/* Profiles                                                                    */
/* -------------------------------------------------------------------------- */

export const profiles = pgTable(
  'profiles',
  {
    /** Mirrors auth.users.id. FK added in the platform-objects migration. */
    id: uuid('id').primaryKey(),
    displayName: text('display_name'),

    /**
     * Date of birth, not age. A stored age silently becomes wrong on the user's birthday
     * and would quietly skew every BMR calculation from then on.
     */
    birthDate: date('birth_date'),
    sex: text('sex'),

    /**
     * Which Mifflin-St Jeor coefficient set to use when `sex = 'other'`.
     * NULL means the user has not chosen; the app must ask rather than assume, because the
     * male/female constants differ by 166 kcal/day.
     */
    bmrFormulaSex: text('bmr_formula_sex'),

    heightCm: numeric('height_cm', { precision: 5, scale: 2, mode: 'number' }),
    activityLevel: text('activity_level'),
    goal: text('goal'),
    unitPreference: text('unit_preference').notNull().default('metric'),
    locale: text('locale').notNull().default('he'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('profiles_sex_check', sql`${t.sex} is null or ${oneOf(t.sex, SEXES)}`),
    check(
      'profiles_bmr_formula_sex_check',
      sql`${t.bmrFormulaSex} is null or ${t.bmrFormulaSex} in ('male', 'female')`,
    ),
    check(
      'profiles_activity_level_check',
      sql`${t.activityLevel} is null or ${oneOf(t.activityLevel, ACTIVITY_LEVELS)}`,
    ),
    check('profiles_goal_check', sql`${t.goal} is null or ${oneOf(t.goal, GOALS)}`),
    check(
      'profiles_unit_preference_check',
      oneOf(t.unitPreference, UNIT_PREFERENCES),
    ),
    check(
      'profiles_height_range_check',
      sql`${t.heightCm} is null or (${t.heightCm} > 50 and ${t.heightCm} < 260)`,
    ),
  ],
);

/* -------------------------------------------------------------------------- */
/* Locations and equipment — the substrate for location-adapted plans          */
/* -------------------------------------------------------------------------- */

export const locations = pgTable(
  'locations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    name: text('name').notNull(), // 'Gym — Kfar Saba', 'Military base'
    kind: text('kind'),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('locations_user_idx').on(t.userId),
    check('locations_kind_check', sql`${t.kind} is null or ${oneOf(t.kind, LOCATION_KINDS)}`),
  ],
);

/** Global equipment catalogue. Not user-scoped, so no RLS beyond public read. */
export const equipment = pgTable('equipment', {
  id: uuid('id').primaryKey().defaultRandom(),
  slug: text('slug').notNull().unique(), // 'barbell', 'cable_machine', 'pullup_bar'
  nameEn: text('name_en').notNull(),
  nameHe: text('name_he').notNull(),
});

/**
 * What equipment is actually available at each location.
 *
 * This join table is what turns "the base has a pull-up bar and dumbbells but no cable
 * machine" into a query result the AI can be given, instead of something it has to guess.
 */
export const locationEquipment = pgTable(
  'location_equipment',
  {
    locationId: uuid('location_id')
      .notNull()
      .references(() => locations.id, { onDelete: 'cascade' }),
    equipmentId: uuid('equipment_id')
      .notNull()
      .references(() => equipment.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.locationId, t.equipmentId] })],
);

/* -------------------------------------------------------------------------- */
/* Exercise catalogue                                                          */
/* -------------------------------------------------------------------------- */

export const exercises = pgTable(
  'exercises',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** NULL means a global, seeded exercise. Non-null means user-created. */
    userId: uuid('user_id').references(() => profiles.id, { onDelete: 'cascade' }),

    nameEn: text('name_en').notNull(),
    nameHe: text('name_he'),

    primaryMuscle: text('primary_muscle').notNull(),
    secondaryMuscles: text('secondary_muscles')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),

    /**
     * Used to find substitutes when an exercise's equipment isn't available at a location —
     * a cable row and a dumbbell row are both 'horizontal_pull'.
     */
    movementPattern: text('movement_pattern'),
    equipmentId: uuid('equipment_id').references(() => equipment.id),
    isUnilateral: boolean('is_unilateral').notNull().default(false),

    /**
     * Determines which columns on `sets` are meaningful, and which inputs the logging UI
     * shows. A plank is 'time', a pull-up is 'bodyweight_plus', a face pull is 'weight_reps'.
     * Without this you get meaningless NULLs and no way to validate input per exercise.
     */
    loadType: text('load_type').notNull().default('weight_reps'),
  },
  (t) => [
    // NULLS NOT DISTINCT so two global exercises can't share a name (NULL user_id would
    // otherwise bypass the constraint, since NULL != NULL under default semantics).
    unique('exercises_user_name_unique').on(t.userId, t.nameEn).nullsNotDistinct(),
    index('exercises_primary_muscle_idx').on(t.primaryMuscle),
    index('exercises_equipment_idx').on(t.equipmentId),
    check('exercises_load_type_check', oneOf(t.loadType, LOAD_TYPES)),
  ],
);

/* -------------------------------------------------------------------------- */
/* Plans → variants → days → prescriptions                                     */
/* -------------------------------------------------------------------------- */

export const plans = pgTable(
  'plans',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    name: text('name').notNull(), // 'Hypertrophy Block 1'
    goal: text('goal'),
    daysPerWeek: integer('days_per_week'),
    lengthWeeks: integer('length_weeks'),
    isActive: boolean('is_active').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('plans_user_idx').on(t.userId),
    check('plans_goal_check', sql`${t.goal} is null or ${oneOf(t.goal, GOALS)}`),
    check(
      'plans_days_per_week_check',
      sql`${t.daysPerWeek} is null or (${t.daysPerWeek} between 1 and 14)`,
    ),
  ],
);

/**
 * A location-adapted variant of a plan — this is "Plan A" vs "Plan B".
 *
 * One plan, one variant per location. The UNIQUE on (plan_id, location_id) is what stops
 * you accidentally creating two competing variants for the same gym.
 */
export const planVariants = pgTable(
  'plan_variants',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    planId: uuid('plan_id')
      .notNull()
      .references(() => plans.id, { onDelete: 'cascade' }),
    locationId: uuid('location_id')
      .notNull()
      .references(() => locations.id, { onDelete: 'cascade' }),
    label: text('label').notNull(), // 'A — Kfar Saba', 'B — Base'
  },
  (t) => [unique('plan_variants_plan_location_unique').on(t.planId, t.locationId)],
);

export const planDays = pgTable(
  'plan_days',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    planVariantId: uuid('plan_variant_id')
      .notNull()
      .references(() => planVariants.id, { onDelete: 'cascade' }),
    dayIndex: integer('day_index').notNull(), // 1..N within the training week
    name: text('name'), // 'Push', 'Pull', 'Legs'
  },
  (t) => [unique('plan_days_variant_index_unique').on(t.planVariantId, t.dayIndex)],
);

/**
 * The prescription: what you intend to do. Distinct from what you actually logged.
 *
 * `targetSets` lives here and ONLY here. It is a hint for the logging UI to pre-populate —
 * never a constraint on how many sets you may record. The plan can say 3 and you can log 5.
 */
export const planDayExercises = pgTable(
  'plan_day_exercises',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    planDayId: uuid('plan_day_id')
      .notNull()
      .references(() => planDays.id, { onDelete: 'cascade' }),
    exerciseId: uuid('exercise_id')
      .notNull()
      .references(() => exercises.id),
    orderIndex: integer('order_index').notNull(),

    targetSets: integer('target_sets'),
    targetRepsMin: integer('target_reps_min'),
    targetRepsMax: integer('target_reps_max'),
    targetRpe: numeric('target_rpe', { precision: 3, scale: 1, mode: 'number' }),
    targetLoadKg: numeric('target_load_kg', { precision: 6, scale: 2, mode: 'number' }),
    targetPct1rm: numeric('target_pct_1rm', { precision: 4, scale: 1, mode: 'number' }),
    restSeconds: integer('rest_seconds'),

    /** Same non-null value across rows = perform those exercises as a superset. */
    supersetGroup: text('superset_group'),
    notes: text('notes'),
  },
  (t) => [
    unique('plan_day_exercises_day_order_unique').on(t.planDayId, t.orderIndex),
    check(
      'plan_day_exercises_rep_range_check',
      sql`${t.targetRepsMin} is null or ${t.targetRepsMax} is null or ${t.targetRepsMin} <= ${t.targetRepsMax}`,
    ),
    check(
      'plan_day_exercises_rpe_check',
      sql`${t.targetRpe} is null or (${t.targetRpe} >= 1 and ${t.targetRpe} <= 10)`,
    ),
  ],
);

/* -------------------------------------------------------------------------- */
/* Workout logging — the dynamic-sets core                                     */
/* -------------------------------------------------------------------------- */

export const workoutSessions = pgTable(
  'workout_sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),

    /** Where you trained. Drives which plan variant applies. */
    locationId: uuid('location_id').references(() => locations.id, { onDelete: 'set null' }),
    /** NULL = freestyle session not driven by any plan. */
    planDayId: uuid('plan_day_id').references(() => planDays.id, { onDelete: 'set null' }),

    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    endedAt: timestamp('ended_at', { withTimezone: true }),
    bodyweightKg: numeric('bodyweight_kg', { precision: 5, scale: 2, mode: 'number' }),
    sessionRpe: numeric('session_rpe', { precision: 3, scale: 1, mode: 'number' }),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('workout_sessions_user_started_idx').on(t.userId, t.startedAt),
    check(
      'workout_sessions_rpe_check',
      sql`${t.sessionRpe} is null or (${t.sessionRpe} >= 1 and ${t.sessionRpe} <= 10)`,
    ),
    check(
      'workout_sessions_time_order_check',
      sql`${t.endedAt} is null or ${t.endedAt} >= ${t.startedAt}`,
    ),
  ],
);

/**
 * One row per exercise performed in a session.
 *
 * This middle level is what makes per-exercise set counts independent: each exercise gets its
 * own row here, and its sets hang off it. Four sets of chest press and two of face pulls are
 * simply two rows here with different numbers of children.
 */
export const sessionExercises = pgTable(
  'session_exercises',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => workoutSessions.id, { onDelete: 'cascade' }),
    exerciseId: uuid('exercise_id')
      .notNull()
      .references(() => exercises.id),
    orderIndex: integer('order_index').notNull(),

    /**
     * Back-link to the prescription this came from. NULL means it was added ad-hoc mid-session.
     * This is what lets the AI compare prescribed vs. actual — the basis of adherence and
     * stall detection.
     */
    planDayExerciseId: uuid('plan_day_exercise_id').references(() => planDayExercises.id, {
      onDelete: 'set null',
    }),
    notes: text('notes'),
  },
  (t) => [
    unique('session_exercises_session_order_unique').on(t.sessionId, t.orderIndex),
    index('session_exercises_exercise_idx').on(t.exerciseId),
  ],
);

/**
 * ONE ROW PER SET. This is the table that makes set counts fully dynamic.
 *
 * There is deliberately no `set1_reps` / `set2_reps` / `set3_reps` anywhere in this schema.
 * "Add a set" is an INSERT; "remove a set" is a DELETE plus renumbering the remaining
 * `set_index` values. An exercise with two sets stores two rows and wastes nothing; an
 * exercise with eight stores eight and needs no migration.
 */
export const sets = pgTable(
  'sets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sessionExerciseId: uuid('session_exercise_id')
      .notNull()
      .references(() => sessionExercises.id, { onDelete: 'cascade' }),

    /** 1-based, contiguous within an exercise. Renumbered on delete. */
    setIndex: integer('set_index').notNull(),

    // Which of these are populated depends on the exercise's load_type.
    weightKg: numeric('weight_kg', { precision: 6, scale: 2, mode: 'number' }),
    reps: integer('reps'),
    durationSeconds: integer('duration_seconds'),
    distanceM: numeric('distance_m', { precision: 8, scale: 2, mode: 'number' }),

    rpe: numeric('rpe', { precision: 3, scale: 1, mode: 'number' }),
    /** Warmups are excluded from volume and 1RM estimation. */
    isWarmup: boolean('is_warmup').notNull().default(false),
    toFailure: boolean('to_failure').notNull().default(false),
    completedAt: timestamp('completed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('sets_exercise_index_unique').on(t.sessionExerciseId, t.setIndex),
    index('sets_session_exercise_idx').on(t.sessionExerciseId),
    check('sets_set_index_positive_check', sql`${t.setIndex} >= 1`),
    check('sets_reps_check', sql`${t.reps} is null or ${t.reps} >= 0`),
    check('sets_weight_check', sql`${t.weightKg} is null or ${t.weightKg} >= 0`),
    check('sets_rpe_check', sql`${t.rpe} is null or (${t.rpe} >= 1 and ${t.rpe} <= 10)`),
    // A set with no measurement at all is meaningless — reject it at the DB layer, since
    // an offline client could otherwise sync empty rows.
    check(
      'sets_has_measurement_check',
      sql`${t.reps} is not null or ${t.durationSeconds} is not null or ${t.distanceM} is not null`,
    ),
  ],
);

/* -------------------------------------------------------------------------- */
/* Body metrics and nutrition targets                                          */
/* -------------------------------------------------------------------------- */

export const bodyMetrics = pgTable(
  'body_metrics',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    measuredAt: timestamp('measured_at', { withTimezone: true }).notNull(),

    weightKg: numeric('weight_kg', { precision: 5, scale: 2, mode: 'number' }),
    bodyFatPct: numeric('body_fat_pct', { precision: 4, scale: 1, mode: 'number' }),
    muscleMassKg: numeric('muscle_mass_kg', { precision: 5, scale: 2, mode: 'number' }),
    waterPct: numeric('water_pct', { precision: 4, scale: 1, mode: 'number' }),
    boneMassKg: numeric('bone_mass_kg', { precision: 4, scale: 2, mode: 'number' }),
    visceralFat: numeric('visceral_fat', { precision: 4, scale: 1, mode: 'number' }),

    source: text('source').notNull(),
    deviceId: text('device_id'),

    /**
     * The raw Bluetooth frame, kept deliberately.
     *
     * Consumer scale protocols are reverse-engineered and the body-composition fields in
     * particular are sometimes decoded wrongly. Keeping the raw bytes means a parser fix can
     * reprocess the entire history rather than throwing it away.
     */
    rawPayload: jsonb('raw_payload'),
  },
  (t) => [
    unique('body_metrics_user_measured_source_unique').on(t.userId, t.measuredAt, t.source),
    index('body_metrics_user_measured_idx').on(t.userId, t.measuredAt),
    check('body_metrics_source_check', oneOf(t.source, METRIC_SOURCES)),
    check(
      'body_metrics_weight_check',
      sql`${t.weightKg} is null or (${t.weightKg} > 0 and ${t.weightKg} < 500)`,
    ),
    check(
      'body_metrics_body_fat_check',
      sql`${t.bodyFatPct} is null or (${t.bodyFatPct} >= 0 and ${t.bodyFatPct} < 100)`,
    ),
  ],
);

/**
 * Dated snapshots of computed targets, not values recomputed on read.
 *
 * Two reasons this is a table rather than a derived value:
 *  1. The weekly/monthly update requirement needs somewhere to record each revision.
 *  2. History stays auditable — the AI can see what your target *was* in March when
 *     assessing whether you actually adhered to it.
 *
 * A GiST EXCLUDE constraint (added in the platform-objects migration) makes overlapping
 * periods for one user impossible at the database level.
 */
export const nutritionTargets = pgTable(
  'nutrition_targets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),

    effectiveFrom: date('effective_from').notNull(),
    /** NULL = currently active. */
    effectiveTo: date('effective_to'),

    weightKgSnapshot: numeric('weight_kg_snapshot', {
      precision: 5,
      scale: 2,
      mode: 'number',
    }).notNull(),
    bmi: numeric('bmi', { precision: 4, scale: 1, mode: 'number' }),
    bmrKcal: integer('bmr_kcal'),
    tdeeKcal: integer('tdee_kcal'),

    goal: text('goal').notNull(),
    calorieTarget: integer('calorie_target'),
    proteinG: integer('protein_g'),
    carbsG: integer('carbs_g'),
    fatG: integer('fat_g'),

    formula: text('formula').notNull().default('mifflin_st_jeor'),
    computedBy: text('computed_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('nutrition_targets_user_from_idx').on(t.userId, t.effectiveFrom),
    check('nutrition_targets_goal_check', oneOf(t.goal, GOALS)),
    check('nutrition_targets_computed_by_check', oneOf(t.computedBy, TARGET_AUTHORS)),
    check(
      'nutrition_targets_date_order_check',
      sql`${t.effectiveTo} is null or ${t.effectiveTo} >= ${t.effectiveFrom}`,
    ),
  ],
);

/* -------------------------------------------------------------------------- */
/* AI coach                                                                    */
/* -------------------------------------------------------------------------- */

export const aiConversations = pgTable(
  'ai_conversations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    title: text('title'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('ai_conversations_user_idx').on(t.userId)],
);

export const aiMessages = pgTable(
  'ai_messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => aiConversations.id, { onDelete: 'cascade' }),
    role: text('role').notNull(),
    content: jsonb('content').notNull(),

    model: text('model'),
    provider: text('provider'),
    /** Token counts logged from day one — LLM spend is invisible until you measure it. */
    inputTokens: integer('input_tokens'),
    outputTokens: integer('output_tokens'),
    cacheReadTokens: integer('cache_read_tokens'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('ai_messages_conversation_idx').on(t.conversationId, t.createdAt),
    check('ai_messages_role_check', oneOf(t.role, AI_ROLES)),
  ],
);

/**
 * AI-proposed plans, held for review.
 *
 * Model output lands here first and is only written into `plans` / `plan_variants` once the
 * user accepts it. The AI never silently mutates a training programme.
 */
export const aiGeneratedPlans = pgTable(
  'ai_generated_plans',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    /** Schema-validated model output. */
    payload: jsonb('payload').notNull(),
    /** Set once accepted and materialised into real plan rows. */
    planId: uuid('plan_id').references(() => plans.id, { onDelete: 'set null' }),

    model: text('model'),
    provider: text('provider'),
    accepted: boolean('accepted').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('ai_generated_plans_user_idx').on(t.userId, t.createdAt),
    check('ai_generated_plans_kind_check', oneOf(t.kind, AI_PLAN_KINDS)),
  ],
);

/* -------------------------------------------------------------------------- */
/* Inferred types                                                              */
/* -------------------------------------------------------------------------- */

export type Profile = typeof profiles.$inferSelect;
export type NewProfile = typeof profiles.$inferInsert;
export type Location = typeof locations.$inferSelect;
export type Equipment = typeof equipment.$inferSelect;
export type Exercise = typeof exercises.$inferSelect;
export type NewExercise = typeof exercises.$inferInsert;
export type Plan = typeof plans.$inferSelect;
export type PlanVariant = typeof planVariants.$inferSelect;
export type PlanDay = typeof planDays.$inferSelect;
export type PlanDayExercise = typeof planDayExercises.$inferSelect;
export type WorkoutSession = typeof workoutSessions.$inferSelect;
export type NewWorkoutSession = typeof workoutSessions.$inferInsert;
export type SessionExercise = typeof sessionExercises.$inferSelect;
export type WorkoutSet = typeof sets.$inferSelect;
export type NewWorkoutSet = typeof sets.$inferInsert;
export type BodyMetric = typeof bodyMetrics.$inferSelect;
export type NewBodyMetric = typeof bodyMetrics.$inferInsert;
export type NutritionTarget = typeof nutritionTargets.$inferSelect;
export type NewNutritionTarget = typeof nutritionTargets.$inferInsert;
export type AiConversation = typeof aiConversations.$inferSelect;
export type AiMessage = typeof aiMessages.$inferSelect;
export type AiGeneratedPlan = typeof aiGeneratedPlans.$inferSelect;
