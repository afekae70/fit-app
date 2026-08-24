/**
 * Writing backups into a folder the user chose, and reading them back.
 *
 * The native half. `expo-file-system` is a native module, so this file is the only one in the
 * backup feature that touches it — `rotation.ts` decides what should happen and is testable off
 * device, exactly the same split as `db/provider.ts` against the repository.
 *
 * ## Why a folder the user picks
 *
 * Anything the app writes inside its own sandbox disappears with the app, which makes it no
 * protection at all against the two things people actually lose data to: uninstalling, and a
 * dead phone. `pickDirectoryAsync` asks Android for a folder and for *persistable* permission
 * to keep writing there, so a folder inside Drive or the phone's own Documents keeps working
 * every day afterwards without asking again.
 *
 * That permission is the whole feature. If it is ever refused or revoked, the honest thing is to
 * report it and stop — a backup that silently stopped running is worse than none, because
 * somebody is relying on it.
 */

import * as SecureStore from 'expo-secure-store';

import { backupFileName, isBackupDue, pruneList } from './rotation.js';

/** Where the chosen folder is remembered. SecureStore is what the app already uses for settings. */
const FOLDER_KEY = 'backup-folder-uri';

interface FsModule {
  Directory: new (...uris: unknown[]) => {
    uri: string;
    exists: boolean;
    list(): { name: string; uri: string; delete(): void }[];
    createFile(name: string, mimeType: string | null): { write(contents: string): void };
  };
  File: new (...uris: unknown[]) => {
    uri: string;
    name: string;
    exists: boolean;
    text(): Promise<string>;
    write(contents: string): void;
    delete(): void;
  };
  pickDirectoryAsync(initialUri?: string): Promise<{ uri: string }>;
  pickFileAsync(initialUri?: string, mimeType?: string): Promise<{ uri: string }>;
}

/**
 * Loaded lazily, for the same reason `react-native-ble-plx` is: a top-level import of a native
 * module crashes anything that cannot provide it — Expo Go, and vitest — before a line of this
 * file's own code could explain why.
 */
function loadFs(): FsModule | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('expo-file-system') as FsModule;
  } catch {
    return null;
  }
}

export async function getBackupFolder(): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(FOLDER_KEY);
  } catch {
    return null;
  }
}

/**
 * Ask for a folder and remember it.
 *
 * Returns null when the user backed out, which is not an error and must not be reported as one.
 */
export async function chooseBackupFolder(): Promise<string | null> {
  const fs = loadFs();
  if (!fs) return null;
  try {
    const directory = await fs.pickDirectoryAsync();
    if (!directory?.uri) return null;
    await SecureStore.setItemAsync(FOLDER_KEY, directory.uri);
    return directory.uri;
  } catch {
    return null;
  }
}

export async function forgetBackupFolder(): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(FOLDER_KEY);
  } catch {
    // Nothing to report: the setting is gone either way as far as the caller is concerned.
  }
}

export type BackupOutcome =
  | { kind: 'written'; name: string }
  | { kind: 'not-due' }
  | { kind: 'no-folder' }
  | { kind: 'unavailable' }
  | { kind: 'failed' };

/**
 * Write one if it is time, then delete whatever the rotation says is surplus.
 *
 * Pruning happens after the write, never before: losing the old copies and then failing to
 * produce a new one would be the one outcome worse than not running at all.
 */
export async function backupIfDue(
  contents: () => Promise<string>,
  { afterWorkout = false, now = new Date() } = {},
): Promise<BackupOutcome> {
  const fs = loadFs();
  if (!fs) return { kind: 'unavailable' };

  const folderUri = await getBackupFolder();
  if (!folderUri) return { kind: 'no-folder' };

  try {
    const directory = new fs.Directory(folderUri);
    if (!directory.exists) return { kind: 'no-folder' };

    const entries = directory.list();
    const names = entries.map((entry) => entry.name);
    if (!isBackupDue({ existing: names, now, afterWorkout })) return { kind: 'not-due' };

    const name = backupFileName(now);
    const file = directory.createFile(name, 'application/json');
    file.write(await contents());

    for (const doomed of pruneList([...names, name])) {
      entries.find((entry) => entry.name === doomed)?.delete();
    }

    return { kind: 'written', name };
  } catch {
    // Reported, never swallowed. Somebody is relying on this.
    return { kind: 'failed' };
  }
}

/** Let the user pick a backup file and hand back its text. Null if they backed out. */
export async function readBackupFile(): Promise<string | null> {
  const fs = loadFs();
  if (!fs) return null;
  try {
    const picked = await fs.pickFileAsync(undefined, 'application/json');
    if (!picked?.uri) return null;
    return await new fs.File(picked.uri).text();
  } catch {
    return null;
  }
}
