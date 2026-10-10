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
 * ## iOS
 *
 * The same library, the same call, and there it is Face ID (Touch ID on the phones that still
 * have a home button). Two differences from Android, both handled below:
 *
 *  - It needs a sentence in the app's configuration saying why it wants Face ID — app.json
 *    gives the library one. Without it the system ends the app instead of asking.
 *  - Storing a protected value asks for nothing; only reading it does. So the first unlock on
 *    a phone, which has to store the value, reads it straight back. Otherwise the very first
 *    "unlock" would open the door without anyone having been looked at.
 *
 * The iOS side had not run on a device when this was written.
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

/**
 * What the lock is called on this phone, for the words and the picture on screen: a
 * fingerprint on Android, a face on iOS.
 */
export const LOCK_READS: 'fingerprint' | 'face' = Platform.OS === 'ios' ? 'face' : 'fingerprint';

/** Can this phone ask for a fingerprint or a face right now? False if none is enrolled. */
export function biometricsAvailable(): boolean {
  if (Platform.OS !== 'android' && Platform.OS !== 'ios') return false;
  try {
    return SecureStore.canUseBiometricAuthentication();
  } catch {
    return false;
  }
}

/** Whether this account wants the lock. Off until it has been turned on in settings. */
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
    if (proof === null) {
      // On Android storing it asks for a fingerprint exactly as reading it would have.
      await SecureStore.setItemAsync(PROOF_KEY, '1', options);
      // On iOS it does not, so it is read back, which does. A value that cannot be read back
      // is a door that was never checked.
      if (Platform.OS === 'ios' && (await SecureStore.getItemAsync(PROOF_KEY, options)) === null) {
        return 'failed';
      }
    }
    return 'unlocked';
  } catch (error) {
    return interpretUnlockError(error instanceof Error ? error.message : String(error));
  }
}
