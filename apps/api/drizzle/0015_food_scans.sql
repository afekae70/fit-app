-- How many meals an account has photographed today.
--
-- Photographing a meal sends the picture to a vision model through the `scan-food` function
-- (apps/api/src/edge/scan-food.ts), on Google's free tier. Free means a daily allowance shared
-- by everyone who uses the app, and the function is reachable by anyone who can sign up. One
-- account scanning in a loop would use the whole day's allowance for all of them.
--
-- So every scan is first counted here, and the count is the limit: a row per scan, and a
-- trigger that refuses the row once the account has made its day's worth. The function only
-- inserts and reads the verdict.
--
-- WHY THE LIMIT IS IN THE DATABASE
--
-- Because it is the one place a client cannot argue with. The row is written with the
-- caller's own token, so there is no service key in the function to leak; and the trigger
-- stamps the owner and the time itself, so a client cannot file a scan under another account
-- or date it to yesterday. There is no UPDATE and no DELETE: a row, once counted, stays
-- counted.
--
-- WHO CAN SEE IT
--
-- Its owner, and nobody else. It holds no photograph and no food — only that a scan happened
-- and when. The picture itself is never stored anywhere on this server.
--
-- Run this once, in the Supabase SQL editor, before deploying the function: the function
-- refuses to scan when this table is missing rather than scanning without a limit. It is one
-- transaction and safe to run again.

BEGIN;

CREATE TABLE IF NOT EXISTS public.food_scans (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- "How many has this account made since a day ago", which is the only question asked of it.
CREATE INDEX IF NOT EXISTS food_scans_user_time_idx
  ON public.food_scans (user_id, created_at);

ALTER TABLE public.food_scans ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS food_scans_read_own ON public.food_scans;
CREATE POLICY food_scans_read_own ON public.food_scans
  FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS food_scans_add_own ON public.food_scans;
CREATE POLICY food_scans_add_own ON public.food_scans
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT auth.uid()) = user_id);

REVOKE ALL ON public.food_scans FROM PUBLIC;
REVOKE ALL ON public.food_scans FROM anon;
REVOKE ALL ON public.food_scans FROM authenticated;
-- Read and add. Nothing changes a row and nothing removes one.
GRANT SELECT, INSERT ON public.food_scans TO authenticated;

-- Forty a day is several times what three meals and their snacks come to, and a small enough
-- share of the free allowance that one account cannot spend it all.
CREATE OR REPLACE FUNCTION public.food_scans_within_limit()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  -- The caller and the server's clock, whatever the request said.
  NEW.user_id := (SELECT auth.uid());
  NEW.created_at := now();

  IF NEW.user_id IS NULL THEN
    RAISE EXCEPTION 'sign_in_required' USING ERRCODE = '42501';
  END IF;

  IF (
    SELECT count(*)
      FROM public.food_scans
     WHERE user_id = NEW.user_id
       AND created_at > now() - interval '24 hours'
  ) >= 40 THEN
    -- The function looks for this word. Not a sentence: the phone says it in its own language.
    RAISE EXCEPTION 'scan_limit' USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS food_scans_within_limit ON public.food_scans;
CREATE TRIGGER food_scans_within_limit
  BEFORE INSERT ON public.food_scans
  FOR EACH ROW EXECUTE FUNCTION public.food_scans_within_limit();

COMMIT;
