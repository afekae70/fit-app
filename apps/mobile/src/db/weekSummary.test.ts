/**
 * The weekly summary — real SQL against real SQLite. 2026-11-14 is a Saturday, so its week runs
 * Sunday 8 to Saturday 14, and the week before it Sunday 1 to Saturday 7.
 */

import { beforeEach, describe, expect, it } from 'vitest';

import type { SqlExecutor } from './executor.js';
import { addFoodEntry } from './food.js';
import { recordBodyMetric } from './metrics.js';
import { createTestExecutor } from './testUtils.js';
import { addWater } from './water.js';
import { loadWeekSummary } from './weekSummary.js';
import {
  addExerciseToSession,
  addSet,
  finishSession,
  markSetDone,
  setSessionSatisfaction,
  startSession,
} from './workouts.js';

const USER = 'user-1';
let db: SqlExecutor;
let counter = 0;
const newId = () => `id-${String(++counter).padStart(3, '0')}`;

/** A finished, named workout on a local day of November 2026. */
async function workout(
  name: string,
  day: number,
  exercises: Record<string, { weightKg: number; reps: number }[]>,
  satisfaction?: number,
) {
  const clock = () => new Date(2026, 10, day, 18).toISOString();
  const id = await startSession(db, USER, newId, {}, clock);
  for (const [key, sets] of Object.entries(exercises)) {
    const exerciseId = await addExerciseToSession(db, newId, id, key, clock);
    for (const set of sets) {
      const setId = await addSet(db, newId, exerciseId, set, clock);
      await markSetDone(db, setId, true, clock);
    }
  }
  await finishSession(db, USER, id, {}, clock);
  await db.run(`UPDATE workout_sessions SET name = ? WHERE id = ?`, [name, id]);
  if (satisfaction !== undefined) await setSessionSatisfaction(db, USER, id, satisfaction);
  return id;
}

const three = (weightKg: number, reps: number) => [
  { weightKg, reps },
  { weightKg, reps },
  { weightKg, reps },
];

beforeEach(() => {
  db = createTestExecutor();
  counter = 0;
});

