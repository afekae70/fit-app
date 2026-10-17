-- What a trainee chooses to share with their coach, and progress photos.
--
-- Until now a coach saw a trainee's plans, calendar and finished workouts (0007-0013) — what
-- the trainee agreed to by entering the coach's code — and nothing of their body or their
-- eating. This adds three things a trainee can choose to share on top of that, each on its own
-- switch, each off until they switch it on:
--
--   body        weigh-ins and the scale's other readings
--   nutrition   the food log, water, and the daily targets the app has worked out for them
--   photos      progress photos
--
-- WHERE THE CHOICE IS KEPT
--
-- On the link between this trainee and this coach (`coach_links`), not on the trainee's
-- profile. Consent is given to a person. A trainee who moves to another coach has shared
-- nothing with the new one until they say so, and `coach_join` below clears the switches when
-- a link is made or remade. A link that ends takes its switches with it.
--
-- `coach_links` still has row-level security and no policies (0007): the switches are read and
-- written only through the functions here, which check who is asking.
--
-- WHAT A COACH CAN READ, AND HOW
--
-- The same way as everything else a coach sees: through SECURITY DEFINER functions that check,
-- on every call, that the caller is this trainee's coach right now — and here also that the
-- switch for what is asked for is on. Switching it off takes the access away on the next call.
--
-- The nutrition targets are not worked out here. The app works them out (from the profile and
-- the latest weight) and sends the four numbers when nutrition is shared, so a coach sees the
-- targets the trainee sees without being sent the weight they came from — weight is the body
-- switch's to share.
--
-- PROGRESS PHOTOS
--
-- A table of the photos' particulars, synced like the rest of the training log, and a private
-- storage bucket `progress-photos` with one folder per account. Its owner can do anything in
-- their own folder; a coach can read — only read — the folder of a trainee who shares photos
-- with them, decided by a function checked on every request. Nobody else can reach a photo by
-- any means: there are no public links.
--
-- Run this once, in the Supabase SQL editor, after 0007-0017. One transaction, safe to run
-- again. Until it is run the app's switches say the server is not ready, and photos stay on
-- the phone.

BEGIN;

--------------------------------------------------------------------- the switches
ALTER TABLE public.coach_links ADD COLUMN IF NOT EXISTS share_body boolean NOT NULL DEFAULT false;
ALTER TABLE public.coach_links ADD COLUMN IF NOT EXISTS share_nutrition boolean NOT NULL DEFAULT false;
ALTER TABLE public.coach_links ADD COLUMN IF NOT EXISTS share_photos boolean NOT NULL DEFAULT false;
-- The app's own daily targets, sent while nutrition is shared: calorieTarget, proteinG,
-- carbsG, fatG, goal. Null whenever nutrition is not shared.
ALTER TABLE public.coach_links ADD COLUMN IF NOT EXISTS shared_targets jsonb;
ALTER TABLE public.coach_links ADD COLUMN IF NOT EXISTS sharing_updated_at timestamptz;

DO $$ BEGIN
  ALTER TABLE public.coach_links
    ADD CONSTRAINT coach_links_targets_check CHECK (
      shared_targets IS NULL
      OR (jsonb_typeof(shared_targets) = 'object' AND octet_length(shared_targets::text) <= 500)
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

---------------------------------------------------- joining clears what was shared
-- As 0007, with one change: a link made or remade starts with nothing shared.
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
    SET coach_id = EXCLUDED.coach_id,
        created_at = now(),
        share_body = false,
        share_nutrition = false,
        share_photos = false,
        shared_targets = NULL,
        sharing_updated_at = NULL;

  RETURN public.coach_status();
END;
$$;

---------------------------------------------------------------------------- status
-- As 0008, with what is shared: the trainee sees their own switches under `coach`, and a
-- coach sees each trainee's under that trainee.
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
    'code', CASE WHEN my_role = 'coach' THEN my_code ELSE NULL END,
    'is_admin', EXISTS (SELECT 1 FROM public.app_admins a WHERE a.user_id = me),
    'coach', (
      SELECT jsonb_build_object(
               'id', l.coach_id,
               'email', u.email,
               'name', p.display_name,
               'since', l.created_at,
               'sharing', jsonb_build_object(
                 'body', l.share_body,
                 'nutrition', l.share_nutrition,
                 'photos', l.share_photos))
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
                 'since', l.created_at,
                 'sharing', jsonb_build_object(
                   'body', l.share_body,
                   'nutrition', l.share_nutrition,
                   'photos', l.share_photos))
               ORDER BY l.created_at)
        FROM public.coach_links l
        JOIN auth.users u ON u.id = l.trainee_id
        LEFT JOIN public.profiles p ON p.id = l.trainee_id
       WHERE l.coach_id = me
    ), '[]'::jsonb)
  );
