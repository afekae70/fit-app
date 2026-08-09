/**
 * Progression analysis tests — real SQL against real SQLite.
 *
 * The SQL here reimplements Epley in SQLite so the aggregate can run in the database. These
 * tests exist largely to prove that reimplementation agrees with `epley1RM` in @fit/shared:
 * if the two ever diverge, the screen and the AI coach would show different numbers for the
 * same lift.
 */

import { epley1RM } from '@fit/shared/calculations';
import { beforeEach, describe, expect, it } from 'vitest';

import type { SqlExecutor } from './executor.js';
import {
  consistencyHeat,
  getExerciseProgression,
  listTrainedExercises,
  personalRecords,
  summariseAllProgress,
  summariseExerciseProgress,
  toCoachDigest,
  weeklyVolume,
} from './progression.js';
import { createTestExecutor } from './testUtils.js';
import {
  addExerciseToSession,
  addSet,
  deleteSession,
  finishSession,
  startSession,
} from './workouts.js';

const USER = 'user-1';

let db: SqlExecutor;
let counter = 0;
const newId = () => `id-${String(++counter).padStart(3, '0')}`;

/** Log one finished session containing a single exercise with the given sets. */
async function logSession(
  dayOffset: number,
  exerciseKey: string,
  sets: { weightKg: number; reps: number; isWarmup?: boolean }[],
  userId = USER,
) {
  const clock = () => new Date(Date.UTC(2026, 5, 1 + dayOffset, 10)).toISOString();
  const sessionId = await startSession(db, userId, newId, {}, clock);
  const exerciseId = await addExerciseToSession(db, newId, sessionId, exerciseKey, clock);
  for (const set of sets) await addSet(db, newId, exerciseId, set, clock);
  await finishSession(db, userId, sessionId, {}, clock);
  return sessionId;
}

beforeEach(() => {
  db = createTestExecutor();
  counter = 0;
});

describe('getExerciseProgression', () => {
  it('computes best e1RM per session, matching the shared formula exactly', async () => {
    await logSession(0, 'Barbell Curl', [
      { weightKg: 30, reps: 10 },
      { weightKg: 35, reps: 6 },
    ]);

    const [session] = await getExerciseProgression(db, USER, 'Barbell Curl');

    // 35 x 6 -> 35 * (1 + 6/30) = 42; 30 x 10 -> 40. The heavier-for-fewer set wins.
    expect(session?.best_e1rm_kg).toBeCloseTo(epley1RM(35, 6), 6);
    expect(session?.best_e1rm_kg).toBeCloseTo(42, 6);
  });

  it('agrees with epley1RM across a range of rep counts', async () => {
    // Guards the SQLite reimplementation against drifting from the TypeScript one.
    for (const [i, [w, r]] of [
      [100, 1],
      [90, 3],
      [80, 5],
      [70, 8],
      [60, 12],
    ].entries()) {
      await logSession(i, `Ex ${i}`, [{ weightKg: w as number, reps: r as number }]);
      const [s] = await getExerciseProgression(db, USER, `Ex ${i}`);
      expect(s?.best_e1rm_kg).toBeCloseTo(epley1RM(w as number, r as number), 6);
    }
  });

  it('returns sessions oldest first', async () => {
    await logSession(0, 'Barbell Curl', [{ weightKg: 30, reps: 10 }]);
    await logSession(7, 'Barbell Curl', [{ weightKg: 32.5, reps: 10 }]);

    const sessions = await getExerciseProgression(db, USER, 'Barbell Curl');
    expect(sessions.map((s) => s.top_weight_kg)).toEqual([30, 32.5]);
  });

  it('keeps the most RECENT sessions when the limit bites', async () => {
    for (let i = 0; i < 5; i++) {
      await logSession(i, 'Barbell Curl', [{ weightKg: 30 + i, reps: 8 }]);
    }

    const sessions = await getExerciseProgression(db, USER, 'Barbell Curl', 3);
    // The limit must drop the OLDEST sessions, not the newest — otherwise the trend would
    // freeze in the past as history grows.
    expect(sessions.map((s) => s.top_weight_kg)).toEqual([32, 33, 34]);
  });

  it('excludes warmups', async () => {
    await logSession(0, 'Barbell Curl', [
      { weightKg: 100, reps: 5, isWarmup: true },
      { weightKg: 30, reps: 10 },
    ]);

    const [session] = await getExerciseProgression(db, USER, 'Barbell Curl');
    expect(session?.working_sets).toBe(1);
    expect(session?.top_weight_kg).toBe(30);
  });

  it('excludes sets above 12 reps, where Epley is unreliable', async () => {
    await logSession(0, 'Barbell Curl', [
      { weightKg: 20, reps: 25 },
      { weightKg: 30, reps: 8 },
    ]);

    const [session] = await getExerciseProgression(db, USER, 'Barbell Curl');
    expect(session?.working_sets).toBe(1);
    expect(session?.best_e1rm_kg).toBeCloseTo(epley1RM(30, 8), 6);
  });

  it('returns nothing for an exercise never performed', async () => {
    expect(await getExerciseProgression(db, USER, 'Preacher Curl')).toEqual([]);
  });

  it('never mixes another user\'s sessions into this user\'s progression', async () => {
    await logSession(0, 'Barbell Curl', [{ weightKg: 30, reps: 10 }], 'user-2');

    // USER has no Barbell Curl history at all — user-2's sessions must not leak in.
    expect(await getExerciseProgression(db, USER, 'Barbell Curl')).toEqual([]);
  });
});

