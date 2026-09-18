/**
 * A profile picture per user, kept on this phone.
 *
 * Picked from the gallery through Android's system photo picker, which needs no permission —
 * the app never sees the rest of the gallery, only the one photo chosen. Cropped square in the
 * picker, then copied into the app's own documents folder: the picker hands back a file in the
 * cache, which Android may clear at any time, and a profile picture that vanishes a week later
 * reads as a bug.
 *
 * Keyed by user, so two people signed in on one phone each keep their own. Local only — it is
 * not synced, so another phone shows the initials until a picture is chosen there too.
 */

import { File, Paths } from 'expo-file-system';
import * as ImagePicker from 'expo-image-picker';
import * as SecureStore from 'expo-secure-store';

import { avatarFileName, avatarStoreKey } from './avatarNames.js';

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
  const saved = new File(Paths.document, avatarFileName(userId, Date.now()));
  new File(picked.uri).copy(saved);
  await SecureStore.setItemAsync(avatarStoreKey(userId), saved.uri);
  if (previous) deleteQuietly(previous);
  return saved.uri;
}

/** Go back to the initials. */
export async function removeAvatar(userId: string): Promise<void> {
  const previous = await loadAvatar(userId);
  await SecureStore.deleteItemAsync(avatarStoreKey(userId)).catch(() => undefined);
  if (previous) deleteQuietly(previous);
}

function deleteQuietly(uri: string) {
  try {
    new File(uri).delete();
  } catch {
    // A file that is already gone is the outcome that was wanted.
  }
}
