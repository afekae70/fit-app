import { describe, expect, it } from 'vitest';

import { accountRoleKey, parseStoredRole, serialiseRole } from './accountRole.js';
import {
  createCoachingApi,
  interpretCoachingError,
  normaliseCode,
  parseCoaches,
  parseStatus,
  personLabel,
  type RpcClient,
} from './api.js';
import {
  addExercise,
  allDays,
  copyForTrainee,
  dayPayload,
  describeTargets,
  existingCopy,
  findDay,
  groupNamed,
  moveExercise,
  newExercise,
  NO_TIMING,
  parsePlans,
  parseSchedule,
  removeExercise,
  REPS,
  sameDay,
  SETS,
  stepTarget,
  type CoachDay,
  type OwnWorkout,
} from './planDocument.js';

/* -------------------------------------------------------------------------- */
/* What the server sends                                                       */
/* -------------------------------------------------------------------------- */

const SERVER_PLANS = [
  {
    id: 'plan-1',
    name: 'Gym',
    is_active: true,
    days: [
      {
        id: 'day-1',
        name: 'Push',
        work_seconds: null,
        rest_seconds: null,
        rounds: null,
        exercises: [
          {
            id: 'ex-1',
            exercise_key: 'Barbell Bench Press',
            target_sets: 4,
            target_reps_min: 6,
            target_reps_max: 8,
            notes: 'slow down',
          },
          {
            id: 'ex-2',
            exercise_key: 'Overhead Press',
            target_sets: null,
            target_reps_min: null,
            target_reps_max: null,
            notes: null,
          },
        ],
      },
      { id: 'day-2', name: null, work_seconds: 40, rest_seconds: 20, rounds: 3, exercises: [] },
    ],
  },
];

