-- Coaches and the people they train.
--
-- A coach is an ordinary account that has switched coach mode on. Doing so gives it a short
-- code. Someone who types that code into their own app becomes that coach's trainee, and from
-- then on the coach can read and write that person's training plans — the groups, the workouts
-- in them, and the exercises, sets and reps each workout prescribes. Nothing else: not their
-- workout history, not their weight, not their profile.
--
-- ## The link is made by the trainee, and only by the trainee
--
-- There is no way for a coach to add somebody. Access to a person's plans begins when that
-- person enters a code, and ends when either side says so. That is the consent, and it is why
-- `coach_join` takes a code and reads the trainee from the session rather than taking two ids.
--
-- ## Why functions, and not wider row-level security
--
-- The obvious way to let a coach see a trainee's plans is to widen the policies on `plans`,
-- `plan_days` and `plan_day_exercises`. It would also change what every existing query on
-- those tables returns. The app's sync pulls "every row I am allowed to see that has changed";
-- with wider policies a coach's phone would start downloading its trainees' plans into its own
-- local database, as if they were the coach's own.
--
-- So the policies stay exactly as they were — a user sees their own rows, full stop — and a
-- coach reaches a trainee's plans only through the functions below. Each one runs as its owner
-- (SECURITY DEFINER), which is what lets it see past those policies, and each one begins by
-- checking that the caller really is that trainee's coach. `coach_links` itself has row-level
-- security on and no policies at all: nothing but these functions can read or change it.
--
-- `search_path = ''` and fully-qualified names throughout, as in 0006: a SECURITY DEFINER
-- function that resolves names through the caller's search path can be handed someone else's
-- tables to work on.
--
-- ## Positions
--
-- `plan_day_exercises` is UNIQUE on (plan_day_id, order_index), checked row by row, so a list
-- cannot be renumbered in place — the second row lands on a position the first has not left.
-- Every rewrite here first moves the rows it is about to touch far out of the way, onto values
-- from `coach_parking_seq`, and then writes the real positions into slots that are certainly
-- free. Rows that are removed simply stay parked. The sequence starts at two million, clear of
-- the bands the app itself parks in (100,000 and 1,000,000 upward).
--
-- Run this once, in the Supabase SQL editor. It is one transaction — either all of it applies
-- or none of it does — and it is safe to run again.

BEGIN;

----------------------------------------------------------------------------- who is a coach
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS role text NOT NULL DEFAULT 'trainee';