describe('the weekly summary', () => {
  it('counts the week’s workouts and sets, against the week before', async () => {
    await workout('Legs', 3, { Squat: three(100, 5) });
    await workout('Legs', 10, { Squat: three(105, 5) });
    await workout('Push', 12, { Bench: three(80, 8) });

    const week = await loadWeekSummary(db, USER, '2026-11-14', '2026-11-14');
    expect(week).toMatchObject({
      start: '2026-11-08',
      end: '2026-11-14',
      isCurrent: true,
      workouts: 2,
      previousWorkouts: 1,
      sets: 6,
    });
  });

  it('says where it moved, each exercise once, by its latest verdict in the week', async () => {
    await workout('Legs', 3, { Squat: three(100, 5), Curl: three(45, 8), Calf: three(60, 15) });
    await workout('Legs', 9, { Squat: three(105, 5), Curl: three(40, 8), Calf: three(60, 15) });
    // Later the same week, squats slip back: the week ends with them down.
    await workout('Legs', 13, { Squat: three(100, 5), Curl: three(45, 8), Calf: three(60, 15) });

    const week = await loadWeekSummary(db, USER, '2026-11-10', '2026-11-14');
    expect(week.counts).toEqual({ up: 1, same: 1, down: 1 });
    expect(week.progressed).toEqual(['Curl']);
    expect(week.toPush).toEqual(['Squat', 'Calf']);
  });

  it('counts days at the water goal and the mean satisfaction', async () => {
    await workout('Legs', 9, { Squat: three(100, 5) }, 8);
    await workout('Legs', 11, { Squat: three(100, 5) }, 7);
    // No weighing: the stand-in aim of 3150 ml. Reached on two days.
    for (const day of ['2026-11-08', '2026-11-12']) {
      await addWater(db, USER, newId, { drunkOn: day, ml: 3200 });
    }
    await addWater(db, USER, newId, { drunkOn: '2026-11-10', ml: 1000 });

    const week = await loadWeekSummary(db, USER, '2026-11-14', '2026-11-14');
    expect(week.water).toEqual({ reached: 2, counted: 7, goalMl: 3150 });
    expect(week.satisfaction).toBe(7.5);
  });

  it('stops a week still under way at today, and has nothing to say about an empty one', async () => {
    const week = await loadWeekSummary(db, USER, '2026-11-11', '2026-11-11');
    expect(week).toMatchObject({
      isCurrent: true,
      workouts: 0,
      sets: 0,
      satisfaction: null,
      counts: { up: 0, same: 0, down: 0 },
      progressed: [],
      toPush: [],
    });
    // Sunday to Wednesday have happened.
    expect(week.water.counted).toBe(4);
  });

  it('reads a past week to its Saturday', async () => {
    const week = await loadWeekSummary(db, USER, '2026-11-03', '2026-11-14');
    expect(week).toMatchObject({ start: '2026-11-01', end: '2026-11-07', isCurrent: false });
    expect(week.water.counted).toBe(7);
  });

  it('lists the week’s personal records: heavier than ever before, each exercise once', async () => {
    await workout('Legs', 3, { Squat: three(100, 5), Curl: three(45, 8) });
    await workout('Legs', 9, { Squat: [{ weightKg: 105, reps: 5 }, { weightKg: 110, reps: 3 }, { weightKg: 110, reps: 4 }], Curl: three(45, 8) });
    await workout('Push', 11, { Bench: three(80, 8) });

    const week = await loadWeekSummary(db, USER, '2026-11-14', '2026-11-14');
    expect(week.records).toEqual([
      { exerciseKey: 'Squat', weightKg: 110, reps: 4, previousKg: 100 },
      // A first time counts, as it does everywhere a record is told.
      { exerciseKey: 'Bench', weightKg: 80, reps: 8, previousKg: null },
    ]);
  });

  it('sums up the food log over the days something was written down', async () => {
    for (const [day, calories, proteinG] of [
      ['2026-11-09', 2000, 150],
      ['2026-11-09', 400, 30],
      ['2026-11-11', 2200, 160],
    ] as const) {
      await addFoodEntry(db, USER, newId, { eatenOn: day, name: 'meal', calories, proteinG });
    }
    const week = await loadWeekSummary(db, USER, '2026-11-14', '2026-11-14');
    expect(week.food).toMatchObject({ daysLogged: 2, caloriesPerDay: 2300, proteinPerDay: 170 });
  });

  it('gives the week’s last weigh-in against the last one before it, and the water a day', async () => {
    const at = (day: number, hour: number) => new Date(2026, 10, day, hour).toISOString();
    await recordBodyMetric(db, USER, newId, { weightKg: 81.4, source: 'manual', measuredAt: at(6, 8) });
    await recordBodyMetric(db, USER, newId, { weightKg: 80.9, source: 'manual', measuredAt: at(10, 8) });
    await recordBodyMetric(db, USER, newId, { weightKg: 80.6, source: 'manual', measuredAt: at(13, 8) });
    await addWater(db, USER, newId, { drunkOn: '2026-11-09', ml: 3500 });
    await addWater(db, USER, newId, { drunkOn: '2026-11-10', ml: 3500 });

    const week = await loadWeekSummary(db, USER, '2026-11-14', '2026-11-14');
    expect(week.weight).toEqual({ latestKg: 80.6, changeKg: -0.8 });
    // 7 litres over the seven days of the week.
    expect(week.waterLitresPerDay).toBe(1);
  });

  it('says nothing it does not know: no food, no weigh-in, no water', async () => {
    const week = await loadWeekSummary(db, USER, '2026-11-14', '2026-11-14');
    expect(week.food).toMatchObject({ daysLogged: 0, caloriesPerDay: null, proteinPerDay: null });
    expect(week.weight).toEqual({ latestKg: null, changeKg: null });
    expect(week.waterLitresPerDay).toBeNull();
    expect(week.records).toEqual([]);
  });
});