describe('listTrainedExercises', () => {
  it('lists exercises with usable history, most recent first', async () => {
    await logSession(0, 'Barbell Curl', [{ weightKg: 30, reps: 10 }]);
    await logSession(3, 'Preacher Curl', [{ weightKg: 25, reps: 10 }]);

    const trained = await listTrainedExercises(db, USER);
    expect(trained.map((e) => e.exercise_key)).toEqual(['Preacher Curl', 'Barbell Curl']);
  });

  it('counts sessions per exercise', async () => {
    await logSession(0, 'Barbell Curl', [{ weightKg: 30, reps: 10 }]);
    await logSession(7, 'Barbell Curl', [{ weightKg: 32, reps: 10 }]);

    const [entry] = await listTrainedExercises(db, USER);
    expect(entry?.session_count).toBe(2);
  });

  it('ignores an exercise logged with warmups only', async () => {
    await logSession(0, 'Barbell Curl', [{ weightKg: 20, reps: 10, isWarmup: true }]);
    expect(await listTrainedExercises(db, USER)).toEqual([]);
  });

  it('never lists another user\'s trained exercises', async () => {
    await logSession(0, 'Barbell Curl', [{ weightKg: 30, reps: 10 }], 'user-2');
    expect(await listTrainedExercises(db, USER)).toEqual([]);
  });
});

describe('summariseExerciseProgress', () => {
  it('reports progress when e1RM is climbing', async () => {
    for (let i = 0; i < 4; i++) {
      await logSession(i * 7, 'Barbell Curl', [{ weightKg: 30 + i * 2.5, reps: 8 }]);
    }

    const summary = await summariseExerciseProgress(db, USER, 'Barbell Curl');
    expect(summary?.assessment.isStalling).toBe(false);
    expect(summary?.assessment.e1rmDeltaKg ?? 0).toBeGreaterThan(0);
    expect(summary?.sessionCount).toBe(4);
  });

  it('flags a stall once enough sessions pass without a new best', async () => {
    await logSession(0, 'Barbell Curl', [{ weightKg: 30, reps: 8 }]);
    await logSession(7, 'Barbell Curl', [{ weightKg: 40, reps: 8 }]); // best
    await logSession(14, 'Barbell Curl', [{ weightKg: 37.5, reps: 8 }]);
    await logSession(21, 'Barbell Curl', [{ weightKg: 37.5, reps: 8 }]);
    await logSession(28, 'Barbell Curl', [{ weightKg: 35, reps: 8 }]);

    const summary = await summariseExerciseProgress(db, USER, 'Barbell Curl');
    expect(summary?.assessment.isStalling).toBe(true);
    expect(summary?.assessment.sessionsSinceBest).toBe(3);
  });

  it('does not call a stall after a single down session', async () => {
    await logSession(0, 'Barbell Curl', [{ weightKg: 30, reps: 8 }]);
    await logSession(7, 'Barbell Curl', [{ weightKg: 40, reps: 8 }]);
    await logSession(14, 'Barbell Curl', [{ weightKg: 37.5, reps: 8 }]);

    // One ordinary session after a personal best is training variance, not a plateau.
    expect((await summariseExerciseProgress(db, USER, 'Barbell Curl'))?.assessment.isStalling).toBe(false);
  });

  it('returns null rather than an empty summary for unknown history', async () => {
    expect(await summariseExerciseProgress(db, USER, 'Zottman Curl')).toBeNull();
  });
});

