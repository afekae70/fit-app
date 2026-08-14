import { beforeEach, describe, expect, it } from 'vitest';

import { getTodayWorkout, isScheduledRestDay, weekStrip, weekSummary } from './home.js';
import { setScheduledDay } from './schedule.js';
import type { SqlExecutor } from './executor.js';
import { createTestExecutor } from './testUtils.js';

const USER = 'u1';
const OTHER = 'u2';
const NOW = new Date('2026-08-05T09:00:00');

let db: SqlExecutor & { close: () => void };
beforeEach(() => {
  db = createTestExecutor();
});

let seq = 0;
const id = (prefix: string) => `${prefix}-${(seq += 1)}`;

async function logWorkout(
  startedLocal: string,
  sets: { exercise: string; weight: number; reps: number }[],
  { user = USER, planDayId = null as string | null } = {},
): Promise<string> {
  const sessionId = id('ws');
  await db.run(
    `INSERT INTO workout_sessions (id, user_id, plan_day_id, started_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    [sessionId, user, planDayId, startedLocal, startedLocal, startedLocal],
  );
  let index = 0;
  for (const set of sets) {
    const exerciseId = id('se');
    await db.run(
      `INSERT INTO session_exercises (id, session_id, exercise_key, order_index, updated_at)
         VALUES (?, ?, ?, ?, ?)`,
      [exerciseId, sessionId, set.exercise, (index += 1), startedLocal],
    );
    await db.run(
      `INSERT INTO sets (id, session_exercise_id, set_index, weight_kg, reps, completed_at, updated_at)
         VALUES (?, ?, 1, ?, ?, ?, ?)`,
      [id('st'), exerciseId, set.weight, set.reps, startedLocal, startedLocal],
    );
  }
  return sessionId;
}

async function seedPlan(days: { name: string; exercises: [string, number | null][] }[]) {
  const planId = id('p');
  await db.run(
    `INSERT INTO plans (id, user_id, name, is_active, created_at, updated_at)
       VALUES (?, ?, 'PPL', 1, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`,
    [planId, USER],
  );
  const dayIds: string[] = [];
  days.forEach(() => dayIds.push(id('pd')));
  for (const [i, day] of days.entries()) {
    await db.run(
      `INSERT INTO plan_days (id, plan_id, day_index, name, updated_at)
         VALUES (?, ?, ?, ?, '2026-01-01T00:00:00.000Z')`,
      [dayIds[i], planId, i + 1, day.name],
    );
    for (const [j, [key, targetSets]] of day.exercises.entries()) {
      await db.run(
        `INSERT INTO plan_day_exercises (id, plan_day_id, exercise_key, order_index, target_sets, updated_at)
           VALUES (?, ?, ?, ?, ?, '2026-01-01T00:00:00.000Z')`,
        [id('pde'), dayIds[i], key, j + 1, targetSets],
      );
    }
  }
  return dayIds;
}

describe('getTodayWorkout — the weekly calendar', () => {
  // NOW is 2026-08-05, a Wednesday.
  const TODAY = '2026-08-05';

  it('shows the committed day even when the rotation had drifted elsewhere', async () => {
    const [push, pull] = await seedPlan([
      { name: 'דחיפה A', exercises: [['Barbell Bench Press', 4]] },
      { name: 'משיכה A', exercises: [['Barbell Row', 4]] },
      { name: 'רגליים', exercises: [['Barbell Back Squat', 4]] },
    ]);
    // Rotation would land on legs (trained push two days ago); the calendar says pull.
    await logWorkout('2026-08-03T09:00:00', [{ exercise: 'Barbell Bench Press', weight: 80, reps: 5 }], {
      planDayId: push,
    });
    expect(pull).toBeTruthy();
    await setScheduledDay(db, USER, () => id('sched'), TODAY, pull ?? null);

    expect((await getTodayWorkout(db, USER, NOW))?.dayName).toBe('משיכה A');
  });

  it('treats a scheduled rest day as no workout, and says so', async () => {
    await seedPlan([{ name: 'דחיפה A', exercises: [['Barbell Bench Press', 4]] }]);
    await setScheduledDay(db, USER, () => id('sched'), TODAY, null);

    expect(await getTodayWorkout(db, USER, NOW)).toBeNull();
    // Distinct from "no plan" — the screen shows a rest card rather than an invitation to build.
    expect(await isScheduledRestDay(db, USER, NOW)).toBe(true);
  });

  it('leaves the rotation in charge of a date nobody decided', async () => {
    await seedPlan([
      { name: 'דחיפה A', exercises: [['Barbell Bench Press', 4]] },
      { name: 'משיכה A', exercises: [['Barbell Row', 4]] },
    ]);
    // Committing a different date must not affect today.
    await setScheduledDay(db, USER, () => id('sched'), '2026-08-06', null);

    expect((await getTodayWorkout(db, USER, NOW))?.dayName).toBe('דחיפה A');
    expect(await isScheduledRestDay(db, USER, NOW)).toBe(false);
  });

  it('falls back to the rotation when the committed day was deleted from the plan', async () => {
    await seedPlan([{ name: 'דחיפה A', exercises: [['Barbell Bench Press', 4]] }]);
    await setScheduledDay(db, USER, () => id('sched'), TODAY, 'a-day-that-no-longer-exists');

    // Stranded rather than silently blank: showing nothing would read as "you have no plan".
    expect((await getTodayWorkout(db, USER, NOW))?.dayName).toBe('דחיפה A');
  });
});

describe('getTodayWorkout', () => {
  it('starts a brand-new plan on its first day', async () => {
    await seedPlan([
      { name: 'דחיפה A', exercises: [['Barbell Bench Press', 4]] },
      { name: 'משיכה A', exercises: [['Barbell Row', 4]] },
    ]);
    expect((await getTodayWorkout(db, USER, NOW))?.dayName).toBe('דחיפה A');
  });

  it('advances one slot per calendar day, trained or not', async () => {
    const [push, pull] = await seedPlan([
      { name: 'דחיפה A', exercises: [['Barbell Bench Press', 4]] },
      { name: 'משיכה A', exercises: [['Barbell Row', 4]] },
      { name: 'רגליים', exercises: [['Barbell Back Squat', 4]] },
    ]);
    // Trained push two days ago and nothing since. The old queue would still be offering pull,
    // for ever; the calendar has moved on twice.
    await logWorkout('2026-08-03T09:00:00', [{ exercise: 'Barbell Bench Press', weight: 80, reps: 5 }], {
      planDayId: push,
    });

    const today = await getTodayWorkout(db, USER, NOW);
    expect(today?.dayName).toBe('רגליים');
    expect(pull).toBeTruthy();
  });

  it("names yesterday's slot as missed", async () => {
    const [push] = await seedPlan([
      { name: 'דחיפה A', exercises: [['Barbell Bench Press', 4]] },
      { name: 'משיכה A', exercises: [['Barbell Row', 4]] },
      { name: 'רגליים', exercises: [['Barbell Back Squat', 4]] },
    ]);
    await logWorkout('2026-08-03T09:00:00', [{ exercise: 'Barbell Bench Press', weight: 80, reps: 5 }], {
      planDayId: push,
    });

    // Two days on: yesterday was pull's slot, and it went untrained.
    expect((await getTodayWorkout(db, USER, NOW))?.missedYesterday).toBe('משיכה A');
  });

  it('reports nothing missed when yesterday was the day trained', async () => {
    const [push] = await seedPlan([
      { name: 'דחיפה A', exercises: [['Barbell Bench Press', 4]] },
      { name: 'משיכה A', exercises: [['Barbell Row', 4]] },
    ]);
    await logWorkout('2026-08-04T09:00:00', [{ exercise: 'Barbell Bench Press', weight: 80, reps: 5 }], {
      planDayId: push,
    });

    const today = await getTodayWorkout(db, USER, NOW);
    expect(today?.dayName).toBe('משיכה A');
    expect(today?.missedYesterday).toBeNull();
  });

  it('stays on the day already trained today', async () => {
    const [push] = await seedPlan([
      { name: 'דחיפה A', exercises: [['Barbell Bench Press', 4]] },
      { name: 'משיכה A', exercises: [['Barbell Row', 4]] },
    ]);
    await logWorkout('2026-08-05T07:00:00', [{ exercise: 'Barbell Bench Press', weight: 80, reps: 5 }], {
      planDayId: push,
    });

    const today = await getTodayWorkout(db, USER, NOW);
    // Finishing a workout must not immediately roll the card on to tomorrow's.
    expect(today?.dayName).toBe('דחיפה A');
    expect(today?.missedYesterday).toBeNull();
  });

  it('wraps around the end of the plan', async () => {
    const [push] = await seedPlan([
      { name: 'דחיפה A', exercises: [['Barbell Bench Press', 4]] },
      { name: 'משיכה A', exercises: [['Barbell Row', 4]] },
    ]);
    // Two days after training slot 0 of a two-day plan lands back on slot 0.
    await logWorkout('2026-08-03T09:00:00', [{ exercise: 'Barbell Bench Press', weight: 80, reps: 5 }], {
      planDayId: push,
    });
    expect((await getTodayWorkout(db, USER, NOW))?.dayName).toBe('דחיפה A');
  });

  it('counts sets and estimates a duration from them', async () => {
    await seedPlan([
      { name: 'דחיפה A', exercises: [['Barbell Bench Press', 4], ['Overhead Press', 3]] },
    ]);
    const today = await getTodayWorkout(db, USER, NOW);
    expect(today?.exerciseCount).toBe(2);
    expect(today?.setCount).toBe(7);
    expect(today?.estimatedMinutes).toBeGreaterThan(10);
  });

  it('assumes three sets for an exercise with no target', async () => {
    await seedPlan([{ name: 'דחיפה A', exercises: [['Barbell Bench Press', null]] }]);
    expect((await getTodayWorkout(db, USER, NOW))?.setCount).toBe(3);
  });

  it('gives Hebrew names, because the card is read not queried', async () => {
    await seedPlan([{ name: 'דחיפה A', exercises: [['Barbell Bench Press', 3]] }]);
    const today = await getTodayWorkout(db, USER, NOW);
    expect(today?.exerciseNames[0]).not.toBe('Barbell Bench Press');
    expect(today?.exerciseNames[0]).toMatch(/[֐-׿]/);
  });

  it('is null with no active plan, rather than inventing one', async () => {
    expect(await getTodayWorkout(db, USER, NOW)).toBeNull();
  });

  it('is null for a plan day with no exercises', async () => {
    await seedPlan([{ name: 'ריק', exercises: [] }]);
    expect(await getTodayWorkout(db, USER, NOW)).toBeNull();
  });
});

describe('weekStrip', () => {
  it('returns seven days, oldest first, ending today', async () => {
    const strip = await weekStrip(db, USER, NOW);
    expect(strip).toHaveLength(7);
    expect(strip[0]?.date).toBe('2026-07-30');
    expect(strip[6]?.date).toBe('2026-08-05');
  });

  it('marks trained days and leaves the rest empty', async () => {
    await logWorkout('2026-08-03T18:00:00', [{ exercise: 'Barbell Row', weight: 60, reps: 8 }]);
    const strip = await weekStrip(db, USER, NOW);
    expect(strip.find((d) => d.date === '2026-08-03')?.state).toBe('trained');
    expect(strip.find((d) => d.date === '2026-08-02')?.state).toBe('rest');
  });

  it('shows today as today even when it has been trained', async () => {
    await logWorkout('2026-08-05T07:00:00', [{ exercise: 'Barbell Row', weight: 60, reps: 8 }]);
    expect((await weekStrip(db, USER, NOW))[6]?.state).toBe('today');
  });

  it('ignores another user\'s training', async () => {
    await logWorkout('2026-08-03T18:00:00', [{ exercise: 'Barbell Row', weight: 60, reps: 8 }], {
      user: OTHER,
    });
    expect((await weekStrip(db, USER, NOW)).every((d) => d.state !== 'trained')).toBe(true);
  });

  it('ignores a deleted workout, so a deleted day stops being marked', async () => {
    const sessionId = await logWorkout('2026-08-03T18:00:00', [
      { exercise: 'Barbell Row', weight: 60, reps: 8 },
    ]);
    await db.run(`UPDATE workout_sessions SET deleted_at = ? WHERE id = ?`, [
      '2026-08-04T00:00:00.000Z',
      sessionId,
    ]);
    expect((await weekStrip(db, USER, NOW)).find((d) => d.date === '2026-08-03')?.state).toBe('rest');
  });
});

describe('weekSummary', () => {
  it('counts only this week, starting Sunday', async () => {
    // 2026-08-05 is a Wednesday, so the week began Sunday 2026-08-02.
    await logWorkout('2026-08-03T09:00:00', [{ exercise: 'Barbell Row', weight: 100, reps: 10 }]);
    await logWorkout('2026-08-01T09:00:00', [{ exercise: 'Barbell Row', weight: 100, reps: 10 }]);

    const summary = await weekSummary(db, USER, NOW);
    expect(summary.workouts).toBe(1);
  });

  it('reports volume in tonnes to one decimal', async () => {
    await logWorkout('2026-08-03T09:00:00', [{ exercise: 'Barbell Row', weight: 100, reps: 10 }]);
    await logWorkout('2026-08-04T09:00:00', [{ exercise: 'Barbell Row', weight: 105, reps: 10 }]);
    // 1000 + 1050 kg
    expect((await weekSummary(db, USER, NOW)).volumeTonnes).toBe(2.1);
  });

  it('counts a personal record once per exercise, not once per heavy set', async () => {
    await logWorkout('2026-07-01T09:00:00', [{ exercise: 'Barbell Row', weight: 80, reps: 5 }]);
    await logWorkout('2026-08-03T09:00:00', [
      { exercise: 'Barbell Row', weight: 90, reps: 5 },
      { exercise: 'Barbell Row', weight: 95, reps: 5 },
    ]);
    expect((await weekSummary(db, USER, NOW)).personalRecords).toBe(1);
  });

  it('does not call a lighter week a record', async () => {
    await logWorkout('2026-07-01T09:00:00', [{ exercise: 'Barbell Row', weight: 100, reps: 5 }]);
    await logWorkout('2026-08-03T09:00:00', [{ exercise: 'Barbell Row', weight: 90, reps: 5 }]);
    expect((await weekSummary(db, USER, NOW)).personalRecords).toBe(0);
  });

  it('counts a brand-new exercise as a record', async () => {
    await logWorkout('2026-08-03T09:00:00', [{ exercise: 'Barbell Row', weight: 60, reps: 5 }]);
    expect((await weekSummary(db, USER, NOW)).personalRecords).toBe(1);
  });

  it('is all zeroes for a user with no training', async () => {
    expect(await weekSummary(db, USER, NOW)).toEqual({
      workouts: 0,
      volumeTonnes: 0,
      personalRecords: 0,
    });
  });

  it('excludes a deleted workout from every number', async () => {
    const kept = await logWorkout('2026-08-03T09:00:00', [
      { exercise: 'Barbell Row', weight: 100, reps: 10 },
    ]);
    const removed = await logWorkout('2026-08-04T09:00:00', [
      { exercise: 'Overhead Press', weight: 100, reps: 10 },
    ]);
    await db.run(`UPDATE workout_sessions SET deleted_at = ? WHERE id = ?`, [
      '2026-08-04T12:00:00.000Z',
      removed,
    ]);

    const summary = await weekSummary(db, USER, NOW);
    expect(summary.workouts).toBe(1);
    expect(summary.volumeTonnes).toBe(1);
    expect(summary.personalRecords).toBe(1);
    expect(kept).toBeTruthy();
  });
});
