/**
 * The ready-made programmes: that every one of them is a plan the app can actually hold, and
 * that adding one makes exactly the rows the plan screen would have made.
 *
 * The database is real. The first half is about the data itself, because that is where this
 * feature breaks: a programme is a list of exercise names typed by hand, and one that does not
 * match the catalogue becomes a workout with a blank row in it on somebody's first day.
 */

import { EXERCISE_BY_KEY } from '@fit/shared';
import { afterEach, describe, expect, it } from 'vitest';

import { getPlanDetail, listPlans } from '../db/plans.js';
import type { SqlExecutor } from '../db/executor.js';
import { createTestExecutor } from '../db/testUtils.js';
import { SYNC_TABLES } from '../sync/tables.js';
import { applyStarterProgram } from './applyStarterProgram.js';
import {
  STARTER_DAY_CHOICES,
  STARTER_PROGRAMS,
  starterFit,
  starterProgramsFor,
  starterTargets,
} from './starterPrograms.js';

const USER = 'user-1';

const open: { close: () => void }[] = [];
function database() {
  const db = createTestExecutor();
  open.push(db);
  return db;
}
afterEach(() => {
  for (const db of open.splice(0)) db.close();
});

function ids() {
  let n = 0;
  return () => `id-${++n}`;
}

const everyExercise = STARTER_PROGRAMS.flatMap((program) =>
  program.days.flatMap((day) =>
    day.exercises.map((exercise) => ({ program: program.id, day: day.name.en, exercise })),
  ),
);

describe('the programmes themselves', () => {
  it('has some', () => {
    // Everything below iterates over what is in the list; an empty list would pass it all.
    expect(STARTER_PROGRAMS.length).toBeGreaterThanOrEqual(5);
    expect(everyExercise.length).toBeGreaterThan(60);
  });

  it.each(
    everyExercise.map((entry) => [
      `${entry.program} / ${entry.day} / ${entry.exercise.key}`,
      entry,
    ]),
  )('%s is an exercise the catalogue has', (_label, entry) => {
    expect(EXERCISE_BY_KEY.has(entry.exercise.key)).toBe(true);
  });

  it('gives a rep range to everything counted in reps, and to nothing that is held for time', () => {
    for (const { exercise } of everyExercise) {
      const loadType = EXERCISE_BY_KEY.get(exercise.key)?.loadType ?? 'weight_reps';
      const counted = ['weight_reps', 'bodyweight', 'bodyweight_plus'].includes(loadType);
      // Named in the message, since a bare true/false says nothing about which of ninety.
      expect([exercise.key, exercise.reps !== undefined]).toEqual([exercise.key, counted]);
    }
  });

  it('prescribes numbers a person could follow', () => {
    for (const { exercise } of everyExercise) {
      expect(exercise.sets).toBeGreaterThanOrEqual(2);
      expect(exercise.sets).toBeLessThanOrEqual(5);
      if (exercise.reps) {
        const [low, high] = exercise.reps;
        expect(low).toBeGreaterThanOrEqual(3);
        expect(high).toBeGreaterThan(low);
        expect(high).toBeLessThanOrEqual(25);
      }
    }
  });

  it('never repeats an exercise inside one workout', () => {
    for (const program of STARTER_PROGRAMS) {
      for (const day of program.days) {
        const keys = day.exercises.map((exercise) => exercise.key);
        expect([day.name.en, new Set(keys).size]).toEqual([day.name.en, keys.length]);
      }
    }
  });

  it('names every programme and workout in both languages, and no two alike', () => {
    for (const program of STARTER_PROGRAMS) {
      for (const text of [program.name, program.blurb, ...program.days.map((day) => day.name)]) {
        expect(text.he.trim()).not.toBe('');
        expect(text.en.trim()).not.toBe('');
      }
      // Two workouts with one name in a plan are two rows the user cannot tell apart.
      for (const language of ['he', 'en'] as const) {
        const names = program.days.map((day) => day.name[language]);
        expect(new Set(names).size).toBe(names.length);
      }
    }
    expect(new Set(STARTER_PROGRAMS.map((program) => program.id)).size).toBe(
      STARTER_PROGRAMS.length,
    );
    expect(new Set(STARTER_PROGRAMS.map((program) => program.name.he)).size).toBe(
      STARTER_PROGRAMS.length,
    );
  });

  it('asks for nothing but the floor in the programme that says it needs no equipment', () => {
    const home = STARTER_PROGRAMS.filter((program) => program.place === 'home');
    expect(home.length).toBeGreaterThan(0);
    for (const program of home) {
      for (const day of program.days) {
        for (const exercise of day.exercises) {
          expect([exercise.key, EXERCISE_BY_KEY.get(exercise.key)?.equipmentSlug]).toEqual([
            exercise.key,
            'none',
          ]);
        }
      }
    }
  });

  it('has as many workouts as the days it is for, or goes round them a whole number of times', () => {
    for (const program of STARTER_PROGRAMS.filter((p) => p.place === 'gym')) {
      for (const days of program.daysPerWeek) {
        expect([program.id, days % program.days.length]).toEqual([program.id, 0]);
      }
    }
  });
});

