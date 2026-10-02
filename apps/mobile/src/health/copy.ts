/**
 * What the workout is called once it is out of this app.
 *
 * The title and the line under it are all another app shows of a session, so they carry the
 * numbers that say what it was: kilometres and minutes for a cardio effort, exercises, sets and
 * volume for a lifting one. Metric throughout, because the records themselves are metric — a
 * note in pounds beside a distance in metres reads like two different workouts.
 */

import type { HealthSessionStats } from './export.js';
import type { HealthExportCopy } from './sync.js';

/** i18next's `t`, narrowed to what this needs — it is called from screens, which have it. */
type Translate = (key: string, vars?: Record<string, unknown>) => string;

export function healthExportCopy(t: Translate): HealthExportCopy {
  return {
    fallbackTitle: t('health.workoutTitle'),
    notes: (stats: HealthSessionStats) => {
      if (stats.distanceMeters > 0) {
        return t('health.notesCardio', {
          km: (stats.distanceMeters / 1000).toFixed(2),
          minutes: stats.durationMinutes,
        });
      }
      if (stats.volumeKg > 0) {
        return t('health.notesStrength', {
          exercises: stats.exerciseCount,
          sets: stats.setCount,
          volume: stats.volumeKg,
        });
      }
      // A circuit on the clock: sets that carry no weight and cover no ground. Reporting zero
      // kilograms would be the one number on the line that says nothing.
      return t('health.notesSets', { exercises: stats.exerciseCount, sets: stats.setCount });
    },
  };
}
