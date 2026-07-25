-- Platform objects that Drizzle's schema DSL cannot express.
--
-- Kept as a hand-written migration rather than generated, because it touches Supabase-owned
-- objects (auth.users) and Postgres features with no Drizzle equivalent (EXCLUDE constraints,
-- RLS policies, views, triggers, deferrable constraints).
--
-- Run AFTER 0000_init.sql.

/* ========================================================================== */
/* 1. Link profiles to Supabase Auth                                          */
/* ========================================================================== */

-- profiles.id mirrors auth.users.id. Declared here rather than in schema.ts so drizzle-kit
-- never tries to create or drop Supabase's auth schema.
ALTER TABLE "profiles"
  ADD CONSTRAINT "profiles_id_auth_users_fk"
  FOREIGN KEY ("id") REFERENCES auth.users ("id") ON DELETE CASCADE;
--> statement-breakpoint


-- Create a profile row automatically whenever a user signs up. Without this, every client
-- would have to remember to insert one, and a failure would leave an account with no profile.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, display_name)
  VALUES (NEW.id, NEW.raw_user_meta_data->>'display_name')
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;
--> statement-breakpoint


CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
--> statement-breakpoint


-- Keep profiles.updated_at honest.
CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;
--> statement-breakpoint


CREATE TRIGGER profiles_touch_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
--> statement-breakpoint


/* ========================================================================== */
/* 2. Non-overlapping nutrition target periods                                */
/* ========================================================================== */

CREATE EXTENSION IF NOT EXISTS btree_gist;
--> statement-breakpoint


-- Makes it structurally impossible for one user to have two target periods covering the same
-- date. Application logic could enforce this, but a retrying offline client or a bug in the
-- weekly cron would eventually violate it — so the database enforces it instead.
ALTER TABLE "nutrition_targets"
  ADD CONSTRAINT "nutrition_targets_no_overlap"
  EXCLUDE USING gist (
    "user_id" WITH =,
    daterange("effective_from", COALESCE("effective_to", 'infinity'::date), '[]') WITH &&
  );
--> statement-breakpoint


/* ========================================================================== */
/* 3. Contiguous set numbering                                                */
/* ========================================================================== */

-- Renumbering after a delete (3->2, 4->3) transiently collides with the unique constraint
-- inside a single UPDATE statement, so the constraint must be deferrable.
ALTER TABLE "sets" DROP CONSTRAINT "sets_exercise_index_unique";
--> statement-breakpoint

ALTER TABLE "sets"
  ADD CONSTRAINT "sets_exercise_index_unique"
  UNIQUE ("session_exercise_id", "set_index") DEFERRABLE INITIALLY IMMEDIATE;
--> statement-breakpoint


-- Close gaps in set_index automatically after a delete.
--
-- Enforced by trigger rather than left to the client on purpose: the app is offline-first, so
-- deletes can arrive out of order from a sync queue. Making the invariant the database's
-- responsibility means no client can leave set numbering with holes in it.
CREATE OR REPLACE FUNCTION public.renumber_sets()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  SET CONSTRAINTS "sets_exercise_index_unique" DEFERRED;

  UPDATE public.sets s
  SET set_index = ordered.new_index
  FROM (
    SELECT id, ROW_NUMBER() OVER (ORDER BY set_index) AS new_index
    FROM public.sets
    WHERE session_exercise_id = OLD.session_exercise_id
  ) AS ordered
  WHERE s.id = ordered.id
    AND s.set_index <> ordered.new_index;

  RETURN NULL;
END;
$$;
--> statement-breakpoint


CREATE TRIGGER sets_renumber_after_delete
  AFTER DELETE ON public.sets
  FOR EACH ROW EXECUTE FUNCTION public.renumber_sets();
--> statement-breakpoint


/* ========================================================================== */
/* 4. Progression analysis view                                               */
/* ========================================================================== */

-- Per-set strength metrics, computed in Postgres.
--
-- This exists so the AI coach is handed a small digest built from exact arithmetic, rather
-- than hundreds of raw set rows to do multi-step maths over (which LLMs do unreliably and
-- expensively). Warmups and unreliable high-rep sets are excluded here, at the source.
CREATE VIEW public.exercise_set_metrics AS
SELECT
  s.id                AS set_id,
  se.session_id,
  se.exercise_id,
  ws.user_id,
  ws.location_id,
  ws.started_at,
  s.weight_kg,
  s.reps,
  s.rpe,
  -- Epley, with the reps = 1 special case: a single IS a 1RM, so the formula's
  -- weight x 1.033 would be wrong by definition.
  CASE
    WHEN s.reps = 1 THEN s.weight_kg
    ELSE s.weight_kg * (1 + s.reps::numeric / 30)
  END                 AS e1rm_kg,
  s.weight_kg * s.reps AS volume_load
