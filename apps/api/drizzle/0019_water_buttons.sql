-- 0019 — each person's two water buttons, kept on their profile so every phone has them.
--
-- The app's quick-add water buttons start at 250 and 500 ml and can be set to anything from 10
-- to 5000. Until this file, the setting lived on one phone. Two columns on the profile carry it
-- to the account's other phones through the profile sync, which compares field by field
-- (apps/mobile/src/sync/profileSync.ts), so a button changed on one phone and the other button
-- changed on another both survive.
--
-- NULL is "never set", which the app shows as the defaults.
--
-- Safe to run more than once. Run it whole, in the Supabase SQL editor.

BEGIN;

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS water_button_1_ml integer;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS water_button_2_ml integer;

-- The app's own bounds, restated: anything outside would be refused here before it is stored.
DO $$ BEGIN
  ALTER TABLE public.profiles
    ADD CONSTRAINT profiles_water_buttons_check CHECK (
      (water_button_1_ml IS NULL OR water_button_1_ml BETWEEN 10 AND 5000)
      AND (water_button_2_ml IS NULL OR water_button_2_ml BETWEEN 10 AND 5000)
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Since 0011 a client may write only the profile columns it is granted by name. These two are a
-- person's own choice, like their goal or their units, so they are added to that list.
GRANT INSERT (water_button_1_ml, water_button_2_ml) ON public.profiles TO authenticated;
GRANT UPDATE (water_button_1_ml, water_button_2_ml) ON public.profiles TO authenticated;

-- Ask rather than assume, as 0011 does: the new columns are writable, and the two that decide
-- who is a coach are still not.
DO $$
DECLARE
  client text;
  col text;
BEGIN
  FOREACH client IN ARRAY ARRAY['authenticated', 'anon'] LOOP
    FOREACH col IN ARRAY ARRAY['role', 'coach_code'] LOOP
      IF has_column_privilege(client::name, 'public.profiles'::text, col, 'UPDATE'::text)
         OR has_column_privilege(client::name, 'public.profiles'::text, col, 'INSERT'::text) THEN
        RAISE EXCEPTION 'profiles.% can be written by the % role; nothing was changed', col, client;
      END IF;
    END LOOP;
  END LOOP;

  IF NOT has_column_privilege('authenticated'::name, 'public.profiles'::text, 'water_button_1_ml'::text, 'UPDATE'::text)
     OR NOT has_column_privilege('authenticated'::name, 'public.profiles'::text, 'water_button_2_ml'::text, 'UPDATE'::text) THEN
    RAISE EXCEPTION 'the app would not be able to save its water buttons; nothing was changed';
  END IF;
END $$;

COMMIT;

NOTIFY pgrst, 'reload schema';
