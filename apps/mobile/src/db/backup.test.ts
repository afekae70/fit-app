import { beforeEach, describe, expect, it } from 'vitest';

import {
  BACKUP_FORMAT,
  createBackup,
  inspectBackup,
  restoreBackup,
  type BackupFile,
} from './backup.js';
import type { SqlExecutor } from './executor.js';
import { addLocation } from './locations.js';
import { SCHEMA_VERSION } from './schema.js';
import { createTestExecutor } from './testUtils.js';
import { addExerciseToSession, addSet, finishSession, startSession } from './workouts.js';

const USER = 'user-1';

let db: SqlExecutor;
let counter = 0;
const newId = () => `id-${String(++counter).padStart(3, '0')}`;
const clock = () => '2026-06-01T10:00:00.000Z';

async function seed() {
  await addLocation(db, newId, USER, 'Gold Gym', clock);
  const sessionId = await startSession(db, USER, newId, {}, clock);
  const ex = await addExerciseToSession(db, newId, sessionId, 'Barbell Bench Press', clock);
  await addSet(db, newId, ex, { weightKg: 80, reps: 8 }, clock);
  await addSet(db, newId, ex, { weightKg: 82.5, reps: 6 }, clock);
  await finishSession(db, USER, sessionId, {}, clock);
  return sessionId;
}

beforeEach(() => {
  db = createTestExecutor();
  counter = 0;
});

describe('createBackup', () => {
  it('captures the training that exists', async () => {
    await seed();
    const file = await createBackup(db, USER, SCHEMA_VERSION);

    expect(file.format).toBe(BACKUP_FORMAT);
    expect(file.tables.workout_sessions).toHaveLength(1);
    expect(file.tables.sets).toHaveLength(2);
    expect(file.tables.locations).toHaveLength(1);
  });

  it('leaves the sync bookkeeping out', async () => {
    // outbox and sync_state describe a conversation with the server that a restored database has
    // not had; carrying them would re-push rows against another device's cursor.
    await seed();
    const file = await createBackup(db, USER, SCHEMA_VERSION);
    expect(file.tables.outbox).toBeUndefined();
    expect(file.tables.sync_state).toBeUndefined();
  });

  it('does not take another account rows left on the device', async () => {
    await seed();
    await addLocation(db, newId, 'someone-else', 'Their gym', clock);

    const file = await createBackup(db, USER, SCHEMA_VERSION);
    expect(file.tables.locations).toHaveLength(1);
  });
});

describe('inspectBackup', () => {
  const good = async () => JSON.stringify(await createBackup(db, USER, SCHEMA_VERSION));

  it('accepts a backup it made itself', async () => {
    await seed();
    const check = inspectBackup(await good(), USER, SCHEMA_VERSION);
    expect(check.ok).toBe(true);
    expect(check.summary?.sets).toBe(2);
  });

  it('names the problem rather than throwing', async () => {
    // "Nothing happened" is the worst possible response to a restore.
    expect(inspectBackup('not json at all', USER, SCHEMA_VERSION).problem).toBe('not-json');
    expect(inspectBackup('{"a":1}', USER, SCHEMA_VERSION).problem).toBe('wrong-format');
  });

  it('refuses a backup belonging to somebody else', async () => {
    // Re-stamping the rows would merge two people's training with no way to separate them again.
    await seed();
    expect(inspectBackup(await good(), 'a-different-user', SCHEMA_VERSION).problem).toBe(
      'different-user',
    );
  });

  it('refuses a backup from a newer version of the app', async () => {
    // It may hold columns this build has never heard of. Importing and silently dropping them
    // would lose data while reporting success.
    await seed();
    expect(inspectBackup(await good(), USER, SCHEMA_VERSION - 1).problem).toBe('newer-schema');
  });

  it('accepts a backup from an older version', async () => {
    await seed();
    const file = JSON.parse(await good()) as BackupFile;
    file.schemaVersion = 1;
    expect(inspectBackup(JSON.stringify(file), USER, SCHEMA_VERSION).ok).toBe(true);
  });

  it('touches nothing while inspecting', async () => {
    await seed();
    inspectBackup('garbage', USER, SCHEMA_VERSION);
    expect(await db.all(`SELECT id FROM sets`)).toHaveLength(2);
  });
});

describe('restoreBackup', () => {
  it('puts back exactly what was taken', async () => {
    await seed();
    const file = await createBackup(db, USER, SCHEMA_VERSION);

    await db.run(`DELETE FROM sets`);
    await db.run(`DELETE FROM session_exercises`);
    await db.run(`DELETE FROM workout_sessions`);
    expect(await db.all(`SELECT id FROM sets`)).toHaveLength(0);

    await restoreBackup(db, file);

    const sets = await db.all<{ weight_kg: number }>(`SELECT weight_kg FROM sets ORDER BY set_index`);
    expect(sets.map((s) => s.weight_kg)).toEqual([80, 82.5]);
  });

  it('replaces rather than merges', async () => {
    // One rule the user can predict: after a restore, the app holds what the backup holds.
    await seed();
    const file = await createBackup(db, USER, SCHEMA_VERSION);

    const second = await startSession(db, USER, newId, {}, clock);
    const ex = await addExerciseToSession(db, newId, second, 'Barbell Curl', clock);
    await addSet(db, newId, ex, { weightKg: 30, reps: 12 }, clock);

    await restoreBackup(db, file);

    expect(await db.all(`SELECT id FROM workout_sessions`)).toHaveLength(1);
    expect(await db.all(`SELECT id FROM sets`)).toHaveLength(2);
  });

  it('survives a round trip through JSON', async () => {
    await seed();
    const text = JSON.stringify(await createBackup(db, USER, SCHEMA_VERSION));
    await db.run(`DELETE FROM sets`);

    const check = inspectBackup(text, USER, SCHEMA_VERSION);
    expect(check.ok).toBe(true);
    await restoreBackup(db, check.file!);

    expect(await db.all(`SELECT id FROM sets`)).toHaveLength(2);
  });

  it('leaves the database untouched when a restore fails', async () => {
    // The disaster a backup exists to prevent: a half-restored history that looks like it worked.
    await seed();
    const broken: BackupFile = {
      format: BACKUP_FORMAT,
      schemaVersion: SCHEMA_VERSION,
      exportedAt: '2026-06-01T10:00:00.000Z',
      userId: USER,
      tables: {
        // A column no table has, so the insert throws part-way through the restore.
        workout_sessions: [{ id: 'x', user_id: USER, nonsense_column: 1 }],
      },
    };

    await expect(restoreBackup(db, broken)).rejects.toThrow();

    expect(await db.all(`SELECT id FROM sets`)).toHaveLength(2);
    expect(await db.all(`SELECT id FROM workout_sessions`)).toHaveLength(1);
  });

  it('restores an older backup that lacks a newer column', async () => {
    await seed();
    const file = await createBackup(db, USER, SCHEMA_VERSION);
    for (const row of file.tables.sets ?? []) delete row.is_drop;

    await restoreBackup(db, file);

    const sets = await db.all<{ is_drop: number }>(`SELECT is_drop FROM sets`);
    expect(sets.every((s) => s.is_drop === 0)).toBe(true);
  });
});
