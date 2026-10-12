-- Water, and meals kept to be logged again.
--
-- Two small tables beside the food log (0014), and they are the server's copy in exactly the
-- way it is: the phone keeps its own, rows are upserted by id, a deletion is a row marked
-- deleted rather than a row removed, and `updated_at` is stamped here so that a phone with a
-- wrong clock cannot win every conflict.
--
--   water_entries   a row per glass: how many millilitres, on which calendar day
--   saved_meals     a named list of things to log together, the list held as JSON on the row
--
-- WHO CAN SEE THEM
--
-- Their owner, and nobody else. A coach cannot: no coach function reads either table, as none
-- reads the food log.
--
-- The checks are bounds, not opinions. A glass is between a millilitre and five litres. A meal
-- has a name, and between one and thirty items in a list that is not allowed to grow without
-- limit — the column is free-form JSON, and the size bound is what stops it being used to
-- store something else.
--
-- The app does not depend on this having been run. Until it is, both work on the phone and
-- wait; the rest of sync carries on. Run this once, in the Supabase SQL editor. It is one
-- transaction and safe to run again.

BEGIN;

CREATE TABLE IF NOT EXISTS public.water_entries (
  id          uuid PRIMARY KEY,
  user_id     uuid NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  drunk_on    date NOT NULL,
  ml          integer NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  deleted_at  timestamptz,
  CONSTRAINT water_entries_ml_check CHECK (ml >= 1 AND ml <= 5000)
);

CREATE INDEX IF NOT EXISTS water_entries_user_day_idx
  ON public.water_entries (user_id, drunk_on);
-- A pull asks "what of mine changed since my cursor".
CREATE INDEX IF NOT EXISTS water_entries_sync_idx
  ON public.water_entries (user_id, updated_at);

ALTER TABLE public.water_entries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS water_entries_own ON public.water_entries;
CREATE POLICY water_entries_own ON public.water_entries
  FOR ALL TO authenticated
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);

REVOKE ALL ON public.water_entries FROM PUBLIC;
REVOKE ALL ON public.water_entries FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.water_entries TO authenticated;

-- Stamped by the server, like every synced table (0002).
DROP TRIGGER IF EXISTS water_entries_set_updated_at ON public.water_entries;
CREATE TRIGGER water_entries_set_updated_at
  BEFORE INSERT OR UPDATE ON public.water_entries
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.saved_meals (
  id          uuid PRIMARY KEY,
  user_id     uuid NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  name        text NOT NULL,
  items       jsonb NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  deleted_at  timestamptz,
  CONSTRAINT saved_meals_name_check CHECK (char_length(btrim(name)) BETWEEN 1 AND 80),
  -- A CASE, not an AND: the length of something that is not an array is an error, not false,
  -- and the order an AND is evaluated in is not promised.
  CONSTRAINT saved_meals_items_check CHECK (
    CASE WHEN jsonb_typeof(items) = 'array'
         THEN jsonb_array_length(items) BETWEEN 1 AND 30
         ELSE false
    END
  ),
  CONSTRAINT saved_meals_items_size_check CHECK (octet_length(items::text) <= 20000)
);

CREATE INDEX IF NOT EXISTS saved_meals_sync_idx
  ON public.saved_meals (user_id, updated_at);

ALTER TABLE public.saved_meals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS saved_meals_own ON public.saved_meals;
CREATE POLICY saved_meals_own ON public.saved_meals
  FOR ALL TO authenticated
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);

REVOKE ALL ON public.saved_meals FROM PUBLIC;
REVOKE ALL ON public.saved_meals FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.saved_meals TO authenticated;

DROP TRIGGER IF EXISTS saved_meals_set_updated_at ON public.saved_meals;
CREATE TRIGGER saved_meals_set_updated_at
  BEFORE INSERT OR UPDATE ON public.saved_meals
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

COMMIT;
