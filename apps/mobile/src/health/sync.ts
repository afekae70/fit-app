/**
 * Sending workouts to Health Connect: the toggle, the one that just finished, and the history.
 *
 * The toggle is a saved preference rather than "we have permission, so we send": permission is
 * granted once inside Health Connect and never asked about again, and turning the sync off in
 * this app should turn it off here, not send the user to another app to revoke something.
 *
 * Reads the workout back out of the database rather than taking it from the screen's state. The
 * screen holds what is being edited; the database holds what was saved, which is what the other
 * app should show.
 */

import * as SecureStore from 'expo-secure-store';

import type { SqlExecutor } from '../db/executor.js';
import { getLatestWeight } from '../db/metrics.js';
import { getSessionDetail, listSessionSummaries } from '../db/workouts.js';
import {
  buildHealthRecords,
  summariseForHealth,
  type HealthExportSession,
  type HealthSessionStats,
} from './export.js';
import { writeHealthRecords, type HealthWriteOutcome } from './writer.js';

const ENABLED_KEY = 'health-sync-enabled';

/** How far back the first sync reaches, so the other app is not empty until the next workout. */
export const BACKFILL_DAYS = 90;

export async function loadHealthSyncEnabled(): Promise<boolean> {
  try {
    return (await SecureStore.getItemAsync(ENABLED_KEY)) === 'on';
  } catch {
    return false;
  }
}

export async function setHealthSyncEnabled(enabled: boolean): Promise<void> {
  await SecureStore.setItemAsync(ENABLED_KEY, enabled ? 'on' : 'off').catch(() => undefined);
}

/** The title and the line under it, as the user's language has them. */
export interface HealthExportCopy {
  /** Used when the workout was never given a name of its own. */
  fallbackTitle: string;
  notes?: (stats: HealthSessionStats) => string;
}

/**
 * Read one saved workout into the shape the mapper takes.
 *
 * The weigh-in is the session's own where it has one and the latest otherwise — a calorie
 * estimate needs a body weight, and a workout from before the first weigh-in has none.
 */
async function loadForExport(
  db: SqlExecutor,
  sessionId: string,
  fallbackWeightKg: number | null,
): Promise<HealthExportSession | null> {
  const { session, exercises } = await getSessionDetail(db, sessionId);
  if (!session) return null;

  // `updated_at` is on the row but not on the published interface — every other reader works in
  // terms of what was logged, not when the row was touched. It matters here and only here: it is
  // what makes a second export of an edited workout outrank the first.
  const updatedAt = (session as { updated_at?: string | null }).updated_at ?? null;

  return {
    id: session.id,
    name: session.name,
    startedAt: session.started_at,
    endedAt: session.ended_at,
    updatedAt,
    bodyWeightKg: session.bodyweight_kg ?? fallbackWeightKg,
    exercises: exercises.map((exercise) => ({
      exerciseKey: exercise.exercise_key,
      sets: exercise.sets.map((set) => ({
        reps: set.reps,
        weightKg: set.weight_kg,
        durationSeconds: set.duration_seconds,
        distanceM: set.distance_m,
        isWarmup: set.is_warmup === 1,
      })),
    })),
  };
}

function recordsFor(session: HealthExportSession, copy: HealthExportCopy) {
  const stats = summariseForHealth(session);
  if (!stats) return [];
  return buildHealthRecords(session, {
    title: copy.fallbackTitle,
    notes: copy.notes?.(stats),
  });
}

/**
 * Send one workout, if the user has asked for workouts to be sent.
 *
 * Called from the finish of a workout and allowed to fail quietly: the workout is already saved
 * locally, and another app not hearing about it is not worth a dialog over the trophy screen.
 */
export async function exportSessionToHealth(
  db: SqlExecutor,
  userId: string,
  sessionId: string,
  copy: HealthExportCopy,
): Promise<HealthWriteOutcome> {
  if (!(await loadHealthSyncEnabled())) return { status: 'nothing' };

  const weight = await getLatestWeight(db, userId);
  const session = await loadForExport(db, sessionId, weight?.weight_kg ?? null);
  if (!session) return { status: 'nothing' };

  return writeHealthRecords(recordsFor(session, copy));
}

export interface BackfillResult {
  sent: number;
  skipped: number;
  failed: number;
}

/**
 * Send the recent history, one workout at a time.
 *
 * One insert per workout rather than one big one: Health Connect rejects an entire insert if any
 * record in it is invalid, and a single odd session from a year of training should cost that
 * session, not the year. Re-sending is safe — the records carry the session ids, so this
 * overwrites rather than duplicates.
 */
export async function backfillHealthExport(
  db: SqlExecutor,
  userId: string,
  copy: HealthExportCopy,
  { days = BACKFILL_DAYS, now = new Date() }: { days?: number; now?: Date } = {},
): Promise<BackfillResult> {
  const since = new Date(now.getTime() - days * 86_400_000).toISOString();
  const summaries = await listSessionSummaries(db, userId, 200, since);
  const weight = await getLatestWeight(db, userId);

  const result: BackfillResult = { sent: 0, skipped: 0, failed: 0 };

  for (const summary of summaries) {
    if (!summary.ended_at) {
      result.skipped += 1;
      continue;
    }

    const session = await loadForExport(db, summary.id, weight?.weight_kg ?? null);
    const records = session ? recordsFor(session, copy) : [];
    if (records.length === 0) {
      result.skipped += 1;
      continue;
    }

    const outcome = await writeHealthRecords(records);
    if (outcome.status === 'written') result.sent += 1;
    else if (outcome.status === 'nothing') result.skipped += 1;
    else result.failed += 1;
  }

  return result;
}
