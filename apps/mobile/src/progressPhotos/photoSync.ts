/**
 * Progress photos' pictures, to the server and away from it.
 *
 * The rows sync with everything else; this moves the files, after each sync. A private bucket,
 * `progress-photos`, one folder per account (0018): the owner can read and write their own
 * folder, and a coach can read it only while the trainee has photos shared with them. There is
 * no public link to any of it — a picture is shown through a link signed for an hour.
 *
 * It decides nothing (that is `db/progressPhotos.ts`, which the tests reach) and never throws:
 * it runs after a sync whose result stands whatever becomes of the pictures. A picture that
 * did not go is still queued and goes next time.
 */

import { PHOTO_BUCKET, photoObjectPath } from '@fit/shared/coaching';
import type { SupabaseClient } from '@supabase/supabase-js';
import { File } from 'expo-file-system';

import { getSupabaseClient } from '../auth/client.js';
import {
  forgetPhotoFile,
  markPhotoCleaned,
  markPhotoUploaded,
  photosToClean,
  photosToUpload,
} from '../db/progressPhotos.js';
import { getExecutor } from '../db/provider.js';
import { deletePhotoFile, MAX_PROGRESS_PHOTO_BYTES } from './files.js';

let running: Promise<void> | null = null;

/** Send what has not been sent, and remove what was deleted. One run at a time. */
export function syncProgressPhotosNow(userId: string): Promise<void> {
  running ??= movePictures(userId).finally(() => {
    running = null;
  });
  return running;
}

async function movePictures(userId: string): Promise<void> {
  try {
    const client = getSupabaseClient();
    if (!client || userId === 'local') return;
    const db = await getExecutor();
    const bucket = client.storage.from(PHOTO_BUCKET);

    // Removals first: a picture deleted on purpose should not linger on the server any longer
    // than it has to.
    for (const photo of await photosToClean(db, userId)) {
      if (photo.inBucket) {
        const { error } = await bucket.remove([photoObjectPath(userId, photo.id)]);
        // Offline, or the bucket not made yet: the rest would fail the same way.
        if (error) break;
      }
      if (photo.fileUri) deletePhotoFile(photo.fileUri);
      await markPhotoCleaned(db, photo.id);
    }

    for (const photo of await photosToUpload(db, userId)) {
      const file = new File(photo.fileUri);
      if (!file.exists) {
        // Not on this phone any more — cleared by something outside the app. There is nothing
        // to send, and asking again on every sync would not bring it back.
        await forgetPhotoFile(db, photo.id);
        continue;
      }
      if (file.size > MAX_PROGRESS_PHOTO_BYTES) continue;
      const bytes = await file.bytes();
      // Exactly the picture's bytes: a typed array may be a window onto a larger buffer.
      const body = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
      const { error } = await bucket.upload(photoObjectPath(userId, photo.id), body, {
        contentType: 'image/jpeg',
        // One that arrived and whose answer did not is sent again under the same name.
        upsert: true,
      });
      if (error) break;
      await markPhotoUploaded(db, photo.id);
    }
  } catch (error) {
    console.warn(
      '[photos] could not move the pictures:',
      error instanceof Error ? error.message : error,
    );
  }
}

/* ------------------------------------------------- showing one from the server */

/** How long a link to a picture is good for. Long enough for a screen to be looked at. */
const LINK_SECONDS = 60 * 60;

const links = new Map<string, { url: string; until: number }>();

/**
 * A link to a picture that is on the server and not on this phone — one taken on another
 * phone. Null when there is none to be had: offline, signed out, or not sent yet.
 */
export async function remotePhotoUrl(userId: string, photoId: string): Promise<string | null> {
  const key = photoObjectPath(userId, photoId);
  const known = links.get(key);
  // A little before it runs out, so a link is never handed over with seconds left on it.
  if (known && known.until > Date.now() + 60_000) return known.url;
  const client = getSupabaseClient();
  if (!client || userId === 'local') return null;
  try {
    const { data, error } = await client.storage
      .from(PHOTO_BUCKET)
      .createSignedUrl(key, LINK_SECONDS);
    if (error || !data?.signedUrl) return null;
    links.set(key, { url: data.signedUrl, until: Date.now() + LINK_SECONDS * 1000 });
    return data.signedUrl;
  } catch {
    return null;
  }
}

/* -------------------------------------------------------- deleting an account */

/**
 * Remove every progress picture the account has on the server — before the account is deleted,
 * for the reason given in `avatarCloud.ts`: afterwards there is no session left to do it with.
 */
export async function removeCloudProgressPhotos(
  client: SupabaseClient,
  userId: string,
): Promise<void> {
  const bucket = client.storage.from(PHOTO_BUCKET);
  // A hundred at a time. Each removal shortens the listing, so the next hundred are always the
  // first page; bounded, so that a removal that silently does nothing cannot loop forever.
  for (let page = 0; page < 100; page++) {
    const { data, error } = await bucket.list(userId, { limit: 100 });
    if (error) throw new Error(error.message);
    const paths = (data ?? []).map((entry) => `${userId}/${entry.name}`);
    if (paths.length === 0) return;
    const removal = await bucket.remove(paths);
    if (removal.error) throw new Error(removal.error.message);
    if (paths.length < 100) return;
  }
}
