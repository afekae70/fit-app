/**
 * Thin wrapper around expo-haptics, one call per feeling rather than the raw enum at every call
 * site.
 *
 * Every call is wrapped in try/catch AND swallows its own rejection, because there are two
 * distinct failure modes and `.catch()` alone only covers one of them:
 *
 *  - **Async**: a device with no vibration motor, or a user who disabled haptics system-wide,
 *    rejects the returned promise.
 *  - **Sync**: the native module is missing entirely, and the call throws before returning a
 *    promise at all — so there is nothing to attach `.catch()` to. This is the real case when a
 *    JS bundle runs against an older dev client built before expo-haptics was added, and an
 *    uncaught throw there takes down the screen.
 *
 * Haptics are a nice-to-have polish layer. A missed buzz must never become a broken interaction.
 */

import * as Haptics from 'expo-haptics';

/** Runs a haptic call, swallowing both a synchronous throw and an async rejection. */
function safely(run: () => Promise<void>): void {
  try {
    void run().catch(() => {});
  } catch {
    /* native module unavailable — haptics are optional, never fatal */
  }
}

/** A light tap — adding a set, a minor confirmation. */
export function hapticLight(): void {
  safely(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light));
}

/**
 * A detent — one notch on a dial or a ruler going past.
 *
 * The lightest thing the motor can do, and meant to be felt dozens of times in a second: dragging
 * a ruler across forty kilos is eighty of these. An impact, even a light one, repeated at that
 * rate is a buzz rather than a click.
 */
export function hapticTick(): void {
  safely(() => Haptics.selectionAsync());
}

/** A firmer tap — finishing a set of consequence, applying a proposal. */
export function hapticMedium(): void {
  safely(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium));
}

/** The "you did it" buzz — finishing a workout, hitting a personal record. */
export function hapticSuccess(): void {
  safely(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success));
}

/* -------------------------------------------------------------------------- */
/* A vocabulary, not a buzz                                                    */
/* -------------------------------------------------------------------------- */

/**
 * The rest of the app speaks in patterns rather than in single taps.
 *
 * One buzz for everything teaches nothing: a set logged, a record broken and a rest ending all
 * felt identical, so the phone had to be looked at to find out which had happened. These are
 * distinguishable in a pocket, and that is the whole point — the app is used by someone whose
 * eyes are on a barbell.
 *
 * The spacing is deliberate. Below about 60ms two taps merge into one longer buzz on most
 * Android motors, and above about 200ms they stop reading as one gesture and become two events.
 */
function pattern(steps: { at: number; play: () => void }[]): void {
  for (const step of steps) {
    if (step.at === 0) step.play();
    else setTimeout(step.play, step.at);
  }
}

/** A set ticked off: two taps, close together — the rhythm of a thing completed. */
export function hapticSetDone(): void {
  pattern([
    { at: 0, play: hapticMedium },
    { at: 90, play: hapticLight },
  ]);
}

/** A personal record: three taps, rising — heard as an exclamation rather than a confirmation. */
export function hapticRecord(): void {
  pattern([
    { at: 0, play: hapticLight },
    { at: 90, play: hapticMedium },
    { at: 190, play: hapticSuccess },
  ]);
}

/** One of the last seconds of rest. Deliberately the lightest thing in the vocabulary. */
export function hapticCountdownTick(): void {
  hapticLight();
}

/** Rest is over: a firm pair, enough to feel through a pocket. */
export function hapticRestOver(): void {
  pattern([
    { at: 0, play: hapticMedium },
    { at: 120, play: hapticMedium },
  ]);
}
