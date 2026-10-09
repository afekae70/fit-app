-- The profile and its picture join the cloud copy — and a hole in who may be a coach is closed.
--
-- Three parts, each its own transaction, so that a later one failing cannot undo an earlier.
--
-- PARTS 1 AND 2 — who may write what on `profiles`
--
-- `profiles` is the one table a signed-in user has always been allowed to write their own row
-- of, and until now that meant *every column* of it. Since 0007 two of those columns are not
-- the user's to decide:
--
--   role        — whether the account is a coach. 0008 made that the owner's decision, through
--                 `admin_set_coach`. But nothing stopped an account from simply updating its
--                 own row to say 'coach': the row-level policy only asks whose row it is, not
--                 which columns are being changed.
--   coach_code  — the code trainees type to join a coach. An account could set its own.
--
-- An account that did so gained a coach's screen and a code to hand out. It did not gain
-- anybody's data — a trainee still has to type that code — but "only the accounts I name are
-- coaches" was not true, and now is.
--
-- It is closed twice over, because it is the kind of thing that should not rest on one check:
--
--   Part 1, a trigger. Whatever a client writes, the two columns keep the value they had. It
--   looks at who is running the statement: a client's own request runs as `authenticated`; the
--   functions that legitimately change the role run with their owner's rights (SECURITY
--   DEFINER) and pass straight through. This cannot fail to take effect.
--
--   Part 2, privileges. A client is granted the columns it has a reason to write and no
--   others, so an attempt is refused outright rather than quietly ignored. This is the cleaner
--   mechanism, and it depends on who originally granted the table — so it ends by asking
--   Postgres whether a client can still write either column, and refuses to commit if the
--   answer is yes. If the editor reports that error, Part 1 is still in force.
--
-- Part 1 also adds `avatar_version`: which profile picture the account has, as a short tag.
-- The picture itself is a file (Part 3); the row only names it, so that a phone can tell
-- whether the picture it holds is the current one.
--
-- PART 3 — somewhere to keep the picture
--
-- A private storage bucket, `avatars`, one folder per account, named by the account's id. A
-- signed-in user may read and write inside their own folder and nowhere else. Nothing in it is
-- public: there is no link to a picture that works without being signed in as its owner.
--
-- The app does not depend on this having been run. Until it is, the app syncs the profile's
-- other fields (they are columns the server has always had), keeps the picture on the phone,
-- and tries again each time. Run this once, in the Supabase SQL editor. Safe to run again.

----------------------------------------------------------------------------------- PART 1
BEGIN;

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS avatar_version text;

-- It becomes part of a file path. Letters, digits, dash and underscore; nothing that could
-- climb out of a folder.
DO $$ BEGIN
  ALTER TABLE public.profiles
    ADD CONSTRAINT profiles_avatar_version_check
    CHECK (avatar_version IS NULL OR avatar_version ~ '^[A-Za-z0-9_-]{1,64}$');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Not SECURITY DEFINER, and that is the point: `current_user` here is whoever the statement is
-- running as. For a request from the app that is `authenticated`. Inside `admin_set_coach` and
-- the other coaching functions it is their owner, and the row is left exactly as they wrote it.
CREATE OR REPLACE FUNCTION public.profiles_keep_role()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF current_user IN ('authenticated', 'anon') THEN
    IF TG_OP = 'INSERT' THEN
      NEW.role := 'trainee';
      NEW.coach_code := NULL;
    ELSE
      NEW.role := OLD.role;
      NEW.coach_code := OLD.coach_code;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profiles_keep_role ON public.profiles;
CREATE TRIGGER profiles_keep_role
  BEFORE INSERT OR UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.profiles_keep_role();

COMMIT;

----------------------------------------------------------------------------------- PART 2
BEGIN;

-- Take away the right to write the table as a whole (which also takes away any per-column
-- rights granted before)...
REVOKE INSERT, UPDATE ON public.profiles FROM PUBLIC;
REVOKE INSERT, UPDATE ON public.profiles FROM anon;
REVOKE INSERT, UPDATE ON public.profiles FROM authenticated;

-- ...and give back exactly the columns a person fills in about themselves. `id` on insert
-- only: the app makes sure its own row exists, and the row-level policy still insists that the
-- id is the caller's own. Not `role`, not `coach_code`, not the timestamps.
GRANT INSERT (id, display_name, birth_date, sex, bmr_formula_sex, height_cm, activity_level,
              goal, unit_preference, locale, avatar_version)
  ON public.profiles TO authenticated;
GRANT UPDATE (display_name, birth_date, sex, bmr_formula_sex, height_cm, activity_level,
              goal, unit_preference, locale, avatar_version)
  ON public.profiles TO authenticated;

-- Ask rather than assume. A grant made by some other role would survive the REVOKEs above, and
-- the only symptom would be that this script appeared to work.
DO $$
DECLARE
  client text;
  col text;
BEGIN
  FOREACH client IN ARRAY ARRAY['authenticated', 'anon'] LOOP
    FOREACH col IN ARRAY ARRAY['role', 'coach_code'] LOOP
      IF has_column_privilege(client::name, 'public.profiles'::text, col, 'UPDATE'::text)
         OR has_column_privilege(client::name, 'public.profiles'::text, col, 'INSERT'::text) THEN
        RAISE EXCEPTION
          'profiles.% can still be written by the % role; part 2 was not applied (part 1 is)', col, client;
      END IF;
    END LOOP;
  END LOOP;

  -- And the other way round: the app must still be able to save a profile.
  IF NOT has_column_privilege('authenticated'::name, 'public.profiles'::text, 'display_name'::text, 'UPDATE'::text)
     OR NOT has_column_privilege('authenticated'::name, 'public.profiles'::text, 'avatar_version'::text, 'UPDATE'::text)
     OR NOT has_column_privilege('authenticated'::name, 'public.profiles'::text, 'id'::text, 'INSERT'::text) THEN
    RAISE EXCEPTION 'the app would no longer be able to save a profile; part 2 was not applied';
  END IF;
END $$;

COMMIT;

----------------------------------------------------------------------------------- PART 3
BEGIN;

-- Private, pictures only, and no larger than the app itself is willing to send.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('avatars', 'avatars', false, 8388608, ARRAY['image/*'])
ON CONFLICT (id) DO UPDATE
  SET public = false,
      file_size_limit = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

-- A file's path is `<account id>/<tag>`, so its first folder says whose it is. Each of the four
-- things that can be done to a file is allowed in the caller's own folder, in this bucket, and
-- that is all. The policies are named for the bucket because `storage.objects` is shared by
-- every bucket the project will ever have.
DROP POLICY IF EXISTS avatars_own_select ON storage.objects;
CREATE POLICY avatars_own_select ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'avatars' AND (storage.foldername(name))[1] = (SELECT auth.uid())::text);

DROP POLICY IF EXISTS avatars_own_insert ON storage.objects;
CREATE POLICY avatars_own_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'avatars' AND (storage.foldername(name))[1] = (SELECT auth.uid())::text);

DROP POLICY IF EXISTS avatars_own_update ON storage.objects;
CREATE POLICY avatars_own_update ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'avatars' AND (storage.foldername(name))[1] = (SELECT auth.uid())::text)
  WITH CHECK (bucket_id = 'avatars' AND (storage.foldername(name))[1] = (SELECT auth.uid())::text);

DROP POLICY IF EXISTS avatars_own_delete ON storage.objects;
CREATE POLICY avatars_own_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'avatars' AND (storage.foldername(name))[1] = (SELECT auth.uid())::text);

COMMIT;