FROM public.sets s
JOIN public.session_exercises se ON se.id = s.session_exercise_id
JOIN public.workout_sessions ws  ON ws.id = se.session_id
WHERE s.is_warmup = false
  AND s.weight_kg IS NOT NULL
  AND s.reps IS NOT NULL
  AND s.reps BETWEEN 1 AND 12;
--> statement-breakpoint
  -- Epley degrades above ~12 reps

-- One row per (exercise, session): the best estimated 1RM and total volume achieved.
-- This is the shape the AI digest is built from.
CREATE VIEW public.exercise_session_bests AS
SELECT
  user_id,
  exercise_id,
  session_id,
  MIN(started_at)     AS started_at,
  MAX(e1rm_kg)        AS best_e1rm_kg,
  SUM(volume_load)    AS total_volume_load,
  COUNT(*)            AS working_sets
FROM public.exercise_set_metrics
GROUP BY user_id, exercise_id, session_id;
--> statement-breakpoint


-- Views run with the privileges of the querying user, so RLS on the underlying tables
-- applies. security_invoker makes that explicit rather than relying on the default.
ALTER VIEW public.exercise_set_metrics SET (security_invoker = true);
--> statement-breakpoint

ALTER VIEW public.exercise_session_bests SET (security_invoker = true);
--> statement-breakpoint


/* ========================================================================== */
/* 5. Row Level Security                                                      */
/* ========================================================================== */

-- Every user-owned table gets RLS. Tables without a direct user_id column reach the owner
-- through their parent, because enabling RLS on a parent while leaving a child open is the
-- classic way this goes wrong: `sets` holds the actual training data, and without its own
-- policy it would be world-readable to any authenticated user.
--
-- `(select auth.uid())` rather than a bare `auth.uid()` is deliberate: the subquery form is
-- evaluated once per statement instead of once per row.

ALTER TABLE "profiles"            ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

ALTER TABLE "locations"           ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

ALTER TABLE "equipment"           ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

ALTER TABLE "location_equipment"  ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

ALTER TABLE "exercises"           ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

ALTER TABLE "plans"               ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

ALTER TABLE "plan_variants"       ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

ALTER TABLE "plan_days"           ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

ALTER TABLE "plan_day_exercises"  ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

ALTER TABLE "workout_sessions"    ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

ALTER TABLE "session_exercises"   ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

ALTER TABLE "sets"                ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

ALTER TABLE "body_metrics"        ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

ALTER TABLE "nutrition_targets"   ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

ALTER TABLE "ai_conversations"    ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

ALTER TABLE "ai_messages"         ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

ALTER TABLE "ai_generated_plans"  ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint


-- ---- Directly owned -------------------------------------------------------

CREATE POLICY "profiles_own" ON "profiles"
  FOR ALL TO authenticated
  USING ((select auth.uid()) = "id")
  WITH CHECK ((select auth.uid()) = "id");
--> statement-breakpoint


CREATE POLICY "locations_own" ON "locations"
  FOR ALL TO authenticated
  USING ((select auth.uid()) = "user_id")
  WITH CHECK ((select auth.uid()) = "user_id");
--> statement-breakpoint


CREATE POLICY "plans_own" ON "plans"
  FOR ALL TO authenticated
  USING ((select auth.uid()) = "user_id")
  WITH CHECK ((select auth.uid()) = "user_id");
--> statement-breakpoint


CREATE POLICY "workout_sessions_own" ON "workout_sessions"
  FOR ALL TO authenticated
  USING ((select auth.uid()) = "user_id")
  WITH CHECK ((select auth.uid()) = "user_id");
--> statement-breakpoint


CREATE POLICY "body_metrics_own" ON "body_metrics"
  FOR ALL TO authenticated
  USING ((select auth.uid()) = "user_id")
  WITH CHECK ((select auth.uid()) = "user_id");
--> statement-breakpoint


CREATE POLICY "nutrition_targets_own" ON "nutrition_targets"
  FOR ALL TO authenticated
  USING ((select auth.uid()) = "user_id")
  WITH CHECK ((select auth.uid()) = "user_id");
--> statement-breakpoint


CREATE POLICY "ai_conversations_own" ON "ai_conversations"
  FOR ALL TO authenticated
  USING ((select auth.uid()) = "user_id")
  WITH CHECK ((select auth.uid()) = "user_id");
--> statement-breakpoint


CREATE POLICY "ai_generated_plans_own" ON "ai_generated_plans"
  FOR ALL TO authenticated
  USING ((select auth.uid()) = "user_id")
  WITH CHECK ((select auth.uid()) = "user_id");
--> statement-breakpoint


-- ---- Global catalogue: readable by all, writable by nobody via the API ----

CREATE POLICY "equipment_read" ON "equipment"
  FOR SELECT TO authenticated
  USING (true);
--> statement-breakpoint


