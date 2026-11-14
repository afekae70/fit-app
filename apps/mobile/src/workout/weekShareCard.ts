/**
 * What goes on the picture of a week: the weekly summary, shared the way a workout is.
 *
 * Asked for by the owner (2026-11-14) — "like the sharing of a workout, so it is similar" — and
 * twice made leaner the same day, the second time because it still had "too much text". So the
 * picture (`components/workout/WeekShareCard.tsx`) carries, in the workout card's language, only:
 * four numbers, the three counters, and the coach's tip for next week in one line. The coach's
 * other lines and the lists of exercises stay on the screen.
 *
 * Built from what the screen already read, so the picture says what the screen says. A number
 * nobody wrote down is left off rather than drawn as a dash: a picture goes to other people, and a
 * row of blanks tells them nothing.
 */

import type { WeekRecord, WeekSummary } from '../db/weekSummary.js';
import { ltr } from './shareCard.js';

/** How many exercises each list names before the rest become a count — on the screen and the card. */
export const WEEK_LIST_LIMIT = 3;

export interface WeekShareLabels {
  title: string;
  /** "8–14 Nov". */
  range: string;
  /** The coach's tip for next week (`parseReview`), or null without one. */
  tip: string | null;
  tipTitle: string;
  workouts: string;
  records: string;
  waterDays: string;
  /** "weight (kg)". */
  weight: string;
  /** "last week: 3". */
  lastWeek: (count: number) => string;
  /** A record's set, compactly in the reader's units: "110×4". */
  recordSet: (record: WeekRecord) => string;
  /** A change of weight with an arrow, in the reader's units: "↓ 0.8". */
  weightChange: (kg: number) => string;
  /** A weight in the reader's units, without the unit: "80.6". */
  weightValue: (kg: number) => string;
  /** "1.2 L a day". */
  litres: (value: number) => string;
  /** The exercise's name in the reader's language. */
  exercise: (key: string) => string;
}

export interface WeekShareStat {
  key: string;
  value: string;
  label: string;
  sub?: string;
}

export interface WeekShareModel {
  title: string;
  when: string;
  stats: WeekShareStat[];
  /** Exercises up, the same and down; null when nothing could be compared. */
  counts: { up: number; same: number; down: number } | null;
  tip: { title: string; text: string } | null;
}

export function weekShareModel(week: WeekSummary, labels: WeekShareLabels): WeekShareModel {
  const stats: WeekShareStat[] = [
    {
      key: 'workouts',
      value: String(week.workouts),
      label: labels.workouts,
      sub: labels.lastWeek(week.previousWorkouts),
    },
  ];
  if (week.records.length > 0) {
    const top = week.records[0]!;
    stats.push({
      key: 'records',
      value: String(week.records.length),
      label: labels.records,
      sub: `${labels.exercise(top.exerciseKey)} ${ltr(labels.recordSet(top))}`,
    });
  }
  if (week.water.reached > 0 || week.waterLitresPerDay !== null) {
    stats.push({
      key: 'water',
      value: ltr(`${week.water.reached}/${week.water.counted}`),
      label: labels.waterDays,
      sub: week.waterLitresPerDay === null ? undefined : labels.litres(week.waterLitresPerDay),
    });
  }
  if (week.weight.latestKg !== null) {
    stats.push({
      key: 'weight',
      value: labels.weightValue(week.weight.latestKg),
      label: labels.weight,
      sub:
        week.weight.changeKg === null || week.weight.changeKg === 0
          ? undefined
          : labels.weightChange(week.weight.changeKg),
    });
  }

  const compared = week.counts.up + week.counts.same + week.counts.down;
  const tip = labels.tip?.trim();
  return {
    title: labels.title,
    when: labels.range,
    stats,
    counts: compared > 0 ? week.counts : null,
    tip: tip ? { title: labels.tipTitle, text: tip } : null,
  };
}
