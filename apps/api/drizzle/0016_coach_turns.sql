-- How many messages an account has sent the coach today.
--
-- The coach now answers from the same Supabase function as the meal scan
-- (apps/api/src/edge/coach.ts), on the same free allowance from Google: so many requests a
-- day, shared by everyone who uses the app, behind a function anyone who can sign up can
-- reach. It needs the limit the scan has, and for the same reason — one account asking in a
-- loop would use up the day for all of them.
--
-- So every message is first counted here, and the count is the limit: a row per message, and
-- a trigger that refuses the row once the account has sent its day's worth. The function only
-- inserts and reads the verdict.
--
-- WHY THE LIMIT IS IN THE DATABASE
--
-- As for scans (0015): it is the one place a client cannot argue with. The row is written with
-- the caller's own token, so the function holds no service key; the trigger stamps the owner
-- and the time itself, so a message cannot be filed under another account or dated to
-- yesterday. There is no UPDATE and no DELETE: a row, once counted, stays counted.
--
-- WHAT IT HOLDS
--
-- That a message was sent, and when. Not the message, not the answer, not the digest of the
-- athlete that went with it — none of those are stored anywhere on this server. Its owner can
-- read their own rows, and nobody else can read any.
--
-- A SEPARATE TABLE FROM THE SCANS
--
-- Rather than one table with a "kind" column, because the two limits are different numbers
-- and a shared table would make each allowance a query that has to remember to filter. Two
-- tables cannot count each other's rows by mistake.
--
-- Run this once, in the Supabase SQL editor, before deploying the function: the function
-- refuses to answer when this table is missing rather than answering without a limit. It is
-- one transaction and safe to run again.

BEGIN;

CREATE TABLE IF NOT EXISTS public.coach_turns (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- "How many has this account sent since a day ago", which is the only question asked of it.
CREATE INDEX IF NOT EXISTS coach_turns_user_time_idx
  ON public.coach_turns (user_id, created_at);

ALTER TABLE public.coach_turns ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS coach_turns_read_own ON public.coach_turns;
CREATE POLICY coach_turns_read_own ON public.coach_turns
  FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS coach_turns_add_own ON public.coach_turns;
CREATE POLICY coach_turns_add_own ON public.coach_turns
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT auth.uid()) = user_id);

REVOKE ALL ON public.coach_turns FROM PUBLIC;
REVOKE ALL ON public.coach_turns FROM anon;
REVOKE ALL ON public.coach_turns FROM authenticated;
-- Read and add. Nothing changes a row and nothing removes one.
GRANT SELECT, INSERT ON public.coach_turns TO authenticated;

-- Sixty a day: a long conversation every day and the morning brief besides, and still a small
-- enough share of the free allowance that one account cannot spend it all.
CREATE OR REPLACE FUNCTION public.coach_turns_within_limit()
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
      FROM public.coach_turns
     WHERE user_id = NEW.user_id
       AND created_at > now() - interval '24 hours'
  ) >= 60 THEN
    -- The function looks for this word. Not a sentence: the phone says it in its own language.
    RAISE EXCEPTION 'coach_limit' USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS coach_turns_within_limit ON public.coach_turns;
CREATE TRIGGER coach_turns_within_limit
  BEFORE INSERT ON public.coach_turns
  FOR EACH ROW EXECUTE FUNCTION public.coach_turns_within_limit();

COMMIT;
