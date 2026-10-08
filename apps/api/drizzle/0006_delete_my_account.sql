-- Let a signed-in user delete their own account.
--
-- Google Play requires it of any app that lets people create an account, and it is the right
-- thing to offer regardless: somebody who made an account should be able to unmake it without
-- writing to anyone.
--
-- Deleting the row in auth.users is the whole of it. Every table of user data hangs off
-- `profiles` with ON DELETE CASCADE, and `profiles.id` hangs off `auth.users.id` the same way
-- (0001_platform_objects.sql) — so one delete takes the profile, the plans, the sessions and
-- their sets, the weigh-ins, the gyms and the coach conversations with it, and Supabase's own
-- sessions and refresh tokens besides. The foreign keys that are NO ACTION rather than CASCADE
-- (a set's exercise, an exercise's equipment) do not get in the way: NO ACTION is checked at the
-- end of the statement, by which time the rows on both ends are gone together.
--
-- SECURITY DEFINER, because an ordinary user cannot touch auth.users — and that is exactly why
-- the function takes no argument. It deletes `auth.uid()`, the caller, and has no way to be
-- asked about anyone else. The alternative is the service-role key doing it from a server, which
-- is a key that can delete everybody.
--
-- `search_path = ''` and fully-qualified names throughout: a SECURITY DEFINER function that
-- resolves names through the caller's search path can be handed a different `auth` to delete from.
--
-- Run this once, in the Supabase SQL editor. It is safe to run again.

CREATE OR REPLACE FUNCTION public.delete_my_account()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  caller uuid := (SELECT auth.uid());
BEGIN
  IF caller IS NULL THEN
    RAISE EXCEPTION 'Not signed in' USING ERRCODE = '28000';
  END IF;

  DELETE FROM auth.users WHERE id = caller;
END;
$$;
--> statement-breakpoint

-- Functions are executable by everyone unless told otherwise. This one is for signed-in users
-- and nobody else — not the anonymous key that ships inside the app.
REVOKE ALL ON FUNCTION public.delete_my_account() FROM PUBLIC;
--> statement-breakpoint

REVOKE ALL ON FUNCTION public.delete_my_account() FROM anon;
--> statement-breakpoint

GRANT EXECUTE ON FUNCTION public.delete_my_account() TO authenticated;
