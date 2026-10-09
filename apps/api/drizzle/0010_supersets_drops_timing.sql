-- Three things the phone has always recorded and never sent — and room for a coach to send them.
--
--   session_exercises.superset_with_next   this exercise is paired with the one after it
--   sets.is_drop                           this set is a drop set off the one before it
--   plan_days.work_seconds / rest_seconds / rounds
--                                          what makes a workout a timed one
--
-- They lived only on the phone. A reinstall brought a superset back as two unrelated exercises
-- and an interval session back as an ordinary one, and a coach handing over one of their own
-- timed workouts handed over its exercises and none of its timing.
--
-- ## 1. The columns
--
-- Added with the defaults the phone uses, so every row already here reads as what it has
-- always been: not a superset, not a drop set, not timed. Adding them touches no row and fires
-- no trigger, so nothing is re-sent to anyone because of it.
--
-- The app does not depend on this having been run. Until it is, the app sends these tables
-- without the new columns and keeps the rows that had something in them queued; the sync after
-- this script sends the rest by itself.
--
-- ## 2. The coach's functions
--
-- `coach_get_plans` and `coach_save_day` are replaced with versions that carry a workout's
-- timing. They are otherwise exactly as 0007 left them. A save from an app that does not send
-- timing leaves a workout's timing as it was.
--
-- Run this once, in the Supabase SQL editor, after 0007-0009. One transaction, safe to run again.

BEGIN;

--------------------------------------------------------------------------------- the columns
ALTER TABLE public.session_exercises
  ADD COLUMN IF NOT EXISTS superset_with_next boolean NOT NULL DEFAULT false;

ALTER TABLE public.sets
  ADD COLUMN IF NOT EXISTS is_drop boolean NOT NULL DEFAULT false;

ALTER TABLE public.plan_days ADD COLUMN IF NOT EXISTS work_seconds integer;
ALTER TABLE public.plan_days ADD COLUMN IF NOT EXISTS rest_seconds integer;
ALTER TABLE public.plan_days ADD COLUMN IF NOT EXISTS rounds integer;

---------------------------------------------------------------------- reading the plans
-- As 0007, with each workout's timing.
CREATE OR REPLACE FUNCTION public.coach_get_plans(p_trainee uuid)
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
               'id', pl.id,
               'name', pl.name,
               'is_active', pl.is_active,
               'days', COALESCE((
                 SELECT jsonb_agg(
                          jsonb_build_object(
                            'id', d.id,
                            'name', d.name,
                            'work_seconds', d.work_seconds,
                            'rest_seconds', d.rest_seconds,
                            'rounds', d.rounds,
                            'exercises', COALESCE((
                              SELECT jsonb_agg(
                                       jsonb_build_object(
                                         'id', e.id,
                                         'exercise_key', e.exercise_key,
                                         'target_sets', e.target_sets,
                                         'target_reps_min', e.target_reps_min,
                                         'target_reps_max', e.target_reps_max,
                                         'notes', e.notes)
                                       ORDER BY e.order_index)
                                FROM public.plan_day_exercises e
                               WHERE e.plan_day_id = d.id
                                 AND e.deleted_at IS NULL
                                 AND e.exercise_key IS NOT NULL
                            ), '[]'::jsonb))
                          ORDER BY d.day_index)
                   FROM public.plan_days d
                  WHERE d.plan_id = pl.id AND d.deleted_at IS NULL
               ), '[]'::jsonb))
             ORDER BY pl.created_at)
      FROM public.plans pl
     WHERE pl.user_id = p_trainee AND pl.deleted_at IS NULL
  ), '[]'::jsonb);
END;
$$;