describe('summariseAllProgress', () => {
  it('skips exercises with too little history to judge', async () => {
    await logSession(0, 'Barbell Curl', [{ weightKg: 30, reps: 8 }]);
    await logSession(7, 'Barbell Curl', [{ weightKg: 32, reps: 8 }]);
    await logSession(0, 'Spider Curl', [{ weightKg: 15, reps: 10 }]); // one session only

    const summaries = await summariseAllProgress(db, USER);
    // Two data points cannot distinguish progress from noise; flagging a stall on one session
    // would be wrong far more often than right.
    expect(summaries.map((s) => s.exerciseKey)).toEqual(['Barbell Curl']);
  });
});

describe('toCoachDigest', () => {
  it('produces a compact record per exercise', async () => {
    for (let i = 0; i < 3; i++) {
      await logSession(i * 7, 'Barbell Curl', [{ weightKg: 30 + i * 2.5, reps: 8 }]);
    }

    const digest = toCoachDigest(await summariseAllProgress(db, USER));
    expect(digest).toHaveLength(1);
    expect(digest[0]).toMatchObject({
      exercise: 'Barbell Curl',
      sessions: 3,
      stalling: false,
    });
    // Rounded so the model is not handed 14 decimal places of float noise to read.
    expect(String(digest[0]?.currentE1rmKg)).toMatch(/^\d+(\.\d)?$/);
    expect(digest[0]?.lastPerformed).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('stays small — the point is to hand the model a digest, not raw rows', async () => {
    for (let i = 0; i < 20; i++) {
      await logSession(i, 'Barbell Curl', [
        { weightKg: 30, reps: 8 },
        { weightKg: 30, reps: 8 },
        { weightKg: 30, reps: 8 },
      ]);
    }

    const digest = toCoachDigest(await summariseAllProgress(db, USER));
    // 60 set rows collapse to one line.
    expect(digest).toHaveLength(1);
    expect(JSON.stringify(digest).length).toBeLessThan(400);
  });
});

describe('deleted sessions are excluded from progression', () => {
  it('drops a deleted session from an exercise history', async () => {
    await logSession(0, 'Barbell Curl', [{ weightKg: 30, reps: 10 }]);
    const wrong = await logSession(1, 'Barbell Curl', [{ weightKg: 200, reps: 10 }]);

    expect(await getExerciseProgression(db, USER, 'Barbell Curl')).toHaveLength(2);

    await deleteSession(db, USER, wrong);

    // A mistyped 200kg curl that was deleted must not keep inflating the e1RM, the best-ever
    // figure, or the digest the coach reasons about.
    const remaining = await getExerciseProgression(db, USER, 'Barbell Curl');
    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.best_e1rm_kg).toBeCloseTo(epley1RM(30, 10), 6);
  });

  it('drops an exercise entirely once its only session is deleted', async () => {
    const only = await logSession(0, 'Barbell Curl', [{ weightKg: 30, reps: 10 }]);
    expect(await listTrainedExercises(db, USER)).toHaveLength(1);

    await deleteSession(db, USER, only);

    expect(await listTrainedExercises(db, USER)).toHaveLength(0);
    expect(await summariseAllProgress(db, USER)).toHaveLength(0);
  });
});

describe('progress screen aggregates', () => {
  // A fixed "today" so week boundaries never depend on when the suite runs.
  const TODAY = new Date(2026, 5, 17); // Wednesday 17 June 2026

  it('weeklyVolume returns one entry per week, ending on the current week', async () => {
    const weeks = await weeklyVolume(db, USER, 4, TODAY);
    expect(weeks).toHaveLength(4);
    // Mondays, ascending, seven days apart.
    expect(weeks.map((w) => w.weekStart)).toEqual([
      '2026-05-25',
      '2026-06-01',
      '2026-06-08',
      '2026-06-15',
    ]);
  });

  it('weeklyVolume keeps untrained weeks at zero rather than dropping them', async () => {
    // Dropping them would slide the bars together and make a fortnight off look like a flat
    // healthy line — the exact thing the chart exists to reveal.
    const weeks = await weeklyVolume(db, USER, 4, TODAY);
    expect(weeks.every((w) => w.volumeKg === 0)).toBe(true);
  });

  it('weeklyVolume sums working-set volume into the right week', async () => {
    // logSession's clock is 1 June + dayOffset, so offset 15 is 16 June — the current week.
    await logSession(15, 'Barbell Curl', [{ weightKg: 30, reps: 10 }]);

    const weeks = await weeklyVolume(db, USER, 4, TODAY);
    const current = weeks[weeks.length - 1];
    expect(current?.weekStart).toBe('2026-06-15');
    expect(current?.volumeKg).toBe(300);
  });

  it('weeklyVolume ignores warmups', async () => {
    await logSession(15, 'Barbell Curl', [
      { weightKg: 100, reps: 10, isWarmup: true },
      { weightKg: 30, reps: 10 },
    ]);
    const weeks = await weeklyVolume(db, USER, 4, TODAY);
    expect(weeks[weeks.length - 1]?.volumeKg).toBe(300);
  });

  it('consistencyHeat returns whole weeks of days', async () => {
    const days = await consistencyHeat(db, USER, 4, TODAY);
    expect(days).toHaveLength(28);
    expect(days.every((d) => d.level === 0)).toBe(true);
  });

  it('consistencyHeat marks a trained day above zero', async () => {
    await logSession(15, 'Barbell Curl', [{ weightKg: 30, reps: 10 }]);
    const days = await consistencyHeat(db, USER, 4, TODAY);
    const trained = days.filter((d) => d.level > 0);
    expect(trained).toHaveLength(1);
    expect(trained[0]?.day).toBe('2026-06-16');
  });

  it('consistencyHeat buckets by quartile, so one huge day cannot flatten the rest', async () => {
    await logSession(10, 'Barbell Curl', [{ weightKg: 20, reps: 10 }]); // 200
    await logSession(11, 'Barbell Curl', [{ weightKg: 30, reps: 10 }]); // 300
    await logSession(12, 'Barbell Curl', [{ weightKg: 40, reps: 10 }]); // 400
    await logSession(13, 'Barbell Curl', [{ weightKg: 900, reps: 10 }]); // 9000, the outlier

    const days = await consistencyHeat(db, USER, 4, TODAY);
    const levels = days.filter((d) => d.level > 0).map((d) => d.level);
    // Against a plain max-based scale the first three would all collapse to the lowest bucket.
    expect(new Set(levels).size).toBeGreaterThan(1);
    expect(Math.max(...levels)).toBe(4);
  });

  it('personalRecords reports the heaviest working set per exercise', async () => {
    await logSession(0, 'Barbell Curl', [{ weightKg: 30, reps: 10 }]);
    await logSession(1, 'Barbell Curl', [{ weightKg: 40, reps: 6 }]);
    await logSession(2, 'Back Squat', [{ weightKg: 100, reps: 5 }]);

    const prs = await personalRecords(db, USER);
    expect(prs.map((p) => p.exerciseKey)).toEqual(['Back Squat', 'Barbell Curl']);
    expect(prs[1]?.weightKg).toBe(40);
    expect(prs[1]?.reps).toBe(6);
  });

  it('personalRecords breaks a weight tie on reps', async () => {
    await logSession(0, 'Barbell Curl', [{ weightKg: 40, reps: 5 }]);
    await logSession(1, 'Barbell Curl', [{ weightKg: 40, reps: 8 }]);

    const prs = await personalRecords(db, USER);
    expect(prs).toHaveLength(1);
    expect(prs[0]?.reps).toBe(8);
  });

  it('personalRecords ignores warmups and deleted sessions', async () => {
    await logSession(0, 'Barbell Curl', [{ weightKg: 30, reps: 10 }]);
    const inflated = await logSession(1, 'Barbell Curl', [{ weightKg: 500, reps: 1 }]);
    await deleteSession(db, USER, inflated);

    const prs = await personalRecords(db, USER);
    expect(prs[0]?.weightKg).toBe(30);
  });

  it('all three ignore another user entirely', async () => {
    await logSession(15, 'Barbell Curl', [{ weightKg: 30, reps: 10 }], 'user-2');

    expect((await weeklyVolume(db, USER, 4, TODAY)).every((w) => w.volumeKg === 0)).toBe(true);
    expect((await consistencyHeat(db, USER, 4, TODAY)).every((d) => d.level === 0)).toBe(true);
    expect(await personalRecords(db, USER)).toEqual([]);
  });
});
