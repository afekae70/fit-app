/**
 * The coaching calls, bound to the signed-in session.
 *
 * Null on a build with no Supabase project: there is nobody to coach and nothing to ask, and
 * the screens that use this say so rather than each working that out for itself.
 */

import { useMemo } from 'react';

import { getSupabaseClient } from '../auth/client.js';
import { createCoachingApi, type CoachingApi, type CoachingError } from './api.js';

export function useCoachingApi(): CoachingApi | null {
  return useMemo(() => {
    const client = getSupabaseClient();
    if (!client) return null;
    // Wrapped rather than passed: `rpc` reads `this`, and the client's generics describe a
    // schema this app has never generated types for.
    return createCoachingApi({ rpc: (fn, args) => client.rpc(fn, args) });
  }, []);
}

/** The string that explains a refusal. One per meaning, so each can say what to do about it. */
export function coachingErrorKey(error: CoachingError): string {
  return `coaching.error.${error}`;
}
