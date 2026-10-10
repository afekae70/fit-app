/**
 * The food log against a real SQLite database: what is kept, what is refused, what a deletion
 * leaves behind, and that the whole thing travels through sync like the training log does.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { MAX_CALORIES, MAX_GRAMS, MAX_NAME } from '../food/foodMath.js';
import { PURGED_TABLES, purgeUserData } from './account.js';
import type { SqlExecutor } from './executor.js';
import { addFoodEntry, deleteFoodEntry, listFoodEntries, listRecentFoods } from './food.js';
import { CREATE_SCHEMA_SQL } from './schema.js';
import { createTestExecutor } from './testUtils.js';
import { SYNC_TABLES } from '../sync/tables.js';

const USER = 'user-1';
const TODAY = '2026-10-10';

let db: SqlExecutor & { close: () => void };
let counter = 0;
let tick = Date.parse('2026-10-10T08:00:00.000Z');
const newId = () => `id-${++counter}`;
const clock = () => new Date((tick += 1000)).toISOString();

beforeEach(() => {
  db = createTestExecutor();
  counter = 0;
});
afterEach(() => db.close());

const rice = {
  eatenOn: TODAY,
  name: 'אורז לבן מבושל',
  foodKey: 'rice_white',
  grams: 250,
  calories: 325,
  proteinG: 6.8,
  carbsG: 70,
  fatG: 0.8,
};

describe('logging something eaten', () => {
  it('keeps what it was, how much, and what that came to', async () => {
    const id = await addFoodEntry(db, USER, newId, rice, clock);
    const [entry] = await listFoodEntries(db, USER, TODAY);
    expect(entry).toMatchObject({
      id,
      user_id: USER,
      eaten_on: TODAY,
      name: 'אורז לבן מבושל',
      food_key: 'rice_white',
      grams: 250,
      calories: 325,
      protein_g: 6.8,
      carbs_g: 70,
      fat_g: 0.8,
      deleted_at: null,
    });
  });

  it('keeps an entry that has calories and nothing else', async () => {
    await addFoodEntry(
      db,
      USER,
      newId,
      { eatenOn: TODAY, name: 'ארוחה במסעדה', calories: 800 },
      clock,
    );
    const [entry] = await listFoodEntries(db, USER, TODAY);
    expect(entry).toMatchObject({
      calories: 800,
      protein_g: null,
      carbs_g: null,
      fat_g: null,
      grams: null,
      food_key: null,
    });
  });

  it('refuses an entry with no name, no day, or calories that are not a number', async () => {
    expect(await addFoodEntry(db, USER, newId, { ...rice, name: '   ' }, clock)).toBeNull();
    expect(await addFoodEntry(db, USER, newId, { ...rice, eatenOn: 'today' }, clock)).toBeNull();
    expect(
      await addFoodEntry(db, USER, newId, { ...rice, calories: Number.NaN }, clock),
    ).toBeNull();
    expect(await addFoodEntry(db, USER, newId, { ...rice, calories: -5 }, clock)).toBeNull();
    expect(await listFoodEntries(db, USER, TODAY)).toEqual([]);
  });

  it('keeps within what the server will take, rather than writing a row it would refuse', async () => {
    await addFoodEntry(
      db,
      USER,
      newId,
      {
        eatenOn: TODAY,
        name: 'x'.repeat(300),
        calories: 99999,
        grams: 99999,
        proteinG: -3,
        carbsG: 9999,
      },
      clock,
    );
    const [entry] = await listFoodEntries(db, USER, TODAY);
    expect(entry!.name).toHaveLength(120);
    expect(entry!.calories).toBe(20000);
    expect(entry!.grams).toBe(5000);
    expect(entry!.protein_g).toBeNull();
    expect(entry!.carbs_g).toBe(2000);
  });

  it('lists a day in the order it was eaten, and only that day, and only this person', async () => {
    await addFoodEntry(db, USER, newId, { ...rice, name: 'breakfast' }, clock);
    await addFoodEntry(db, USER, newId, { ...rice, name: 'lunch' }, clock);
    await addFoodEntry(
      db,
      USER,
      newId,
      { ...rice, name: 'yesterday', eatenOn: '2026-10-09' },
      clock,
    );
    await addFoodEntry(db, 'someone-else', newId, { ...rice, name: 'theirs' }, clock);

    expect((await listFoodEntries(db, USER, TODAY)).map((entry) => entry.name)).toEqual([
      'breakfast',
      'lunch',
    ]);
  });
});

describe('taking an entry out', () => {
  it('removes it from the day', async () => {
    const id = await addFoodEntry(db, USER, newId, rice, clock);
    await deleteFoodEntry(db, USER, id!, clock);
    expect(await listFoodEntries(db, USER, TODAY)).toEqual([]);
  });

  it('marks the row rather than removing it, so the deletion can reach the cloud', async () => {
    const id = await addFoodEntry(db, USER, newId, rice, clock);
    await deleteFoodEntry(db, USER, id!, clock);
    const row = await db.get<{ deleted_at: string | null; updated_at: string }>(
      `SELECT deleted_at, updated_at FROM food_entries WHERE id = ?`,
      [id],
    );
    expect(row?.deleted_at).not.toBeNull();
    expect(row?.updated_at).toBe(row?.deleted_at);
  });

  it('cannot take out somebody else’s', async () => {
    const id = await addFoodEntry(db, USER, newId, rice, clock);
    await deleteFoodEntry(db, 'someone-else', id!, clock);
    expect(await listFoodEntries(db, USER, TODAY)).toHaveLength(1);
  });
});

describe('what this person logs', () => {
  it('offers each thing once, the most recent first', async () => {
    await addFoodEntry(db, USER, newId, { ...rice, eatenOn: '2026-10-08' }, clock);
    await addFoodEntry(
      db,
      USER,
      newId,
      { eatenOn: '2026-10-09', name: 'ביצה', calories: 72 },
      clock,
    );
    await addFoodEntry(db, USER, newId, { ...rice, eatenOn: '2026-10-10' }, clock);

    const recent = await listRecentFoods(db, USER);
    expect(recent.map((entry) => entry.name)).toEqual(['אורז לבן מבושל', 'ביצה']);
    // The newest of the two identical bowls is the one offered.
    expect(recent[0]!.eaten_on).toBe('2026-10-10');
  });

  it('offers two amounts of the same food as two things', async () => {
    await addFoodEntry(db, USER, newId, { ...rice, grams: 100, calories: 130 }, clock);
    await addFoodEntry(db, USER, newId, { ...rice, grams: 250, calories: 325 }, clock);
    expect((await listRecentFoods(db, USER)).map((entry) => entry.calories)).toEqual([325, 130]);
  });

  it('does not offer what was deleted, or what someone else ate', async () => {
    const id = await addFoodEntry(db, USER, newId, rice, clock);
    await deleteFoodEntry(db, USER, id!, clock);
    await addFoodEntry(db, 'someone-else', newId, { ...rice, name: 'theirs' }, clock);
    expect(await listRecentFoods(db, USER)).toEqual([]);
  });

  it('stops at the number asked for', async () => {
    for (let i = 0; i < 8; i += 1) {
      await addFoodEntry(
        db,
        USER,
        newId,
        { eatenOn: TODAY, name: `food ${i}`, calories: 100 + i },
        clock,
      );
    }
    expect(await listRecentFoods(db, USER, 5)).toHaveLength(5);
  });
});

describe('the food log as part of the account', () => {
  it('is deleted with the account, and only that account’s', async () => {
    await addFoodEntry(db, USER, newId, rice, clock);
    await addFoodEntry(db, 'someone-else', newId, rice, clock);

    await purgeUserData(db, USER);

    expect(PURGED_TABLES).toContain('food_entries');
    const left = await db.all<{ user_id: string }>(`SELECT user_id FROM food_entries`);
    expect(left).toEqual([{ user_id: 'someone-else' }]);
  });

  it('syncs, with every column of the table that is not sync’s own bookkeeping', async () => {
    const table = SYNC_TABLES.find((entry) => entry.table === 'food_entries');
    expect(table).toBeDefined();
    // The server gets this table from a script run by hand; until then the rest must sync.
    expect(table?.optional).toBe(true);

    const local = (await db.all<{ name: string }>(`PRAGMA table_info(food_entries)`)).map(
      (c) => c.name,
    );
    expect([...table!.columns].sort()).toEqual(
      local.filter((c) => c !== 'remote_updated_at').sort(),
    );
    expect(local).toContain('remote_updated_at');
    expect(CREATE_SCHEMA_SQL).toContain('CREATE TABLE IF NOT EXISTS food_entries');
  });

  it('sends only columns the server’s table has', () => {
    // The other half lives in another package: apps/api/drizzle/0014 creates the table the
    // phone uploads to. A column sent that the server does not have is refused, and with it
    // every food row, on every phone — with nothing wrong in either file on its own.
    const migration = readFileSync(
      join(import.meta.dirname, '../../../api/drizzle/0014_food_log.sql'),
      'utf8',
    );
    const body = /CREATE TABLE IF NOT EXISTS public\.food_entries \(([\s\S]*?)\n\);/.exec(
      migration,
    )?.[1];
    expect(body).toBeDefined();
    const serverColumns = [
      ...body!.matchAll(/^\s{2}([a-z_]+)\s+(?:uuid|text|date|numeric|timestamptz)/gm),
    ].map((match) => match[1]);
    const table = SYNC_TABLES.find((entry) => entry.table === 'food_entries')!;
    expect(serverColumns.length).toBeGreaterThan(10);
    for (const column of table.columns) expect(serverColumns).toContain(column);
  });

  it('keeps within the bounds the server checks', () => {
    // The same numbers, in two files. If the server's are ever tightened and these are not,
    // rows start being refused; this is where that shows first.
    const migration = readFileSync(
      join(import.meta.dirname, '../../../api/drizzle/0014_food_log.sql'),
      'utf8',
    );
    expect(migration).toContain('BETWEEN 1 AND 120');
    expect(migration).toContain('grams <= 5000');
    expect(migration).toContain('calories <= 20000');
    expect(migration).toContain('protein_g <= 2000');
    expect([MAX_NAME, MAX_GRAMS, MAX_CALORIES]).toEqual([120, 5000, 20000]);
  });

  it('stamps a new entry so that sync sends it', async () => {
    const id = await addFoodEntry(db, USER, newId, rice, clock);
    const row = await db.get<{ updated_at: string | null; created_at: string }>(
      `SELECT updated_at, created_at FROM food_entries WHERE id = ?`,
      [id],
    );
    expect(row?.updated_at).toBe(row?.created_at);
    expect(row?.updated_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});
