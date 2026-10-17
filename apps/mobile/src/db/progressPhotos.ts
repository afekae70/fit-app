/**
 * Progress photos: a picture of the body on a day, to set beside one from months before.
 *
 * Two parts that travel separately. The particulars — the day, the pose, a note — are a row
 * here that syncs like the rest of the log. The picture is a file on this phone, sent on its own
 * to a private bucket on the server (`progressPhotos/photoSync.ts`); a phone that pulls the row
 * without the file fetches the picture from there when it is shown.
 *
 * Two columns say where the picture is, and only to this phone — sync neither sends nor
 * overwrites them:
 *
 *  - `file_uri`: the picture on this phone, or NULL for a row from another phone.
 *  - `uploaded_at`: on a live row, when the picture reached the bucket from here. On a deleted
 *    row it means the bucket may still hold the picture and it is to be removed: a deletion
 *    always sets it, because the phone deleting a photo need not be the one that sent it.
 *
 * Neither column is part of what syncs, so setting them does not touch `updated_at`.
 */

import type { PhotoPose } from '@fit/shared/coaching';

import type { SqlExecutor } from './executor.js';
import type { Clock } from './workouts.js';

const defaultClock: Clock = () => new Date().toISOString();

/** The server's bound on a note (0018). */
export const MAX_PHOTO_NOTE = 200;

export const PHOTO_POSES: readonly PhotoPose[] = ['front', 'side', 'back'];

export interface ProgressPhoto {
  id: string;
  takenOn: string;
  pose: PhotoPose | null;
  note: string | null;
  /** The picture on this phone; null when it is only on the server. */
  fileUri: string | null;
}

interface PhotoRow {
  id: string;
  taken_on: string;
  pose: string | null;
  note: string | null;
  file_uri: string | null;
}

const isDay = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value);
const isPose = (value: unknown): value is PhotoPose =>
  typeof value === 'string' && (PHOTO_POSES as readonly string[]).includes(value);

/** The server's id column is a uuid; a row with any other id would be refused there forever. */
const isUuid = (value: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

function toPhoto(row: PhotoRow): ProgressPhoto {
  return {
    id: row.id,
    takenOn: row.taken_on,
    pose: isPose(row.pose) ? row.pose : null,
    note: row.note,
    fileUri: row.file_uri,
  };
}

/**
 * Record a photo whose picture is already saved at `fileUri`. The id is given rather than made
 * here, because the file is named after it and has to exist first. Resolves to whether it was
 * recorded: false for a day, pose or id the server would refuse.
 */
export async function addProgressPhoto(
  db: SqlExecutor,
  userId: string,
  input: { id: string; takenOn: string; pose: PhotoPose | null; note: string; fileUri: string },
  clock: Clock = defaultClock,
): Promise<boolean> {
  if (!isUuid(input.id) || !isDay(input.takenOn)) return false;
  if (input.pose !== null && !isPose(input.pose)) return false;
  const note = input.note.trim().slice(0, MAX_PHOTO_NOTE);
  const now = clock();
  await db.run(
    `INSERT INTO progress_photos (id, user_id, taken_on, pose, note, created_at, updated_at, file_uri)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      input.id,
      userId,
      input.takenOn,
      input.pose,
      note === '' ? null : note,
      now,
      now,
      input.fileUri,
    ],
  );
  return true;
}

/** Every photo kept, newest day first. */
export async function listProgressPhotos(
  db: SqlExecutor,
  userId: string,
): Promise<ProgressPhoto[]> {
  const rows = await db.all<PhotoRow>(
    `SELECT id, taken_on, pose, note, file_uri FROM progress_photos
      WHERE user_id = ? AND deleted_at IS NULL
      ORDER BY taken_on DESC, created_at DESC, id DESC`,
    [userId],
  );
  return rows.map(toPhoto);
}

/**
 * Delete a photo. Marked deleted rather than removed, so the deletion reaches the server and the
 * other phones; the files go afterwards, in `photoSync.ts`. Resolves to whether there was one.
 */
export async function deleteProgressPhoto(
  db: SqlExecutor,
  userId: string,
  id: string,
  clock: Clock = defaultClock,
): Promise<boolean> {
  const found = await db.get<{ id: string }>(
    `SELECT id FROM progress_photos WHERE id = ? AND user_id = ? AND deleted_at IS NULL`,
    [id, userId],
  );
  if (!found) return false;
  const now = clock();
  await db.run(
    `UPDATE progress_photos
        SET deleted_at = ?, updated_at = ?, uploaded_at = COALESCE(uploaded_at, ?)
      WHERE id = ?`,
    [now, now, now, id],
  );
  return true;
}

/** Pictures on this phone that the bucket does not have yet. */
export async function photosToUpload(
  db: SqlExecutor,
  userId: string,
): Promise<{ id: string; fileUri: string }[]> {
  const rows = await db.all<{ id: string; file_uri: string }>(
    `SELECT id, file_uri FROM progress_photos
      WHERE user_id = ? AND deleted_at IS NULL AND file_uri IS NOT NULL AND uploaded_at IS NULL
      ORDER BY created_at, id`,
    [userId],
  );
  return rows.map((row) => ({ id: row.id, fileUri: row.file_uri }));
}

export async function markPhotoUploaded(
  db: SqlExecutor,
  id: string,
  clock: Clock = defaultClock,
): Promise<void> {
  await db.run(`UPDATE progress_photos SET uploaded_at = ? WHERE id = ?`, [clock(), id]);
}

/**
 * Deleted photos whose picture may still be somewhere: on this phone, in the bucket, or both.
 * That includes a deletion pulled from another phone, of a photo this one took.
 */
export async function photosToClean(
  db: SqlExecutor,
  userId: string,
): Promise<{ id: string; fileUri: string | null; inBucket: boolean }[]> {
  const rows = await db.all<{ id: string; file_uri: string | null; uploaded_at: string | null }>(
    `SELECT id, file_uri, uploaded_at FROM progress_photos
      WHERE user_id = ? AND deleted_at IS NOT NULL
        AND (file_uri IS NOT NULL OR uploaded_at IS NOT NULL)`,
    [userId],
  );
  return rows.map((row) => ({
    id: row.id,
    fileUri: row.file_uri,
    inBucket: row.uploaded_at !== null,
  }));
}

/** A deleted photo's picture is gone from everywhere: nothing more to do for it. */
export async function markPhotoCleaned(db: SqlExecutor, id: string): Promise<void> {
  await db.run(
    `UPDATE progress_photos SET file_uri = NULL, uploaded_at = NULL
      WHERE id = ? AND deleted_at IS NOT NULL`,
    [id],
  );
}

/**
 * The picture on this phone is gone — deleted along with its photo, or missing from where it
 * was kept. Whether the bucket still has it is left as it was.
 */
export async function forgetPhotoFile(db: SqlExecutor, id: string): Promise<void> {
  await db.run(`UPDATE progress_photos SET file_uri = NULL WHERE id = ?`, [id]);
}

/**
 * Every picture was taken off the server and the account then was not deleted. The pictures
 * still on this phone are queued to be sent again.
 */
export async function resendAllPhotos(db: SqlExecutor, userId: string): Promise<void> {
  await db.run(
    `UPDATE progress_photos SET uploaded_at = NULL
      WHERE user_id = ? AND deleted_at IS NULL AND file_uri IS NOT NULL`,
    [userId],
  );
}
