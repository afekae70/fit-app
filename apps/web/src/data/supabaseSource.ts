/**
 * The real server: the coach functions, called as the signed-in coach.
 *
 * A thin layer over the app's own coaching client (`@fit/shared/coaching`), so the dashboard
 * reads exactly what the app's coach screens read, refused in exactly the same cases.
 */

import { createCoachingApi } from '@fit/shared/coaching';
import type { SupabaseClient } from '@supabase/supabase-js';

import { sessionsBetween, type CoachData } from './source.js';

export function supabaseSource(supabase: SupabaseClient): CoachData {
  const api = createCoachingApi({
    rpc: (fn, args) => supabase.rpc(fn, args),
  });

  return {
    mode: 'live',
    status: api.status,
    sessions: (traineeId, from, to) =>
      sessionsBetween((start, end) => api.sessions(traineeId, start, end), from, to),
    schedule: api.schedule,
    plans: api.plans,
    setSchedule: api.setSchedule,
    savePlan: api.savePlan,
    saveDay: api.saveDay,
    deletePlan: api.deletePlan,
    deleteDay: api.deleteDay,
    removeTrainee: api.removeTrainee,
    coaches: api.coaches,
    setCoach: api.setCoach,
  };
}
