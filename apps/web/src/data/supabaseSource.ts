/**
 * The real server: the coach functions, called as the signed-in coach.
 *
 * A thin layer over the app's own coaching client (`@fit/shared/coaching`), so the dashboard
 * reads exactly what the app's coach screens read, refused in exactly the same cases.
 */

import { createCoachingApi, PHOTO_BUCKET, photoObjectPath } from '@fit/shared/coaching';
import type { SupabaseClient } from '@supabase/supabase-js';

import { sessionsBetween, type CoachData } from './source.js';

/**
 * How long a link to a photo works. A signed link is a key: whoever has it can open that one
 * picture until it runs out, so it runs out soon. The photos tab asks for fresh ones before then.
 */
const LINK_SECONDS = 10 * 60;

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
    body: (traineeId, from, to) => api.body(traineeId, from.toISOString(), to.toISOString()),
    nutrition: api.nutrition,
    photos: api.photos,
    async photoUrls(traineeId, photoIds) {
      if (photoIds.length === 0) return {};
      // Signed as the coach: storage lets them read the folder only while photos are shared.
      const { data, error } = await supabase.storage
        .from(PHOTO_BUCKET)
        .createSignedUrls(
          photoIds.map((id) => photoObjectPath(traineeId, id)),
          LINK_SECONDS,
        );
      if (error) return {};
      // Matched by path, not by position: a missing picture comes back as an error in its place.
      const byPath = new Map(
        data.flatMap((signed) =>
          signed.path && signed.signedUrl && !signed.error ? [[signed.path, signed.signedUrl]] : [],
        ),
      );
      const urls: Record<string, string> = {};
      for (const id of photoIds) {
        const url = byPath.get(photoObjectPath(traineeId, id));
        if (url) urls[id] = url;
      }
      return urls;
    },
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
