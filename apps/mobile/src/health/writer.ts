/**
 * The Health Connect transport, outbound: puts a finished workout where other apps can see it.
 *
 * Samsung Health, Google Fit and the rest read the same system store this writes into, so one
 * insert here is the workout appearing in whichever of them the user actually opens. There is no
 * Samsung Health API to integrate with — Health Connect *is* the integration.
 *
 * Permission is per record type and is granted inside the Health Connect app, not by a runtime
 * dialog, so every write asks what was granted first and sends only the records it is allowed to
 * send. Someone who allows the workout and refuses the calories gets the workout.
 *
 * What to write is decided in export.ts, which is pure and tested. This file is the part that
 * needs the native module.
 */

import { Platform } from 'react-native';

import { checkAvailability, type HealthAvailability } from './adapter.js';
import {
  grantedHealthPermissions,
  loadHealthConnect,
  SDK_AVAILABLE,
  type HealthPermission,
} from './native.js';

/**
 * What this app asks to write.
 *
 * The session is the point; distance and calories only ever accompany one. Nothing here asks to
 * write weight or heart rate — this app does not measure them, and asking for permissions an app
 * has no use for is how an integration stops looking trustworthy.
 */
export const WRITE_PERMISSIONS: readonly HealthPermission[] = [
  { accessType: 'write', recordType: 'ExerciseSession' },
  { accessType: 'write', recordType: 'Distance' },
  { accessType: 'write', recordType: 'ActiveCaloriesBurned' },
];

/** Whether Health Connect can be written to at all on this device. */
export async function checkHealthWriteAvailability(): Promise<HealthAvailability> {
  const module = loadHealthConnect();
  if (!module) {
    return checkAvailability({ platform: Platform.OS, hasNativeModule: false });
  }

  try {
    const status = await module.getSdkStatus();
    return checkAvailability({
      platform: Platform.OS,
      hasNativeModule: true,
      isInstalled: status === SDK_AVAILABLE,
    });
  } catch {
    return checkAvailability({ platform: Platform.OS, hasNativeModule: true, isInstalled: false });
  }
}

/** True when the workout itself may be written — the one permission without which nothing works. */
export async function hasHealthWritePermission(): Promise<boolean> {
  return (await grantedHealthPermissions()).has('write:ExerciseSession');
}

/**
 * Ask for write access, and report whether the workout may now be written.
 *
 * The request opens Health Connect's own permission screen. A user can come back from it having
 * granted some of what was asked, all of it, or none — so the answer comes from reading the
 * grants afterwards rather than from the call returning.
 */
export async function requestHealthWritePermission(): Promise<boolean> {
  const module = loadHealthConnect();
  if (!module) return false;

  try {
    await module.initialize();
    await module.requestPermission(WRITE_PERMISSIONS);
  } catch {
    return false;
  }

  return hasHealthWritePermission();
}

export type HealthWriteOutcome =
  /** Written, with how many records went in. */
  | { status: 'written'; records: number }
  /** Nothing to write: not an error, and not worth telling anyone about. */
  | { status: 'nothing' }
  /** No Health Connect on this device, or no development build. */
  | { status: 'unavailable' }
  /** Health Connect is there and has not been given permission to take workouts. */
  | { status: 'denied' }
  | { status: 'failed'; message: string };

/**
 * Insert records, dropping the ones this app has not been allowed to write.
 *
 * Filtering rather than failing: Health Connect rejects the whole insert if it contains a type
 * without permission, which would mean a refused calorie permission silently costing the user
 * every workout.
 */
export async function writeHealthRecords(
  records: readonly { recordType: string }[],
): Promise<HealthWriteOutcome> {
  if (records.length === 0) return { status: 'nothing' };

  const module = loadHealthConnect();
  if (!module) return { status: 'unavailable' };

  const granted = await grantedHealthPermissions();
  if (!granted.has('write:ExerciseSession')) return { status: 'denied' };

  const allowed = records.filter((record) => granted.has(`write:${record.recordType}`));
  if (allowed.length === 0) return { status: 'denied' };

  try {
    const ids = await module.insertRecords(allowed);
    return { status: 'written', records: ids.length };
  } catch (error) {
    return { status: 'failed', message: error instanceof Error ? error.message : String(error) };
  }
}

/** Open Health Connect, where the permissions themselves live. */
export function openHealthConnectSettings(): void {
  loadHealthConnect()?.openHealthConnectSettings();
}