-- Global exercises (user_id IS NULL) are readable by everyone; custom ones only by their
-- owner. Split into separate read/write policies so a user cannot edit a seeded exercise.
CREATE POLICY "exercises_read" ON "exercises"
  FOR SELECT TO authenticated
  USING ("user_id" IS NULL OR (select auth.uid()) = "user_id");
--> statement-breakpoint


CREATE POLICY "exercises_insert_own" ON "exercises"
  FOR INSERT TO authenticated
  WITH CHECK ((select auth.uid()) = "user_id");
--> statement-breakpoint


CREATE POLICY "exercises_update_own" ON "exercises"
  FOR UPDATE TO authenticated
  USING ((select auth.uid()) = "user_id")
  WITH CHECK ((select auth.uid()) = "user_id");
--> statement-breakpoint


CREATE POLICY "exercises_delete_own" ON "exercises"
  FOR DELETE TO authenticated
  USING ((select auth.uid()) = "user_id");
--> statement-breakpoint


-- ---- Owned through a parent ----------------------------------------------

CREATE POLICY "location_equipment_own" ON "location_equipment"
  FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM "locations" l
    WHERE l."id" = "location_equipment"."location_id"
      AND l."user_id" = (select auth.uid())
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM "locations" l
    WHERE l."id" = "location_equipment"."location_id"
      AND l."user_id" = (select auth.uid())
  ));
--> statement-breakpoint


CREATE POLICY "plan_variants_own" ON "plan_variants"
  FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM "plans" p
    WHERE p."id" = "plan_variants"."plan_id" AND p."user_id" = (select auth.uid())
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM "plans" p
    WHERE p."id" = "plan_variants"."plan_id" AND p."user_id" = (select auth.uid())
  ));
--> statement-breakpoint


CREATE POLICY "plan_days_own" ON "plan_days"
  FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM "plan_variants" pv
    JOIN "plans" p ON p."id" = pv."plan_id"
    WHERE pv."id" = "plan_days"."plan_variant_id" AND p."user_id" = (select auth.uid())
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM "plan_variants" pv
    JOIN "plans" p ON p."id" = pv."plan_id"
    WHERE pv."id" = "plan_days"."plan_variant_id" AND p."user_id" = (select auth.uid())
  ));
--> statement-breakpoint


CREATE POLICY "plan_day_exercises_own" ON "plan_day_exercises"
  FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM "plan_days" pd
    JOIN "plan_variants" pv ON pv."id" = pd."plan_variant_id"
    JOIN "plans" p ON p."id" = pv."plan_id"
    WHERE pd."id" = "plan_day_exercises"."plan_day_id" AND p."user_id" = (select auth.uid())
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM "plan_days" pd
    JOIN "plan_variants" pv ON pv."id" = pd."plan_variant_id"
    JOIN "plans" p ON p."id" = pv."plan_id"
    WHERE pd."id" = "plan_day_exercises"."plan_day_id" AND p."user_id" = (select auth.uid())
  ));
--> statement-breakpoint


CREATE POLICY "session_exercises_own" ON "session_exercises"
  FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM "workout_sessions" ws
    WHERE ws."id" = "session_exercises"."session_id" AND ws."user_id" = (select auth.uid())
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM "workout_sessions" ws
    WHERE ws."id" = "session_exercises"."session_id" AND ws."user_id" = (select auth.uid())
  ));
--> statement-breakpoint


-- The most important policy in the schema: `sets` is where the actual training data lives.
CREATE POLICY "sets_own" ON "sets"
  FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM "session_exercises" se
    JOIN "workout_sessions" ws ON ws."id" = se."session_id"
    WHERE se."id" = "sets"."session_exercise_id" AND ws."user_id" = (select auth.uid())
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM "session_exercises" se
    JOIN "workout_sessions" ws ON ws."id" = se."session_id"
    WHERE se."id" = "sets"."session_exercise_id" AND ws."user_id" = (select auth.uid())
  ));
--> statement-breakpoint


CREATE POLICY "ai_messages_own" ON "ai_messages"
  FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM "ai_conversations" c
    WHERE c."id" = "ai_messages"."conversation_id" AND c."user_id" = (select auth.uid())
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM "ai_conversations" c
    WHERE c."id" = "ai_messages"."conversation_id" AND c."user_id" = (select auth.uid())
  ));
--> statement-breakpoint


/* ========================================================================== */
/* 6. Indexes supporting the RLS subqueries                                   */
/* ========================================================================== */

-- The EXISTS lookups above walk child -> parent on every row access, so the FK columns they
-- traverse need indexes or RLS turns every read into a sequential scan.
CREATE INDEX IF NOT EXISTS "plan_variants_plan_idx"      ON "plan_variants" ("plan_id");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "plan_days_variant_idx"       ON "plan_days" ("plan_variant_id");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "plan_day_exercises_day_idx"  ON "plan_day_exercises" ("plan_day_id");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "session_exercises_session_idx" ON "session_exercises" ("session_id");