END;
$$;

----------------------------------------------------------------- setting the switches
-- The trainee's side, and the only way a switch changes. `p_targets` is the app's own daily
-- targets, kept only while nutrition is shared; anything but an object of four numbers in a
-- sane range is refused rather than stored.
CREATE OR REPLACE FUNCTION public.coach_set_sharing(
  p_body boolean,
  p_nutrition boolean,
  p_photos boolean,
  p_targets jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  me uuid := (SELECT auth.uid());
  targets jsonb := NULL;
BEGIN
  IF me IS NULL THEN
    RAISE EXCEPTION 'not_signed_in' USING ERRCODE = '28000';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.coach_links l WHERE l.trainee_id = me) THEN
    RAISE EXCEPTION 'no_coach' USING ERRCODE = 'P0002';
  END IF;

  IF COALESCE(p_nutrition, false) AND p_targets IS NOT NULL AND jsonb_typeof(p_targets) = 'object' THEN
    IF jsonb_typeof(p_targets -> 'calorieTarget') = 'number'
       AND (p_targets ->> 'calorieTarget')::numeric BETWEEN 500 AND 12000
       AND jsonb_typeof(p_targets -> 'proteinG') = 'number'
       AND (p_targets ->> 'proteinG')::numeric BETWEEN 0 AND 600
       AND jsonb_typeof(p_targets -> 'carbsG') = 'number'
       AND (p_targets ->> 'carbsG')::numeric BETWEEN 0 AND 1500
       AND jsonb_typeof(p_targets -> 'fatG') = 'number'
       AND (p_targets ->> 'fatG')::numeric BETWEEN 0 AND 500
    THEN
      targets := jsonb_build_object(
        'calorieTarget', round((p_targets ->> 'calorieTarget')::numeric),
        'proteinG', round((p_targets ->> 'proteinG')::numeric),
        'carbsG', round((p_targets ->> 'carbsG')::numeric),
        'fatG', round((p_targets ->> 'fatG')::numeric),
        'goal', CASE WHEN p_targets ->> 'goal' IN ('cut', 'maintain', 'bulk')
                     THEN p_targets ->> 'goal' END);
    ELSE
      RAISE EXCEPTION 'invalid_targets' USING ERRCODE = '22023';
    END IF;
  END IF;

  UPDATE public.coach_links l
     SET share_body = COALESCE(p_body, false),
         share_nutrition = COALESCE(p_nutrition, false),
         share_photos = COALESCE(p_photos, false),
         shared_targets = targets,
         sharing_updated_at = now()
   WHERE l.trainee_id = me;

  RETURN public.coach_status();
END;
$$;

