/**
 * A trainee's finished workouts, as a coach's phone reads them.
 *
 * Like the plans (`planDocument.ts`), these are not the coach's data and never touch the
 * coach's database: they come from the server as one document (`coach_get_sessions`, 0012),
 * are looked at, and are gone when the screen closes. Unlike the plans, nothing here is ever
 * sent back — a coach reads what was done and cannot change it.
 *
 * Everything in this file is a pure function over that document. What counts as "did the
 * workout that was planned" is decided here, in one place, so the calendar and the summary
 * above it cannot disagree about a day.
 *
 * ## What is in the document
 *
 * What the server chose to send, which is deliberately less than a workout holds: no body
 * weight, no notes. See 0012 for why. This file does not add a field for either, so there is
 * nowhere on the coach's side for one to land if a later server sent it by mistake.
 */

import { localDate } from '../db/schedule.js';
import type { CoachCalendar } from './planDocument.js';

/**
 * One set that was done. In the shape of the app's own set rows — 0 and 1 for the flags,
 * kilograms and metres whatever the reader's units — so that the same component draws a
 * workout for the person who did it and for their coach.
 */
export interface CoachSet {
  /** Made up here, stable for a given document: the server sends sets by position, not by id. */
  id: string;
  weight_kg: number | null;
  reps: number | null;
  duration_seconds: number | null;
  distance_m: number | null;
  rpe: number | null;
  is_warmup: number;
  is_drop: number;
  to_failure: number;
}

export interface CoachSessionExercise {
  /** The catalogue key. Null for a row the app would not have written; drawn as unnamed. */
  exerciseKey: string | null;
  supersetWithNext: boolean;
  sets: CoachSet[];
}

export interface CoachSession {
  id: string;
  /** The name the trainee gave the workout, if they gave one. */
  name: string | null;
  /** The planned workout it was started from, if it was started from one. */
  planDayId: string | null;
  startedAt: string;
  endedAt: string | null;
  /** How hard the trainee rated the whole workout, 1-10. */
  rpe: number | null;
  exercises: CoachSessionExercise[];
}

/* -------------------------------------------------------------------------- */
/* Reading what the server sent                                                */
/* -------------------------------------------------------------------------- */

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const asText = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() !== '' ? value : null;

/** A number, or null. Postgres sends a `numeric` as a number here, but may send it as text. */
const asNumber = (value: unknown): number | null => {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  return Number.isFinite(n) ? n : null;
};

const asFlag = (value: unknown): number => (value === true || value === 1 ? 1 : 0);

/** A moment the server sent, if it is one a `Date` can read. */
const asMoment = (value: unknown): string | null => {
  const text = asText(value);
  return text !== null && !Number.isNaN(Date.parse(text)) ? text : null;
};

/**
 * The server's document, as typed objects, newest workout first.
 *
 * Tolerant in the same way `parsePlans` is: a workout with no id or no start is left out rather
 * than allowed to throw, and so is anything in a set that is not a number. One row that cannot
 * be read must not blank a coach's view of everything else the trainee did.
 */
export function parseSessions(raw: unknown): CoachSession[] {
  if (!Array.isArray(raw)) return [];
  const sessions: CoachSession[] = [];

  for (const entry of raw) {
    const row = asRecord(entry);
    const id = asText(row?.id);
    const startedAt = asMoment(row?.started_at);
    if (!row || !id || !startedAt) continue;

    const exercises: CoachSessionExercise[] = [];
    for (const [e, exerciseEntry] of (Array.isArray(row.exercises)
      ? row.exercises
      : []
    ).entries()) {
      const exercise = asRecord(exerciseEntry);
      if (!exercise) continue;
      const sets: CoachSet[] = [];
      for (const [s, setEntry] of (Array.isArray(exercise.sets) ? exercise.sets : []).entries()) {
        const set = asRecord(setEntry);
        if (!set) continue;
        sets.push({
          id: `${id}:${e}:${s}`,
          weight_kg: asNumber(set.weight_kg),
          reps: asNumber(set.reps),
          duration_seconds: asNumber(set.duration_seconds),
          distance_m: asNumber(set.distance_m),
          rpe: asNumber(set.rpe),
          is_warmup: asFlag(set.is_warmup),
          is_drop: asFlag(set.is_drop),
          to_failure: asFlag(set.to_failure),
        });
      }
      exercises.push({
        exerciseKey: asText(exercise.key),
        supersetWithNext: exercise.superset_with_next === true,
        sets,
      });
    }

    sessions.push({
      id,
      name: asText(row.name),
      planDayId: asText(row.plan_day_id),
      startedAt,
      endedAt: asMoment(row.ended_at),
      rpe: asNumber(row.rpe),
      exercises,
    });
  }

  return sessions.sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt));
}

/* -------------------------------------------------------------------------- */
/* What one workout amounted to                                                */
/* -------------------------------------------------------------------------- */

