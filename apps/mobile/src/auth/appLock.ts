/**
 * Asking the phone for a fingerprint, and remembering whether an account wants to be asked.
 *
 * ## Where the prompt comes from
 *
 * Not from a biometrics library — the app does not have one, and adding one is a native module
 * (see CLAUDE.md). It comes from `expo-secure-store`, which is already in every build: a value
 * stored there with `requireAuthentication` can only be read back after the system's own
 * fingerprint prompt has succeeded. So the app keeps one such value, with nothing in it, and
 * "unlock" is "read it". The prompt, the sensor and the matching are entirely Android's; the app
 * is only told that it worked.
 *
 * Two things follow from borrowing it this way, and both are acceptable for a door:
 *
 *  - It accepts a fingerprint (strictly, whatever the phone counts as *strong* biometrics) and
 *    nothing else. There is no "use PIN instead" on the prompt. The way in without a
 *    fingerprint is the other button on the lock screen: sign in with the password.
 *  - Android throws the stored value away when the phone's fingerprints change. Reading it
 *    then comes back empty rather than failing, and it is simply stored again — which also
 *    prompts. Either way, getting in takes one successful fingerprint.
 *
 * Android only for now. On iOS the same call would use Face ID, which needs a usage
 * description declared in the app's configuration that this project does not have yet; without
 * it the system ends the app instead of prompting.
 */

import { AppState, Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

import {
  appLockKey,
  interpretUnlockError,
  parseLockSetting,
  serialiseLockSetting,
  type UnlockFailure,
} from './lockPolicy.js';

/** The one protected value. Device-wide: it identifies nobody and holds nothing. */
const PROOF_KEY = 'app-lock-proof';

/** Can this phone ask for a fingerprint right now? False if none is enrolled. */
export function biometricsAvailable(): boolean {
  if (Platform.OS !== 'android') return false;
  try {
    return SecureStore.canUseBiometricAuthentication();
  } catch {
    return false;
  }
}

/** Whether this account wants the lock. On unless it was turned off. */
export async function loadLockEnabled(userId: string): Promise<boolean> {
  try {
    return parseLockSetting(await SecureStore.getItemAsync(appLockKey(userId)));
  } catch {
    // A store that cannot be read is no reason to shut someone out of their own app.
    return false;
  }
}

export async function saveLockEnabled(userId: string, on: boolean): Promise<void> {
  await SecureStore.setItemAsync(appLockKey(userId), serialiseLockSetting(on));
}

export type UnlockOutcome = 'unlocked' | 'unavailable' | UnlockFailure;

/**
 * Show the system's fingerprint prompt, titled `prompt`, and say how it went.
 *
 * Never rejects. `unavailable` means the phone can no longer ask at all — the fingerprints were
 * removed since the lock was set — and the caller opens the door, since a lock that cannot be
 * opened by its owner is not one.
 */
export async function unlockWithBiometrics(prompt: string): Promise<UnlockOutcome> {
  if (!biometricsAvailable()) return 'unavailable';
  // The prompt can only be put up by an app that is in front. Asked for at any other moment the
  // system declines without saying so, and the request would wait for an answer that never
  // comes — with every later attempt refused as "already in progress".
  if (AppState.currentState !== 'active') return 'cancelled';

  const options = { requireAuthentication: true, authenticationPrompt: prompt };
  try {
    const proof = await SecureStore.getItemAsync(PROOF_KEY, options);
    // Nothing there: the first time on this phone, or its fingerprints have changed since.
    // Storing it asks for a fingerprint exactly as reading it would have.
    if (proof === null) await SecureStore.setItemAsync(PROOF_KEY, '1', options);
    return 'unlocked';
  } catch (error) {
    return interpretUnlockError(error instanceof Error ? error.message : String(error));
  }
}
