import { beforeEach, describe, expect, it } from 'vitest';

import {
  DEFAULT_WEEKLY_TARGET,
  monthWeeks,
  getHomeNutrition,
  getTodayWorkout,
  getTrainedToday,
  isScheduledRestDay,
  macroShares,
  weekStrip,
  weekSummary,
} from './home.js';
import { saveProfile } from './metrics.js';
import { setScheduledDay, setScheduledWorkouts, weeksOfMonth } from './schedule.js';
import type { SqlExecutor } from './executor.js';
import { localDate } from './schedule.js';
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
    // `done_at`, not just `completed_at`: the first is when the row was created, the second is
    // when the user ticked the set off. A fixture called logWorkout has to mean the latter, or it
    // is modelling a session that was opened and abandoned.
    await db.run(
      `INSERT INTO sets (id, session_exercise_id, set_index, weight_kg, reps, completed_at, done_at, updated_at)
         VALUES (?, ?, 1, ?, ?, ?, ?, ?)`,
      [id('st'), exerciseId, set.weight, set.reps, startedLocal, startedLocal, startedLocal],
    );
  }
  return sessionId;
}

/**
 * A session that was opened and nothing more — no ticked sets, not finished.
 *
 * Exactly what pressing "Start workout" on the home screen produces, which is the state that
 * used to be indistinguishable from a completed workout.
 */
