import { beforeEach, describe, expect, it } from 'vitest';

import type { SqlExecutor } from './executor.js';
import { exportMetrics, exportSets } from './exportData.js';
import { addLocation, setSessionLocation } from './locations.js';
import { createTestExecutor } from './testUtils.js';
import {
  addExerciseToSession,
  addSet,
  finishSession,
  removeExerciseFromSession,
  removeSet,
  startSession,
} from './workouts.js';

const USER = 'user-1';

let db: SqlExecutor;
let counter = 0;
const newId = () => `id-${String(++counter).padStart(3, '0')}`;
const at = (day: number) => () => `2026-06-${String(day).padStart(2, '0')}T18:00:00.000Z`;

beforeEach(() => {
  db = createTestExecutor();
  counter = 0;
});

async function logSession(day: number, exercise: string, weights: number[], gym?: string) {
  const clock = at(day);
  const id = await startSession(db, USER, newId, {}, clock);
  if (gym) await setSessionLocation(db, id, gym, clock);
  const ex = await addExerciseToSession(db, newId, id, exercise, clock);
  for (const w of weights) await addSet(db, newId, ex, { weightKg: w, reps: 8 }, clock);
  await finishSession(db, USER, id, {}, clock);
  return { id, ex };
}

describe('exporting sets', () => {
  it('writes one row per set, oldest first', async () => {
    await logSession(2, 'Bench', [80, 82.5]);
    await logSession(1, 'Squat', [100]);

    const rows = await exportSets(db, USER);

    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.exercise)).toEqual(['Squat', 'Bench', 'Bench']);
  });

  it('carries the gym when there is one', async () => {
    const gym = await addLocation(db, newId, USER, 'Gold Gym', at(1));
    await logSession(1, 'Bench', [80], gym!);

    expect((await exportSets(db, USER))[0]?.gym).toBe('Gold Gym');
  });

  it('still exports a workout with no gym', async () => {
    // Every workout logged before gyms existed has none, so an inner join here would export
    // nothing at all — the failure that would look like the feature simply not working.
    await logSession(1, 'Bench', [80]);

    const rows = await exportSets(db, USER);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.gym).toBeNull();
  });

  it('leaves out a deleted set', async () => {
    const { ex } = await logSession(1, 'Bench', [80, 100]);
    const sets = await db.all<{ id: string }>(
      `SELECT id FROM sets WHERE session_exercise_id = ? ORDER BY set_index`,
      [ex],
    );
    await removeSet(db, sets[0]!.id, at(1));

    const rows = await exportSets(db, USER);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.weightKg).toBe(100);
  });

  it('leaves out the sets of a deleted exercise', async () => {
    // A set can be alive while the exercise holding it is gone. Reading only `sets.deleted_at`
    // would resurrect it, and the export would disagree with every screen in the app.
    const { ex } = await logSession(1, 'Bench', [80, 100]);
    await removeExerciseFromSession(db, ex);

    expect(await exportSets(db, USER)).toHaveLength(0);
  });

  it('keeps one user out of another user\'s history', async () => {
    await logSession(1, 'Bench', [80]);
    const other = await startSession(db, 'someone-else', newId, {}, at(1));
    const otherEx = await addExerciseToSession(db, newId, other, 'Squat', at(1));
    await addSet(db, newId, otherEx, { weightKg: 200, reps: 1 }, at(1));

    const rows = await exportSets(db, USER);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.exercise).toBe('Bench');
  });
});

describe('exporting weigh-ins', () => {
  it('returns them oldest first', async () => {
    for (const [day, kg] of [[3, 74], [1, 73]] as const) {
      await db.run(
        `INSERT INTO body_metrics (id, user_id, measured_at, weight_kg, source, updated_at)
         VALUES (?, ?, ?, ?, 'manual', ?)`,
        [newId(), USER, `2026-06-0${day}T07:00:00.000Z`, kg, '2026-06-01T07:00:00.000Z'],
      );
    }

    expect((await exportMetrics(db, USER)).map((m) => m.weightKg)).toEqual([73, 74]);
  });

  it('is empty rather than throwing when nothing was ever weighed', async () => {
    expect(await exportMetrics(db, USER)).toEqual([]);
  });
});
