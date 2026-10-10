-- A food log.
--
-- The app has always worked out how much someone should eat and had nowhere to write down
-- what they did eat. This is the server's copy of that log: one row per thing eaten, on a
-- calendar day, holding its own calories and — where known — protein, carbohydrate and fat.
--
-- The phone keeps the log in its own database and syncs it here exactly as it does the
-- training log: rows are upserted by id, a deletion is a row marked deleted rather than a row
-- removed, and `updated_at` is stamped by the server so that a phone with a wrong clock cannot
-- win every conflict.
--
-- WHO CAN SEE IT
--
-- Its owner, and nobody else. The policy below ties every row to the account that wrote it.
-- A coach cannot: no coach function reads this table, and the app tells trainees what a coach
-- sees — plans, calendar, finished workouts — which does not include what they eat.
--
-- The checks are bounds, not opinions: a name, calories that are a sane number, macros that
-- are not negative. They exist so that one bad row from a buggy client is refused by itself
-- rather than accepted and then summed into somebody's day.
--
-- The app does not depend on this having been run. Until it is, the food log works on the
-- phone and waits; the rest of sync carries on. Run this once, in the Supabase SQL editor. It
-- is one transaction and safe to run again.

BEGIN;

CREATE TABLE IF NOT EXISTS public.food_entries (
  id          uuid PRIMARY KEY,
  user_id     uuid NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  eaten_on    date NOT NULL,
  name        text NOT NULL,
  food_key    text,
  grams       numeric(7, 1),
  calories    numeric(7, 1) NOT NULL,
  protein_g   numeric(6, 1),
  carbs_g     numeric(6, 1),
  fat_g       numeric(6, 1),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  deleted_at  timestamptz,
  CONSTRAINT food_entries_name_check CHECK (char_length(btrim(name)) BETWEEN 1 AND 120),
  CONSTRAINT food_entries_food_key_check CHECK (food_key IS NULL OR food_key ~ '^[a-z0-9_]{1,64}$'),
  CONSTRAINT food_entries_grams_check CHECK (grams IS NULL OR (grams >= 0 AND grams <= 5000)),
  CONSTRAINT food_entries_calories_check CHECK (calories >= 0 AND calories <= 20000),
  CONSTRAINT food_entries_protein_check CHECK (protein_g IS NULL OR (protein_g >= 0 AND protein_g <= 2000)),
  CONSTRAINT food_entries_carbs_check CHECK (carbs_g IS NULL OR (carbs_g >= 0 AND carbs_g <= 2000)),
  CONSTRAINT food_entries_fat_check CHECK (fat_g IS NULL OR (fat_g >= 0 AND fat_g <= 2000))
);

-- "What did I eat on this day", which is every screen that shows the log.
CREATE INDEX IF NOT EXISTS food_entries_user_day_idx
  ON public.food_entries (user_id, eaten_on);
-- A pull asks "what of mine changed since my cursor".
CREATE INDEX IF NOT EXISTS food_entries_sync_idx
  ON public.food_entries (user_id, updated_at);

ALTER TABLE public.food_entries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS food_entries_own ON public.food_entries;
CREATE POLICY food_entries_own ON public.food_entries
  FOR ALL TO authenticated
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);

REVOKE ALL ON public.food_entries FROM PUBLIC;
REVOKE ALL ON public.food_entries FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.food_entries TO authenticated;

-- Stamped by the server, like every synced table (0002).
DROP TRIGGER IF EXISTS food_entries_set_updated_at ON public.food_entries;
CREATE TRIGGER food_entries_set_updated_at
  BEFORE INSERT OR UPDATE ON public.food_entries
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

COMMIT;