---------------------------------------------------------------------- writing the plans
-- As 0007, with each workout's timing. `p_day` may now also carry:
--
--   "work_seconds": int or null, "rest_seconds": int or null, "rounds": int or null
--
-- A key that is present is written, null included — null is how a workout stops being timed.
-- A key that is absent leaves the column as it is.
CREATE OR REPLACE FUNCTION public.coach_save_day(p_trainee uuid, p_plan uuid, p_day jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  day_id uuid := (p_day ->> 'id')::uuid;
  day_name text := NULLIF(btrim(COALESCE(p_day ->> 'name', '')), '');
  current_plan uuid;
  was_deleted boolean;
  next_index integer;
  item jsonb;
  item_id uuid;
  item_key text;
  place integer := 0;
  kept uuid[] := ARRAY[]::uuid[];
BEGIN
  PERFORM public.coach_require_link(p_trainee);

  IF day_id IS NULL THEN
    RAISE EXCEPTION 'invalid_day' USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.plans pl
     WHERE pl.id = p_plan AND pl.user_id = p_trainee AND pl.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'no_such_plan' USING ERRCODE = 'P0002';
  END IF;

  SELECT COALESCE(max(d.day_index), 0) + 1 INTO next_index
    FROM public.plan_days d
   WHERE d.plan_id = p_plan AND d.deleted_at IS NULL AND d.day_index < 100000;

  SELECT d.plan_id, d.deleted_at IS NOT NULL INTO current_plan, was_deleted
    FROM public.plan_days d WHERE d.id = day_id;

  IF FOUND THEN
    -- The id exists. It has to be a workout of this very group, or it is not ours to touch.
    IF current_plan IS DISTINCT FROM p_plan THEN
      RAISE EXCEPTION 'not_your_trainee' USING ERRCODE = '42501';
    END IF;
    UPDATE public.plan_days d
       SET name = day_name,
           -- One the trainee deleted in the meantime comes back at the end, not on the parked
           -- position its deletion left it with.
           day_index = CASE WHEN was_deleted THEN next_index ELSE d.day_index END,
           -- Only when the document says something about timing. An app from before timing
           -- travelled sends none of these keys, and must not turn a timed workout into an
           -- ordinary one just by saving its exercises.
           work_seconds = CASE WHEN p_day ? 'work_seconds'
                               THEN (p_day ->> 'work_seconds')::integer ELSE d.work_seconds END,
           rest_seconds = CASE WHEN p_day ? 'rest_seconds'
                               THEN (p_day ->> 'rest_seconds')::integer ELSE d.rest_seconds END,
           rounds = CASE WHEN p_day ? 'rounds'
                         THEN (p_day ->> 'rounds')::integer ELSE d.rounds END,
           deleted_at = NULL
     WHERE d.id = day_id;
  ELSE
    INSERT INTO public.plan_days (id, plan_id, day_index, name, work_seconds, rest_seconds, rounds)
    VALUES (
      day_id,
      p_plan,
      next_index,
      day_name,
      (p_day ->> 'work_seconds')::integer,
      (p_day ->> 'rest_seconds')::integer,
      (p_day ->> 'rounds')::integer
    );
  END IF;

  -- Everything in the workout out of the way: the live rows, and any deleted row still sitting
  -- on a real position from before deletions were parked.
  UPDATE public.plan_day_exercises e
     SET order_index = nextval('public.coach_parking_seq')
   WHERE e.plan_day_id = day_id
     AND (e.deleted_at IS NULL OR e.order_index < 1000000);

  FOR item IN
    SELECT t.value
      FROM jsonb_array_elements(COALESCE(p_day -> 'exercises', '[]'::jsonb))
           WITH ORDINALITY AS t(value, n)
     ORDER BY t.n
  LOOP
    place := place + 1;
    item_id := (item ->> 'id')::uuid;
    item_key := btrim(COALESCE(item ->> 'exercise_key', ''));

    IF item_id IS NULL OR item_key = '' THEN
      RAISE EXCEPTION 'invalid_exercise' USING ERRCODE = '22023';
    END IF;

    INSERT INTO public.plan_day_exercises AS present
      (id, plan_day_id, exercise_key, order_index,
       target_sets, target_reps_min, target_reps_max, notes)
    VALUES (
      item_id,
      day_id,
      item_key,
      place,
      (item ->> 'target_sets')::integer,
      (item ->> 'target_reps_min')::integer,
      (item ->> 'target_reps_max')::integer,
      NULLIF(btrim(COALESCE(item ->> 'notes', '')), '')
    )
    ON CONFLICT (id) DO UPDATE
      SET exercise_key = EXCLUDED.exercise_key,
          order_index = EXCLUDED.order_index,
          target_sets = EXCLUDED.target_sets,
          target_reps_min = EXCLUDED.target_reps_min,
          target_reps_max = EXCLUDED.target_reps_max,
          notes = EXCLUDED.notes,
          deleted_at = NULL
      -- Only a row of this workout. An id that belongs to another workout — anybody's — is
      -- left exactly as it is.
      WHERE present.plan_day_id = day_id;

    kept := kept || item_id;
  END LOOP;

  -- What was in the workout and is not in the document is removed. It is already parked.
  UPDATE public.plan_day_exercises e
     SET deleted_at = now()
   WHERE e.plan_day_id = day_id
     AND e.deleted_at IS NULL
     AND NOT (e.id = ANY (kept));
END;
$$;

COMMIT;

-- Tell the API layer about the new columns straight away. Until it has reloaded, it goes on
-- refusing them as unknown, and the app goes on working around that.
NOTIFY pgrst, 'reload schema';
