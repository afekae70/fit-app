/**
 * Running a profile sync from the app: the real database, the real server, the real files.
 *
 * Two things ask for one. `SyncProvider` runs it beside every sync of the training data. And
 * `OnboardingGate` runs it once on a phone that has no profile, before deciding whether to ask
 * the setup questions — someone signing in on a new phone has already answered them, and the
 * answers are on the server.
 *
 * Those two can ask at the same moment, on exactly the occasion that matters most: the first
 * seconds after signing in. So a run in progress is shared rather than started twice. Two at
 * once would both read the same "nothing here yet", and both write.
 *
 * It never rejects. The profile is not worth failing a sync of someone's training log for, and
 * the gate that waits on it has to open either way.
 */

import { getSupabaseClient } from '../auth/client.js';
import { getExecutor } from '../db/provider.js';
import { createPhotoPort, reconcileLocalPhoto } from '../profile/avatarCloud.js';
import { announceProfilePulled } from './profileEvents.js';
import { syncProfile, type ProfileSyncResult } from './profileSync.js';
import { createProfileTransport } from './profileTransport.js';

const running = new Map<string, Promise<ProfileSyncResult | null>>();

/** Sync this account's profile now. Null when it could not be done; the log says why. */
export function syncProfileNow(userId: string): Promise<ProfileSyncResult | null> {
  const already = running.get(userId);
  if (already) return already;

  const run = runOnce(userId).finally(() => {
    running.delete(userId);
  });
  running.set(userId, run);
  return run;
}

async function runOnce(userId: string): Promise<ProfileSyncResult | null> {
  const client = getSupabaseClient();
  // The stand-in user of a build with no accounts has no server row to compare with.
  if (!client || userId === 'local') return null;

  try {
    const db = await getExecutor();
    // A picture whose tag and file disagree is put right first, in whichever direction cannot
    // lose it. If that cannot be done the profile's other fields are still worth exchanging.
    await reconcileLocalPhoto(db, userId).catch(() => undefined);

    const result = await syncProfile(
      db,
      createProfileTransport(client),
      userId,
      createPhotoPort(client),
    );

    // Field names, never what they hold: this is a log, and those are someone's height and
    // date of birth.
    console.log(
      `[sync] profile ${result.outcome}: pushed=[${result.pushed.join(',')}]` +
        ` pulled=[${result.pulled.join(',')}] photo=${result.photo}` +
        (result.unsendable.length > 0 ? ` unsendable=[${result.unsendable.join(',')}]` : ''),
    );
    if (result.photo === 'failed') console.warn(`[sync] profile photo: ${result.photoError ?? ''}`);

    if (result.pulled.length > 0) announceProfilePulled();
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // No signal is routine and says nothing; the training sync beside this has reported it.
    if (!/network request failed|failed to fetch|network error|timeout/i.test(message)) {
      const code = (error as { code?: string }).code;
      console.warn('[sync] profile failed:', message, code ? `code=${code}` : '');
    }
    return null;
  }
}