------------------------------------------------------------------------ the check
-- Raises unless the caller is the trainee's coach right now and the trainee shares `p_what`.
CREATE OR REPLACE FUNCTION public.coach_require_share(p_trainee uuid, p_what text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  link public.coach_links%ROWTYPE;
  shared boolean;
BEGIN
  PERFORM public.coach_require_link(p_trainee);
  SELECT * INTO link FROM public.coach_links l WHERE l.trainee_id = p_trainee;
  -- Worked out first, not inside the IF: PL/pgSQL ends an IF's condition at the first THEN,
  -- and a CASE has several.
  shared := CASE p_what
              WHEN 'body' THEN link.share_body
              WHEN 'nutrition' THEN link.share_nutrition
              WHEN 'photos' THEN link.share_photos
              ELSE false
            END;
  IF NOT COALESCE(shared, false) THEN
    RAISE EXCEPTION 'not_shared' USING ERRCODE = '42501';
  END IF;
END;
$$;

---------------------------------------------------------------------------- body
-- Weigh-ins between two moments, newest first: the readings, not the raw scale payload.
CREATE OR REPLACE FUNCTION public.coach_get_body(p_trainee uuid, p_from timestamptz, p_to timestamptz)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  PERFORM public.coach_require_share(p_trainee, 'body');

  RETURN COALESCE((
    SELECT jsonb_agg(
             jsonb_build_object(
               'measured_at', m.measured_at,
               'weight_kg', m.weight_kg,
               'body_fat_pct', m.body_fat_pct,
               'muscle_mass_kg', m.muscle_mass_kg,
               'water_pct', m.water_pct)
             ORDER BY m.measured_at DESC)
      FROM (
        SELECT b.measured_at, b.weight_kg, b.body_fat_pct, b.muscle_mass_kg, b.water_pct
          FROM public.body_metrics b
         WHERE b.user_id = p_trainee
           AND b.deleted_at IS NULL
           AND b.measured_at >= p_from
           AND b.measured_at < p_to
         ORDER BY b.measured_at DESC
         LIMIT 1000
      ) m
  ), '[]'::jsonb);
END;
$$;

----------------------------------------------------------------------- nutrition
-- The food log and water between two dates, inclusive, at most a year and a few days of it:
-- each day's totals, the entries themselves, and the targets the app last sent.
CREATE OR REPLACE FUNCTION public.coach_get_nutrition(p_trainee uuid, p_from date, p_to date)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  first_day date := GREATEST(p_from, p_to - 370);
BEGIN
  PERFORM public.coach_require_share(p_trainee, 'nutrition');

  RETURN jsonb_build_object(
    'targets', (SELECT l.shared_targets FROM public.coach_links l WHERE l.trainee_id = p_trainee),
    'entries', COALESCE((
      SELECT jsonb_agg(
               jsonb_build_object(
                 'date', to_char(f.eaten_on, 'YYYY-MM-DD'),
                 'name', f.name,
                 'grams', f.grams,
                 'calories', f.calories,
                 'protein_g', f.protein_g,
                 'carbs_g', f.carbs_g,
                 'fat_g', f.fat_g)
               ORDER BY f.eaten_on DESC, f.created_at)
        FROM (
          SELECT e.eaten_on, e.name, e.grams, e.calories, e.protein_g, e.carbs_g, e.fat_g, e.created_at
            FROM public.food_entries e
           WHERE e.user_id = p_trainee
             AND e.deleted_at IS NULL
             AND e.eaten_on BETWEEN first_day AND p_to
           ORDER BY e.eaten_on DESC, e.created_at
           LIMIT 4000
        ) f
    ), '[]'::jsonb),
    'water', COALESCE((
      SELECT jsonb_agg(
               jsonb_build_object('date', to_char(w.day, 'YYYY-MM-DD'), 'ml', w.ml)
               ORDER BY w.day)
        FROM (
          SELECT x.drunk_on AS day, sum(x.ml)::integer AS ml
            FROM public.water_entries x
           WHERE x.user_id = p_trainee
             AND x.deleted_at IS NULL
             AND x.drunk_on BETWEEN first_day AND p_to
           GROUP BY x.drunk_on
        ) w
    ), '[]'::jsonb)
  );
END;
$$;

------------------------------------------------------------------ progress photos
CREATE TABLE IF NOT EXISTS public.progress_photos (
  id          uuid PRIMARY KEY,
  user_id     uuid NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  taken_on    date NOT NULL,
  pose        text,
  note        text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  deleted_at  timestamptz,
  CONSTRAINT progress_photos_pose_check CHECK (pose IS NULL OR pose IN ('front', 'side', 'back')),
  CONSTRAINT progress_photos_note_check CHECK (note IS NULL OR char_length(note) <= 200)
);

CREATE INDEX IF NOT EXISTS progress_photos_user_day_idx
  ON public.progress_photos (user_id, taken_on);
CREATE INDEX IF NOT EXISTS progress_photos_sync_idx
  ON public.progress_photos (user_id, updated_at);

ALTER TABLE public.progress_photos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS progress_photos_own ON public.progress_photos;
CREATE POLICY progress_photos_own ON public.progress_photos
  FOR ALL TO authenticated
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);

REVOKE ALL ON public.progress_photos FROM PUBLIC;
REVOKE ALL ON public.progress_photos FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.progress_photos TO authenticated;

