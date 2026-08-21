/**
 * A ramp up to a working weight.
 *
 * Warming up is the part of a session people skip when it costs them anything, including the
 * twenty seconds of arithmetic and tapping it takes to write three sets down. The ramp itself is
 * unremarkable — roughly 40/60/80 per cent for descending reps — and the value here is entirely
 * in it being one button rather than six fields.
 */

import { OLYMPIC_BAR, type BarSpec } from './plates.js';

export interface WarmupSet {
  weight: number;
  reps: number;
}

/**
 * Fractions of the working weight, with the reps that go with them.
 *
 * Reps fall as the weight climbs, which is the point: warming up is preparation, not fatigue.
 * Doing five at eighty per cent leaves less for the set it was meant to prepare.
 */
const RAMP: readonly WarmupSet[] = [
  { weight: 0.4, reps: 5 },
  { weight: 0.6, reps: 3 },
  { weight: 0.8, reps: 2 },
];

export interface WarmupOptions {
  /**
   * The bar, when there is one. A step lighter than the bare bar cannot be loaded, so those
   * collapse into a single set with the empty bar rather than being silently dropped — the empty
   * bar is a real warm-up set and the one most worth doing.
   */
  bar?: BarSpec | null;
  /**
   * Smallest weight change that can actually be made.
   *
   * 2.5 kg on a barbell, because the smallest plate goes on both ends. Dumbbells and stacks come
   * in their own steps; this is a parameter rather than a constant so a suggestion is never a
   * weight the gym cannot produce.
   */
  increment?: number;
}

/**
 * Build the ramp for a working weight, or nothing when there is nothing to ramp.
 *
 * Returns an empty list rather than a token set when the working weight is at or below what a
 * warm-up would be: for the bare bar there is nothing lighter to lift, and inventing a set the
 * user then has to delete is worse than offering none.
 */
export function warmupRamp(working: number, options: WarmupOptions = {}): WarmupSet[] {
  const { bar = OLYMPIC_BAR, increment = 2.5 } = options;
  if (!Number.isFinite(working) || working <= 0) return [];

  const floor = bar?.kg ?? increment;
  if (working <= floor) return [];

  const out: WarmupSet[] = [];
  let previous = 0;

  for (const step of RAMP) {
    // Rounded down, never up: a warm-up that overshoots is a working set nobody planned.
    const rounded = Math.floor((working * step.weight) / increment) * increment;
    const weight = Math.max(rounded, floor);

    // Two steps can round to the same weight on a light lift, and the bar floor can flatten the
    // first two into one. Either way the same weight twice is a rep scheme, not a ramp.
    if (weight === previous) continue;
    // Never propose a warm-up that is the working set.
    if (weight >= working) break;

    out.push({ weight: Number(weight.toFixed(2)), reps: step.reps });
    previous = weight;
  }

  return out;
}
