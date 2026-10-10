/**
 * A trainee's finished workouts as a coach reads them: what the server's document turns into,
 * and what counts as a day that went to plan.
 */

import { describe, expect, it } from 'vitest';

import { createCoachingApi } from './api.js';
import type { CoachCalendar } from './planDocument.js';
import {
  dayOutcome,
  localDay,
  parseSessions,
  sessionMinutes,
  sessionsByDay,
  sessionVolumeKg,
  tally,
  weekOf,
  workingSetCount,
  type CoachSession,
} from './sessionDocument.js';

/** A workout as `coach_get_sessions` sends it. */
const squatDay = {
  id: 's1',
  name: 'רגליים',
  plan_day_id: 'day-legs',
  started_at: '2026-10-06T16:00:00+00:00',
  ended_at: '2026-10-06T16:52:00+00:00',
  rpe: 8,
  exercises: [
    {
      key: 'Back Squat',
      superset_with_next: false,
      sets: [
        {
          weight_kg: 60,
          reps: 5,
          duration_seconds: null,
          distance_m: null,
          rpe: null,
          is_warmup: true,
          is_drop: false,
          to_failure: false,
        },
        {
          weight_kg: 100,
          reps: 8,
          duration_seconds: null,
          distance_m: null,
          rpe: 8,
          is_warmup: false,
          is_drop: false,
          to_failure: false,
        },
        {
          weight_kg: 100,
          reps: 7,
          duration_seconds: null,
          distance_m: null,
          rpe: 9,
          is_warmup: false,
          is_drop: false,
          to_failure: true,
        },
        {
          weight_kg: 80,
          reps: 10,
          duration_seconds: null,
          distance_m: null,
          rpe: null,
          is_warmup: false,
          is_drop: true,
          to_failure: false,
        },
      ],
    },
    {
      key: 'Plank',
      superset_with_next: false,
      sets: [
        {
          weight_kg: null,
          reps: null,
          duration_seconds: 60,
          distance_m: null,
          rpe: null,
          is_warmup: false,
          is_drop: false,
          to_failure: false,
        },
      ],
    },
  ],
};

const one = (raw: unknown): CoachSession => parseSessions([raw])[0]!;

