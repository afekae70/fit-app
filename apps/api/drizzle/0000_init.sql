CREATE TABLE "ai_conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"title" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_generated_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"payload" jsonb NOT NULL,
	"plan_id" uuid,
	"model" text,
	"provider" text,
	"accepted" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_generated_plans_kind_check" CHECK ("ai_generated_plans"."kind" in ('workout', 'nutrition'))
);
--> statement-breakpoint
CREATE TABLE "ai_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"role" text NOT NULL,
	"content" jsonb NOT NULL,
	"model" text,
	"provider" text,
	"input_tokens" integer,
	"output_tokens" integer,
	"cache_read_tokens" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_messages_role_check" CHECK ("ai_messages"."role" in ('user', 'assistant'))
);
--> statement-breakpoint
CREATE TABLE "body_metrics" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"measured_at" timestamp with time zone NOT NULL,
	"weight_kg" numeric(5, 2),
	"body_fat_pct" numeric(4, 1),
	"muscle_mass_kg" numeric(5, 2),
	"water_pct" numeric(4, 1),
	"bone_mass_kg" numeric(4, 2),
	"visceral_fat" numeric(4, 1),
	"source" text NOT NULL,
	"device_id" text,
	"raw_payload" jsonb,
	CONSTRAINT "body_metrics_user_measured_source_unique" UNIQUE("user_id","measured_at","source"),
	CONSTRAINT "body_metrics_source_check" CHECK ("body_metrics"."source" in ('ble_scale', 'manual', 'ai_assistant', 'health_platform')),
	CONSTRAINT "body_metrics_weight_check" CHECK ("body_metrics"."weight_kg" is null or ("body_metrics"."weight_kg" > 0 and "body_metrics"."weight_kg" < 500)),
	CONSTRAINT "body_metrics_body_fat_check" CHECK ("body_metrics"."body_fat_pct" is null or ("body_metrics"."body_fat_pct" >= 0 and "body_metrics"."body_fat_pct" < 100))
);
--> statement-breakpoint
CREATE TABLE "equipment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name_en" text NOT NULL,
	"name_he" text NOT NULL,
	CONSTRAINT "equipment_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "exercises" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"name_en" text NOT NULL,
	"name_he" text,
	"primary_muscle" text NOT NULL,
	"secondary_muscles" text[] DEFAULT '{}'::text[] NOT NULL,
	"movement_pattern" text,
	"equipment_id" uuid,
	"is_unilateral" boolean DEFAULT false NOT NULL,
	"load_type" text DEFAULT 'weight_reps' NOT NULL,
	CONSTRAINT "exercises_user_name_unique" UNIQUE NULLS NOT DISTINCT("user_id","name_en"),
	CONSTRAINT "exercises_load_type_check" CHECK ("exercises"."load_type" in ('weight_reps', 'bodyweight', 'bodyweight_plus', 'time', 'distance'))
);
--> statement-breakpoint
CREATE TABLE "location_equipment" (
	"location_id" uuid NOT NULL,
	"equipment_id" uuid NOT NULL,
	CONSTRAINT "location_equipment_location_id_equipment_id_pk" PRIMARY KEY("location_id","equipment_id")
);
--> statement-breakpoint
CREATE TABLE "locations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"kind" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "locations_kind_check" CHECK ("locations"."kind" is null or "locations"."kind" in ('commercial_gym', 'home', 'military_base', 'outdoor', 'other'))
);
--> statement-breakpoint
CREATE TABLE "nutrition_targets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"effective_from" date NOT NULL,
	"effective_to" date,
	"weight_kg_snapshot" numeric(5, 2) NOT NULL,
	"bmi" numeric(4, 1),
	"bmr_kcal" integer,
	"tdee_kcal" integer,
	"goal" text NOT NULL,
	"calorie_target" integer,
	"protein_g" integer,
	"carbs_g" integer,
	"fat_g" integer,
	"formula" text DEFAULT 'mifflin_st_jeor' NOT NULL,
	"computed_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "nutrition_targets_goal_check" CHECK ("nutrition_targets"."goal" in ('cut', 'maintain', 'bulk')),
	CONSTRAINT "nutrition_targets_computed_by_check" CHECK ("nutrition_targets"."computed_by" in ('system_weekly', 'ai', 'manual')),
	CONSTRAINT "nutrition_targets_date_order_check" CHECK ("nutrition_targets"."effective_to" is null or "nutrition_targets"."effective_to" >= "nutrition_targets"."effective_from")
);
--> statement-breakpoint
CREATE TABLE "plan_day_exercises" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plan_day_id" uuid NOT NULL,
	"exercise_id" uuid NOT NULL,
	"order_index" integer NOT NULL,
	"target_sets" integer,
	"target_reps_min" integer,
	"target_reps_max" integer,
	"target_rpe" numeric(3, 1),
	"target_load_kg" numeric(6, 2),
	"target_pct_1rm" numeric(4, 1),
	"rest_seconds" integer,
	"superset_group" text,
	"notes" text,
	CONSTRAINT "plan_day_exercises_day_order_unique" UNIQUE("plan_day_id","order_index"),
	CONSTRAINT "plan_day_exercises_rep_range_check" CHECK ("plan_day_exercises"."target_reps_min" is null or "plan_day_exercises"."target_reps_max" is null or "plan_day_exercises"."target_reps_min" <= "plan_day_exercises"."target_reps_max"),
	CONSTRAINT "plan_day_exercises_rpe_check" CHECK ("plan_day_exercises"."target_rpe" is null or ("plan_day_exercises"."target_rpe" >= 1 and "plan_day_exercises"."target_rpe" <= 10))
);
--> statement-breakpoint
CREATE TABLE "plan_days" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plan_variant_id" uuid NOT NULL,
	"day_index" integer NOT NULL,
	"name" text,
	CONSTRAINT "plan_days_variant_index_unique" UNIQUE("plan_variant_id","day_index")
);
--> statement-breakpoint
CREATE TABLE "plan_variants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plan_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"label" text NOT NULL,
	CONSTRAINT "plan_variants_plan_location_unique" UNIQUE("plan_id","location_id")
);
--> statement-breakpoint
CREATE TABLE "plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"goal" text,
	"days_per_week" integer,
	"length_weeks" integer,
	"is_active" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "plans_goal_check" CHECK ("plans"."goal" is null or "plans"."goal" in ('cut', 'maintain', 'bulk')),
	CONSTRAINT "plans_days_per_week_check" CHECK ("plans"."days_per_week" is null or ("plans"."days_per_week" between 1 and 14))
);
--> statement-breakpoint
CREATE TABLE "profiles" (
	"id" uuid PRIMARY KEY NOT NULL,
	"display_name" text,
	"birth_date" date,
	"sex" text,
	"bmr_formula_sex" text,
	"height_cm" numeric(5, 2),
	"activity_level" text,
	"goal" text,
	"unit_preference" text DEFAULT 'metric' NOT NULL,
	"locale" text DEFAULT 'he' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "profiles_sex_check" CHECK ("profiles"."sex" is null or "profiles"."sex" in ('male', 'female', 'other')),
	CONSTRAINT "profiles_bmr_formula_sex_check" CHECK ("profiles"."bmr_formula_sex" is null or "profiles"."bmr_formula_sex" in ('male', 'female')),
	CONSTRAINT "profiles_activity_level_check" CHECK ("profiles"."activity_level" is null or "profiles"."activity_level" in ('sedentary', 'light', 'moderate', 'active', 'very_active')),
	CONSTRAINT "profiles_goal_check" CHECK ("profiles"."goal" is null or "profiles"."goal" in ('cut', 'maintain', 'bulk')),
	CONSTRAINT "profiles_unit_preference_check" CHECK ("profiles"."unit_preference" in ('metric', 'imperial')),
	CONSTRAINT "profiles_height_range_check" CHECK ("profiles"."height_cm" is null or ("profiles"."height_cm" > 50 and "profiles"."height_cm" < 260))
);
--> statement-breakpoint
CREATE TABLE "session_exercises" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"exercise_id" uuid NOT NULL,
	"order_index" integer NOT NULL,
	"plan_day_exercise_id" uuid,
	"notes" text,
	CONSTRAINT "session_exercises_session_order_unique" UNIQUE("session_id","order_index")
);
--> statement-breakpoint
CREATE TABLE "sets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_exercise_id" uuid NOT NULL,
	"set_index" integer NOT NULL,
	"weight_kg" numeric(6, 2),
	"reps" integer,
	"duration_seconds" integer,
	"distance_m" numeric(8, 2),
	"rpe" numeric(3, 1),
	"is_warmup" boolean DEFAULT false NOT NULL,
	"to_failure" boolean DEFAULT false NOT NULL,
	"completed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sets_exercise_index_unique" UNIQUE("session_exercise_id","set_index"),
	CONSTRAINT "sets_set_index_positive_check" CHECK ("sets"."set_index" >= 1),
	CONSTRAINT "sets_reps_check" CHECK ("sets"."reps" is null or "sets"."reps" >= 0),
	CONSTRAINT "sets_weight_check" CHECK ("sets"."weight_kg" is null or "sets"."weight_kg" >= 0),
	CONSTRAINT "sets_rpe_check" CHECK ("sets"."rpe" is null or ("sets"."rpe" >= 1 and "sets"."rpe" <= 10)),
	CONSTRAINT "sets_has_measurement_check" CHECK ("sets"."reps" is not null or "sets"."duration_seconds" is not null or "sets"."distance_m" is not null)
);
--> statement-breakpoint
CREATE TABLE "workout_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"location_id" uuid,
	"plan_day_id" uuid,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	"bodyweight_kg" numeric(5, 2),
	"session_rpe" numeric(3, 1),
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workout_sessions_rpe_check" CHECK ("workout_sessions"."session_rpe" is null or ("workout_sessions"."session_rpe" >= 1 and "workout_sessions"."session_rpe" <= 10)),
	CONSTRAINT "workout_sessions_time_order_check" CHECK ("workout_sessions"."ended_at" is null or "workout_sessions"."ended_at" >= "workout_sessions"."started_at")
);
--> statement-breakpoint
ALTER TABLE "ai_conversations" ADD CONSTRAINT "ai_conversations_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_generated_plans" ADD CONSTRAINT "ai_generated_plans_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_generated_plans" ADD CONSTRAINT "ai_generated_plans_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_messages" ADD CONSTRAINT "ai_messages_conversation_id_ai_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."ai_conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "body_metrics" ADD CONSTRAINT "body_metrics_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exercises" ADD CONSTRAINT "exercises_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exercises" ADD CONSTRAINT "exercises_equipment_id_equipment_id_fk" FOREIGN KEY ("equipment_id") REFERENCES "public"."equipment"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "location_equipment" ADD CONSTRAINT "location_equipment_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "location_equipment" ADD CONSTRAINT "location_equipment_equipment_id_equipment_id_fk" FOREIGN KEY ("equipment_id") REFERENCES "public"."equipment"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "locations" ADD CONSTRAINT "locations_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nutrition_targets" ADD CONSTRAINT "nutrition_targets_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_day_exercises" ADD CONSTRAINT "plan_day_exercises_plan_day_id_plan_days_id_fk" FOREIGN KEY ("plan_day_id") REFERENCES "public"."plan_days"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_day_exercises" ADD CONSTRAINT "plan_day_exercises_exercise_id_exercises_id_fk" FOREIGN KEY ("exercise_id") REFERENCES "public"."exercises"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_days" ADD CONSTRAINT "plan_days_plan_variant_id_plan_variants_id_fk" FOREIGN KEY ("plan_variant_id") REFERENCES "public"."plan_variants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_variants" ADD CONSTRAINT "plan_variants_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_variants" ADD CONSTRAINT "plan_variants_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plans" ADD CONSTRAINT "plans_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_exercises" ADD CONSTRAINT "session_exercises_session_id_workout_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."workout_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_exercises" ADD CONSTRAINT "session_exercises_exercise_id_exercises_id_fk" FOREIGN KEY ("exercise_id") REFERENCES "public"."exercises"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_exercises" ADD CONSTRAINT "session_exercises_plan_day_exercise_id_plan_day_exercises_id_fk" FOREIGN KEY ("plan_day_exercise_id") REFERENCES "public"."plan_day_exercises"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sets" ADD CONSTRAINT "sets_session_exercise_id_session_exercises_id_fk" FOREIGN KEY ("session_exercise_id") REFERENCES "public"."session_exercises"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workout_sessions" ADD CONSTRAINT "workout_sessions_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workout_sessions" ADD CONSTRAINT "workout_sessions_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workout_sessions" ADD CONSTRAINT "workout_sessions_plan_day_id_plan_days_id_fk" FOREIGN KEY ("plan_day_id") REFERENCES "public"."plan_days"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_conversations_user_idx" ON "ai_conversations" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "ai_generated_plans_user_idx" ON "ai_generated_plans" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "ai_messages_conversation_idx" ON "ai_messages" USING btree ("conversation_id","created_at");--> statement-breakpoint
CREATE INDEX "body_metrics_user_measured_idx" ON "body_metrics" USING btree ("user_id","measured_at");--> statement-breakpoint
CREATE INDEX "exercises_primary_muscle_idx" ON "exercises" USING btree ("primary_muscle");--> statement-breakpoint
CREATE INDEX "exercises_equipment_idx" ON "exercises" USING btree ("equipment_id");--> statement-breakpoint
CREATE INDEX "locations_user_idx" ON "locations" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "nutrition_targets_user_from_idx" ON "nutrition_targets" USING btree ("user_id","effective_from");--> statement-breakpoint
CREATE INDEX "plans_user_idx" ON "plans" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "session_exercises_exercise_idx" ON "session_exercises" USING btree ("exercise_id");--> statement-breakpoint
CREATE INDEX "sets_session_exercise_idx" ON "sets" USING btree ("session_exercise_id");--> statement-breakpoint
CREATE INDEX "workout_sessions_user_started_idx" ON "workout_sessions" USING btree ("user_id","started_at");