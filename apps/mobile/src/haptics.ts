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

/** A firmer tap — finishing a set of consequence, applying a proposal. */
export function hapticMedium(): void {
  safely(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium));
}

/** The "you did it" buzz — finishing a workout, hitting a personal record. */
export function hapticSuccess(): void {
  safely(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success));
}
