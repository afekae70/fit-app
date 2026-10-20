/**
 * The two quick-add water buttons, as each person sets them.
 *
 * 250 and 500 are a glass and a small bottle, and they are only a start: one person's bottle is
 * 750, another drinks from a 330 can all day. Whatever someone pours most often should be one
 * tap, so both buttons can be set to any amount, by each account for itself.
 *
 * Kept on the phone, per account (see `waterButtonsStore.ts`), as two numbers. Everything here is
 * the part with no native code: what the stored text means, and what a typed amount may be.
 */

import { MAX_WATER_ML } from '../db/water.js';
import { BOTTLE_ML, GLASS_ML } from './water.js';

export type WaterButtons = readonly [number, number];

export const DEFAULT_WATER_BUTTONS: WaterButtons = [GLASS_ML, BOTTLE_ML];

/** Below this is a sip, not something to have a button for. */
export const MIN_BUTTON_ML = 10;

/** Where one account's buttons are kept. Per account: two people can share a phone. */
export function waterButtonsKey(userId: string): string {
  return `water-buttons-${userId.replace(/[^A-Za-z0-9_-]/g, '_') || 'local'}`;
}

const inRange = (ml: unknown): ml is number =>
  typeof ml === 'number' && Number.isInteger(ml) && ml >= MIN_BUTTON_ML && ml <= MAX_WATER_ML;

/**
 * The stored buttons, read back. Never throws: anything that is not two sensible amounts —
 * nothing stored, a value another version wrote, a typo that got through — is the defaults.
 */
export function readWaterButtons(raw: string | null): WaterButtons {
  if (!raw) return DEFAULT_WATER_BUTTONS;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length === 2 && inRange(parsed[0]) && inRange(parsed[1])) {
      return [parsed[0], parsed[1]];
    }
  } catch {
    // Not JSON: the defaults, below.
  }
  return DEFAULT_WATER_BUTTONS;
}

export function serialiseWaterButtons(buttons: WaterButtons): string {
  return JSON.stringify([buttons[0], buttons[1]]);
}

/**
 * A typed amount for a button, in millilitres; null while it is not one. Whole millilitres
 * only — "330", not "0.33" — since the field says ml beside it.
 */
export function buttonAmount(text: string): number | null {
  const trimmed = text.trim();
  if (!/^\d{1,4}$/.test(trimmed)) return null;
  const ml = Number(trimmed);
  return inRange(ml) ? ml : null;
}

export function isDefault(buttons: WaterButtons): boolean {
  return buttons[0] === DEFAULT_WATER_BUTTONS[0] && buttons[1] === DEFAULT_WATER_BUTTONS[1];
}
