/**
 * The live heart rate, as the workout screen receives it.
 *
 * The readings come from the NovaFit app on the watch. Samsung Health does not stream to other
 * apps, and Health Connect is a store of past records, not a feed — so the only way to a number
 * that changes while you are mid-set is a small app on the wrist that reads the sensor and sends
 * each reading across to the phone. That app is in native/wear; the phone's half of the bridge is
 * the `NovaFitHeartRate` native module.
 *
 * This file is the seam. It knows how to ask the watch to start and stop, and how to hand the
 * screen the latest reading — and it is written so that a watch that is not there, a watch app
 * that is not installed, and a build with no native module all look the same: no reading, and
 * nothing on screen where the number would be.
 *
 * What a reading means lives in heartRate.ts, which is pure and tested.
 */

import { useEffect, useState } from 'react';
import { DeviceEventEmitter, NativeModules, Platform } from 'react-native';

import { isFresh, isPlausibleBpm, type HeartRateSample } from './heartRate.js';

/** The event the native module emits. Changing it means changing the Kotlin too. */
const EVENT = 'novafit-heart-rate';

interface NativeHeartRate {
  /** Ask every connected watch to start measuring. Resolves with how many were asked. */
  start(): Promise<number>;
  stop(): Promise<number>;
}

function nativeModule(): NativeHeartRate | null {
  if (Platform.OS !== 'android') return null;
  return (NativeModules as { NovaFitHeartRate?: NativeHeartRate }).NovaFitHeartRate ?? null;
}

/**
 * Ask the watch to start measuring.
 *
 * Best effort, and silent about it: there may be no watch, the watch app may not be installed, or
 * Wear OS may decline to start it from the background — in which case opening the app on the watch
 * does the same thing. None of those is worth interrupting the start of a workout for.
 */
export function startWatchHeartRate(): void {
  void nativeModule()
    ?.start()
    .catch(() => undefined);
}

/** Tell the watch the workout is over, so it stops spending battery on the sensor. */
export function stopWatchHeartRate(): void {
  void nativeModule()
    ?.stop()
    .catch(() => undefined);
}

interface HeartRateEvent {
  bpm?: number;
  at?: number;
}

/**
 * The current heart rate, or null when there is none worth showing.
 *
 * Null covers every way of not having one: nothing has arrived yet, the last reading is too old
 * to trust, or what arrived was not a pulse. The caller renders nothing for null, so the header of
 * someone training without a watch looks exactly as it did before this existed.
 *
 * The clock that expires a reading only runs while there is a reading to expire.
 */
export function useLiveHeartRate(active: boolean): HeartRateSample | null {
  const [sample, setSample] = useState<HeartRateSample | null>(null);
  const [, repaint] = useState(0);

  useEffect(() => {
    if (!active) {
      setSample(null);
      return undefined;
    }

    const subscription = DeviceEventEmitter.addListener(EVENT, (event: HeartRateEvent) => {
      const bpm = Number(event?.bpm);
      if (!isPlausibleBpm(bpm)) return;
      // Stamped here rather than trusting the watch's clock: freshness is a question about when
      // the phone last heard, and two devices never quite agree on the time.
      setSample({ bpm: Math.round(bpm), at: Date.now() });
    });

    return () => subscription.remove();
  }, [active]);

  const hasSample = sample !== null;
  useEffect(() => {
    if (!hasSample) return undefined;
    const id = setInterval(() => repaint((n) => n + 1), 2000);
    return () => clearInterval(id);
  }, [hasSample]);

  return isFresh(sample, Date.now()) ? sample : null;
}
