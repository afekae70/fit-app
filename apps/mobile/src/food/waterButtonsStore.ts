/**
 * Where each account's water buttons are kept: on this phone, beside the app's other per-account
 * choices (the fingerprint lock, the account's role), in the same store. Reading never throws —
 * a store that cannot be read is the default buttons — and neither does saving: a button that did
 * not stay set is a small annoyance, not a reason to stop logging water.
 */

import * as SecureStore from 'expo-secure-store';

import {
  readWaterButtons,
  serialiseWaterButtons,
  waterButtonsKey,
  type WaterButtons,
} from './waterButtons.js';

export async function loadWaterButtons(userId: string): Promise<WaterButtons> {
  const raw = await SecureStore.getItemAsync(waterButtonsKey(userId)).catch(() => null);
  return readWaterButtons(raw);
}

export async function saveWaterButtons(userId: string, buttons: WaterButtons): Promise<void> {
  await SecureStore.setItemAsync(waterButtonsKey(userId), serialiseWaterButtons(buttons)).catch(
    () => undefined,
  );
}
