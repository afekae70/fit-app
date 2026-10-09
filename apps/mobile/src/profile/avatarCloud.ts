/**
 * The profile picture's journey to the server and back.
 *
 * Profile sync decides *whether* a picture has to move and in which direction (see
 * `sync/profileSync.ts`); this is the part that moves it. It is everything the tests cannot
 * reach — files, the network, Supabase Storage — so it decides nothing and only does as asked.
 *
 * ## Where it goes
 *
 * A private bucket, `avatars`, with one folder per account (0011). The server lets a signed-in
 * user read and write inside the folder named after their own id and nowhere else, so a
 * picture is visible to its owner and to nobody with merely a valid login. There is no public
 * link to it: it is fetched through a link signed for a minute, by the account that owns it.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { File } from 'expo-file-system';

import { getProfile, setAvatarVersion } from '../db/metrics.js';
import type { SqlExecutor } from '../db/executor.js';
import { forgetMissingPhoto, type PhotoPort } from '../sync/profileSync.js';
import { adoptDownloadedAvatar, deleteLocalAvatar, loadAvatar } from './avatar.js';
import { avatarObjectPath, newAvatarVersion } from './avatarNames.js';

const BUCKET = 'avatars';

/**
 * The largest picture that is sent. The bucket has the same limit; checking here as well means
 * an oversized one costs nothing, rather than an upload of several megabytes that is refused
 * at the far end and attempted again on every sync.
 */
export const MAX_PHOTO_BYTES = 8 * 1024 * 1024;

/** How long a download link is good for. Long enough to start one download, and no longer. */
const LINK_SECONDS = 60;

export function createPhotoPort(client: SupabaseClient): PhotoPort {
  const bucket = () => client.storage.from(BUCKET);

  return {
    async upload(userId, version) {
      const uri = await loadAvatar(userId);
      if (!uri) throw new Error('there is no picture on this phone to send');
      const file = new File(uri);
      if (file.size > MAX_PHOTO_BYTES) {
        throw new Error(
          `the picture is ${file.size} bytes, over the ${MAX_PHOTO_BYTES} that is sent`,
        );
      }
      const bytes = await file.bytes();
      // Exactly the picture's bytes: a typed array may be a window onto a larger buffer.
      const body = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
      const { error } = await bucket().upload(avatarObjectPath(userId, version), body, {
        // The picker saves its crop as a JPEG, and the app names it so.
        contentType: 'image/jpeg',
        // An upload that got there and whose answer did not is sent again under the same tag.
        upsert: true,
      });
      if (error) throw new Error(error.message);
    },

    async download(userId, version) {
      const { data, error } = await bucket().createSignedUrl(
        avatarObjectPath(userId, version),
        LINK_SECONDS,
      );
      if (error || !data?.signedUrl) throw new Error(error?.message ?? 'no link was given');
      await adoptDownloadedAvatar(userId, data.signedUrl);
    },

    async removeRemote(userId, version) {
      const { error } = await bucket().remove([avatarObjectPath(userId, version)]);
      if (error) throw new Error(error.message);
    },

    async removeLocal(userId) {
      await deleteLocalAvatar(userId);
    },
  };
}

/**
 * Make the profile's tag say what is actually on this phone, before the two sides compare.
 *
 * Two ways they can disagree, and each is settled in the direction that cannot lose a picture:
 *
 *  - A picture and no tag. That is every phone that chose its picture before pictures synced.
 *    It is given a tag, which sync then reads as a picture the server has not seen.
 *  - A tag and no picture. Not the user removing it — that clears the tag itself. A file that
 *    should be here is not, so the tag is forgotten along with any agreement about it, and the
 *    server's copy is fetched again rather than deleted to match.
 */
export async function reconcileLocalPhoto(db: SqlExecutor, userId: string): Promise<void> {
  const [uri, profile] = await Promise.all([loadAvatar(userId), getProfile(db, userId)]);
  const tagged = profile?.avatar_version ?? null;
  if (uri && !tagged) await setAvatarVersion(db, userId, newAvatarVersion(Date.now()));
  else if (!uri && tagged) await forgetMissingPhoto(db, userId);
}

/**
 * Delete every picture the account has on the server.
 *
 * For account deletion, and it has to come *before* the account is deleted: afterwards there is
 * no session left to ask with, and deleting the account does not reach into file storage. The
 * whole folder rather than the one picture the profile names, so that a leftover from a
 * replaced picture goes too.
 */
export async function removeCloudAvatars(client: SupabaseClient, userId: string): Promise<void> {
  const bucket = client.storage.from(BUCKET);
  const { data, error } = await bucket.list(userId, { limit: 100 });
  if (error) throw new Error(error.message);
  const paths = (data ?? []).map((entry) => `${userId}/${entry.name}`);
  if (paths.length === 0) return;
  const removal = await bucket.remove(paths);
  if (removal.error) throw new Error(removal.error.message);
}

/**
 * The pictures were deleted from the server and the account was not — the deletion that was
 * meant to follow failed. The picture on this phone is given a new tag, so the next sync sees
 * one the server does not have and sends it back, instead of trusting a row that still names a
 * file that is no longer there.
 */
export async function resendAvatarLater(db: SqlExecutor, userId: string): Promise<void> {
  if (await loadAvatar(userId)) await setAvatarVersion(db, userId, newAvatarVersion(Date.now()));
}
