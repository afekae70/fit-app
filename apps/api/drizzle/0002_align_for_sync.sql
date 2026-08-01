-- Align Postgres with the shape the mobile app actually uses, so rows can sync both ways.
--
-- The server schema was written before the app settled, and the two drifted. Three gaps had to
-- close before any sync engine could work:
--
--   1. No `updated_at` / `deleted_at` anywhere. Without the first there is no basis for deciding
--      which of two edits wins; without the second a deletion is invisible to the next pull and
--      the row simply comes back from the server.
--   2. `workout_sessions` had no `name`. That column is what turns a finished session into a
--      reusable template in the app, so syncing without it would silently drop it.
--   3. `session_exercises` / `plan_day_exercises` required `exercise_id uuid`, but the app
--      references exercises by their catalogue name, which ships in the bundle and has no server
--      uuid. Rather than force a lookup table into the client, the key travels as text and the
--      uuid becomes optional.
--
-- Safe to run more than once: every statement is guarded.

--------------------------------------------------------------------------- sync bookkeeping
ALTER TABLE "workout_sessions"   ADD COLUMN IF NOT EXISTS "updated_at" timestamptz NOT NULL DEFAULT now();
ALTER TABLE "workout_sessions"   ADD COLUMN IF NOT EXISTS "deleted_at" timestamptz;
ALTER TABLE "session_exercises"  ADD COLUMN IF NOT EXISTS "updated_at" timestamptz NOT NULL DEFAULT now();
ALTER TABLE "session_exercises"  ADD COLUMN IF NOT EXISTS "deleted_at" timestamptz;
ALTER TABLE "sets"               ADD COLUMN IF NOT EXISTS "updated_at" timestamptz NOT NULL DEFAULT now();
ALTER TABLE "sets"               ADD COLUMN IF NOT EXISTS "deleted_at" timestamptz;
ALTER TABLE "body_metrics"       ADD COLUMN IF NOT EXISTS "updated_at" timestamptz NOT NULL DEFAULT now();
ALTER TABLE "body_metrics"       ADD COLUMN IF NOT EXISTS "deleted_at" timestamptz;
ALTER TABLE "plans"              ADD COLUMN IF NOT EXISTS "updated_at" timestamptz NOT NULL DEFAULT now();
ALTER TABLE "plans"              ADD COLUMN IF NOT EXISTS "deleted_at" timestamptz;
ALTER TABLE "plan_days"          ADD COLUMN IF NOT EXISTS "updated_at" timestamptz NOT NULL DEFAULT now();
ALTER TABLE "plan_days"          ADD COLUMN IF NOT EXISTS "deleted_at" timestamptz;
ALTER TABLE "plan_day_exercises" ADD COLUMN IF NOT EXISTS "updated_at" timestamptz NOT NULL DEFAULT now();
ALTER TABLE "plan_day_exercises" ADD COLUMN IF NOT EXISTS "deleted_at" timestamptz;

-- A pull asks "what changed since my cursor", so updated_at is the access path, per user where
-- the table is user-scoped and on its own where ownership flows through a parent row.
CREATE INDEX IF NOT EXISTS "workout_sessions_sync_idx"   ON "workout_sessions"   ("user_id", "updated_at");
CREATE INDEX IF NOT EXISTS "body_metrics_sync_idx"       ON "body_metrics"       ("user_id", "updated_at");
CREATE INDEX IF NOT EXISTS "plans_sync_idx"              ON "plans"              ("user_id", "updated_at");
CREATE INDEX IF NOT EXISTS "session_exercises_sync_idx"  ON "session_exercises"  ("updated_at");
CREATE INDEX IF NOT EXISTS "sets_sync_idx"               ON "sets"               ("updated_at");
CREATE INDEX IF NOT EXISTS "plan_days_sync_idx"          ON "plan_days"          ("updated_at");
CREATE INDEX IF NOT EXISTS "plan_day_exercises_sync_idx" ON "plan_day_exercises" ("updated_at");

------------------------------------------------------------------------------ session naming
-- Doubles as the template name: naming a workout is what makes it repeatable in the app.
ALTER TABLE "workout_sessions" ADD COLUMN IF NOT EXISTS "name" text;

----------------------------------------------------------------- catalogue key instead of uuid
-- The catalogue ships inside the app bundle and is keyed by the exercise's English name, which
-- is stable. `exercise_id` stays for rows that came from a server-side catalogue, but it can no
-- longer be required, or nothing the client writes would be accepted.
ALTER TABLE "session_exercises"  ADD COLUMN IF NOT EXISTS "exercise_key" text;
ALTER TABLE "plan_day_exercises" ADD COLUMN IF NOT EXISTS "exercise_key" text;

ALTER TABLE "session_exercises"  ALTER COLUMN "exercise_id" DROP NOT NULL;
ALTER TABLE "plan_day_exercises" ALTER COLUMN "exercise_id" DROP NOT NULL;

-- One of the two identifiers must be present, so a row can never be orphaned from any exercise.
DO $$ BEGIN
  ALTER TABLE "session_exercises" ADD CONSTRAINT "session_exercises_exercise_ref_check"
    CHECK ("exercise_id" IS NOT NULL OR "exercise_key" IS NOT NULL);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "plan_day_exercises" ADD CONSTRAINT "plan_day_exercises_exercise_ref_check"
    CHECK ("exercise_id" IS NOT NULL OR "exercise_key" IS NOT NULL);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-------------------------------------------------------------------------- keep updated_at honest
-- Stamped by a trigger rather than trusted from the client. A device with a wrong clock could
-- otherwise write a timestamp far in the future and permanently win every conflict.
CREATE OR REPLACE FUNCTION "set_updated_at"() RETURNS trigger AS $$
BEGIN
  NEW."updated_at" = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'workout_sessions','session_exercises','sets',
    'body_metrics','plans','plan_days','plan_day_exercises'
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I', t || '_set_updated_at', t);
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE INSERT OR UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION set_updated_at()',
      t || '_set_updated_at', t
    );
  END LOOP;
END $$;