async function openSession(startedLocal: string, planDayId: string | null = null): Promise<string> {
  const sessionId = id('ws');
  await db.run(
    `INSERT INTO workout_sessions (id, user_id, plan_day_id, started_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    [sessionId, USER, planDayId, startedLocal, startedLocal, startedLocal],
  );
  const exerciseId = id('se');
  await db.run(
    `INSERT INTO session_exercises (id, session_id, exercise_key, order_index, updated_at)
       VALUES (?, ?, 'Barbell Bench Press', 1, ?)`,
    [exerciseId, sessionId, startedLocal],
  );
  // Sets exist from the moment the session is created — laid out, untouched.
  await db.run(
    `INSERT INTO sets (id, session_exercise_id, set_index, completed_at, updated_at)
       VALUES (?, ?, 1, ?, ?)`,
    [id('st'), exerciseId, startedLocal, startedLocal],
  );
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

describe('opening a workout is not training it', () => {
  // The regression: the Today card's Start button creates a session, and every "have you
  // trained" query used to accept a bare session row as proof. Pressing Start therefore
  // incremented the week count, lit the streak strip and consumed today's rotation slot —
  // reporting the workout as done before a single rep.

  it('does not count an opened session in the week summary', async () => {
    await openSession('2026-08-03T09:00:00');
    expect((await weekSummary(db, USER, NOW)).workouts).toBe(0);
  });

  it('does not light the streak strip for an opened session', async () => {
    await openSession('2026-08-03T09:00:00');
    const strip = await weekStrip(db, USER, NOW);
    expect(strip.find((d) => d.date === '2026-08-03')?.trained).toBe(false);
  });

  it('does not advance the rotation for an opened session', async () => {
    const [push] = await seedPlan([
      { name: 'דחיפה A', exercises: [['Barbell Bench Press', 4]] },
      { name: 'משיכה A', exercises: [['Barbell Row', 4]] },
    ]);
    await openSession('2026-08-03T09:00:00', push ?? null);

    // Still day one: nothing has been trained, so the rotation has nowhere to have moved from.
    expect((await getTodayWorkout(db, USER, NOW))?.dayName).toBe('דחיפה A');
  });

  it('counts a session as soon as one set is ticked, without waiting for the finish sheet', async () => {
    // The other half. A session still in progress with real sets logged IS training, and
    // requiring `ended_at` would make the strip lie in the opposite direction.
    await logWorkout('2026-08-03T09:00:00', [
      { exercise: 'Barbell Bench Press', weight: 80, reps: 5 },
    ]);
    expect((await weekSummary(db, USER, NOW)).workouts).toBe(1);
  });

  it('counts a finished session even with nothing ticked', async () => {
    const sessionId = await openSession('2026-08-03T09:00:00');
    await db.run(`UPDATE workout_sessions SET ended_at = ? WHERE id = ?`, [
      '2026-08-03T10:00:00',
      sessionId,
    ]);
    expect((await weekSummary(db, USER, NOW)).workouts).toBe(1);
  });
});

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

  it('shows a scheduled workout from a group that is not the active plan, under its own title', async () => {
    await seedPlan([{ name: 'דחיפה A', exercises: [['Barbell Bench Press', 4]] }]);
    // A second group — created later, so not active — with its own workout.
    await db.run(
      `INSERT INTO plans (id, user_id, name, is_active, created_at, updated_at)
         VALUES ('abs-group', ?, 'בטן', 0, '2026-02-01T00:00:00.000Z', '2026-02-01T00:00:00.000Z')`,
      [USER],
    );
    await db.run(
      `INSERT INTO plan_days (id, plan_id, day_index, name, updated_at)
         VALUES ('abs-day', 'abs-group', 1, 'בטן 10 תרגילים', '2026-02-01T00:00:00.000Z')`,
    );
    await db.run(
      `INSERT INTO plan_day_exercises (id, plan_day_id, exercise_key, order_index, updated_at)
         VALUES ('abs-ex', 'abs-day', 'Crunch', 1, '2026-02-01T00:00:00.000Z')`,
    );
    await setScheduledDay(db, USER, () => id('sched'), TODAY, 'abs-day');

    const today = await getTodayWorkout(db, USER, NOW);
    expect(today?.dayName).toBe('בטן 10 תרגילים');
    expect(today?.planName).toBe('בטן');
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

  it('offers nothing more today once the workout for today is trained, without rolling on to tomorrow', async () => {
    const [push] = await seedPlan([
      { name: 'דחיפה A', exercises: [['Barbell Bench Press', 4]] },
      { name: 'משיכה A', exercises: [['Barbell Row', 4]] },
    ]);
    await logWorkout('2026-08-05T07:00:00', [{ exercise: 'Barbell Bench Press', weight: 80, reps: 5 }], {
      planDayId: push,
    });

    // Finishing a workout must not immediately roll the card on to tomorrow's — and with dates
    // able to hold more than one workout, it must not offer the one just done again either.
    expect(await getTodayWorkout(db, USER, NOW)).toBeNull();
    // Tomorrow is still the next slot, so the rotation did not skip ahead.
    const tomorrow = await getTodayWorkout(db, USER, new Date('2026-08-06T09:00:00'));
    expect(tomorrow?.dayName).toBe('משיכה A');
  });

  describe('with more than one workout on the day', () => {
    async function twoToday() {
      const [push, abs] = await seedPlan([
        { name: 'דחיפה A', exercises: [['Barbell Bench Press', 4]] },
        { name: 'בטן', exercises: [['Plank', 1]] },
      ]);
      await setScheduledWorkouts(db, USER, () => id('sd'), localDate(NOW), [push!, abs!]);
      return { push: push!, abs: abs! };
    }

    it('offers the first one, and says it is one of two', async () => {
      await twoToday();
      const today = await getTodayWorkout(db, USER, NOW);
      expect(today?.dayName).toBe('דחיפה A');
      expect([today?.slot, today?.slots]).toEqual([1, 2]);
    });

    it('moves on to the second once the first is trained', async () => {
      const { push } = await twoToday();
      await logWorkout('2026-08-05T07:00:00', [{ exercise: 'Barbell Bench Press', weight: 80, reps: 5 }], {
        planDayId: push,
      });
      const today = await getTodayWorkout(db, USER, NOW);
      expect(today?.dayName).toBe('בטן');
      expect([today?.slot, today?.slots]).toEqual([2, 2]);
    });

    it('offers the second even when it was trained first', async () => {
      const { abs } = await twoToday();
      await logWorkout('2026-08-05T07:00:00', [{ exercise: 'Plank', weight: 0, reps: 1 }], {
        planDayId: abs,
      });
      expect((await getTodayWorkout(db, USER, NOW))?.dayName).toBe('דחיפה A');
    });

    it('offers nothing once both are trained', async () => {
      const { push, abs } = await twoToday();
      await logWorkout('2026-08-05T07:00:00', [{ exercise: 'Barbell Bench Press', weight: 80, reps: 5 }], {
        planDayId: push,
      });
      await logWorkout('2026-08-05T18:00:00', [{ exercise: 'Plank', weight: 0, reps: 1 }], {
        planDayId: abs,
      });
      expect(await getTodayWorkout(db, USER, NOW)).toBeNull();
    });

    it('still offers the plan after one unplanned session, since two were planned', async () => {
      await twoToday();
      await logWorkout('2026-08-05T07:00:00', [{ exercise: 'Barbell Row', weight: 60, reps: 8 }]);
      expect((await getTodayWorkout(db, USER, NOW))?.dayName).toBe('דחיפה A');
    });

    it('counts training from yesterday as nothing for today', async () => {
      const { push } = await twoToday();
      await logWorkout('2026-08-04T07:00:00', [{ exercise: 'Barbell Bench Press', weight: 80, reps: 5 }], {
        planDayId: push,
      });
      expect((await getTodayWorkout(db, USER, NOW))?.slot).toBe(1);
    });
  });

  it('treats one planned workout replaced by an unplanned session as a trained day, as before', async () => {
    const [push] = await seedPlan([{ name: 'דחיפה A', exercises: [['Barbell Bench Press', 4]] }]);
    await setScheduledDay(db, USER, () => id('sd'), localDate(NOW), push!);
    await logWorkout('2026-08-05T07:00:00', [{ exercise: 'Barbell Row', weight: 60, reps: 8 }]);
    expect(await getTodayWorkout(db, USER, NOW)).toBeNull();
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
    expect(strip.find((d) => d.date === '2026-08-03')?.trained).toBe(true);
    expect(strip.find((d) => d.date === '2026-08-02')?.trained).toBe(false);
  });

  it('marks today as trained the moment it is, not the next morning', async () => {
    // This used to assert the opposite: "today" outranked "trained" in a single merged state, so
    // a workout finished this morning left the strip looking like a missed day while the streak
    // counter beside it had already counted it.
    await logWorkout('2026-08-05T07:00:00', [{ exercise: 'Barbell Row', weight: 60, reps: 8 }]);

    const today = (await weekStrip(db, USER, NOW))[6];
    expect(today?.trained).toBe(true);
    expect(today?.isToday).toBe(true);
  });

  it('marks today as today when nothing has been trained', async () => {
    const today = (await weekStrip(db, USER, NOW))[6];
    expect(today?.isToday).toBe(true);
    expect(today?.trained).toBe(false);
  });

  it('marks exactly one day as today', async () => {
    const strip = await weekStrip(db, USER, NOW);
    expect(strip.filter((d) => d.isToday)).toHaveLength(1);
  });

  it('ignores another user\'s training', async () => {
    await logWorkout('2026-08-03T18:00:00', [{ exercise: 'Barbell Row', weight: 60, reps: 8 }], {
      user: OTHER,
    });
    expect((await weekStrip(db, USER, NOW)).every((d) => !d.trained)).toBe(true);
  });

  it('ignores a deleted workout, so a deleted day stops being marked', async () => {
    const sessionId = await logWorkout('2026-08-03T18:00:00', [
      { exercise: 'Barbell Row', weight: 60, reps: 8 },
    ]);
    await db.run(`UPDATE workout_sessions SET deleted_at = ? WHERE id = ?`, [
      '2026-08-04T00:00:00.000Z',
      sessionId,
    ]);
    expect((await weekStrip(db, USER, NOW)).find((d) => d.date === '2026-08-03')?.trained).toBe(
      false,
    );
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

describe('macroShares', () => {
  it('weighs fat at 9 kcal per gram, not by grams', () => {
    // 100 g of each: by grams that is a third apiece, by calories fat is nearly half.
    const shares = macroShares({ proteinG: 100, carbsG: 100, fatG: 100 });
    expect(shares.fat).toBeCloseTo(9 / 17, 5);
    expect(shares.protein).toBeCloseTo(4 / 17, 5);
    expect(shares.carbs).toBeCloseTo(4 / 17, 5);
  });

  it('sums to one', () => {
    const shares = macroShares({ proteinG: 180, carbsG: 250, fatG: 70 });
    expect(shares.protein + shares.carbs + shares.fat).toBeCloseTo(1, 10);
  });

  it('returns zeroes rather than NaN when every macro is zero', () => {
    // A width of NaN% silently collapses the bar; a width of 0% is at least honest.
    expect(macroShares({ proteinG: 0, carbsG: 0, fatG: 0 })).toEqual({
      protein: 0,
      carbs: 0,
      fat: 0,
    });
  });
});

describe('getHomeNutrition', () => {
  async function weighIn(dateLocal: string, kg: number, user = USER) {
    await db.run(
      `INSERT INTO body_metrics (id, user_id, measured_at, weight_kg, source, updated_at)
         VALUES (?, ?, ?, ?, 'manual', ?)`,
      [id('bm'), user, dateLocal, kg, dateLocal],
    );
  }

  async function completeProfile(user = USER) {
    await saveProfile(db, user, {
      birthDate: '1996-04-10',
      sex: 'male',
      heightCm: 178,
      activityLevel: 'moderate',
      goal: 'cut',
    });
  }

  it('names the one missing field instead of guessing at targets', async () => {
    await completeProfile();
    const withoutWeight = await getHomeNutrition(db, USER);
    expect(withoutWeight.targets).toEqual({ ok: false, missing: 'no_weight' });
    expect(withoutWeight.latestKg).toBeNull();
    expect(withoutWeight.weightPoints).toEqual([]);

    await weighIn('2026-08-05T07:00:00', 82);
    const withoutProfile = await getHomeNutrition(db, OTHER);
    expect(withoutProfile.targets.ok).toBe(false);
  });

  it('computes targets from the newest weigh-in', async () => {
    await completeProfile();
    await weighIn('2026-07-01T07:00:00', 90);
    await weighIn('2026-08-05T07:00:00', 82);

    const home = await getHomeNutrition(db, USER);
    expect(home.latestKg).toBe(82);
    if (!home.targets.ok) throw new Error('expected targets');
    expect(home.targets.targets.weightKg).toBe(82);
    expect(home.targets.targets.calorieTarget).toBeGreaterThan(0);
    expect(home.targets.targets.proteinG).toBeGreaterThan(0);
  });

  it('plots the smoothed line oldest first', async () => {
    await completeProfile();
    // Three weeks: weeklyRateOfChange wants a 14-day span before it calls a rate reliable.
    for (let day = 1; day <= 21; day += 1) {
      const date = `2026-08-${String(day).padStart(2, '0')}T07:00:00`;
      // A steady drop with a 1 kg scale swing on top, which is what smoothing is for.
      await weighIn(date, 85 - day * 0.1 + (day % 2 === 0 ? 0.5 : -0.5));
    }

    const home = await getHomeNutrition(db, USER);
    expect(home.weightPoints.length).toBeGreaterThan(1);

    const dates = home.weightPoints.map((p) => p.date.getTime());
    expect([...dates].sort((a, b) => a - b)).toEqual(dates);

    const first = home.weightPoints[0]!.weightKg;
    const last = home.weightPoints[home.weightPoints.length - 1]!.weightKg;
    expect(last).toBeLessThan(first);
    expect(home.ratePerWeek).toBeLessThan(0);
  });

  it('reports no rate when two weigh-ins are too close together to mean anything', async () => {
    await completeProfile();
    await weighIn('2026-08-04T07:00:00', 84);
    await weighIn('2026-08-05T07:00:00', 82);

    const home = await getHomeNutrition(db, USER);
    expect(home.ratePerWeek).toBeNull();
  });

  it('ignores weigh-ins belonging to another user', async () => {
    await completeProfile();
    await weighIn('2026-08-05T07:00:00', 82);
    await weighIn('2026-08-05T07:00:00', 61, OTHER);

    const home = await getHomeNutrition(db, USER);
    expect(home.latestKg).toBe(82);
    expect(home.weightPoints.every((p) => p.weightKg > 70)).toBe(true);
  });
});

describe('getTrainedToday', () => {
  const at = (hhmm: string) => `${localDate(new Date())}T${hhmm}:00.000`;

  it('reports nothing on a day with no training', async () => {
    expect(await getTrainedToday(db, USER)).toBeNull();
  });

  it('does not count a session that was only opened', async () => {
    // Pressing Start lays the sets out and ticks none of them. Reporting that as "trained today"
    // is the exact failure the TRAINED predicate exists to prevent.
    await openSession(at('08:00'));
    expect(await getTrainedToday(db, USER)).toBeNull();
  });

  it('counts a session with a ticked set, before it is finished', async () => {
    await logWorkout(at('08:00'), [{ exercise: 'Barbell Bench Press', weight: 80, reps: 8 }]);

    const trained = await getTrainedToday(db, USER);
    expect(trained?.setCount).toBe(1);
    expect(trained?.volumeKg).toBe(640);
    // Still running: there is a start and no end, so there is no duration to report.
    expect(trained?.finished).toBe(false);
    expect(trained?.minutes).toBeNull();
  });

  it('reports the duration once the session is finished', async () => {
    const sessionId = await logWorkout(at('08:00'), [
      { exercise: 'Barbell Bench Press', weight: 80, reps: 8 },
    ]);
    await db.run(`UPDATE workout_sessions SET ended_at = ? WHERE id = ?`, [at('09:00'), sessionId]);

    const trained = await getTrainedToday(db, USER);
    expect(trained?.finished).toBe(true);
    expect(trained?.minutes).toBe(60);
  });

  it('ignores yesterday', async () => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    await logWorkout(`${localDate(yesterday)}T08:00:00.000`, [
      { exercise: 'Barbell Bench Press', weight: 80, reps: 8 },
    ]);

    expect(await getTrainedToday(db, USER)).toBeNull();
  });

  it('keeps one user out of a different account', async () => {
    await logWorkout(at('08:00'), [{ exercise: 'Barbell Bench Press', weight: 80, reps: 8 }], {
      user: 'someone-else',
    });
    expect(await getTrainedToday(db, USER)).toBeNull();
  });

  it('leaves warm-ups out of the count', async () => {
    const sessionId = await logWorkout(at('08:00'), [
      { exercise: 'Barbell Bench Press', weight: 80, reps: 8 },
    ]);
    const se = await db.get<{ id: string }>(
      `SELECT id FROM session_exercises WHERE session_id = ?`,
      [sessionId],
    );
    await db.run(
      `INSERT INTO sets (id, session_exercise_id, set_index, weight_kg, reps, is_warmup,
                         completed_at, done_at, updated_at)
         VALUES ('warm', ?, 2, 40, 5, 1, ?, ?, ?)`,
      [se!.id, at('08:00'), at('08:00'), at('08:00')],
    );

    expect((await getTrainedToday(db, USER))?.setCount).toBe(1);
  });
});

describe('which weeks a month owns', () => {
  it('gives each month the weeks that start in it', () => {
    // September 2026 begins on a Tuesday; its Sundays are the 6th, 13th, 20th and 27th.
    expect(weeksOfMonth('2026-09')).toEqual(['2026-09-06', '2026-09-13', '2026-09-20', '2026-09-27']);
    // August 2026 begins on a Saturday and has five Sundays.
    expect(weeksOfMonth('2026-08')).toHaveLength(5);
  });

  it('never gives one week to two months', () => {
    const all = [...weeksOfMonth('2026-09'), ...weeksOfMonth('2026-10')];
    expect(new Set(all).size).toBe(all.length);
    // The week of September 27th runs into October, and belongs to September alone.
    expect(weeksOfMonth('2026-10')[0]).toBe('2026-10-04');
  });
});

describe('full weeks this month', () => {
  const trainOn = (local: string, planDayId: string | null = null) =>
    logWorkout(local, [{ exercise: 'Barbell Row', weight: 60, reps: 8 }], { planDayId });

  it('counts a week complete once every planned workout in it is trained', async () => {
    const [push, pull] = await seedPlan([
      { name: 'דחיפה', exercises: [['Barbell Bench Press', 3]] },
      { name: 'משיכה', exercises: [['Barbell Row', 3]] },
    ]);
    // Week of September 6th: two planned, two trained.
    await setScheduledDay(db, USER, () => id('sd'), '2026-09-07', push!);
    await setScheduledDay(db, USER, () => id('sd'), '2026-09-09', pull!);
    await trainOn('2026-09-07T07:00:00', push);
    await trainOn('2026-09-09T07:00:00', pull);

    const tally = await monthWeeks(db, USER, new Date('2026-09-10T12:00:00'));
    expect(tally.month).toBe('2026-09');
    expect(tally.weeks).toBe(4);
    expect(tally.completed).toBe(1);
    expect(tally.thisWeek).toMatchObject({ trained: 2, target: 2, complete: true });
  });

  it('does not count a week with a planned workout still missing', async () => {
    const [push, pull] = await seedPlan([
      { name: 'דחיפה', exercises: [['Barbell Bench Press', 3]] },
      { name: 'משיכה', exercises: [['Barbell Row', 3]] },
    ]);
    await setScheduledWorkouts(db, USER, () => id('sd'), '2026-09-07', [push!, pull!]);
    await trainOn('2026-09-07T07:00:00', push);

    const tally = await monthWeeks(db, USER, new Date('2026-09-10T12:00:00'));
    expect(tally.completed).toBe(0);
    expect(tally.thisWeek).toMatchObject({ trained: 1, target: 2, complete: false });
  });

  it('measures a week with nothing planned against the default target', async () => {
    for (const day of ['06', '07', '08']) await trainOn(`2026-09-${day}T07:00:00`);
    let tally = await monthWeeks(db, USER, new Date('2026-09-10T12:00:00'));
    expect(tally.thisWeek.target).toBe(DEFAULT_WEEKLY_TARGET);
    expect(tally.completed).toBe(0);

    await trainOn('2026-09-10T07:00:00');
    tally = await monthWeeks(db, USER, new Date('2026-09-10T20:00:00'));
    expect(tally.completed).toBe(1);
  });

  it('keeps counting the week that runs past the end of the month as that month', async () => {
    // Friday October 2nd is in the week of September 27th, so the card still shows September.
    for (const day of ['2026-09-27', '2026-09-29', '2026-10-01', '2026-10-02']) {
      await trainOn(`${day}T07:00:00`);
    }
    const tally = await monthWeeks(db, USER, new Date('2026-10-02T20:00:00'));
    expect(tally.month).toBe('2026-09');
    expect(tally.thisWeek.start).toBe('2026-09-27');
    expect(tally.completed).toBe(1);
  });

  it('starts the next month from zero on its first Sunday', async () => {
    for (const day of ['2026-09-27', '2026-09-29', '2026-10-01', '2026-10-02']) {
      await trainOn(`${day}T07:00:00`);
    }
    const tally = await monthWeeks(db, USER, new Date('2026-10-04T09:00:00'));
    expect(tally.month).toBe('2026-10');
    expect(tally.completed).toBe(0);
    expect(tally.weeks).toBe(4);
  });

  it('adds up several complete weeks, and only past and current ones', async () => {
    for (const week of ['2026-09-06', '2026-09-13']) {
      for (let i = 0; i < DEFAULT_WEEKLY_TARGET; i += 1) {
        const [y, m, d] = week.split('-').map(Number);
        const day = new Date(y!, m! - 1, d! + i, 7);
        await trainOn(
          `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}T07:00:00`,
        );
      }
    }
    const tally = await monthWeeks(db, USER, new Date('2026-09-15T12:00:00'));
    expect(tally.completed).toBe(2);
    expect(tally.weeks).toBe(4);
  });

  it('counts two sessions on one day as two', async () => {
    const [push, abs] = await seedPlan([
      { name: 'דחיפה', exercises: [['Barbell Bench Press', 3]] },
      { name: 'בטן', exercises: [['Plank', 1]] },
    ]);
    await setScheduledWorkouts(db, USER, () => id('sd'), '2026-09-07', [push!, abs!]);
    await trainOn('2026-09-07T07:00:00', push);
    await trainOn('2026-09-07T19:00:00', abs);
    const tally = await monthWeeks(db, USER, new Date('2026-09-08T12:00:00'));
    expect(tally.thisWeek).toMatchObject({ trained: 2, target: 2, complete: true });
  });

  it('keeps two users apart', async () => {
    for (let i = 0; i < DEFAULT_WEEKLY_TARGET; i += 1) {
      await logWorkout(`2026-09-0${6 + i}T07:00:00`, [{ exercise: 'Barbell Row', weight: 60, reps: 8 }], {
        user: 'someone-else',
      });
    }
    expect((await monthWeeks(db, USER, new Date('2026-09-10T20:00:00'))).completed).toBe(0);
  });
});