DROP TRIGGER IF EXISTS progress_photos_set_updated_at ON public.progress_photos;
CREATE TRIGGER progress_photos_set_updated_at
  BEFORE INSERT OR UPDATE ON public.progress_photos
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- A trainee's photos, newest first, for a coach they share photos with. The files themselves
-- are read from storage at `<trainee>/<id>.jpg`, under the policy below.
CREATE OR REPLACE FUNCTION public.coach_get_photos(p_trainee uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  PERFORM public.coach_require_share(p_trainee, 'photos');

  RETURN COALESCE((
    SELECT jsonb_agg(
             jsonb_build_object(
               'id', ph.id,
               'taken_on', to_char(ph.taken_on, 'YYYY-MM-DD'),
               'pose', ph.pose,
               'note', ph.note)
             ORDER BY ph.taken_on DESC, ph.created_at DESC)
      FROM (
        SELECT x.id, x.taken_on, x.pose, x.note, x.created_at
          FROM public.progress_photos x
         WHERE x.user_id = p_trainee AND x.deleted_at IS NULL
         ORDER BY x.taken_on DESC, x.created_at DESC
         LIMIT 500
      ) ph
  ), '[]'::jsonb);
END;
$$;

-- Whether the caller may read files in this folder as its owner's coach. For the storage
-- policy, which cannot see `coach_links` itself. Compared as text: a folder name is whatever
-- a client uploaded under, and casting a malformed one to uuid would be an error, not a no.
CREATE OR REPLACE FUNCTION public.coach_sees_photos_of(p_folder text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.coach_links l
     WHERE l.coach_id = (SELECT auth.uid())
       AND l.trainee_id::text = p_folder
       AND l.share_photos
  );
$$;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('progress-photos', 'progress-photos', false, 10485760, ARRAY['image/jpeg', 'image/png', 'image/webp'])
ON CONFLICT (id) DO UPDATE
  SET public = false,
      file_size_limit = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

-- The owner: everything, in their own folder only.
DROP POLICY IF EXISTS progress_photos_own_select ON storage.objects;
CREATE POLICY progress_photos_own_select ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'progress-photos' AND (storage.foldername(name))[1] = (SELECT auth.uid())::text);

DROP POLICY IF EXISTS progress_photos_own_insert ON storage.objects;
CREATE POLICY progress_photos_own_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'progress-photos' AND (storage.foldername(name))[1] = (SELECT auth.uid())::text);

DROP POLICY IF EXISTS progress_photos_own_update ON storage.objects;
CREATE POLICY progress_photos_own_update ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'progress-photos' AND (storage.foldername(name))[1] = (SELECT auth.uid())::text)
  WITH CHECK (bucket_id = 'progress-photos' AND (storage.foldername(name))[1] = (SELECT auth.uid())::text);

DROP POLICY IF EXISTS progress_photos_own_delete ON storage.objects;
CREATE POLICY progress_photos_own_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'progress-photos' AND (storage.foldername(name))[1] = (SELECT auth.uid())::text);

-- The coach: reading, and only while the trainee shares photos with them.
DROP POLICY IF EXISTS progress_photos_coach_select ON storage.objects;
CREATE POLICY progress_photos_coach_select ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'progress-photos' AND public.coach_sees_photos_of((storage.foldername(name))[1]));

------------------------------------------------------------------------- who may call
REVOKE ALL ON FUNCTION public.coach_join(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.coach_join(text) FROM anon;
GRANT EXECUTE ON FUNCTION public.coach_join(text) TO authenticated;

REVOKE ALL ON FUNCTION public.coach_status() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.coach_status() FROM anon;
GRANT EXECUTE ON FUNCTION public.coach_status() TO authenticated;

REVOKE ALL ON FUNCTION public.coach_set_sharing(boolean, boolean, boolean, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.coach_set_sharing(boolean, boolean, boolean, jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.coach_set_sharing(boolean, boolean, boolean, jsonb) TO authenticated;

-- The check is not callable from outside; the functions above reach it as its owner.
REVOKE ALL ON FUNCTION public.coach_require_share(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.coach_require_share(uuid, text) FROM anon;
REVOKE ALL ON FUNCTION public.coach_require_share(uuid, text) FROM authenticated;

REVOKE ALL ON FUNCTION public.coach_get_body(uuid, timestamptz, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.coach_get_body(uuid, timestamptz, timestamptz) FROM anon;
GRANT EXECUTE ON FUNCTION public.coach_get_body(uuid, timestamptz, timestamptz) TO authenticated;

REVOKE ALL ON FUNCTION public.coach_get_nutrition(uuid, date, date) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.coach_get_nutrition(uuid, date, date) FROM anon;
GRANT EXECUTE ON FUNCTION public.coach_get_nutrition(uuid, date, date) TO authenticated;

REVOKE ALL ON FUNCTION public.coach_get_photos(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.coach_get_photos(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.coach_get_photos(uuid) TO authenticated;

-- Storage policies run as the caller, so the caller must be able to run this one; it answers
-- only "may I", never what is in the folder.
REVOKE ALL ON FUNCTION public.coach_sees_photos_of(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.coach_sees_photos_of(text) FROM anon;
GRANT EXECUTE ON FUNCTION public.coach_sees_photos_of(text) TO authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';
