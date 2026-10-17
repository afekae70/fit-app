/**
 * Progress photos: the pictures on this phone.
 *
 * Taken with the camera or chosen from the gallery through `expo-image-picker`, which the app
 * already has for the profile picture and the meal scan — nothing native is added for this.
 * Cropped to 3:4 in the picker, so that two photos set side by side are the same shape.
 *
 * Copied into the app's own documents folder, one folder per account: the picker hands back a
 * file in the cache, which Android may clear at any time, and these are pictures a person
 * means to look back at in a year. A folder per account also lets deleting an account remove
 * every picture without asking the database, which by then has already been emptied.
 *
 * The picker copies the original's EXIF into its file, location and all. The copy kept here has
 * it taken out first (`jpeg.ts`), so neither this phone's folder nor the server ever holds it.
 * The one thing read from it beforehand is the day the photo was taken, so an old photo chosen
 * from the gallery lands on its own day rather than today's.
 *
 * Where the picture is located is the database's business (`db/progressPhotos.ts`); sending it
 * to the server is `photoSync.ts`'s.
 */

import { Directory, File, Paths } from 'expo-file-system';
import * as ImagePicker from 'expo-image-picker';

import { localDate } from '../db/schedule.js';
import { exifDay } from './compare.js';
import { stripJpegMetadata } from './jpeg.js';

/** The bucket's own limit (0018). A larger picture would be refused there on every sync. */
export const MAX_PROGRESS_PHOTO_BYTES = 10 * 1024 * 1024;

export type TakenPhoto =
  /** `takenOn`: the camera's own date for a gallery photo, today for one just taken. */
  | { ok: true; uri: string; takenOn: string }
  | { ok: false; error: 'cancelled' | 'camera_denied' | 'not_readable' | 'too_large' };

const PICKER_OPTIONS: ImagePicker.ImagePickerOptions = {
  mediaTypes: ['images'],
  allowsEditing: true,
  aspect: [3, 4],
  // A body is not a document: this is plenty, and keeps a year of weekly photos small.
  quality: 0.7,
  // Read for the day it was taken and nothing else; see the note at the top.
  exif: true,
};

function takenFrom(result: ImagePicker.ImagePickerResult): TakenPhoto {
  const asset = result.canceled ? undefined : result.assets[0];
  if (!asset) return { ok: false, error: 'cancelled' };
  if (typeof asset.fileSize === 'number' && asset.fileSize > MAX_PROGRESS_PHOTO_BYTES) {
    return { ok: false, error: 'too_large' };
  }
  const today = localDate(new Date());
  return { ok: true, uri: asset.uri, takenOn: exifDay(asset.exif, today) ?? today };
}

/** Open the camera for one photo. Asks for the permission the first time. */
export async function takeProgressPhoto(): Promise<TakenPhoto> {
  try {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) return { ok: false, error: 'camera_denied' };
    return takenFrom(await ImagePicker.launchCameraAsync(PICKER_OPTIONS));
  } catch {
    return { ok: false, error: 'camera_denied' };
  }
}

/** Choose a photo already taken. Android's own picker, which needs no permission. */
export async function pickProgressPhoto(): Promise<TakenPhoto> {
  try {
    return takenFrom(await ImagePicker.launchImageLibraryAsync(PICKER_OPTIONS));
  } catch {
    return { ok: false, error: 'not_readable' };
  }
}

function folderOf(userId: string): Directory {
  // A user id is a uuid, or 'local' before signing in: safe as a folder name either way.
  return new Directory(Paths.document, 'progress-photos', userId);
}

/**
 * Write a picked picture into the account's folder, named after the photo's id and without its
 * metadata. Resolves to where it now is, or null when it could not be read or written, or is
 * larger than the server takes.
 */
export async function keepPhotoFile(
  userId: string,
  id: string,
  pickedUri: string,
): Promise<string | null> {
  try {
    const picked = new File(pickedUri);
    if (picked.size > MAX_PROGRESS_PHOTO_BYTES) return null;
    const bytes = stripJpegMetadata(await picked.bytes());
    const folder = folderOf(userId);
    if (!folder.exists) folder.create({ intermediates: true });
    const kept = new File(folder, `${id}.jpg`);
    if (kept.exists) kept.delete();
    kept.create();
    kept.write(bytes);
    return kept.uri;
  } catch {
    return null;
  }
}

/** Whether a picture is still where the database says it is. */
export function photoFileExists(uri: string): boolean {
  try {
    return new File(uri).exists;
  } catch {
    return false;
  }
}

export function deletePhotoFile(uri: string): void {
  try {
    const file = new File(uri);
    if (file.exists) file.delete();
  } catch {
    // A file that is already gone is the outcome that was wanted.
  }
}

/** Every picture this account has on this phone, for deleting the account. */
export function deleteLocalProgressPhotos(userId: string): void {
  try {
    const folder = folderOf(userId);
    if (folder.exists) folder.delete();
  } catch {
    // Nothing more can be done from here; the files are in the app's own folder either way,
    // and go with the app.
  }
}