describe('reading what the server sent', () => {
  it('turns a workout into its exercises and the sets that were done', () => {
    const session = one(squatDay);
    expect(session).toMatchObject({
      id: 's1',
      name: 'רגליים',
      planDayId: 'day-legs',
      rpe: 8,
    });
    expect(session.exercises.map((exercise) => exercise.exerciseKey)).toEqual([
      'Back Squat',
      'Plank',
    ]);
    expect(session.exercises[0]!.sets).toHaveLength(4);
  });

  it('gives sets the shape of the app’s own set rows, flags as 0 and 1', () => {
    // The same card draws a workout for the person who did it and for their coach.
    const [warmup, , failure, drop] = one(squatDay).exercises[0]!.sets;
    expect(warmup).toMatchObject({
      weight_kg: 60,
      reps: 5,
      is_warmup: 1,
      is_drop: 0,
      to_failure: 0,
    });
    expect(failure).toMatchObject({ rpe: 9, to_failure: 1, is_warmup: 0 });
    expect(drop).toMatchObject({ weight_kg: 80, is_drop: 1 });
  });

  it('gives every set an id of its own, since the server sends none', () => {
    const ids = one(squatDay).exercises.flatMap((exercise) => exercise.sets.map((set) => set.id));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('reads a weight the database sent as text', () => {
    // A `numeric` column can arrive either way, depending on what serialised it.
    const session = one({
      ...squatDay,
      exercises: [{ key: 'Back Squat', sets: [{ weight_kg: '82.50', reps: 6 }] }],
    });
    expect(session.exercises[0]!.sets[0]).toMatchObject({ weight_kg: 82.5, reps: 6 });
  });

  it('puts the newest workout first, whatever order they arrived in', () => {
    const sessions = parseSessions([
      { ...squatDay, id: 'old', started_at: '2026-10-01T10:00:00+00:00' },
      { ...squatDay, id: 'new', started_at: '2026-10-08T10:00:00+00:00' },
      { ...squatDay, id: 'mid', started_at: '2026-10-04T10:00:00+00:00' },
    ]);
    expect(sessions.map((session) => session.id)).toEqual(['new', 'mid', 'old']);
  });

  it('leaves out what it cannot read, and keeps the rest', () => {
    const sessions = parseSessions([
      null,
      'nonsense',
      { id: 'no-start' },
      { id: 'bad-start', started_at: 'yesterday' },
      { started_at: '2026-10-06T16:00:00+00:00' },
      squatDay,
      { id: 'bare', started_at: '2026-10-05T16:00:00+00:00' },
    ]);
    expect(sessions.map((session) => session.id)).toEqual(['s1', 'bare']);
    expect(sessions[1]).toMatchObject({
      name: null,
      planDayId: null,
      endedAt: null,
      exercises: [],
    });
  });

  it('is an empty list for anything that is not a list', () => {
    for (const raw of [null, undefined, {}, 'x', 5]) expect(parseSessions(raw)).toEqual([]);
  });

  it('reads the note the trainee wrote on the workout', () => {
    expect(one({ ...squatDay, note: 'כתף שמאל כאבה בסט האחרון' }).note).toBe(
      'כתף שמאל כאבה בסט האחרון',
    );
  });

  it('has no note when none was written, or only spaces were', () => {
    expect(one(squatDay).note).toBeNull();
    expect(one({ ...squatDay, note: '   ' }).note).toBeNull();
    expect(one({ ...squatDay, note: 5 }).note).toBeNull();
  });

  it('has nowhere to put a body weight, or a note on an exercise or a set, even if a server sent one', () => {
    // The server sends one note — the workout's own — and a trainee has been told so. If some
    // later version sent the rest by mistake, the coach's side must not turn out to have been
    // holding it all along.
    const session = one({
      ...squatDay,
      bodyweight_kg: 81.4,
      note: 'for the coach',
      notes: 'raw column, not the field',
      exercises: [
        { key: 'Back Squat', notes: 'private', sets: [{ weight_kg: 100, reps: 5, notes: 'x' }] },
      ],
    });
    const text = JSON.stringify(session);
    expect(session.note).toBe('for the coach');
    expect(text).not.toContain('81.4');
    expect(text).not.toContain('raw column');
    expect(text).not.toContain('private');
    expect(text).not.toContain('notes');
  });
});

describe('what a workout amounted to', () => {
  it('counts the sets that were not warm-ups', () => {
    expect(workingSetCount(one(squatDay))).toBe(4);
  });

  it('adds up weight times reps over those sets', () => {
    // 100×8 + 100×7 + 80×10; the warm-up and the plank add nothing.
    expect(sessionVolumeKg(one(squatDay))).toBe(2300);
  });

  it('says how long it took', () => {
    expect(sessionMinutes(one(squatDay))).toBe(52);
  });

  it('has no length without an end, or with an end before its start', () => {
    expect(sessionMinutes(one({ ...squatDay, ended_at: null }))).toBeNull();
    expect(sessionMinutes(one({ ...squatDay, ended_at: '2026-10-06T15:00:00+00:00' }))).toBeNull();
  });
});

describe('how a day went', () => {
  const TODAY = '2026-10-08';
  const day = (
    planned: readonly string[] | null | undefined,
    trained: boolean,
    date = '2026-10-06',
  ) => dayOutcome({ date, today: TODAY, planned, trained });

  it('is done when a workout was planned and the trainee trained', () => {
    expect(day(['legs'], true)).toBe('done');
  });

  it('is missed when one was planned, the day is over, and nothing was logged', () => {
    expect(day(['legs'], false)).toBe('missed');
  });

  it('is never missed today, or on a day that has not come', () => {
    expect(day(['legs'], false, TODAY)).toBe('planned');
    expect(day(['legs'], false, '2026-10-09')).toBe('planned');
  });

  it('is extra when the trainee trained with nothing planned, or on a rest day', () => {
    expect(day(undefined, true)).toBe('extra');
    expect(day(null, true)).toBe('extra');
  });

  it('is a rest day or nothing at all when nothing was planned and nothing done', () => {
    expect(day(null, false)).toBe('rest');
    expect(day(undefined, false)).toBe('nothing');
    expect(day([], false)).toBe('nothing');
  });
});

describe('a week against its plan', () => {
  const TODAY = '2026-10-08'; // a Thursday
  const week = weekOf(TODAY);
  const session = (id: string, startedAt: string) =>
    one({ ...squatDay, id, started_at: startedAt });

  it('is the seven dates from Sunday, as the app’s calendars draw a week', () => {
    expect(week).toEqual([
      '2026-10-04',
      '2026-10-05',
      '2026-10-06',
      '2026-10-07',
      '2026-10-08',
      '2026-10-09',
      '2026-10-10',
    ]);
    expect(weekOf('2026-10-04')).toEqual(week);
    expect(weekOf('2026-10-10')).toEqual(week);
  });

  it('counts what was planned, what of it was done, what was missed and what was extra', () => {
    const calendar: CoachCalendar = new Map<string, string[] | null>([
      ['2026-10-04', ['push']], // Sunday: done
      ['2026-10-05', null], // Monday: rest, and trained anyway
      ['2026-10-06', ['pull']], // Tuesday: missed
      ['2026-10-08', ['legs']], // today: still to come
      ['2026-10-10', ['push']], // Saturday: still to come
    ]);
    const byDay = sessionsByDay([
      session('a', new Date(2026, 9, 4, 18).toISOString()),
      session('b', new Date(2026, 9, 5, 7).toISOString()),
    ]);

    expect(tally(week, calendar, byDay, TODAY)).toEqual({
      planned: 4,
      done: 1,
      missed: 1,
      extra: 1,
    });
  });

  it('counts a day with two workouts once', () => {
    const calendar: CoachCalendar = new Map([['2026-10-04', ['push', 'core']]]);
    const byDay = sessionsByDay([
      session('a', new Date(2026, 9, 4, 8).toISOString()),
      session('b', new Date(2026, 9, 4, 18).toISOString()),
    ]);
    expect(tally(week, calendar, byDay, TODAY)).toEqual({
      planned: 1,
      done: 1,
      missed: 0,
      extra: 0,
    });
  });

  it('files a workout under the day it started on this phone', () => {
    const lateEvening = new Date(2026, 9, 6, 23, 40);
    expect(localDay(lateEvening.toISOString())).toBe('2026-10-06');
    expect([...sessionsByDay([session('a', lateEvening.toISOString())]).keys()]).toEqual([
      '2026-10-06',
    ]);
  });
});

describe('asking the server', () => {
  function server(answer: { data: unknown; error: { code?: string; message?: string } | null }) {
    const calls: { fn: string; args?: Record<string, unknown> }[] = [];
    const api = createCoachingApi({
      rpc: async (fn, args) => {
        calls.push({ fn, args });
        return answer;
      },
    });
    return { api, calls };
  }

  it('calls the one function, with the trainee and the span, and nothing else', async () => {
    const { api, calls } = server({ data: [squatDay], error: null });

    const result = await api.sessions(
      'trainee-1',
      '2026-08-13T00:00:00.000Z',
      '2026-10-09T00:00:00.000Z',
    );

    expect(calls).toEqual([
      {
        fn: 'coach_get_sessions',
        args: {
          p_trainee: 'trainee-1',
          p_from: '2026-08-13T00:00:00.000Z',
          p_to: '2026-10-09T00:00:00.000Z',
        },
      },
    ]);
    expect(result.ok && result.value.map((session) => session.id)).toEqual(['s1']);
  });

  it('says the server has not been given the function yet, rather than that something broke', async () => {
    const { api } = server({
      data: null,
      error: { code: 'PGRST202', message: 'Could not find the function public.coach_get_sessions' },
    });
    expect(await api.sessions('t', 'a', 'b')).toEqual({ ok: false, error: 'not_available' });
  });

  it('says so when the trainee has ended the link', async () => {
    const { api } = server({ data: null, error: { code: '42501', message: 'not_your_trainee' } });
    expect(await api.sessions('t', 'a', 'b')).toEqual({ ok: false, error: 'not_your_trainee' });
  });
});
