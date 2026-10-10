-- A coach can see the workouts a trainee has done.
--
-- Until now a coach could say what a trainee should do — build their plans (0007), fill their
-- calendar (0009) — and had no way to learn whether any of it happened. This adds the one
-- thing that closes that loop: a function a coach calls to read a trainee's finished workouts.
--
-- WHAT A COACH SEES, AND WHAT STAYS PRIVATE
--
-- Of a finished workout: its name, when it started and ended, which planned workout it was
-- started from, the effort the trainee rated it, and for each exercise the sets that were
-- actually done — weight, reps, time, distance, effort, and whether a set was a warm-up, a drop
-- set or taken to failure.
--
-- Not the body weight recorded with a workout, and not the notes written on it or on an
-- exercise. Weight is a measurement, and the app tells trainees a coach does not see those. A
-- note is something a person writes to themselves; if coach and trainee are to exchange
-- remarks, that is its own feature, built to be read by two people.
--
-- Nothing here widens what a coach can *change*. This is one read-only function.
--
-- WHO MAY CALL IT
--
-- The same rule as every other coach function: `coach_require_link` first, which refuses
-- anyone who is not, at this moment, the coach this trainee connected to. A trainee who leaves
-- their coach takes this away in the same instant.
--
-- It returns at most sixty workouts for one call, newest first, within the dates asked for —
-- enough for the two months the app shows, and a ceiling on what any one request can pull.
--
-- Needs 0010 (it reads the superset and drop-set columns that added). Run this once, in the
-- Supabase SQL editor. It is one transaction and safe to run again.

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
        SELECT ws.id, ws.name, ws.plan_day_id, ws.started_at, ws.ended_at, ws.session_rpe
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