DO $$ BEGIN
  ALTER TABLE public.profiles
    ADD CONSTRAINT profiles_role_check CHECK (role IN ('trainee', 'coach'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- What a trainee types to join. Null until coach mode is first switched on.
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS coach_code text;

CREATE UNIQUE INDEX IF NOT EXISTS profiles_coach_code_key
  ON public.profiles (coach_code) WHERE coach_code IS NOT NULL;

------------------------------------------------------------------------- who coaches whom
-- Keyed by the trainee: a person has one coach at a time. Joining another replaces the first.
CREATE TABLE IF NOT EXISTS public.coach_links (
  trainee_id uuid PRIMARY KEY REFERENCES public.profiles (id) ON DELETE CASCADE,
  coach_id   uuid NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT coach_links_not_self CHECK (coach_id <> trainee_id)
);

CREATE INDEX IF NOT EXISTS coach_links_coach_idx ON public.coach_links (coach_id);

-- On, with no policies: to an ordinary session this table is empty and cannot be written.
ALTER TABLE public.coach_links ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.coach_links FROM PUBLIC;
REVOKE ALL ON public.coach_links FROM anon;
REVOKE ALL ON public.coach_links FROM authenticated;

CREATE SEQUENCE IF NOT EXISTS public.coach_parking_seq
  AS integer START WITH 2000000 MINVALUE 2000000 MAXVALUE 2000000000 CYCLE;
REVOKE ALL ON SEQUENCE public.coach_parking_seq FROM PUBLIC;
REVOKE ALL ON SEQUENCE public.coach_parking_seq FROM anon;
REVOKE ALL ON SEQUENCE public.coach_parking_seq FROM authenticated;

--------------------------------------------------------------------------------- the check
-- Every function that touches a trainee's plans starts here. It raises unless the caller is
-- signed in and is, right now, the coach of `p_trainee`.
CREATE OR REPLACE FUNCTION public.coach_require_link(p_trainee uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  me uuid := (SELECT auth.uid());
BEGIN
  IF me IS NULL THEN
    RAISE EXCEPTION 'not_signed_in' USING ERRCODE = '28000';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.coach_links l
     WHERE l.coach_id = me AND l.trainee_id = p_trainee
  ) THEN
    RAISE EXCEPTION 'not_your_trainee' USING ERRCODE = '42501';
  END IF;
END;
$$;

---------------------------------------------------------------------------------- status
-- Everything the coaching screen needs in one call: the caller's role and code, who coaches
-- them, and whom they coach. The email comes from auth.users because that is the only place
-- it lives, and it is shown only across a link that the trainee made.
CREATE OR REPLACE FUNCTION public.coach_status()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  me uuid := (SELECT auth.uid());
  my_role text;
  my_code text;
BEGIN
  IF me IS NULL THEN
    RAISE EXCEPTION 'not_signed_in' USING ERRCODE = '28000';
  END IF;

  SELECT p.role, p.coach_code INTO my_role, my_code
    FROM public.profiles p WHERE p.id = me;

  RETURN jsonb_build_object(
    'role', COALESCE(my_role, 'trainee'),
    'code', my_code,
    'coach', (
      SELECT jsonb_build_object(
               'id', l.coach_id,
               'email', u.email,
               'name', p.display_name,
               'since', l.created_at)
        FROM public.coach_links l
        JOIN auth.users u ON u.id = l.coach_id
        LEFT JOIN public.profiles p ON p.id = l.coach_id
       WHERE l.trainee_id = me
    ),
    'trainees', COALESCE((
      SELECT jsonb_agg(
               jsonb_build_object(
                 'id', l.trainee_id,
                 'email', u.email,
                 'name', p.display_name,
                 'since', l.created_at)
               ORDER BY l.created_at)
        FROM public.coach_links l
        JOIN auth.users u ON u.id = l.trainee_id
        LEFT JOIN public.profiles p ON p.id = l.trainee_id
       WHERE l.coach_id = me
    ), '[]'::jsonb)
  );
END;
$$;

------------------------------------------------------------------------------ coach mode
-- Switches coach mode on and returns the code. The code is made once and kept: switching the
-- mode off and on again gives the same one, so a code already handed out goes on working.
CREATE OR REPLACE FUNCTION public.coach_enable()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  me uuid := (SELECT auth.uid());
  -- No I, L, O, 0 or 1: a code is read off one phone and typed into another.
  alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  candidate text;
  attempt integer := 0;
BEGIN
  IF me IS NULL THEN
    RAISE EXCEPTION 'not_signed_in' USING ERRCODE = '28000';
  END IF;

  INSERT INTO public.profiles (id) VALUES (me) ON CONFLICT (id) DO NOTHING;

  SELECT p.coach_code INTO candidate FROM public.profiles p WHERE p.id = me;
  IF candidate IS NOT NULL THEN
    UPDATE public.profiles SET role = 'coach' WHERE id = me;
    RETURN candidate;
  END IF;

  LOOP
    attempt := attempt + 1;
    candidate := '';
    FOR i IN 1..6 LOOP
      candidate := candidate
        || substr(alphabet, 1 + floor(random() * length(alphabet))::integer, 1);
    END LOOP;

    BEGIN
      UPDATE public.profiles SET role = 'coach', coach_code = candidate WHERE id = me;
      RETURN candidate;
    EXCEPTION WHEN unique_violation THEN
      -- Somebody already has that one. Thirty-one to the sixth is most of a billion, so this
      -- is a second attempt once in a very long while, not a loop.
      IF attempt >= 20 THEN
        RAISE;
      END IF;
    END;
  END LOOP;
END;
$$;

-- Switches coach mode off and lets every trainee go. The code is kept for next time.
CREATE OR REPLACE FUNCTION public.coach_disable()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  me uuid := (SELECT auth.uid());
BEGIN
  IF me IS NULL THEN
    RAISE EXCEPTION 'not_signed_in' USING ERRCODE = '28000';
  END IF;

  DELETE FROM public.coach_links l WHERE l.coach_id = me;
  UPDATE public.profiles SET role = 'trainee' WHERE id = me;
END;
$$;

------------------------------------------------------------------------- joining, leaving
-- The trainee's side, and the only way a link is ever made. Returns the new status.
CREATE OR REPLACE FUNCTION public.coach_join(p_code text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  me uuid := (SELECT auth.uid());
  coach uuid;
BEGIN
  IF me IS NULL THEN
    RAISE EXCEPTION 'not_signed_in' USING ERRCODE = '28000';
  END IF;

  SELECT p.id INTO coach
    FROM public.profiles p
   WHERE p.coach_code = upper(btrim(COALESCE(p_code, '')))
     AND p.role = 'coach';

  IF coach IS NULL THEN
    RAISE EXCEPTION 'no_such_code' USING ERRCODE = 'P0002';
  END IF;
  IF coach = me THEN
    RAISE EXCEPTION 'own_code' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.profiles (id) VALUES (me) ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.coach_links (trainee_id, coach_id) VALUES (me, coach)
  ON CONFLICT (trainee_id) DO UPDATE
    SET coach_id = EXCLUDED.coach_id, created_at = now();

  RETURN public.coach_status();
END;
$$;

CREATE OR REPLACE FUNCTION public.coach_leave()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  me uuid := (SELECT auth.uid());
BEGIN
  IF me IS NULL THEN
    RAISE EXCEPTION 'not_signed_in' USING ERRCODE = '28000';
  END IF;

  DELETE FROM public.coach_links l WHERE l.trainee_id = me;
END;
$$;

CREATE OR REPLACE FUNCTION public.coach_remove_trainee(p_trainee uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  me uuid := (SELECT auth.uid());
BEGIN
  IF me IS NULL THEN
    RAISE EXCEPTION 'not_signed_in' USING ERRCODE = '28000';
  END IF;

  DELETE FROM public.coach_links l WHERE l.coach_id = me AND l.trainee_id = p_trainee;
END;
$$;

---------------------------------------------------------------------- reading the plans
-- A trainee's plans as one document: groups, the workouts in each, the exercises in each
-- workout, all in order, deleted rows left out.
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
-- Create a group or rename one. The id comes from the app, so a retry after a lost reply
-- writes the same row rather than a second one. A trainee's first group becomes the active
-- one; after that, which group is active is left as the trainee has it.
CREATE OR REPLACE FUNCTION public.coach_save_plan(p_trainee uuid, p_id uuid, p_name text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  cleaned text := btrim(COALESCE(p_name, ''));
  plan_owner uuid;
BEGIN
  PERFORM public.coach_require_link(p_trainee);

  IF p_id IS NULL OR cleaned = '' THEN
    RAISE EXCEPTION 'invalid_plan' USING ERRCODE = '22023';
  END IF;

  SELECT pl.user_id INTO plan_owner FROM public.plans pl WHERE pl.id = p_id;
  IF FOUND THEN
    -- An id that exists and belongs to somebody else is never written to, whoever asks.
    IF plan_owner <> p_trainee THEN
      RAISE EXCEPTION 'not_your_trainee' USING ERRCODE = '42501';
    END IF;
    UPDATE public.plans SET name = cleaned, deleted_at = NULL WHERE id = p_id;
  ELSE
    INSERT INTO public.plans (id, user_id, name, is_active)
    VALUES (
      p_id,
      p_trainee,
      cleaned,
      NOT EXISTS (
        SELECT 1 FROM public.plans x
         WHERE x.user_id = p_trainee AND x.is_active AND x.deleted_at IS NULL
      )
    );
  END IF;
END;
$$;

-- Create a workout or replace what is in one. `p_day` is the whole workout as it should be:
--
--   { "id": uuid, "name": text or null,
--     "exercises": [ { "id": uuid, "exercise_key": text, "target_sets": int or null,
--                      "target_reps_min": int or null, "target_reps_max": int or null,
--                      "notes": text or null }, ... ] }
--
-- The exercises are written in the order given. One that is in the workout now and not in the
-- document is removed. A new workout goes to the end of its group.
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
           deleted_at = NULL
     WHERE d.id = day_id;
  ELSE
    INSERT INTO public.plan_days (id, plan_id, day_index, name)
    VALUES (day_id, p_plan, next_index, day_name);
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

-- Remove a workout ('day') or a whole group ('plan'), with everything under it. Soft, like
-- every deletion in this schema: the rows stay, marked, so the trainee's phone hears about it.
CREATE OR REPLACE FUNCTION public.coach_delete(p_trainee uuid, p_kind text, p_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  PERFORM public.coach_require_link(p_trainee);

  IF p_kind = 'day' THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.plan_days d
        JOIN public.plans pl ON pl.id = d.plan_id
       WHERE d.id = p_id AND pl.user_id = p_trainee
    ) THEN
      RAISE EXCEPTION 'no_such_day' USING ERRCODE = 'P0002';
    END IF;

    UPDATE public.plan_day_exercises e
       SET deleted_at = now(), order_index = nextval('public.coach_parking_seq')
     WHERE e.plan_day_id = p_id AND e.deleted_at IS NULL;

    UPDATE public.plan_days d
       SET deleted_at = now(), day_index = nextval('public.coach_parking_seq')
     WHERE d.id = p_id AND d.deleted_at IS NULL;

  ELSIF p_kind = 'plan' THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.plans pl WHERE pl.id = p_id AND pl.user_id = p_trainee
    ) THEN
      RAISE EXCEPTION 'no_such_plan' USING ERRCODE = 'P0002';
    END IF;

    UPDATE public.plan_day_exercises e
       SET deleted_at = now(), order_index = nextval('public.coach_parking_seq')
     WHERE e.deleted_at IS NULL
       AND e.plan_day_id IN (SELECT d.id FROM public.plan_days d WHERE d.plan_id = p_id);

    UPDATE public.plan_days d
       SET deleted_at = now(), day_index = nextval('public.coach_parking_seq')
     WHERE d.plan_id = p_id AND d.deleted_at IS NULL;

    UPDATE public.plans SET deleted_at = now(), is_active = false WHERE id = p_id;

  ELSE
    RAISE EXCEPTION 'invalid_kind' USING ERRCODE = '22023';
  END IF;
END;
$$;

------------------------------------------------------------------------------- who may call
-- Functions are executable by everyone unless told otherwise. These are for signed-in users
-- and nobody else — not the anonymous key that ships inside the app. The check itself is not
-- callable from outside at all; the functions above reach it because they run as its owner.
REVOKE ALL ON FUNCTION public.coach_require_link(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.coach_require_link(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.coach_require_link(uuid) FROM authenticated;

REVOKE ALL ON FUNCTION public.coach_status() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.coach_status() FROM anon;
GRANT EXECUTE ON FUNCTION public.coach_status() TO authenticated;

REVOKE ALL ON FUNCTION public.coach_enable() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.coach_enable() FROM anon;
GRANT EXECUTE ON FUNCTION public.coach_enable() TO authenticated;

REVOKE ALL ON FUNCTION public.coach_disable() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.coach_disable() FROM anon;
GRANT EXECUTE ON FUNCTION public.coach_disable() TO authenticated;

REVOKE ALL ON FUNCTION public.coach_join(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.coach_join(text) FROM anon;
GRANT EXECUTE ON FUNCTION public.coach_join(text) TO authenticated;

REVOKE ALL ON FUNCTION public.coach_leave() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.coach_leave() FROM anon;
GRANT EXECUTE ON FUNCTION public.coach_leave() TO authenticated;

REVOKE ALL ON FUNCTION public.coach_remove_trainee(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.coach_remove_trainee(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.coach_remove_trainee(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.coach_get_plans(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.coach_get_plans(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.coach_get_plans(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.coach_save_plan(uuid, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.coach_save_plan(uuid, uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.coach_save_plan(uuid, uuid, text) TO authenticated;

REVOKE ALL ON FUNCTION public.coach_save_day(uuid, uuid, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.coach_save_day(uuid, uuid, jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.coach_save_day(uuid, uuid, jsonb) TO authenticated;

REVOKE ALL ON FUNCTION public.coach_delete(uuid, text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.coach_delete(uuid, text, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.coach_delete(uuid, text, uuid) TO authenticated;

COMMIT;

-- Tell the API layer about the new functions straight away, rather than at its next reload.
NOTIFY pgrst, 'reload schema';
