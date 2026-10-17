/**
 * Progress photos against a real SQLite database and against the server script that makes their
 * table: what is kept, what a deletion leaves to be cleaned up, and which columns travel.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { SYNC_TABLES } from '../sync/tables.js';
import { PURGED_TABLES, purgeUserData } from './account.js';
import type { SqlExecutor } from './executor.js';
import {
  addProgressPhoto,
  deleteProgressPhoto,
  listProgressPhotos,
  markPhotoCleaned,
  markPhotoUploaded,
  MAX_PHOTO_NOTE,
  photosToClean,
  photosToUpload,
  resendAllPhotos,
} from './progressPhotos.js';
import { createTestExecutor } from './testUtils.js';

const USER = 'user-1';
const ID_A = '11111111-1111-4111-8111-111111111111';
const ID_B = '22222222-2222-4222-8222-222222222222';
const ID_C = '33333333-3333-4333-8333-333333333333';

let db: SqlExecutor & { close: () => void };
let tick = Date.parse('2026-10-17T08:00:00.000Z');
const clock = () => new Date((tick += 1000)).toISOString();

beforeEach(() => {
  db = createTestExecutor();
});
afterEach(() => db.close());

const SERVER_SQL = readFileSync(
  join(import.meta.dirname, '../../../api/drizzle/0018_coach_sharing_and_progress_photos.sql'),
  'utf8',
);

const photo = (id: string, takenOn = '2026-10-17', extra: Partial<{ note: string }> = {}) => ({
  id,
  takenOn,
  pose: 'front' as const,
  note: extra.note ?? '',
  fileUri: `file:///photos/${id}.jpg`,
});

describe('keeping a photo', () => {
  it('lists them newest day first', async () => {
    await addProgressPhoto(db, USER, photo(ID_A, '2026-08-01'), clock);
    await addProgressPhoto(db, USER, photo(ID_B, '2026-10-17'), clock);
    await addProgressPhoto(db, USER, photo(ID_C, '2026-09-01'), clock);
    expect((await listProgressPhotos(db, USER)).map((p) => p.takenOn)).toEqual([
      '2026-10-17',
      '2026-09-01',
      '2026-08-01',
    ]);
  });

  it('keeps each person’s apart', async () => {
    await addProgressPhoto(db, USER, photo(ID_A), clock);
    await addProgressPhoto(db, 'someone-else', photo(ID_B), clock);
    expect((await listProgressPhotos(db, USER)).map((p) => p.id)).toEqual([ID_A]);
  });

  it('keeps the pose, the note and where the picture is', async () => {
    await addProgressPhoto(
      db,
      USER,
      { ...photo(ID_A), pose: 'side', note: '  after the cut ' },
      clock,
    );
    expect(await listProgressPhotos(db, USER)).toEqual([
      {
        id: ID_A,
        takenOn: '2026-10-17',
        pose: 'side',
        note: 'after the cut',
        fileUri: `file:///photos/${ID_A}.jpg`,
      },
    ]);
  });

  it('stores an empty note as none, and a long one cut to the server’s bound', async () => {
    await addProgressPhoto(db, USER, photo(ID_A, '2026-10-17', { note: '   ' }), clock);
    await addProgressPhoto(db, USER, photo(ID_B, '2026-10-16', { note: 'x'.repeat(500) }), clock);
    const [a, b] = await listProgressPhotos(db, USER);
    expect(a?.note).toBeNull();
    expect(b?.note).toHaveLength(MAX_PHOTO_NOTE);
    expect(SERVER_SQL).toContain('char_length(note) <= 200');
    expect(MAX_PHOTO_NOTE).toBe(200);
  });

  it('refuses what the server would refuse forever', async () => {
    expect(await addProgressPhoto(db, USER, photo('not-a-uuid'), clock)).toBe(false);
    expect(await addProgressPhoto(db, USER, photo(ID_A, '17/10/2026'), clock)).toBe(false);
    expect(
      await addProgressPhoto(db, USER, { ...photo(ID_A), pose: 'upside-down' as never }, clock),
    ).toBe(false);
    expect(await listProgressPhotos(db, USER)).toEqual([]);
    expect(SERVER_SQL).toContain(`pose IN ('front', 'side', 'back')`);
  });

  it('allows a photo with no pose said', async () => {
    expect(await addProgressPhoto(db, USER, { ...photo(ID_A), pose: null }, clock)).toBe(true);
    expect((await listProgressPhotos(db, USER))[0]?.pose).toBeNull();
  });
});

describe('sending the picture', () => {
  it('queues a new picture, and stops once it has gone', async () => {
    await addProgressPhoto(db, USER, photo(ID_A), clock);
    expect(await photosToUpload(db, USER)).toEqual([
      { id: ID_A, fileUri: `file:///photos/${ID_A}.jpg` },
    ]);
    await markPhotoUploaded(db, ID_A, clock);
    expect(await photosToUpload(db, USER)).toEqual([]);
  });

  it('does not send a picture that was deleted before it went', async () => {
    await addProgressPhoto(db, USER, photo(ID_A), clock);
    await deleteProgressPhoto(db, USER, ID_A, clock);
    expect(await photosToUpload(db, USER)).toEqual([]);
  });

  it('has nothing to send for a row from another phone', async () => {
    await db.run(
      `INSERT INTO progress_photos (id, user_id, taken_on, created_at, updated_at)
       VALUES (?, ?, '2026-10-01', '2026-10-01T00:00:00Z', '2026-10-01T00:00:00Z')`,
      [ID_A, USER],
    );
    expect(await photosToUpload(db, USER)).toEqual([]);
    expect((await listProgressPhotos(db, USER))[0]?.fileUri).toBeNull();
  });

  it('does not count as a change for sync to send', async () => {
    await addProgressPhoto(db, USER, photo(ID_A), clock);
    const before = await db.get(`SELECT updated_at FROM progress_photos WHERE id = ?`, [ID_A]);
    await markPhotoUploaded(db, ID_A, clock);
    expect(await db.get(`SELECT updated_at FROM progress_photos WHERE id = ?`, [ID_A])).toEqual(
      before,
    );
  });

  it('queues every picture again when the server’s copies were taken away', async () => {
    await addProgressPhoto(db, USER, photo(ID_A), clock);
    await addProgressPhoto(db, USER, photo(ID_B), clock);
    await markPhotoUploaded(db, ID_A, clock);
    await markPhotoUploaded(db, ID_B, clock);
    await resendAllPhotos(db, USER);
    expect((await photosToUpload(db, USER)).map((p) => p.id).sort()).toEqual([ID_A, ID_B]);
  });
});

describe('deleting a photo', () => {
  it('takes it off the list, and marks it so the deletion syncs', async () => {
    await addProgressPhoto(db, USER, photo(ID_A), clock);
    expect(await deleteProgressPhoto(db, USER, ID_A, clock)).toBe(true);
    expect(await listProgressPhotos(db, USER)).toEqual([]);
    const row = await db.get<{ deleted_at: string | null; updated_at: string }>(
      `SELECT deleted_at, updated_at FROM progress_photos WHERE id = ?`,
      [ID_A],
    );
    expect(row?.deleted_at).toBe(row?.updated_at);
  });

  it('says so when there was nothing to delete, including someone else’s', async () => {
    await addProgressPhoto(db, 'someone-else', photo(ID_A), clock);
    expect(await deleteProgressPhoto(db, USER, ID_A, clock)).toBe(false);
    expect(await listProgressPhotos(db, 'someone-else')).toHaveLength(1);
  });

  it('leaves the picture to be removed here and from the server', async () => {
    await addProgressPhoto(db, USER, photo(ID_A), clock);
    await markPhotoUploaded(db, ID_A, clock);
    await deleteProgressPhoto(db, USER, ID_A, clock);
    expect(await photosToClean(db, USER)).toEqual([
      { id: ID_A, fileUri: `file:///photos/${ID_A}.jpg`, inBucket: true },
    ]);
    await markPhotoCleaned(db, ID_A);
    expect(await photosToClean(db, USER)).toEqual([]);
  });

  it('removes from the server even when this phone never sent the picture', async () => {
    // A row pulled from another phone, deleted here: the bucket has the picture all the same.
    await db.run(
      `INSERT INTO progress_photos (id, user_id, taken_on, created_at, updated_at)
       VALUES (?, ?, '2026-10-01', '2026-10-01T00:00:00Z', '2026-10-01T00:00:00Z')`,
      [ID_A, USER],
    );
    await deleteProgressPhoto(db, USER, ID_A, clock);
    expect(await photosToClean(db, USER)).toEqual([{ id: ID_A, fileUri: null, inBucket: true }]);
  });

  it('cleans up a deletion that came from another phone', async () => {
    await addProgressPhoto(db, USER, photo(ID_A), clock);
    await markPhotoUploaded(db, ID_A, clock);
    // What sync writes when the other phone's deletion arrives: the synced columns only.
    await db.run(`UPDATE progress_photos SET deleted_at = ?, updated_at = ? WHERE id = ?`, [
      '2026-10-17T09:00:00Z',
      '2026-10-17T09:00:00Z',
      ID_A,
    ]);
    expect(await photosToClean(db, USER)).toEqual([
      { id: ID_A, fileUri: `file:///photos/${ID_A}.jpg`, inBucket: true },
    ]);
  });

  it('never marks a live photo clean', async () => {
    await addProgressPhoto(db, USER, photo(ID_A), clock);
    await markPhotoCleaned(db, ID_A);
    expect((await listProgressPhotos(db, USER))[0]?.fileUri).toBe(`file:///photos/${ID_A}.jpg`);
  });
});

describe('as part of the account', () => {
  it('is deleted with the account, and only that account’s', async () => {
    await addProgressPhoto(db, USER, photo(ID_A), clock);
    await addProgressPhoto(db, 'someone-else', photo(ID_B), clock);
    expect(PURGED_TABLES).toContain('progress_photos');
    await purgeUserData(db, USER);
    expect(await listProgressPhotos(db, USER)).toEqual([]);
    expect(await listProgressPhotos(db, 'someone-else')).toHaveLength(1);
  });

  it('syncs every column but this phone’s own', async () => {
    const table = SYNC_TABLES.find((entry) => entry.table === 'progress_photos');
    expect(table?.optional).toBe(true);
    const local = (await db.all<{ name: string }>(`PRAGMA table_info(progress_photos)`)).map(
      (column) => column.name,
    );
    expect([...table!.columns].sort()).toEqual(
      local.filter((c) => !['remote_updated_at', 'file_uri', 'uploaded_at'].includes(c)).sort(),
    );
    // Where a picture is on one phone means nothing on another.
    expect(table!.columns).not.toContain('file_uri');
    expect(table!.columns).not.toContain('uploaded_at');
  });

  it('sends only columns the server’s table has', () => {
    const body = /CREATE TABLE IF NOT EXISTS public\.progress_photos \(([\s\S]*?)\n\);/.exec(
      SERVER_SQL,
    )?.[1];
    expect(body).toBeDefined();
    const serverColumns = [
      ...body!.matchAll(/^\s{2}([a-z_]+)\s+(?:uuid|text|date|timestamptz)/gm),
    ].map((match) => match[1]);
    const table = SYNC_TABLES.find((entry) => entry.table === 'progress_photos')!;
    expect(serverColumns).toHaveLength(8);
    for (const column of table.columns) expect(serverColumns, column).toContain(column);
  });
});
