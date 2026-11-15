/**
 * What the add-food screen is doing, as one value.
 *
 * There are three ways in — the list, a food picked from it (how much?), and typing it by
 * hand — and they used to be `picked` and `byHand`, never both only because each setter
 * remembered to clear the other, with the grams of the picked food held beside them and left
 * behind when it went. Here the grams live on the picked food, and there is one mode at a time.
 *
 *   browsing ──PICKED──▶ picked(food, grams) ⇄ PICKED (another food)
 *       │                      │
 *       └──BY_HAND_OPENED──▶ byHand ◀── BY_HAND_OPENED
 *                               └──PICKED──▶ picked
 *
 * Saving sits across all three: a recent food is logged straight from the list. While an entry
 * is being written nothing else changes, so what is on screen is what was saved.
 */

import type { FoodSeed } from './foods.js';

/** What the amount field opens on when the food has no serving of its own. */
const DEFAULT_GRAMS = 100;

export type FoodAddMode =
  | { kind: 'browsing' }
  /** `gramsRaw` is the field as typed; it belongs to this food and goes with it. */
  | { kind: 'picked'; food: FoodSeed; gramsRaw: string }
  | { kind: 'byHand' };

export interface FoodAddState {
  mode: FoodAddMode;
  saving: boolean;
}

export type FoodAddEvent =
  | { type: 'PICKED'; food: FoodSeed }
  | { type: 'GRAMS_TYPED'; raw: string }
  | { type: 'BY_HAND_OPENED' }
  | { type: 'SAVE_STARTED' }
  /** Nothing was written: the screen is live again, as it was. A save that works leaves it. */
  | { type: 'SAVE_FAILED' };

export const INITIAL_FOOD_ADD_STATE: FoodAddState = { mode: { kind: 'browsing' }, saving: false };

export function foodAddReducer(state: FoodAddState, event: FoodAddEvent): FoodAddState {
  if (event.type === 'SAVE_FAILED') return state.saving ? { ...state, saving: false } : state;
  if (state.saving) return state;

  switch (event.type) {
    case 'PICKED':
      return {
        ...state,
        mode: {
          kind: 'picked',
          food: event.food,
          gramsRaw: String(event.food.serving?.grams ?? DEFAULT_GRAMS),
        },
      };

    case 'GRAMS_TYPED':
      return state.mode.kind === 'picked'
        ? { ...state, mode: { ...state.mode, gramsRaw: event.raw } }
        : state;

    case 'BY_HAND_OPENED':
      return state.mode.kind === 'byHand' ? state : { ...state, mode: { kind: 'byHand' } };

    case 'SAVE_STARTED':
      return { ...state, saving: true };
  }
}
