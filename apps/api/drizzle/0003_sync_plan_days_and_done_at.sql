-- Two gaps that would have stopped the sync engine dead. Found by diffing the live Postgres
-- schema against the app's SQLite schema, column by column, before writing any sync code.
--
--   1. `sets.done_at` exists locally (schema v8 — the per-set tick that drives the progress rail
--      and starts the rest timer) and nowhere on the server. Syncing without it would quietly
--      drop which sets were actually performed, which is the single most important bit on the row.
--
--   2. `plan_days` requires `plan_variant_id`, and its RLS policy proves ownership by joining
--      through `plan_variants`. The app has no variants: it models plans as
--      `plans -> plan_days -> plan_day_exercises`, full stop. A client insert would therefore
--      fail twice over — NOT NULL on a column it cannot fill, and then a WITH CHECK it cannot
--      satisfy. Every plan the user builds would stay trapped on the phone.
--
-- The fix for (2) teaches the server the app's shape rather than teaching the app the server's.
-- `plan_variants` is server-side ambition (per-location variants of one plan) that the app never
-- adopted; making the client fabricate variant rows to satisfy a level of the hierarchy it does
-- not have would be inventing data to satisfy a schema. So `plan_id` becomes a first-class second
-- parent, and ownership can be proven down either path.
--
-- Safe to run more than once: every statement is guarded.

------------------------------------------------------------------------------- sets.done_at
ALTER TABLE "sets" ADD COLUMN IF NOT EXISTS "done_at" timestamptz;

--------------------------------------------------------------- plan_days: a direct plan parent
ALTER TABLE "plan_days" ADD COLUMN IF NOT EXISTS "plan_id" uuid;

DO $$ BEGIN
  ALTER TABLE "plan_days" ADD CONSTRAINT "plan_days_plan_id_plans_id_fk"
    FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Rows that came from the variant-shaped world keep their variant; rows from the app carry a
-- plan instead. Neither column can be required on its own any more.
ALTER TABLE "plan_days" ALTER COLUMN "plan_variant_id" DROP NOT NULL;

DO $$ BEGIN
  ALTER TABLE "plan_days" ADD CONSTRAINT "plan_days_parent_check"
    CHECK ("plan_id" IS NOT NULL OR "plan_variant_id" IS NOT NULL);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS "plan_days_plan_idx" ON "plan_days" ("plan_id");

-- Deliberately no UNIQUE on (plan_id, day_index), even though the app enforces exactly that
-- locally. A reorder is two writes, and between them two days genuinely do share an index; the
-- client resolves this with a parking offset it can only apply to its own database. A server-side
-- constraint would reject the intermediate state and fail the sync mid-reorder.

---------------------------------------------------------------------- ownership down either path
-- Rewritten, not added to: a second permissive policy on the same table ORs with the first, which
-- would be the same result by a much less obvious route. One policy that states the whole rule is
-- what someone reading this table's security later needs to see.
DROP POLICY IF EXISTS "plan_days_own" ON "plan_days";
CREATE POLICY "plan_days_own" ON "plan_days"
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM "plans" p
      WHERE p."id" = "plan_days"."plan_id" AND p."user_id" = (select auth.uid())
    )
    OR EXISTS (
      SELECT 1 FROM "plan_variants" pv
      JOIN "plans" p ON p."id" = pv."plan_id"
      WHERE pv."id" = "plan_days"."plan_variant_id" AND p."user_id" = (select auth.uid())
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM "plans" p
      WHERE p."id" = "plan_days"."plan_id" AND p."user_id" = (select auth.uid())
    )
    OR EXISTS (
      SELECT 1 FROM "plan_variants" pv
      JOIN "plans" p ON p."id" = pv."plan_id"
      WHERE pv."id" = "plan_days"."plan_variant_id" AND p."user_id" = (select auth.uid())
    )
  );

-- The ownership join is spelled out in full rather than delegated to "is this day visible to me",
-- which would have read better and been half the length. Whether a policy's own subquery is
-- itself filtered by the subquery table's RLS is a subtlety of Postgres semantics, and if it does
-- not hold here the shorter version grants every authenticated user access to every other user's
-- plan exercises. A row-security rule is the wrong place to depend on a fine point being true:
-- this version is correct either way.
DROP POLICY IF EXISTS "plan_day_exercises_own" ON "plan_day_exercises";
CREATE POLICY "plan_day_exercises_own" ON "plan_day_exercises"
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM "plan_days" pd
      JOIN "plans" p ON p."id" = pd."plan_id"
      WHERE pd."id" = "plan_day_exercises"."plan_day_id" AND p."user_id" = (select auth.uid())
    )
    OR EXISTS (
      SELECT 1 FROM "plan_days" pd
      JOIN "plan_variants" pv ON pv."id" = pd."plan_variant_id"
      JOIN "plans" p ON p."id" = pv."plan_id"
      WHERE pd."id" = "plan_day_exercises"."plan_day_id" AND p."user_id" = (select auth.uid())
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM "plan_days" pd
      JOIN "plans" p ON p."id" = pd."plan_id"
      WHERE pd."id" = "plan_day_exercises"."plan_day_id" AND p."user_id" = (select auth.uid())
    )
    OR EXISTS (
      SELECT 1 FROM "plan_days" pd
      JOIN "plan_variants" pv ON pv."id" = pd."plan_variant_id"
      JOIN "plans" p ON p."id" = pv."plan_id"
      WHERE pd."id" = "plan_day_exercises"."plan_day_id" AND p."user_id" = (select auth.uid())
    )
  );