describe('which programme is offered', () => {
  it.each(STARTER_DAY_CHOICES)(
    'has one that suits %i days a week at the gym, and puts it first',
    (days) => {
      const offered = starterProgramsFor(days, 'gym');
      expect(starterFit(offered[0]!, days)).toBe(0);
    },
  );

  it('offers every gym programme, the fits before the near misses', () => {
    const offered = starterProgramsFor(3, 'gym');
    expect(offered).toHaveLength(STARTER_PROGRAMS.filter((p) => p.place === 'gym').length);
    const fits = offered.map((program) => starterFit(program, 3));
    expect(fits).toEqual([...fits].sort((a, b) => a - b));
    expect(offered.slice(0, 2).map((program) => program.id)).toEqual([
      'full-body-3',
      'push-pull-legs',
    ]);
  });

  it('keeps the two places apart', () => {
    expect(starterProgramsFor(3, 'home').every((program) => program.place === 'home')).toBe(true);
    expect(starterProgramsFor(3, 'gym').every((program) => program.place === 'gym')).toBe(true);
  });

  it('still offers something at home for a number of days nothing there was written for', () => {
    expect(starterProgramsFor(6, 'home').length).toBeGreaterThan(0);
  });
});

describe('what an exercise is prescribed', () => {
  it('is sets and a rep range for a lift', () => {
    expect(starterTargets({ key: 'Back Squat', sets: 4, reps: [6, 10] })).toEqual({
      targetSets: 4,
      targetRepsMin: 6,
      targetRepsMax: 10,
    });
  });

  it('is sets alone for a hold, even if a rep range was written beside it by mistake', () => {
    expect(starterTargets({ key: 'Plank', sets: 3, reps: [10, 15] })).toEqual({
      targetSets: 3,
      targetRepsMin: null,
      targetRepsMax: null,
    });
  });
});

