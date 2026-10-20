/**
 * The one build (b561e0a) that kept the water buttons in this phone's secure store, before they
 * moved onto the profile to sync. Whatever it kept is moved onto the profile once, the first
 * time the buttons are read, and the old entry is deleted — so nobody who set their buttons in
 * that build finds them back at 250 and 500.
 *
 * Only a valid, non-default pair is moved. A default written onto the profile would count, at
 * the first sync, as this phone's value, and would be sent over buttons set on another phone.
 */

import * as SecureStore from 'expo-secure-store';

import type { SqlExecutor } from '../db/executor.js';
import { setWaterButtons } from '../db/waterButtons.js';
import { isDefault, readWaterButtons, waterButtonsKey, type WaterButtons } from './waterButtons.js';

export async function adoptLegacyWaterButtons(
  db: SqlExecutor,
  userId: string,
): Promise<WaterButtons | null> {
  const key = waterButtonsKey(userId);
  const raw = await SecureStore.getItemAsync(key).catch(() => null);
  if (!raw) return null;
  const buttons = readWaterButtons(raw);
  const moved = !isDefault(buttons) && (await setWaterButtons(db, userId, buttons));
  await SecureStore.deleteItemAsync(key).catch(() => undefined);
  return moved ? buttons : null;
}
