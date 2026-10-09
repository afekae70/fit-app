/**
 * A profile picture per user: the file on this phone.
 *
 * Picked from the gallery through Android's system photo picker, which needs no permission —
 * the app never sees the rest of the gallery, only the one photo chosen. Cropped square in the
 * picker, then copied into the app's own documents folder: the picker hands back a file in the
 * cache, which Android may clear at any time, and a profile picture that vanishes a week later
 * reads as a bug.
 *
 * Keyed by user, so two people signed in on one phone each keep their own.
 *
 * The picture also travels to the user's other phones, and that is not done here. This file
 * keeps the picture and says which one it is — `setAvatarVersion` — and profile sync
 * (`sync/profileSync.ts`, through `avatarCloud.ts`) notices the tag has changed and moves the
 * file. So choosing a picture works the same with no signal as with it.
 */

import { File, Paths } from 'expo-file-system';
import * as ImagePicker from 'expo-image-picker';
import * as SecureStore from 'expo-secure-store';

import { setAvatarVersion } from '../db/metrics.js';
import { getExecutor } from '../db/provider.js';
import { avatarFileName, avatarStoreKey, newAvatarVersion } from './avatarNames.js';

/* ------------------------------------------------------------ who is watching */

const watchers = new Set<() => void>();

/**
 * Be told when any account's picture on this phone changes. Returns the way to stop.
 *
 * The picture is shown in three places at once — the home header, the settings banner, the
 * profile — and it can now change with none of them involved, when sync brings one down.
 * Without this each would go on showing what it loaded when it was first drawn.
 */
export function onAvatarChange(watcher: () => void): () => void {
  watchers.add(watcher);
  return () => {
    watchers.delete(watcher);
  };
}

function announce() {
  for (const watcher of [...watchers]) watcher();
}

/* ------------------------------------------------------------------ the file */

/** The saved picture's file URI, or null when there is none (or it has gone missing). */
export async function loadAvatar(userId: string): Promise<string | null> {
  try {
    const uri = await SecureStore.getItemAsync(avatarStoreKey(userId));
    if (!uri) return null;
    return new File(uri).exists ? uri : null;
  } catch {
    return null;
  }
}

/**
 * Let the user choose a picture and keep it. Resolves to the new URI, or null if they backed out.
 *
 * Each picture gets a new file name, so the image view cannot keep showing the old one from its
 * cache; the previous file is deleted once the new one is safely in place.
 */
export async function pickAvatar(userId: string): Promise<string | null> {
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    allowsEditing: true,
    aspect: [1, 1],
    quality: 0.7,
  });
  const picked = result.canceled ? undefined : result.assets[0];
  if (!picked) return null;

  const previous = await loadAvatar(userId);
  const now = Date.now();
  const saved = new File(Paths.document, avatarFileName(userId, now));
  new File(picked.uri).copy(saved);
  await SecureStore.setItemAsync(avatarStoreKey(userId), saved.uri);
  if (previous) deleteQuietly(previous);

  // A new tag is what tells sync there is a different picture to send.
  await setAvatarVersion(await getExecutor(), userId, newAvatarVersion(now));
  announce();
  return saved.uri;
}

/** The user going back to the initials. Sync carries that to their other phones. */
export async function removeAvatar(userId: string): Promise<void> {
  await deleteLocalAvatar(userId);
  await setAvatarVersion(await getExecutor(), userId, null);
}

/**
 * Take the picture off this phone and say nothing more about it.
 *
 * For the two callers that are not the user changing their mind: an account that has just been
 * deleted, whose profile must not be written to again, and sync, which records the change
 * itself once it knows the whole exchange worked.
 */
export async function deleteLocalAvatar(userId: string): Promise<void> {
  const previous = await loadAvatar(userId);
  await SecureStore.deleteItemAsync(avatarStoreKey(userId)).catch(() => undefined);
  if (previous) deleteQuietly(previous);
  announce();
}

/**
 * Fetch a picture from a link and make it the one this phone shows.
 *
 * Straight to a file, by the system's own downloader — the image never passes through
 * JavaScript, which on this platform would mean holding all of it in memory as text. The old
 * picture is replaced only once the new one has arrived whole; a download that fails leaves
 * everything as it was.
 */
export async function adoptDownloadedAvatar(userId: string, url: string): Promise<void> {
  const previous = await loadAvatar(userId);
  const target = new File(Paths.document, avatarFileName(userId, Date.now()));
  try {
    await File.downloadFileAsync(url, target);
    if (!target.exists || target.size === 0) throw new Error('the picture arrived empty');
  } catch (error) {
    deleteQuietly(target.uri);
    throw error;
  }
  await SecureStore.setItemAsync(avatarStoreKey(userId), target.uri);
  if (previous && previous !== target.uri) deleteQuietly(previous);
  announce();
}

function deleteQuietly(uri: string) {
  try {
    new File(uri).delete();
  } catch {
    // A file that is already gone is the outcome that was wanted.
  }
}
