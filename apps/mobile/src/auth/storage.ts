/**
 * The `expo-secure-store` adapter Supabase's client stores its session under.
 *
 * Backed by the platform Keychain (iOS) / Keystore-encrypted SharedPreferences (Android)
 * rather than plain AsyncStorage, because the refresh token is long-lived — unlike the access
 * token, which expires in an hour, a stolen refresh token grants access indefinitely until it
 * is revoked. Chunking (see `chunkedStorage.ts`) exists because the session blob routinely
 * exceeds SecureStore's ~2048-byte per-value limit on Android.
 */

import * as SecureStore from 'expo-secure-store';

import { chunkKeys, joinChunks, metaKey, splitIntoChunks } from './chunkedStorage.js';

/** The interface `@supabase/supabase-js`'s `Auth` options expect for `storage`. */
export interface AuthStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

export const secureChunkedStorage: AuthStorage = {
  async getItem(key) {
    const countRaw = await SecureStore.getItemAsync(metaKey(key));
    if (countRaw === null) return null;

    const count = Number(countRaw);
    if (!Number.isInteger(count) || count < 1) return null;

    const values = await Promise.all(
      chunkKeys(key, count).map((chunkKey) => SecureStore.getItemAsync(chunkKey)),
    );
    return joinChunks(values);
  },

  async setItem(key, value) {
    const { chunks, count } = splitIntoChunks(value);

    // Meta written last: if the app is killed mid-write, a partial set of chunks with no
    // meta key reads back as "not present" (getItem above) rather than as corrupt data — the
    // stale chunks are simply orphaned and overwritten on the next successful setItem.
    await Promise.all(
      chunkKeys(key, count).map((chunkKey, i) => SecureStore.setItemAsync(chunkKey, chunks[i]!)),
    );
    await SecureStore.setItemAsync(metaKey(key), String(count));
  },

  async removeItem(key) {
    const countRaw = await SecureStore.getItemAsync(metaKey(key));
    const count = countRaw === null ? 0 : Number(countRaw);

    if (Number.isInteger(count) && count > 0) {
      await Promise.all(
        chunkKeys(key, count).map((chunkKey) => SecureStore.deleteItemAsync(chunkKey)),
      );
    }
    await SecureStore.deleteItemAsync(metaKey(key));
  },
};
