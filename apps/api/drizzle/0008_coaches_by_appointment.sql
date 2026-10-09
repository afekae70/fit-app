-- Coaches are appointed, not self-declared.
--
-- 0007 let any account switch coach mode on for itself. That was my reading of "user types:
-- coach and trainee", and it was the wrong one: who is a coach is the owner's decision. A coach
-- can read and rewrite other people's training plans, and "anyone who presses a switch" is not
-- a description of who should be able to.
--
-- So the switch is gone. An account becomes a coach when an administrator names it, by the
-- email it signs in with, and stops being one the same way. Everything else about coaching is
-- unchanged: an appointed coach still has a code, a trainee still links themselves by entering
-- it, and the plan functions still check that link on every call.
--
-- ## Administrators
--
-- `app_admins` is a list of accounts allowed to appoint coaches. It has row-level security on
-- and no policies, like `coach_links`: nothing reads or writes it except the functions here,
-- and there is deliberately no function that adds to it. Making somebody an administrator is
-- done in this editor, by whoever has the database — which is the point. The last statement in
-- this file adds the owner.
--
-- Run this once, in the Supabase SQL editor, after 0007. One transaction, safe to run again.

BEGIN;

----------------------------------------------------------------------- who may appoint
CREATE TABLE IF NOT EXISTS public.app_admins (
  user_id uuid PRIMARY KEY REFERENCES public.profiles (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.app_admins ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.app_admins FROM PUBLIC;
REVOKE ALL ON public.app_admins FROM anon;
REVOKE ALL ON public.app_admins FROM authenticated;

---------------------------------------------------------------- the end of self-service
DROP FUNCTION IF EXISTS public.coach_enable();
DROP FUNCTION IF EXISTS public.coach_disable();

--------------------------------------------------------------------------------- the check
CREATE OR REPLACE FUNCTION public.coach_require_admin()
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

  IF NOT EXISTS (SELECT 1 FROM public.app_admins a WHERE a.user_id = me) THEN
    RAISE EXCEPTION 'not_admin' USING ERRCODE = '42501';
  END IF;
END;
$$;

---------------------------------------------------------------------------------- status
-- As in 0007, with one more field: whether the caller may appoint coaches. The app uses it to
-- decide whether to show that part of the screen at all; the functions below check for
-- themselves regardless.
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
    -- A code is only a code while its owner is a coach.
    'code', CASE WHEN my_role = 'coach' THEN my_code ELSE NULL END,
    'is_admin', EXISTS (SELECT 1 FROM public.app_admins a WHERE a.user_id = me),
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

-------------------------------------------------------------------------- appointing
-- Every coach there is: who they are, their code, and how many people they train.
CREATE OR REPLACE FUNCTION public.admin_list_coaches()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  PERFORM public.coach_require_admin();

  RETURN COALESCE((
    SELECT jsonb_agg(
             jsonb_build_object(
               'id', p.id,
               'email', u.email,
               'name', p.display_name,
               'code', p.coach_code,
               'trainees', (
                 SELECT count(*) FROM public.coach_links l WHERE l.coach_id = p.id
               ))
             ORDER BY u.email)
      FROM public.profiles p
      JOIN auth.users u ON u.id = p.id
     WHERE p.role = 'coach'
  ), '[]'::jsonb);
END;
$$;

-- Make the account with this email a coach (`p_on` true) or stop it being one (false), and
-- answer with the list as it now stands.
--
-- Appointing gives the account a code the first time and keeps it afterwards, so a coach who
-- is removed and appointed again has the code they already handed out. Removing one lets every
-- one of their trainees go: the plans stay with the trainees, the access ends.
CREATE OR REPLACE FUNCTION public.admin_set_coach(p_email text, p_on boolean)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  target uuid;
  -- No I, L, O, 0 or 1: a code is read off one phone and typed into another.
  alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  candidate text;
  attempt integer := 0;
BEGIN
  PERFORM public.coach_require_admin();

  SELECT u.id INTO target
    FROM auth.users u
   WHERE lower(u.email) = lower(btrim(COALESCE(p_email, '')));

  IF target IS NULL THEN
    RAISE EXCEPTION 'no_such_user' USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO public.profiles (id) VALUES (target) ON CONFLICT (id) DO NOTHING;

  IF NOT COALESCE(p_on, false) THEN
    DELETE FROM public.coach_links l WHERE l.coach_id = target;
    UPDATE public.profiles SET role = 'trainee' WHERE id = target;
    RETURN public.admin_list_coaches();
  END IF;

  SELECT p.coach_code INTO candidate FROM public.profiles p WHERE p.id = target;
  IF candidate IS NOT NULL THEN
    UPDATE public.profiles SET role = 'coach' WHERE id = target;
    RETURN public.admin_list_coaches();
  END IF;

  LOOP
    attempt := attempt + 1;
    candidate := '';
    FOR i IN 1..6 LOOP
      candidate := candidate
        || substr(alphabet, 1 + floor(random() * length(alphabet))::integer, 1);
    END LOOP;

    BEGIN
      UPDATE public.profiles SET role = 'coach', coach_code = candidate WHERE id = target;
      RETURN public.admin_list_coaches();
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

------------------------------------------------------------------------------- who may call
REVOKE ALL ON FUNCTION public.coach_require_admin() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.coach_require_admin() FROM anon;
REVOKE ALL ON FUNCTION public.coach_require_admin() FROM authenticated;

REVOKE ALL ON FUNCTION public.coach_status() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.coach_status() FROM anon;
GRANT EXECUTE ON FUNCTION public.coach_status() TO authenticated;

REVOKE ALL ON FUNCTION public.admin_list_coaches() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_list_coaches() FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_list_coaches() TO authenticated;

REVOKE ALL ON FUNCTION public.admin_set_coach(text, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_set_coach(text, boolean) FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_set_coach(text, boolean) TO authenticated;

------------------------------------------------------------------------- the first admin
-- The owner's account, by the email it signs in to the app with. Check that this is that
-- email before running: if it matches nobody, nothing is added, nobody is an administrator,
-- and the appointing part of the coaching screen simply never appears.
INSERT INTO public.profiles (id)
SELECT u.id FROM auth.users u WHERE lower(u.email) = lower('afekae70@gmail.com')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.app_admins (user_id)
SELECT u.id FROM auth.users u WHERE lower(u.email) = lower('afekae70@gmail.com')
ON CONFLICT (user_id) DO NOTHING;

COMMIT;

-- Tell the API layer about the changed functions straight away.
NOTIFY pgrst, 'reload schema';
