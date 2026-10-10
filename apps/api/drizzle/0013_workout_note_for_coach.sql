-- A coach can read the note a trainee writes on a workout.
--
-- 0012 let a coach see what a trainee did and deliberately left out notes: at the time a note
-- was something nothing in the app could even write, and "a coach reads your notes" was not a
-- thing anyone had been told. The app now has a place to write one on a finished workout, and
-- that place says who will read it — because this is the only way a trainee has of telling the
-- person who planned the workout that the left shoulder hurt on the last set.
--
-- So `coach_get_sessions` is replaced with a version that also sends the workout's own note.
-- One field. Everything else about the function is as 0012 left it: the link is checked first,
-- it only reads, only finished workouts and only sets that were done, at most sixty a call.
--
-- STILL NOT SENT
--
-- The body weight recorded with a workout — a measurement, and the app tells trainees a coach
-- does not see those. And the notes on an exercise inside a workout (`session_exercises.notes`),
-- which nothing writes: if that ever gains a use, whether a coach should read it is a decision
-- to make then, not a thing to have already switched on.
--
-- In the other direction nothing is needed here: a coach's instruction on an exercise travels
-- in `plan_day_exercises.notes`, which `coach_save_day` has written since 0007.
--
-- Run this once, in the Supabase SQL editor. It is one transaction and safe to run again.

BEGIN;

CREATE OR REPLACE FUNCTION public.coach_get_sessions(
  p_trainee uuid,
  p_from timestamptz,
  p_to timestamptz
)
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
               'id', s.id,
               'name', s.name,
               'plan_day_id', s.plan_day_id,
               'started_at', s.started_at,
               'ended_at', s.ended_at,
               'rpe', s.session_rpe,
               'note', s.session_note,
               'exercises', COALESCE((
                 SELECT jsonb_agg(
                          jsonb_build_object(
                            'key', e.exercise_key,
                            'superset_with_next', e.superset_with_next,
                            'sets', COALESCE((
                              SELECT jsonb_agg(
                                       jsonb_build_object(
                                         'weight_kg', st.weight_kg,
                                         'reps', st.reps,
                                         'duration_seconds', st.duration_seconds,
                                         'distance_m', st.distance_m,
                                         'rpe', st.rpe,
                                         'is_warmup', st.is_warmup,
                                         'is_drop', st.is_drop,
                                         'to_failure', st.to_failure)
                                       ORDER BY st.set_index)
                                FROM public.sets st
                               WHERE st.session_exercise_id = e.id
                                 AND st.deleted_at IS NULL
                                 -- Ticked off, not merely typed in: the same line the
                                 -- trainee's own history draws.
                                 AND st.done_at IS NOT NULL
                            ), '[]'::jsonb))
                          ORDER BY e.order_index)
                   FROM public.session_exercises e
                  WHERE e.session_id = s.id
                    AND e.deleted_at IS NULL
               ), '[]'::jsonb))
             ORDER BY s.started_at DESC)
      FROM (
        -- Named one by one, and the note under a name of its own, so that what leaves this
        -- table is exactly what is listed here and a later column cannot ride along.
        SELECT ws.id, ws.name, ws.plan_day_id, ws.started_at, ws.ended_at, ws.session_rpe,
               ws.notes AS session_note
          FROM public.workout_sessions ws
         WHERE ws.user_id = p_trainee
           AND ws.deleted_at IS NULL
           -- Finished. One still open is a workout in progress, or one that was abandoned.
           AND ws.ended_at IS NOT NULL
           AND ws.started_at >= p_from
           AND ws.started_at < p_to
         ORDER BY ws.started_at DESC
         LIMIT 60
      ) s
  ), '[]'::jsonb);
END;
$$;

REVOKE ALL ON FUNCTION public.coach_get_sessions(uuid, timestamptz, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.coach_get_sessions(uuid, timestamptz, timestamptz) FROM anon;
GRANT EXECUTE ON FUNCTION public.coach_get_sessions(uuid, timestamptz, timestamptz) TO authenticated;

COMMIT;