describe('reading a trainee\'s plans', () => {
  it('turns the document into typed groups, workouts and exercises, in order', () => {
    const plans = parsePlans(SERVER_PLANS);
    expect(plans).toHaveLength(1);
    expect(plans[0]).toMatchObject({ id: 'plan-1', name: 'Gym', isActive: true });
    expect(plans[0]?.days.map((day) => day.id)).toEqual(['day-1', 'day-2']);
    expect(plans[0]?.days[0]?.exercises[0]).toEqual({
      id: 'ex-1',
      exerciseKey: 'Barbell Bench Press',
      targetSets: 4,
      targetRepsMin: 6,
      targetRepsMax: 8,
      notes: 'slow down',
    });
  });

  it('keeps "no target" as no target, not as zero', () => {
    const exercise = parsePlans(SERVER_PLANS)[0]?.days[0]?.exercises[1];
    expect(exercise).toMatchObject({ targetSets: null, targetRepsMin: null, targetRepsMax: null });
  });

  it('is an empty list for anything that is not a list', () => {
    expect(parsePlans(null)).toEqual([]);
    expect(parsePlans({})).toEqual([]);
    expect(parsePlans('nope')).toEqual([]);
  });

  it('leaves out a row it cannot make sense of instead of failing the whole document', () => {
    const plans = parsePlans([
      { name: 'no id' },
      {
        id: 'plan-1',
        name: 'Gym',
        days: [
          { name: 'no id either' },
          {
            id: 'day-1',
            name: 'Push',
            exercises: [{ id: 'ex-1' }, { id: 'ex-2', exercise_key: 'Squat', target_sets: 'three' }],
          },
        ],
      },
    ]);
    expect(plans).toHaveLength(1);
    expect(plans[0]?.days).toHaveLength(1);
    // The exercise with no key is dropped; the one with a nonsense target keeps its place and
    // loses only the target.
    expect(plans[0]?.days[0]?.exercises).toEqual([
      {
        id: 'ex-2',
        exerciseKey: 'Squat',
        targetSets: null,
        targetRepsMin: null,
        targetRepsMax: null,
        notes: null,
      },
    ]);
  });

  it('reads a timed workout\'s timing, and none on an ordinary one', () => {
    const [plan] = parsePlans(SERVER_PLANS);
    expect(plan?.days[0]).toMatchObject({ workSeconds: null, restSeconds: null, rounds: null });
    expect(plan?.days[1]).toMatchObject({ workSeconds: 40, restSeconds: 20, rounds: 3 });
  });

  it('reads a server that says nothing about timing as an ordinary workout', () => {
    // Before migration 0010 the function sends no timing keys at all.
    const [plan] = parsePlans([{ id: 'p', name: 'Gym', days: [{ id: 'd', name: 'Push', exercises: [] }] }]);
    expect(plan?.days[0]).toMatchObject({ workSeconds: null, restSeconds: null, rounds: null });
  });

  it('finds a workout by its group and its own id', () => {
    const plans = parsePlans(SERVER_PLANS);
    expect(findDay(plans, 'plan-1', 'day-2')?.day.id).toBe('day-2');
    expect(findDay(plans, 'plan-1', 'missing')).toBeNull();
    expect(findDay(plans, 'missing', 'day-1')).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* Editing                                                                     */
/* -------------------------------------------------------------------------- */

const day = (): CoachDay => ({
  id: 'day-1',
  name: 'Push',
  ...NO_TIMING,
  exercises: [newExercise('a', 'Bench'), newExercise('b', 'Row'), newExercise('c', 'Curl')],
});

const order = (value: CoachDay) => value.exercises.map((exercise) => exercise.id);

describe('editing a workout', () => {
  it('starts a new exercise at three sets of eight to twelve, as the trainee\'s own screen does', () => {
    expect(newExercise('x', 'Squat')).toMatchObject({
      targetSets: 3,
      targetRepsMin: 8,
      targetRepsMax: 12,
      notes: null,
    });
  });

  it('adds to the end', () => {
    expect(order(addExercise(day(), newExercise('d', 'Squat')))).toEqual(['a', 'b', 'c', 'd']);
  });

  it('removes one and keeps the rest in order', () => {
    expect(order(removeExercise(day(), 'b'))).toEqual(['a', 'c']);
  });

  it('moves an exercise up and down by one', () => {
    expect(order(moveExercise(day(), 'c', -1))).toEqual(['a', 'c', 'b']);
    expect(order(moveExercise(day(), 'a', 1))).toEqual(['b', 'a', 'c']);
  });

  it('leaves the list alone at either end, and for an id that is not in it', () => {
    expect(order(moveExercise(day(), 'a', -1))).toEqual(['a', 'b', 'c']);
    expect(order(moveExercise(day(), 'c', 1))).toEqual(['a', 'b', 'c']);
    expect(order(moveExercise(day(), 'zzz', 1))).toEqual(['a', 'b', 'c']);
  });

  it('never changes the workout it was given', () => {
    const original = day();
    moveExercise(original, 'c', -1);
    removeExercise(original, 'a');
    addExercise(original, newExercise('d', 'Squat'));
    expect(order(original)).toEqual(['a', 'b', 'c']);
  });
});

describe('stepping a prescription', () => {
  const base = newExercise('a', 'Bench');

  it('moves sets by one and stops at the limits', () => {
    expect(stepTarget(base, 'sets', 1).targetSets).toBe(4);
    expect(stepTarget({ ...base, targetSets: SETS.min }, 'sets', -1).targetSets).toBe(SETS.min);
    expect(stepTarget({ ...base, targetSets: SETS.max }, 'sets', 1).targetSets).toBe(SETS.max);
  });

  it('keeps the rep range a range when the low end is pushed past the high end', () => {
    const narrow = { ...base, targetRepsMin: 12, targetRepsMax: 12 };
    expect(stepTarget(narrow, 'repsMin', 1)).toMatchObject({ targetRepsMin: 13, targetRepsMax: 13 });
  });

  it('keeps it a range when the high end is pulled below the low end', () => {
    const narrow = { ...base, targetRepsMin: 8, targetRepsMax: 8 };
    expect(stepTarget(narrow, 'repsMax', -1)).toMatchObject({ targetRepsMin: 7, targetRepsMax: 7 });
  });

  it('can never produce a range the server would refuse', () => {
    let exercise = base;
    for (let i = 0; i < 300; i++) {
      const field = (['sets', 'repsMin', 'repsMax'] as const)[i % 3]!;
      exercise = stepTarget(exercise, field, i % 7 < 4 ? 1 : -1);
      expect(exercise.targetRepsMin!).toBeLessThanOrEqual(exercise.targetRepsMax!);
      expect(exercise.targetRepsMin!).toBeGreaterThanOrEqual(REPS.min);
      expect(exercise.targetRepsMax!).toBeLessThanOrEqual(REPS.max);
      expect(exercise.targetSets!).toBeGreaterThanOrEqual(SETS.min);
    }
  });

  it('starts an empty target from the default rather than from nothing', () => {
    const empty = { ...base, targetSets: null, targetRepsMin: null, targetRepsMax: null };
    expect(stepTarget(empty, 'sets', 1).targetSets).toBe(4);
    expect(stepTarget(empty, 'repsMin', 1)).toMatchObject({ targetRepsMin: 9, targetRepsMax: 12 });
  });
});

describe('describing a prescription in a list', () => {
  const base = newExercise('a', 'Bench');

  it('writes sets and a range', () => {
    expect(describeTargets(base)).toBe('3 × 8–12');
  });

  it('writes one number when the range is a single value', () => {
    expect(describeTargets({ ...base, targetRepsMin: 10, targetRepsMax: 10 })).toBe('3 × 10');
  });

  it('says nothing when nothing is prescribed', () => {
    expect(
      describeTargets({ ...base, targetSets: null, targetRepsMin: null, targetRepsMax: null }),
    ).toBe('');
  });
});

/* -------------------------------------------------------------------------- */
/* Sending it back                                                             */
/* -------------------------------------------------------------------------- */

describe('what goes back to the server', () => {
  it('is the workout in the server\'s own column names, exercises in order', () => {
    expect(dayPayload(moveExercise(day(), 'c', -1))).toEqual({
      id: 'day-1',
      name: 'Push',
      work_seconds: null,
      rest_seconds: null,
      rounds: null,
      exercises: [
        { id: 'a', exercise_key: 'Bench', target_sets: 3, target_reps_min: 8, target_reps_max: 12, notes: null },
        { id: 'c', exercise_key: 'Curl', target_sets: 3, target_reps_min: 8, target_reps_max: 12, notes: null },
        { id: 'b', exercise_key: 'Row', target_sets: 3, target_reps_min: 8, target_reps_max: 12, notes: null },
      ],
    });
  });

  it('sends a blank name or note as nothing, not as an empty string', () => {
    const blank: CoachDay = {
      id: 'day-1',
      name: '   ',
      ...NO_TIMING,
      exercises: [{ ...newExercise('a', 'Bench'), notes: '  ' }],
    };
    const payload = dayPayload(blank) as { name: unknown; exercises: { notes: unknown }[] };
    expect(payload.name).toBeNull();
    expect(payload.exercises[0]?.notes).toBeNull();
  });

  it('survives the round trip: what was read is what would be sent', () => {
    const loaded = parsePlans(SERVER_PLANS)[0]!.days[0]!;
    expect(dayPayload(loaded)).toEqual(SERVER_PLANS[0]!.days[0]);
  });

  it('does not call a workout changed when nothing the server would see has', () => {
    const loaded = day();
    expect(sameDay(loaded, { ...loaded, name: 'Push ' })).toBe(true);
    expect(sameDay(loaded, moveExercise(loaded, 'c', -1))).toBe(false);
    expect(sameDay(loaded, { ...loaded, name: 'Pull' })).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
/* Status, codes and refusals                                                  */
/* -------------------------------------------------------------------------- */

describe('the coaching status', () => {
  it('reads a coach with trainees', () => {
    const status = parseStatus({
      role: 'coach',
      code: 'K7M2QP',
      coach: null,
      trainees: [
        { id: 't1', email: 'dana@example.com', name: null, since: '2026-10-01T10:00:00+00:00' },
        { id: 't2', email: 'omer@example.com', name: 'Omer', since: null },
      ],
    });
    expect(status.role).toBe('coach');
    expect(status.code).toBe('K7M2QP');
    expect(status.trainees.map(personLabel)).toEqual(['dana', 'Omer']);
  });

  it('reads a trainee with a coach', () => {
    const status = parseStatus({
      role: 'trainee',
      code: null,
      coach: { id: 'c1', email: 'coach@example.com', name: 'Yael' },
      trainees: [],
    });
    expect(status.coach).toMatchObject({ id: 'c1', name: 'Yael' });
  });

  it('reads anything it does not understand as the quiet case', () => {
    for (const raw of [null, undefined, 'x', [], { role: 'admin', trainees: 'many' }]) {
      expect(parseStatus(raw)).toEqual({
        role: 'trainee',
        code: null,
        isAdmin: false,
        coach: null,
        trainees: [],
      });
    }
  });

  it('is an administrator only when the server says exactly that', () => {
    expect(parseStatus({ is_admin: true }).isAdmin).toBe(true);
    // Anything short of `true` is no: a missing field on an older server, a string, a number.
    for (const value of [undefined, null, 'true', 1, {}]) {
      expect(parseStatus({ is_admin: value }).isAdmin).toBe(false);
    }
  });
});

describe('the list of coaches an administrator sees', () => {
  it('reads who they are, their code and how many they train', () => {
    expect(
      parseCoaches([
        { id: 'c1', email: 'yael@example.com', name: null, code: 'K7M2QP', trainees: 3 },
        { id: 'c2', email: 'noa@example.com', name: 'Noa', code: null, trainees: 0 },
      ]),
    ).toEqual([
      { id: 'c1', email: 'yael@example.com', name: null, code: 'K7M2QP', trainees: 3 },
      { id: 'c2', email: 'noa@example.com', name: 'Noa', code: null, trainees: 0 },
    ]);
  });

  it('is empty for anything that is not a list, and skips a row with no id', () => {
    expect(parseCoaches(null)).toEqual([]);
    expect(parseCoaches({})).toEqual([]);
    expect(parseCoaches([{ email: 'nobody@example.com' }])).toEqual([]);
  });
});

describe('a code as it is typed', () => {
  it('is upper-cased and loses its spaces', () => {
    expect(normaliseCode(' k7m 2qp ')).toBe('K7M2QP');
  });
});

describe('what a refusal means', () => {
  it.each([
    [{ code: 'PGRST202', message: 'Could not find the function public.coach_status' }, 'not_available'],
    [{ code: 'P0002', message: 'no_such_code' }, 'no_such_code'],
    [{ code: '22023', message: 'own_code' }, 'own_code'],
    [{ code: 'P0002', message: 'no_such_user' }, 'no_such_user'],
    [{ code: '42501', message: 'not_admin' }, 'not_admin'],
    [{ code: '42501', message: 'not_your_trainee' }, 'not_your_trainee'],
    [{ code: 'P0002', message: 'no_such_plan' }, 'gone'],
    [{ code: 'P0002', message: 'no_such_day' }, 'gone'],
    [{ code: '28000', message: 'not_signed_in' }, 'not_signed_in'],
    [{ code: 'PGRST301', message: 'JWT expired' }, 'not_signed_in'],
    [{ message: 'TypeError: Network request failed' }, 'offline'],
    [{ code: '22023', message: 'invalid_exercise' }, 'invalid'],
    [{ code: '23514', message: 'violates check constraint' }, 'invalid'],
    [{ code: '22P02', message: 'invalid input syntax for type uuid' }, 'invalid'],
    [{ code: 'XX000', message: 'something else' }, 'failed'],
  ] as const)('%j is %s', (error, expected) => {
    expect(interpretCoachingError(error)).toBe(expected);
  });

  it('does not mistake "no such plan" for a wrong code', () => {
    // Both are P0002. The message is what tells them apart, and the remedies are opposite:
    // one asks for the code again, the other says the thing being edited is gone.
    expect(interpretCoachingError({ code: 'P0002', message: 'no_such_plan' })).not.toBe('no_such_code');
  });
});

describe('calling the server', () => {
  const answering = (
    answers: Record<string, { data?: unknown; error?: { code?: string; message?: string } }>,
  ) => {
    const calls: { fn: string; args: unknown }[] = [];
    const client: RpcClient = {
      rpc: (fn, args) => {
        calls.push({ fn, args });
        const answer = answers[fn] ?? {};
        return Promise.resolve({ data: answer.data ?? null, error: answer.error ?? null });
      },
    };
    return { api: createCoachingApi(client), calls };
  };

  it('joins with the code tidied, and answers with the new status', async () => {
    const { api, calls } = answering({
      coach_join: { data: { role: 'trainee', coach: { id: 'c1', email: 'coach@example.com' } } },
    });
    const result = await api.join(' k7m2qp ');
    expect(calls).toEqual([{ fn: 'coach_join', args: { p_code: 'K7M2QP' } }]);
    expect(result).toMatchObject({ ok: true, value: { coach: { id: 'c1' } } });
  });

  it('sends a workout as the whole list it should now be', async () => {
    const { api, calls } = answering({});
    await api.saveDay('trainee-1', 'plan-1', day());
    expect(calls[0]?.fn).toBe('coach_save_day');
    expect(calls[0]?.args).toMatchObject({
      p_trainee: 'trainee-1',
      p_plan: 'plan-1',
      p_day: { id: 'day-1', exercises: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] },
    });
  });

  it('appoints a coach by email, trimmed, and answers with the list as it now stands', async () => {
    const { api, calls } = answering({
      admin_set_coach: { data: [{ id: 'c1', email: 'yael@example.com', code: 'K7M2QP', trainees: 0 }] },
    });
    const result = await api.setCoach('  yael@example.com ', true);
    expect(calls).toEqual([
      { fn: 'admin_set_coach', args: { p_email: 'yael@example.com', p_on: true } },
    ]);
    expect(result).toMatchObject({ ok: true, value: [{ id: 'c1', code: 'K7M2QP' }] });
  });

  it('is told no when the account asking is not an administrator', async () => {
    const { api } = answering({
      admin_set_coach: { error: { code: '42501', message: 'not_admin' } },
    });
    expect(await api.setCoach('yael@example.com', true)).toEqual({ ok: false, error: 'not_admin' });
  });

  it('has no way to make itself a coach', () => {
    // There used to be an `enable`. Who is a coach is the owner's decision, made through
    // `setCoach` by an administrator; a call the app does not have is one it cannot make.
    const { api } = answering({});
    expect(Object.keys(api)).not.toContain('enable');
    expect(Object.keys(api)).not.toContain('disable');
  });

  it('reports a refusal by what it means', async () => {
    const { api } = answering({ coach_join: { error: { code: 'P0002', message: 'no_such_code' } } });
    expect(await api.join('ZZZZZZ')).toEqual({ ok: false, error: 'no_such_code' });
  });

  it('treats a request that throws as one that never arrived', async () => {
    const api = createCoachingApi({
      rpc: () => Promise.reject(new TypeError('Network request failed')),
    });
    expect(await api.status()).toEqual({ ok: false, error: 'offline' });
  });

  it('says so when the server has never heard of coaching', async () => {
    const { api } = answering({
      coach_status: { error: { code: 'PGRST202', message: 'Could not find the function' } },
    });
    expect(await api.status()).toEqual({ ok: false, error: 'not_available' });
  });
});

/* -------------------------------------------------------------------------- */
/* A trainee's calendar, and giving them one of the coach's own workouts       */
/* -------------------------------------------------------------------------- */

describe('reading a trainee\'s calendar', () => {
  it('groups the rows by date, workouts in the order the day is done', () => {
    const calendar = parseSchedule([
      { date: '2026-10-11', plan_day_id: 'push', position: 0 },
      { date: '2026-10-11', plan_day_id: 'abs', position: 1 },
      { date: '2026-10-13', plan_day_id: 'legs', position: 0 },
    ]);
    expect(calendar.get('2026-10-11')).toEqual(['push', 'abs']);
    expect(calendar.get('2026-10-13')).toEqual(['legs']);
  });

  it('keeps the three states apart: workouts, a rest day, and nothing decided', () => {
    const calendar = parseSchedule([
      { date: '2026-10-11', plan_day_id: 'push', position: 0 },
      { date: '2026-10-12', plan_day_id: null, position: 0 },
    ]);
    expect(calendar.get('2026-10-11')).toEqual(['push']);
    expect(calendar.get('2026-10-12')).toBeNull();
    // Absent, not null: an undecided date is not a rest day.
    expect(calendar.has('2026-10-13')).toBe(false);
  });

  it('counts a workout once when two rows name it, and lets it outrank a stray rest row', () => {
    const calendar = parseSchedule([
      { date: '2026-10-11', plan_day_id: 'legs', position: 0 },
      { date: '2026-10-11', plan_day_id: 'legs', position: 0 },
      { date: '2026-10-11', plan_day_id: null, position: 0 },
    ]);
    expect(calendar.get('2026-10-11')).toEqual(['legs']);
  });

  it('is empty for anything that is not a list', () => {
    expect(parseSchedule(null).size).toBe(0);
    expect(parseSchedule({}).size).toBe(0);
    expect(parseSchedule([{ plan_day_id: 'no date' }]).size).toBe(0);
  });
});

describe('giving a trainee one of the coach\'s own workouts', () => {
  const legs: OwnWorkout = {
    groupName: 'Gym',
    name: 'Legs',
    ...NO_TIMING,
    exercises: [
      { exerciseKey: 'Squat', targetSets: 4, targetRepsMin: 5, targetRepsMax: 8, notes: null },
      { exerciseKey: 'Leg Press', targetSets: 3, targetRepsMin: 10, targetRepsMax: 12, notes: 'slow' },
    ],
  };

  let n = 0;
  const newId = () => `id-${++n}`;

  const trainee = () => [
    {
      id: 'plan-1',
      name: 'Gym',
      isActive: true,
      days: [{ ...copyForTrainee(legs, newId), id: 'their-legs' }],
    },
  ];

  it('writes it as a new workout of theirs: the same content, every id new', () => {
    const copy = copyForTrainee(legs, newId);
    expect(copy.name).toBe('Legs');
    expect(copy.exercises.map((exercise) => exercise.exerciseKey)).toEqual(['Squat', 'Leg Press']);
    expect(copy.exercises[1]).toMatchObject({ targetSets: 3, targetRepsMin: 10, notes: 'slow' });
    const ids = [copy.id, ...copy.exercises.map((exercise) => exercise.id)];
    expect(new Set(ids).size).toBe(3);
  });

  it('finds the copy they already have instead of making another', () => {
    // The same leg day on four Tuesdays is one workout on their plan screen, not four.
    expect(existingCopy(trainee(), legs)).toEqual({ planId: 'plan-1', dayId: 'their-legs' });
  });

  it('does not take an edited copy for the same workout', () => {
    const plans = trainee();
    plans[0]!.days[0]!.exercises[0]!.targetSets = 5;
    expect(existingCopy(plans, legs)).toBeNull();
  });

  it('does not take a workout of the same name in a different group, or in a different order', () => {
    const elsewhere = trainee();
    elsewhere[0]!.name = 'Home';
    expect(existingCopy(elsewhere, legs)).toBeNull();

    const reordered = trainee();
    reordered[0]!.days[0]!.exercises.reverse();
    expect(existingCopy(reordered, legs)).toBeNull();
  });

  it('carries the timing of a timed workout, and tells a timed copy from an ordinary one', () => {
    // Forty seconds on, twenty off, three rounds — the part that used to be left behind.
    const intervals: OwnWorkout = { ...legs, workSeconds: 40, restSeconds: 20, rounds: 3 };
    const copy = copyForTrainee(intervals, newId);
    expect(copy).toMatchObject({ workSeconds: 40, restSeconds: 20, rounds: 3 });
    expect(dayPayload(copy)).toMatchObject({ work_seconds: 40, rest_seconds: 20, rounds: 3 });

    // The same exercises under the same name, but not timed: a different workout.
    expect(existingCopy(trainee(), intervals)).toBeNull();
  });

  it('finds the group to put a copy in by its name, ignoring stray spaces', () => {
    expect(groupNamed(trainee(), ' Gym ')?.id).toBe('plan-1');
    expect(groupNamed(trainee(), 'Home')).toBeNull();
  });

  it('lists every workout a trainee has with its group, for choosing from', () => {
    const days = allDays(parsePlans(SERVER_PLANS));
    expect(days.map((entry) => [entry.planName, entry.day.id, entry.number])).toEqual([
      ['Gym', 'day-1', 1],
      ['Gym', 'day-2', 2],
    ]);
  });
});

describe('setting a trainee\'s day', () => {
  it('sends the date, the workouts in order, and whether an empty day is a rest day', async () => {
    const calls: { fn: string; args: unknown }[] = [];
    const api = createCoachingApi({
      rpc: (fn, args) => {
        calls.push({ fn, args });
        return Promise.resolve({ data: null, error: null });
      },
    });

    await api.setSchedule('trainee-1', '2026-10-13', ['legs', 'abs'], false);
    await api.setSchedule('trainee-1', '2026-10-14', [], true);

    expect(calls).toEqual([
      {
        fn: 'coach_set_schedule',
        args: { p_trainee: 'trainee-1', p_date: '2026-10-13', p_plan_days: ['legs', 'abs'], p_rest: false },
      },
      {
        fn: 'coach_set_schedule',
        args: { p_trainee: 'trainee-1', p_date: '2026-10-14', p_plan_days: [], p_rest: true },
      },
    ]);
  });

  it('reads the month back as a calendar', async () => {
    const api = createCoachingApi({
      rpc: () =>
        Promise.resolve({
          data: [{ date: '2026-10-13', plan_day_id: 'legs', position: 0 }],
          error: null,
        }),
    });
    const result = await api.schedule('trainee-1', '2026-09-27', '2026-10-31');
    expect(result.ok && result.value.get('2026-10-13')).toEqual(['legs']);
  });
});

describe('remembering what kind of account this is', () => {
  it('reads back exactly what was stored', () => {
    for (const role of [
      { role: 'trainee', isAdmin: false },
      { role: 'coach', isAdmin: false },
      { role: 'coach', isAdmin: true },
      { role: 'trainee', isAdmin: true },
    ] as const) {
      expect(parseStoredRole(serialiseRole(role))).toEqual(role);
    }
  });

  it('is no answer, rather than a guess, for nothing stored or something unrecognised', () => {
    // Null is drawn as nothing at all. "trainee" as a fallback would tell a coach, on every
    // screen, that they are not one.
    for (const raw of [null, undefined, '', 'admin', 'owner', 'coach+', 'coach+root', 'coach+admin+x']) {
      expect(parseStoredRole(raw)).toBeNull();
    }
  });

  it('keeps each account\'s answer under a key of its own', () => {
    expect(accountRoleKey('11111111-1111-4111-8111-111111111111')).not.toBe(
      accountRoleKey('22222222-2222-4222-8222-222222222222'),
    );
    // The store accepts letters, digits, dots, dashes and underscores, and nothing else.
    expect(accountRoleKey('a b/c@d')).toMatch(/^[A-Za-z0-9._-]+$/);
  });
});
