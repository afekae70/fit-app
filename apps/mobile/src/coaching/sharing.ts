/**
 * What a trainee shares with their coach beyond their training — the app's half.
 *
 * The switches live on the server, on the link to the coach (0018); the screen turns them on
 * and off through `coach_set_sharing`. One thing only the phone can supply: the daily targets.
 * They are worked out here, from the profile and the latest weigh-in, exactly as the nutrition
 * screen works them out, and sent as four numbers — so the coach sees the targets the trainee
 * sees without being sent the weight they came from, which is the body switch's to share.
 *
 * Targets move when the weight or the profile does, so after each sync they are worked out
 * again and sent if they changed — and only then, and only while nutrition is shared.
 */

import { createCoachingApi, type SharedTargets } from '@fit/shared/coaching';

import { getSupabaseClient } from '../auth/client.js';
import type { SqlExecutor } from '../db/executor.js';
import { computeTargets, getLatestWeight, getProfile } from '../db/metrics.js';
import { getExecutor } from '../db/provider.js';

/** The app's own daily targets, in the shape the server keeps; null while they cannot be worked out. */
export async function currentTargets(db: SqlExecutor, userId: string): Promise<SharedTargets | null> {
  const [profile, latest] = await Promise.all([getProfile(db, userId), getLatestWeight(db, userId)]);
  const computed = computeTargets(profile, latest?.weight_kg ?? null);
  if (!computed.ok) return null;
  const { calorieTarget, proteinG, carbsG, fatG, goal } = computed.targets;
  return { calorieTarget, proteinG, carbsG, fatG, goal };
}

/** What was last offered to the server, so an unchanged figure is not sent again. */
let lastOffered: string | null = null;

/**
 * Send the targets again if they have changed and nutrition is shared. Never throws: this runs
 * after a sync, whose result stands whatever becomes of it.
 */
export async function shareTargetsIfChanged(userId: string): Promise<void> {
  try {
    const client = getSupabaseClient();
    if (!client || userId === 'local') return;
    const targets = await currentTargets(await getExecutor(), userId);
    const key = `${userId}:${JSON.stringify(targets)}`;
    if (key === lastOffered) return;

    const api = createCoachingApi({ rpc: (fn, args) => client.rpc(fn, args) });
    const status = await api.status();
    if (!status.ok) return;
    const sharing = status.value.coach?.sharing;
    // Nothing to send: no coach, or nutrition not shared. Remembered all the same, so the
    // question is not asked again until the targets themselves change.
    if (!sharing?.nutrition) {
      lastOffered = key;
      return;
    }
    const sent = await api.setSharing(sharing, targets);
    if (sent.ok) lastOffered = key;
  } catch (error) {
    console.warn('[coaching] could not send the targets:', error instanceof Error ? error.message : error);
  }
}

/** Forget what was sent — after the switches change on the screen, which sends them itself. */
export function targetsSentNow(userId: string, targets: SharedTargets | null): void {
  lastOffered = `${userId}:${JSON.stringify(targets)}`;
}
