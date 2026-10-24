-- 0020 — reports of the AI coach's output, from inside the app.
--
-- Google Play's AI-generated content policy: an app in which people get text from a model must
-- let them flag an answer as offensive or harmful without leaving the app, and the developer
-- has to look at what is flagged. Here a flag is one row: what kind of text it was, why it was
-- flagged, and the text itself, so it can be read later in the Supabase dashboard (Table editor →
-- ai_reports). Nothing else about the person is in it beyond whose account sent it.
--
-- A client may add its own reports and nothing more: it cannot read, change or delete one, its
-- own included, and it cannot send one in another account's name. A day's reports per account
-- are capped, so a stuck button cannot fill the table.
--
-- Safe to run more than once. Run it whole, in the Supabase SQL editor.

BEGIN;

CREATE TABLE IF NOT EXISTS public.ai_reports (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL DEFAULT auth.uid() REFERENCES public.profiles (id) ON DELETE CASCADE,
  kind        text NOT NULL,
  reason      text NOT NULL,
  content     text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ai_reports_kind_check CHECK (kind IN ('coach_reply', 'weekly_review', 'daily_brief')),
  CONSTRAINT ai_reports_reason_check CHECK (reason IN ('offensive', 'harmful', 'wrong', 'other')),
  CONSTRAINT ai_reports_content_check CHECK (char_length(content) BETWEEN 1 AND 4000)
);

CREATE INDEX IF NOT EXISTS ai_reports_user_day_idx ON public.ai_reports (user_id, created_at);

ALTER TABLE public.ai_reports ENABLE ROW LEVEL SECURITY;

-- Adding one's own report. No SELECT, UPDATE or DELETE policy: with row-level security on, their
-- absence means no client can do any of them.
DROP POLICY IF EXISTS ai_reports_insert_own ON public.ai_reports;
CREATE POLICY ai_reports_insert_own ON public.ai_reports
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT auth.uid()) = user_id);

REVOKE ALL ON public.ai_reports FROM PUBLIC;
REVOKE ALL ON public.ai_reports FROM anon;
REVOKE ALL ON public.ai_reports FROM authenticated;
GRANT INSERT (kind, reason, content) ON public.ai_reports TO authenticated;

-- At most fifty a day per account.
CREATE OR REPLACE FUNCTION public.ai_reports_daily_cap()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  today_count integer;
BEGIN
  SELECT count(*) INTO today_count
    FROM public.ai_reports r
   WHERE r.user_id = NEW.user_id
     AND r.created_at > now() - interval '1 day';
  IF today_count >= 50 THEN
    RAISE EXCEPTION 'too_many_reports' USING ERRCODE = '54000';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.ai_reports_daily_cap() FROM PUBLIC;

DROP TRIGGER IF EXISTS ai_reports_daily_cap ON public.ai_reports;
CREATE TRIGGER ai_reports_daily_cap
  BEFORE INSERT ON public.ai_reports
  FOR EACH ROW EXECUTE FUNCTION public.ai_reports_daily_cap();

COMMIT;

NOTIFY pgrst, 'reload schema';
