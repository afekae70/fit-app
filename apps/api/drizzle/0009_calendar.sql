-- The calendar, on the server — and a coach's hand on a trainee's.
--
-- Until now the calendar (which workout is planned for which date) lived only on the phone. It
-- was never synced: a reinstall lost it, a second phone never saw it, and nobody else could
-- write to it. A coach setting "Tuesday: legs" for a trainee needs all three to change, so this
-- does two things.
--
-- ## 1. The table
--
-- `scheduled_days` mirrors the phone's table column for column. A date holds zero or more rows:
-- none is "undecided", one with no workout is a rest day the person chose, and one or more with
-- a workout are that day's workouts in `position` order. Deleting is soft, like every table the
-- app syncs — a row with `deleted_at` set — because the other device has to hear about it.
--
-- A user reads and writes their own rows and nobody else's; the app's ordinary sync does the
-- rest. There is deliberately no foreign key from `plan_day_id` to `plan_days`: the phone has
-- none either, and a row the server refused for pointing at a workout it had not received yet
-- would be a row that never syncs.
--
-- ## 2. The coach's functions
--
-- As in 0007: a coach reaches a trainee's calendar only through functions that check, on every
-- call, that the caller is that trainee's coach. The policies on the table are not widened.
--
-- Setting a date replaces what was on it. The rows that were there are marked deleted and new
-- ones are written, which is exactly what the phone does when its own user changes a day — so
-- the trainee's phone applies a coach's change the same way it would apply its own.
--
-- Run this once, in the Supabase SQL editor, after 0007 and 0008. One transaction, safe to
-- run again.

BEGIN;

---------------------------------------------------------------------------------- the table
CREATE TABLE IF NOT EXISTS public.scheduled_days (
  id           uuid PRIMARY KEY,
  user_id      uuid NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  scheduled_on date NOT NULL,
  plan_day_id  uuid,
  position     integer NOT NULL DEFAULT 0,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  deleted_at   timestamptz
);

CREATE INDEX IF NOT EXISTS scheduled_days_user_date_idx
  ON public.scheduled_days (user_id, scheduled_on);
-- A pull asks "what of mine changed since my cursor".
CREATE INDEX IF NOT EXISTS scheduled_days_sync_idx
  ON public.scheduled_days (user_id, updated_at);

ALTER TABLE public.scheduled_days ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS scheduled_days_own ON public.scheduled_days;
CREATE POLICY scheduled_days_own ON public.scheduled_days
  FOR ALL TO authenticated
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);

REVOKE ALL ON public.scheduled_days FROM PUBLIC;
REVOKE ALL ON public.scheduled_days FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.scheduled_days TO authenticated;

-- Stamped by the server, like every synced table (0002): a phone with a wrong clock must not be
-- able to write a timestamp that wins every conflict.
DROP TRIGGER IF EXISTS scheduled_days_set_updated_at ON public.scheduled_days;
CREATE TRIGGER scheduled_days_set_updated_at
  BEFORE INSERT OR UPDATE ON public.scheduled_days
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

----------------------------------------------------------------------- reading a calendar
-- A trainee's calendar between two dates, inclusive: one entry per row, in the order the day
-- is done. A rest day is an entry whose `plan_day_id` is null; an undecided date has none.
CREATE OR REPLACE FUNCTION public.coach_get_schedule(p_trainee uuid, p_from date, p_to date)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  PERFORM public.coach_require_link(p_trainee);

  RETURN COALESCE((
    SELECT jsonb_agg(
             jsonb_build_object(
               'date', to_char(s.scheduled_on, 'YYYY-MM-DD'),
               'plan_day_id', s.plan_day_id,
               'position', s.position)
             ORDER BY s.scheduled_on, s.position, s.updated_at, s.id)
      FROM public.scheduled_days s
     WHERE s.user_id = p_trainee
       AND s.deleted_at IS NULL
       AND s.scheduled_on >= p_from
       AND s.scheduled_on <= p_to
  ), '[]'::jsonb);
END;
$$;

----------------------------------------------------------------------- writing a calendar
-- Say what one date holds for a trainee, replacing whatever it held.
--
--   p_plan_days   the workouts for that date, in order. Each must be one of the trainee's own.
--   p_rest        with no workouts: true records a rest day, false leaves the date undecided.
--
-- So: workouts -> those workouts; none and p_rest -> a rest day; none and not p_rest -> cleared.
CREATE OR REPLACE FUNCTION public.coach_set_schedule(
  p_trainee uuid,
  p_date date,
  p_plan_days uuid[],
  p_rest boolean
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  wanted uuid[] := COALESCE(p_plan_days, ARRAY[]::uuid[]);
  how_many integer := COALESCE(array_length(p_plan_days, 1), 0);
BEGIN
  PERFORM public.coach_require_link(p_trainee);

  IF p_date IS NULL THEN
    RAISE EXCEPTION 'invalid_date' USING ERRCODE = '22023';
  END IF;

  -- Every workout named has to be a live workout of this trainee's. One that is somebody
  -- else's, or deleted, or not there at all, fails the whole call: a calendar that points at
  -- a workout the trainee cannot open is worse than no change.
  IF how_many > 0 AND EXISTS (
    SELECT 1 FROM unnest(wanted) AS w(id)
     WHERE NOT EXISTS (
       SELECT 1 FROM public.plan_days d
         JOIN public.plans pl ON pl.id = d.plan_id
        WHERE d.id = w.id
          AND d.deleted_at IS NULL
          AND pl.user_id = p_trainee
          AND pl.deleted_at IS NULL
     )
  ) THEN
    RAISE EXCEPTION 'no_such_day' USING ERRCODE = 'P0002';
  END IF;

  UPDATE public.scheduled_days s
     SET deleted_at = now()
   WHERE s.user_id = p_trainee AND s.scheduled_on = p_date AND s.deleted_at IS NULL;

  IF how_many > 0 THEN
    INSERT INTO public.scheduled_days (id, user_id, scheduled_on, plan_day_id, position)
    SELECT gen_random_uuid(), p_trainee, p_date, w.id, (w.n - 1)::integer
      FROM unnest(wanted) WITH ORDINALITY AS w(id, n);
  ELSIF COALESCE(p_rest, false) THEN
    INSERT INTO public.scheduled_days (id, user_id, scheduled_on, plan_day_id, position)
    VALUES (gen_random_uuid(), p_trainee, p_date, NULL, 0);
  END IF;
END;
$$;

------------------------------------------------------------------------------- who may call
REVOKE ALL ON FUNCTION public.coach_get_schedule(uuid, date, date) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.coach_get_schedule(uuid, date, date) FROM anon;
GRANT EXECUTE ON FUNCTION public.coach_get_schedule(uuid, date, date) TO authenticated;

REVOKE ALL ON FUNCTION public.coach_set_schedule(uuid, date, uuid[], boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.coach_set_schedule(uuid, date, uuid[], boolean) FROM anon;
GRANT EXECUTE ON FUNCTION public.coach_set_schedule(uuid, date, uuid[], boolean) TO authenticated;

COMMIT;

-- Tell the API layer about the new table and functions straight away.
NOTIFY pgrst, 'reload schema';