/** How long it took, in whole minutes; null if it has no end. */
export function sessionMinutes(session: CoachSession): number | null {
  if (!session.endedAt) return null;
  const minutes = Math.round((Date.parse(session.endedAt) - Date.parse(session.startedAt)) / 60000);
  return minutes >= 0 ? minutes : null;
}

/** The sets that count: every one that was not a warm-up. */
export function workingSetCount(session: CoachSession): number {
  return session.exercises.reduce(
    (sum, exercise) => sum + exercise.sets.filter((set) => set.is_warmup === 0).length,
    0,
  );
}

/** Weight times reps over the working sets, in kilograms — the same sum the trainee is shown. */
export function sessionVolumeKg(session: CoachSession): number {
  return session.exercises.reduce(
    (sum, exercise) =>
      sum +
      exercise.sets
        .filter((set) => set.is_warmup === 0)
        .reduce((inner, set) => inner + (set.weight_kg ?? 0) * (set.reps ?? 0), 0),
    0,
  );
}

/* -------------------------------------------------------------------------- */
/* Days                                                                        */
/* -------------------------------------------------------------------------- */

/**
 * The calendar day a moment falls on, as `YYYY-MM-DD`, where this phone is.
 *
 * Where *this* phone is, which is the coach's. A workout finished at half past midnight in the
 * trainee's evening could land on the next day for a coach nine time zones away; for two people
 * who meet in the same gym it is the same day, and the trainee's own zone is not something the
 * server knows.
 */
export function localDay(moment: string | Date): string {
  return localDate(typeof moment === 'string' ? new Date(moment) : moment);
}

/** The workouts of each day, by `localDay`. */
export function sessionsByDay(sessions: readonly CoachSession[]): Map<string, CoachSession[]> {
  const days = new Map<string, CoachSession[]>();
  for (const session of sessions) {
    const day = localDay(session.startedAt);
    days.set(day, [...(days.get(day) ?? []), session]);
  }
  return days;
}

export type DayOutcome =
  /** A workout was planned and the trainee trained. */
  | 'done'
  /** A workout was planned, the day is over, and nothing was logged. */
  | 'missed'
  /** Trained with nothing planned — on a rest day, or a day nobody had decided. */
  | 'extra'
  /** A workout is planned and the day is not over. */
  | 'planned'
  | 'rest'
  | 'nothing';

/**
 * How one day went, given what was planned for it and what was done on it.
 *
 * "Trained" is any finished workout that day, not specifically the one that was planned. A
 * coach who planned legs and sees that back was done wants to know the trainee turned up, and
 * can see which workout it was a tap away; calling that day "missed" would be the app taking a
 * side in a conversation that belongs to the two of them.
 *
 * Today is never "missed". The day is not over.
 */
export function dayOutcome(input: {
  date: string;
  today: string;
  /** From the calendar: workouts, `null` for a rest day, `undefined` for nothing decided. */
  planned: readonly string[] | null | undefined;
  trained: boolean;
}): DayOutcome {
  const hasWorkout = Array.isArray(input.planned) && input.planned.length > 0;
  if (hasWorkout) {
    if (input.trained) return 'done';
    return input.date < input.today ? 'missed' : 'planned';
  }
  if (input.trained) return 'extra';
  return input.planned === null ? 'rest' : 'nothing';
}

export interface Tally {
  /** Days in the span with a workout planned. */
  planned: number;
  /** Of those, the days the trainee trained. */
  done: number;
  /** Of those, the days that are over with nothing logged. */
  missed: number;
  /** Days trained with nothing planned. */
  extra: number;
}

/** The count of each outcome over a run of dates — a week, a month. */
export function tally(
  dates: readonly string[],
  calendar: CoachCalendar,
  byDay: ReadonlyMap<string, readonly CoachSession[]>,
  today: string,
): Tally {
  const result: Tally = { planned: 0, done: 0, missed: 0, extra: 0 };
  for (const date of dates) {
    const outcome = dayOutcome({
      date,
      today,
      planned: calendar.get(date),
      trained: (byDay.get(date)?.length ?? 0) > 0,
    });
    if (outcome === 'done' || outcome === 'missed' || outcome === 'planned') result.planned += 1;
    if (outcome === 'done') result.done += 1;
    if (outcome === 'missed') result.missed += 1;
    if (outcome === 'extra') result.extra += 1;
  }
  return result;
}

/** The seven dates of the week `day` is in, Sunday first — the week the app's calendars draw. */
export function weekOf(day: string): string[] {
  const [y, m, d] = day.split('-').map(Number);
  const start = new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1);
  start.setDate(start.getDate() - start.getDay());
  return Array.from({ length: 7 }, (_unused, offset) => {
    const date = new Date(start);
    date.setDate(start.getDate() + offset);
    return localDay(date);
  });
}