describe('adding a programme', () => {
  const program = STARTER_PROGRAMS.find((p) => p.id === 'upper-lower-4')!;

  it('makes the plan, its workouts in order, and their exercises in order', async () => {
    const db = database();

    const planId = await applyStarterProgram(db, USER, ids(), program, 'he');

    const { plan, days } = await getPlanDetail(db, planId);
    expect(plan?.name).toBe(program.name.he);
    expect(days.map((day) => day.name)).toEqual(program.days.map((day) => day.name.he));
    expect(days.map((day) => day.day_index)).toEqual([1, 2, 3, 4]);
    for (const [index, day] of days.entries()) {
      const wanted = program.days[index]!.exercises;
      expect(day.exercises.map((row) => row.exercise_key)).toEqual(wanted.map((e) => e.key));
      expect(day.exercises.map((row) => row.order_index)).toEqual(wanted.map((_e, i) => i + 1));
    }
  });

  it('writes the prescription, with no rep target on a hold', async () => {
    const db = database();
    const planId = await applyStarterProgram(db, USER, ids(), program, 'en');
    const { days } = await getPlanDetail(db, planId);

    const lowerA = days[1]!.exercises;
    expect(lowerA[0]).toMatchObject({
      exercise_key: 'Back Squat',
      target_sets: 4,
      target_reps_min: 6,
      target_reps_max: 10,
    });
    expect(lowerA.at(-1)).toMatchObject({
      exercise_key: 'Plank',
      target_sets: 3,
      target_reps_min: null,
      target_reps_max: null,
    });
  });

  it('names it in the language asked for', async () => {
    const db = database();
    const planId = await applyStarterProgram(db, USER, ids(), program, 'en');
    const { plan, days } = await getPlanDetail(db, planId);
    expect(plan?.name).toBe('Upper · Lower · 4 days a week');
    expect(days[0]?.name).toBe('Upper A');
  });

  it('makes the first plan of an account the active one, like one made by hand', async () => {
    const db = database();
    await applyStarterProgram(db, USER, ids(), program, 'he');
    const plans = await listPlans(db, USER);
    expect(plans).toHaveLength(1);
    expect(plans[0]?.is_active).toBe(1);
  });

  it('belongs to the account it was added for, and to no other', async () => {
    const db = database();
    await applyStarterProgram(db, USER, ids(), program, 'he');
    expect(await listPlans(db, 'someone-else')).toEqual([]);
  });

  it('can be added twice without the two getting in each other’s way', async () => {
    const db = database();
    const newId = ids();
    const first = await applyStarterProgram(db, USER, newId, program, 'he');
    const second = await applyStarterProgram(db, USER, newId, program, 'he');
    expect(first).not.toBe(second);
    expect((await getPlanDetail(db, first)).days).toHaveLength(4);
    expect((await getPlanDetail(db, second)).days).toHaveLength(4);
  });

  it('is rows sync will carry: every one stamped, in tables that travel', async () => {
    const db = database();
    const planId = await applyStarterProgram(db, USER, ids(), program, 'he');
    const synced = new Set(SYNC_TABLES.map((table) => table.table));
    for (const table of ['plans', 'plan_days', 'plan_day_exercises']) {
      expect(synced.has(table)).toBe(true);
    }
    const unstamped = await db.get<{ n: number }>(
      `SELECT (SELECT COUNT(*) FROM plans WHERE id = ? AND updated_at IS NULL)
            + (SELECT COUNT(*) FROM plan_days WHERE plan_id = ? AND updated_at IS NULL)
            + (SELECT COUNT(*) FROM plan_day_exercises pde JOIN plan_days pd ON pd.id = pde.plan_day_id
                WHERE pd.plan_id = ? AND pde.updated_at IS NULL) AS n`,
      [planId, planId, planId],
    );
    expect(unstamped?.n).toBe(0);
  });

  it('leaves nothing behind when it cannot be finished', async () => {
    const real = database();
    let exercises = 0;
    // The seventh exercise will not go in: partway through the second workout.
    const failing: SqlExecutor = {
      ...real,
      run: async (sql, params) => {
        if (/INSERT INTO plan_day_exercises/.test(sql) && ++exercises === 7) {
          throw new Error('disk is full');
        }
        return real.run(sql, params);
      },
    };

    await expect(applyStarterProgram(failing, USER, ids(), program, 'he')).rejects.toThrow(
      'disk is full',
    );

    expect(await listPlans(real, USER)).toEqual([]);
    const live = await real.get<{ n: number }>(
      `SELECT (SELECT COUNT(*) FROM plan_days WHERE deleted_at IS NULL)
            + (SELECT COUNT(*) FROM plan_day_exercises WHERE deleted_at IS NULL) AS n`,
    );
    expect(live?.n).toBe(0);
  });
});
