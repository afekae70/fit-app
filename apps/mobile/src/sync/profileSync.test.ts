/**
 * Profile sync against a real SQLite database on the phone's side and a stand-in for the
 * server that objects to the things Postgres would object to.
 *
 * The stand-in matters as much as the assertions. A fake that accepts anything would agree
 * with whatever the code under test sent it; this one rounds a height the way `numeric(5,2)`
 * does, refuses a value outside a CHECK, refuses the columns a client is not granted, and —
 * until told otherwise — has never heard of `avatar_version`.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { getProfile, saveProfile, setAvatarVersion } from '../db/metrics.js';
import { createTestExecutor } from '../db/testUtils.js';
import {
  canonical,
  decide,
  forgetMissingPhoto,
  parseAgreement,
  PHOTO_FIELD,
  PROFILE_FIELDS,
  syncProfile,
  type PhotoPort,
  type ProfileTransport,
  type ProfileValue,
} from './profileSync.js';

const USER = '11111111-1111-4111-8111-111111111111';

/** Every column a client is allowed to write. Anything else is refused, as 0011 arranges. */
const WRITABLE = new Set<string>([...PROFILE_FIELDS, PHOTO_FIELD, 'locale']);

const CHECKS: Record<string, readonly string[]> = {
  sex: ['male', 'female', 'other'],
  bmr_formula_sex: ['male', 'female'],
  activity_level: ['sedentary', 'light', 'moderate', 'active', 'very_active'],
  goal: ['cut', 'maintain', 'bulk'],
  unit_preference: ['metric', 'imperial'],
};

class Refused extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

function createServer(initial: Record<string, unknown> | null = {}) {
  let stamp = 0;
  let row: Record<string, unknown> | null =
    initial === null
      ? null
      : {
          id: USER,
          display_name: null,
          birth_date: null,
          sex: null,
          bmr_formula_sex: null,
          height_cm: null,
          activity_level: null,
          goal: null,
          // NOT NULL DEFAULT 'metric' on the real table.
          unit_preference: 'metric',
          locale: 'he',
          role: 'trainee',
          coach_code: null,
          updated_at: `2026-10-09T10:00:00.${String(stamp).padStart(6, '0')}+00:00`,
          ...initial,
        };

  const state = {
    /** Every update that was attempted, accepted or not. */
    updates: [] as Record<string, ProfileValue>[],
    fetches: 0,
    /** Run once, in the middle of the next update — for an edit that lands mid-flight. */
    duringUpdate: null as null | (() => Promise<void>),
    get row() {
      return row;
    },
    /** What 0011 does to a server that did not have the column. */
    addPhotoColumn() {
      if (row && !(PHOTO_FIELD in row)) row[PHOTO_FIELD] = null;
    },
    /** Somebody else — an administrator, another phone — changing the row directly. */
    set(changes: Record<string, unknown>) {
      row = {
        ...row,
        ...changes,
        updated_at: `2026-10-09T10:00:00.${String(++stamp).padStart(6, '0')}+00:00`,
      };
    },
  };

  const transport: ProfileTransport = {
    async fetch() {
      state.fetches += 1;
      return row ? { ...row } : null;
    },
    async update(_userId, changes) {
      state.updates.push({ ...changes });
      if (state.duringUpdate) {
        const run = state.duringUpdate;
        state.duringUpdate = null;
        await run();
      }
      if (!row) return;
      for (const [column, value] of Object.entries(changes)) {
        if (!(column in row)) throw new Refused('PGRST204', `no column ${column}`);
        if (!WRITABLE.has(column)) throw new Refused('42501', `permission denied for ${column}`);
        if (column === 'unit_preference' && value === null) throw new Refused('23502', 'null');
        const allowed = CHECKS[column];
        if (allowed && value !== null && !allowed.includes(String(value))) {
          throw new Refused('23514', `check on ${column}`);
        }
        if (
          column === 'height_cm' &&
          value !== null &&
          !(Number(value) > 50 && Number(value) < 260)
        ) {
          throw new Refused('23514', 'height range');
        }
      }
      const stored: Record<string, unknown> = { ...changes };
      if (typeof stored.height_cm === 'number')
        stored.height_cm = Math.round(stored.height_cm * 100) / 100;
      state.set(stored);
    },
  };

  return { state, transport };
}

/** A phone's picture and the cloud's pictures, as far as the port can tell. */
function createPhotos(onPhone: string | null = null) {
  const state = {
    /** The tag of the picture file on this phone. */
    onPhone,
    cloud: new Set<string>(),
    log: [] as string[],
    failUpload: false,
    failDownload: false,
  };
  const port: PhotoPort = {
    async upload(_userId, version) {
      state.log.push(`upload ${version}`);
      if (state.failUpload) throw new Error('upload refused');
      state.cloud.add(version);
    },
    async download(_userId, version) {
      state.log.push(`download ${version}`);
      if (state.failDownload || !state.cloud.has(version)) throw new Error('not found');
      state.onPhone = version;
    },
    async removeRemote(_userId, version) {
      state.log.push(`removeRemote ${version}`);
      state.cloud.delete(version);
    },
    async removeLocal() {
      state.log.push('removeLocal');
      state.onPhone = null;
    },
  };
  return { state, port };
}

const FULL = {
  displayName: 'אפק',
  birthDate: '1998-04-12',
  sex: 'male',
  heightCm: 178,
  activityLevel: 'active',
  goal: 'bulk',
  unitPreference: 'metric',
} as const;

const open: { close: () => void }[] = [];
function phone() {
  const db = createTestExecutor();
  open.push(db);
  return db;
}
afterEach(() => {
  for (const db of open.splice(0)) db.close();
});

const fields = async (db: ReturnType<typeof phone>) => {
  const row = await getProfile(db, USER);
  return row
    ? {
        display_name: row.display_name,
        birth_date: row.birth_date,
        sex: row.sex,
        height_cm: row.height_cm,
        activity_level: row.activity_level,
        goal: row.goal,
        unit_preference: row.unit_preference,
      }
    : null;
};

describe('which way one field goes', () => {
  it('does nothing when the two sides already agree', () => {
    expect(decide('cut', 'cut', undefined)).toBe('same');
    expect(decide(null, null, 'cut')).toBe('same');
  });

  it('at the first meeting, a value beats no value in either direction', () => {
    expect(decide('cut', null, undefined)).toBe('push');
    expect(decide(null, 'cut', undefined)).toBe('pull');
    // Two values and no history: this phone's is kept.
    expect(decide('cut', 'bulk', undefined)).toBe('push');
  });

  it('after that, sends what changed here and takes what changed elsewhere', () => {
    expect(decide('bulk', 'cut', 'cut')).toBe('push');
    expect(decide('cut', 'bulk', 'cut')).toBe('pull');
    // A field cleared on purpose is a change like any other.
    expect(decide(null, 'cut', 'cut')).toBe('push');
    expect(decide('cut', null, 'cut')).toBe('pull');
    // Both moved: this phone's goes, as with every other table.
    expect(decide('bulk', 'maintain', 'cut')).toBe('push');
  });
});

describe('the form values are compared in', () => {
  it('keeps a height to the two decimals the server keeps', () => {
    expect(canonical('height_cm', 180.339999)).toBe(180.34);
    expect(canonical('height_cm', '175.50')).toBe(175.5);
  });

  it('reads a date of birth as a day, whatever is written after it', () => {
    expect(canonical('birth_date', '1998-04-12T00:00:00.000Z')).toBe('1998-04-12');
    expect(canonical('birth_date', '1998-04-12')).toBe('1998-04-12');
  });

  it('has no form for what the server would refuse', () => {
    expect(canonical('height_cm', 30)).toBeUndefined();
    expect(canonical('height_cm', 'tall')).toBeUndefined();
    expect(canonical('birth_date', '12/04/1998')).toBeUndefined();
    expect(canonical('birth_date', '1998-02-31')).toBeUndefined();
    expect(canonical('goal', 'lose_weight')).toBeUndefined();
    expect(canonical('avatar_version', '../../etc')).toBeUndefined();
  });

  it('reads nothing as nothing', () => {
    for (const field of [...PROFILE_FIELDS, PHOTO_FIELD] as const) {
      expect(canonical(field, null)).toBeNull();
      expect(canonical(field, undefined)).toBeNull();
    }
  });
});

describe('the first meeting', () => {
  it('sends a filled-in profile to a server that has none of it', async () => {
    const db = phone();
    const server = createServer();
    await saveProfile(db, USER, FULL);

    const result = await syncProfile(db, server.transport, USER);

    expect(result.outcome).toBe('synced');
    expect(result.pulled).toEqual([]);
    expect(server.state.row).toMatchObject({
      display_name: 'אפק',
      birth_date: '1998-04-12',
      sex: 'male',
      height_cm: 178,
      activity_level: 'active',
      goal: 'bulk',
      unit_preference: 'metric',
    });
  });

  it('fills an empty phone from the server and sends nothing', async () => {
    const db = phone();
    const server = createServer({
      display_name: 'אפק',
      birth_date: '1998-04-12',
      sex: 'male',
      height_cm: 178,
      activity_level: 'active',
      goal: 'bulk',
      unit_preference: 'imperial',
    });

    const result = await syncProfile(db, server.transport, USER);

    expect(server.state.updates).toEqual([]);
    expect(result.pushed).toEqual([]);
    expect(await fields(db)).toEqual({
      display_name: 'אפק',
      birth_date: '1998-04-12',
      sex: 'male',
      height_cm: 178,
      activity_level: 'active',
      goal: 'bulk',
      unit_preference: 'imperial',
    });
  });

  it('does not send back what it has just been given', async () => {
    // What comes down has to be remembered as agreed. If it is not, the next run finds a phone
    // full of values that match no agreement, takes them for edits made here, and pushes the
    // server's own answers back — over whatever another phone has changed in the meantime.
    const db = phone();
    const server = createServer({ display_name: 'אפק', height_cm: 178, goal: 'bulk' });
    await syncProfile(db, server.transport, USER);

    server.state.set({ goal: 'cut' });
    const result = await syncProfile(db, server.transport, USER);

    expect(server.state.updates).toEqual([]);
    expect(result.pulled).toEqual(['goal']);
    expect((await fields(db))?.goal).toBe('cut');
  });

  it('does not blank the server because one field was saved on a new phone first', async () => {
    // The case the whole design is for. A reinstalled app, and the units switch flipped before
    // anything had come down: the phone now has a profile row that is newer than the server's
    // and empty everywhere else.
    const db = phone();
    const server = createServer({
      display_name: 'אפק',
      birth_date: '1998-04-12',
      height_cm: 178,
      activity_level: 'active',
      goal: 'bulk',
    });
    await saveProfile(db, USER, { unitPreference: 'imperial' });

    const result = await syncProfile(db, server.transport, USER);

    expect(server.state.updates).toEqual([{ unit_preference: 'imperial' }]);
    expect(result.pushed).toEqual(['unit_preference']);
    expect(server.state.row).toMatchObject({ display_name: 'אפק', height_cm: 178, goal: 'bulk' });
    expect(await fields(db)).toMatchObject({
      display_name: 'אפק',
      height_cm: 178,
      goal: 'bulk',
      unit_preference: 'imperial',
    });
  });

  it('treats an agreement it cannot read as no agreement, not as an agreement on nothing', async () => {
    const db = phone();
    const server = createServer({ display_name: 'אפק', goal: 'bulk' });
    await saveProfile(db, USER, { heightCm: 178 });
    await db.run(`UPDATE profile SET synced_json = ? WHERE user_id = ?`, ['{not json', USER]);

    await syncProfile(db, server.transport, USER);

    expect(server.state.row).toMatchObject({ display_name: 'אפק', goal: 'bulk', height_cm: 178 });
    expect(await fields(db)).toMatchObject({ display_name: 'אפק', goal: 'bulk', height_cm: 178 });
    expect(parseAgreement('[1,2]')).toEqual({});
    expect(parseAgreement('null')).toEqual({});
  });

  it('does nothing at all when the server has no row for the account yet', async () => {
    const db = phone();
    const server = createServer(null);
    await saveProfile(db, USER, FULL);

    const result = await syncProfile(db, server.transport, USER);

    expect(result.outcome).toBe('no_row');
    expect(server.state.updates).toEqual([]);
    // No agreement recorded: the next run is still a first meeting.
    expect((await getProfile(db, USER))?.synced_json).toBeNull();
  });
});

describe('after the first meeting', () => {
  it('is quiet when nothing has changed on either side', async () => {
    const db = phone();
    const server = createServer();
    await saveProfile(db, USER, FULL);
    await syncProfile(db, server.transport, USER);
    const before = await getProfile(db, USER);

    const result = await syncProfile(db, server.transport, USER);

    expect(server.state.updates).toHaveLength(1);
    expect(result).toMatchObject({ outcome: 'synced', pushed: [], pulled: [] });
    expect(await getProfile(db, USER)).toEqual(before);
  });

  it('sends only the field that was edited', async () => {
    const db = phone();
    const server = createServer();
    await saveProfile(db, USER, FULL);
    await syncProfile(db, server.transport, USER);

    await saveProfile(db, USER, { goal: 'cut' });
    await syncProfile(db, server.transport, USER);

    expect(server.state.updates.at(-1)).toEqual({ goal: 'cut' });
  });

  it('keeps an edit from each of two phones when they changed different fields', async () => {
    const first = phone();
    const second = phone();
    const server = createServer();
    await saveProfile(first, USER, FULL);
    await syncProfile(first, server.transport, USER);
    await syncProfile(second, server.transport, USER);

    await saveProfile(first, USER, { goal: 'cut' });
    await saveProfile(second, USER, { heightCm: 180 });
    await syncProfile(first, server.transport, USER);
    await syncProfile(second, server.transport, USER);
    await syncProfile(first, server.transport, USER);

    for (const db of [first, second]) {
      expect(await fields(db)).toMatchObject({ goal: 'cut', height_cm: 180, display_name: 'אפק' });
    }
    expect(server.state.row).toMatchObject({ goal: 'cut', height_cm: 180 });
  });

  it("sends this phone's value when both changed the same field", async () => {
    const first = phone();
    const second = phone();
    const server = createServer();
    await saveProfile(first, USER, FULL);
    await syncProfile(first, server.transport, USER);
    await syncProfile(second, server.transport, USER);

    await saveProfile(first, USER, { goal: 'cut' });
    await saveProfile(second, USER, { goal: 'maintain' });
    await syncProfile(first, server.transport, USER);
    await syncProfile(second, server.transport, USER);

    expect(server.state.row?.goal).toBe('maintain');
  });

  it('carries a field cleared on purpose, which the first meeting never would', async () => {
    const first = phone();
    const second = phone();
    const server = createServer();
    await saveProfile(first, USER, FULL);
    await syncProfile(first, server.transport, USER);
    await syncProfile(second, server.transport, USER);

    await saveProfile(first, USER, { displayName: null });
    await syncProfile(first, server.transport, USER);
    await syncProfile(second, server.transport, USER);

    expect(server.state.row?.display_name).toBeNull();
    expect((await fields(second))?.display_name).toBeNull();
  });

  it('takes a change made on the server by someone else', async () => {
    const db = phone();
    const server = createServer();
    await saveProfile(db, USER, FULL);
    await syncProfile(db, server.transport, USER);

    server.state.set({ activity_level: 'light' });
    const result = await syncProfile(db, server.transport, USER);

    expect(result.pulled).toEqual(['activity_level']);
    expect((await fields(db))?.activity_level).toBe('light');
    expect(server.state.updates).toHaveLength(1);
  });
});

describe('values that would never settle', () => {
  it('does not send a height again because the server rounded it', async () => {
    const db = phone();
    const server = createServer();
    // Five foot eleven, converted: more decimals than the server keeps.
    await saveProfile(db, USER, { heightCm: 180.339999 });

    await syncProfile(db, server.transport, USER);
    await syncProfile(db, server.transport, USER);
    await syncProfile(db, server.transport, USER);

    expect(server.state.updates).toEqual([{ height_cm: 180.34 }]);
    // What the user entered is left exactly as entered.
    expect((await fields(db))?.height_cm).toBe(180.339999);
  });

  it('does not send a date of birth again because it was stored with a time', async () => {
    const db = phone();
    const server = createServer();
    await saveProfile(db, USER, { birthDate: '1998-04-12T00:00:00.000Z' });

    await syncProfile(db, server.transport, USER);
    await syncProfile(db, server.transport, USER);

    expect(server.state.updates).toEqual([{ birth_date: '1998-04-12' }]);
  });

  it('never sends "no units chosen", which the server has no way to hold', async () => {
    const db = phone();
    const server = createServer({ unit_preference: 'imperial' });
    await saveProfile(db, USER, { goal: 'cut' });

    await syncProfile(db, server.transport, USER);

    expect(server.state.updates).toEqual([{ goal: 'cut' }]);
    expect((await fields(db))?.unit_preference).toBe('imperial');
  });
});

describe('what the server would refuse', () => {
  it('leaves a value it could not take where it is, and sends the rest', async () => {
    const db = phone();
    const server = createServer();
    await saveProfile(db, USER, FULL);
    // Written by some older version of the app, under a name the server never had.
    await db.run(`UPDATE profile SET goal = 'lose_weight' WHERE user_id = ?`, [USER]);

    const result = await syncProfile(db, server.transport, USER);

    expect(result.unsendable).toEqual(['goal']);
    expect(server.state.row).toMatchObject({ display_name: 'אפק', height_cm: 178, goal: null });
    expect((await fields(db))?.goal).toBe('lose_weight');
  });

  it('never sends whether the account is a coach, or anything else it was not asked to', async () => {
    const db = phone();
    const server = createServer({ role: 'coach', coach_code: 'ABC234' });
    const photos = createPhotos('p1');
    server.state.addPhotoColumn();
    await saveProfile(db, USER, FULL);
    await setAvatarVersion(db, USER, 'p1');
    // Even with the columns sitting in the local row, as they would after a careless migration.
    await db.exec(
      `ALTER TABLE profile ADD COLUMN role TEXT; ALTER TABLE profile ADD COLUMN coach_code TEXT;`,
    );
    await db.run(`UPDATE profile SET role = 'coach', coach_code = 'ZZZ999' WHERE user_id = ?`, [
      USER,
    ]);

    await syncProfile(db, server.transport, USER, photos.port);

    const sent = new Set(server.state.updates.flatMap((update) => Object.keys(update)));
    expect(
      [...sent].every((column) => [...PROFILE_FIELDS, PHOTO_FIELD].includes(column as never)),
    ).toBe(true);
    expect(sent.has('role')).toBe(false);
    expect(sent.has('coach_code')).toBe(false);
    expect(server.state.row).toMatchObject({ role: 'coach', coach_code: 'ABC234' });
  });

  it('records nothing when the update is refused, so the same edit is offered again', async () => {
    const db = phone();
    const server = createServer();
    await saveProfile(db, USER, FULL);
    const failing: ProfileTransport = {
      fetch: (userId) => server.transport.fetch(userId),
      update: async () => {
        throw new Refused('42501', 'permission denied');
      },
    };

    await expect(syncProfile(db, failing, USER)).rejects.toThrow('permission denied');
    expect((await getProfile(db, USER))?.synced_json).toBeNull();

    const result = await syncProfile(db, server.transport, USER);
    expect(result.pushed.length).toBeGreaterThan(0);
    expect(server.state.row).toMatchObject({ display_name: 'אפק', goal: 'bulk' });
  });
});

describe('what the server is told to accept', () => {
  // The other half of this lives in a different package: apps/api/drizzle/0011 grants a client
  // an explicit list of columns on `profiles`, and anything outside it is refused. A field
  // added to sync and not to that list would have every profile update turned away, on every
  // phone, with nothing wrong in either file on its own.
  const migration = readFileSync(
    join(import.meta.dirname, '../../../api/drizzle/0011_profile_sync.sql'),
    'utf8',
  );
  const granted = /GRANT UPDATE\s*\(([^)]+)\)\s+ON\s+public\.profiles\s+TO\s+authenticated;/
    .exec(migration)?.[1]
    ?.split(',')
    .map((column) => column.trim());

  it('finds the list', () => {
    expect(granted?.length).toBeGreaterThan(5);
  });

  it.each([...PROFILE_FIELDS, PHOTO_FIELD])('includes %s, which sync may send', (field) => {
    expect(granted).toContain(field);
  });

  it('accepts exactly the picture tags this app makes', () => {
    // The CHECK on the column and `canonical` here must agree on what a tag is, or a tag one
    // side makes is one the other refuses.
    expect(migration).toContain("avatar_version ~ '^[A-Za-z0-9_-]{1,64}$'");
    expect(canonical(PHOTO_FIELD, 'pmgk3x9a1')).toBe('pmgk3x9a1');
    expect(canonical(PHOTO_FIELD, 'a'.repeat(65))).toBeUndefined();
  });
});

describe('an edit made while a sync is in the air', () => {
  it('is not overwritten by what the server said a moment before', async () => {
    const db = phone();
    const server = createServer();
    await saveProfile(db, USER, FULL, () => '2026-10-09T10:00:00.000Z');
    await syncProfile(db, server.transport, USER);

    // Another phone changed the activity level; this one is about to change the goal, and
    // while that is on its way the user changes their name as well.
    server.state.set({ activity_level: 'light' });
    await saveProfile(db, USER, { goal: 'cut' }, () => '2026-10-09T11:00:00.000Z');
    server.state.duringUpdate = () =>
      saveProfile(db, USER, { displayName: 'אפק ב' }, () => '2026-10-09T11:00:05.000Z');

    const raced = await syncProfile(db, server.transport, USER);

    expect(raced.outcome).toBe('raced');
    expect((await fields(db))?.display_name).toBe('אפק ב');
    // What was sent did arrive.
    expect(server.state.row?.goal).toBe('cut');

    const settled = await syncProfile(db, server.transport, USER);
    expect(settled.outcome).toBe('synced');
    expect(settled.pushed).toEqual(['display_name']);
    expect(settled.pulled).toEqual(['activity_level']);
    expect(server.state.row).toMatchObject({
      display_name: 'אפק ב',
      goal: 'cut',
      activity_level: 'light',
    });
    expect(await fields(db)).toMatchObject({
      display_name: 'אפק ב',
      goal: 'cut',
      activity_level: 'light',
    });
  });
});

describe('the profile picture', () => {
  async function withPicture(tag: string) {
    const db = phone();
    const server = createServer();
    server.state.addPhotoColumn();
    const photos = createPhotos(tag);
    await saveProfile(db, USER, FULL);
    await setAvatarVersion(db, USER, tag);
    return { db, server, photos };
  }

  it('goes up from a phone that has one, and is named on the row only once it is there', async () => {
    const { db, server, photos } = await withPicture('p1');
    const order: string[] = [];
    const port: PhotoPort = {
      ...photos.port,
      upload: async (userId, version) => {
        await photos.port.upload(userId, version);
        order.push('uploaded');
      },
    };
    const transport: ProfileTransport = {
      fetch: (userId) => server.transport.fetch(userId),
      update: async (userId, changes) => {
        order.push('row');
        await server.transport.update(userId, changes);
      },
    };

    const result = await syncProfile(db, transport, USER, port);

    expect(result.photo).toBe('uploaded');
    expect(order).toEqual(['uploaded', 'row']);
    expect(photos.state.cloud.has('p1')).toBe(true);
    expect(server.state.row?.avatar_version).toBe('p1');
  });

  it('comes down to a new phone', async () => {
    const { db, server, photos } = await withPicture('p1');
    await syncProfile(db, server.transport, USER, photos.port);

    const other = phone();
    const otherPhotos = createPhotos(null);
    otherPhotos.state.cloud = photos.state.cloud;
    const result = await syncProfile(other, server.transport, USER, otherPhotos.port);

    expect(result.photo).toBe('downloaded');
    expect(otherPhotos.state.onPhone).toBe('p1');
    expect((await getProfile(other, USER))?.avatar_version).toBe('p1');
    expect(server.state.row?.avatar_version).toBe('p1');
  });

  it('replaces the old one in the cloud, and only after the row has moved on', async () => {
    const { db, server, photos } = await withPicture('p1');
    await syncProfile(db, server.transport, USER, photos.port);

    photos.state.onPhone = 'p2';
    await setAvatarVersion(db, USER, 'p2');
    photos.state.log.length = 0;
    await syncProfile(db, server.transport, USER, photos.port);

    expect(photos.state.log).toEqual(['upload p2', 'removeRemote p1']);
    expect([...photos.state.cloud]).toEqual(['p2']);
    expect(server.state.row?.avatar_version).toBe('p2');
  });

  it('is removed from the cloud when it is removed here', async () => {
    const { db, server, photos } = await withPicture('p1');
    await syncProfile(db, server.transport, USER, photos.port);

    photos.state.onPhone = null;
    await setAvatarVersion(db, USER, null);
    const result = await syncProfile(db, server.transport, USER, photos.port);

    expect(result.photo).toBe('cleared');
    expect(server.state.row?.avatar_version).toBeNull();
    expect(photos.state.cloud.size).toBe(0);
  });

  it('is removed here when it was removed on another phone', async () => {
    const { db, server, photos } = await withPicture('p1');
    await syncProfile(db, server.transport, USER, photos.port);

    server.state.set({ avatar_version: null });
    const result = await syncProfile(db, server.transport, USER, photos.port);

    expect(result.photo).toBe('removed');
    expect(photos.state.onPhone).toBeNull();
    expect((await getProfile(db, USER))?.avatar_version).toBeNull();
  });

  it('is not removed here because the server row changed for some other reason', async () => {
    // An administrator making this account a coach touches the same row. A phone whose picture
    // has not gone up yet must read that as "the server has no picture", not "delete yours".
    const { db, server, photos } = await withPicture('p1');
    photos.state.failUpload = true;
    await syncProfile(db, server.transport, USER, photos.port);

    server.state.set({ role: 'coach' });
    photos.state.failUpload = false;
    const result = await syncProfile(db, server.transport, USER, photos.port);

    expect(result.photo).toBe('uploaded');
    expect(photos.state.onPhone).toBe('p1');
    expect(photos.state.log).not.toContain('removeLocal');
  });

  it('still sends the fields when the picture will not go, and tries the picture again', async () => {
    const { db, server, photos } = await withPicture('p1');
    photos.state.failUpload = true;

    const first = await syncProfile(db, server.transport, USER, photos.port);

    expect(first.photo).toBe('failed');
    expect(first.photoError).toBe('upload refused');
    expect(server.state.row).toMatchObject({
      display_name: 'אפק',
      goal: 'bulk',
      avatar_version: null,
    });

    photos.state.failUpload = false;
    const second = await syncProfile(db, server.transport, USER, photos.port);
    expect(second.photo).toBe('uploaded');
    expect(server.state.row?.avatar_version).toBe('p1');
  });

  it('does not claim a picture it failed to fetch', async () => {
    const { db, server, photos } = await withPicture('p1');
    await syncProfile(db, server.transport, USER, photos.port);

    const other = phone();
    const otherPhotos = createPhotos(null);
    otherPhotos.state.cloud = photos.state.cloud;
    otherPhotos.state.failDownload = true;
    const first = await syncProfile(other, server.transport, USER, otherPhotos.port);

    expect(first.photo).toBe('failed');
    expect((await getProfile(other, USER))?.avatar_version).toBeNull();
    // The rest of the profile came down regardless.
    expect((await fields(other))?.display_name).toBe('אפק');

    otherPhotos.state.failDownload = false;
    const second = await syncProfile(other, server.transport, USER, otherPhotos.port);
    expect(second.photo).toBe('downloaded');
    expect(otherPhotos.state.onPhone).toBe('p1');
  });

  it('waits for a server that has nowhere to keep one, and goes up once it does', async () => {
    const db = phone();
    const server = createServer();
    const photos = createPhotos('p1');
    await saveProfile(db, USER, FULL);
    await setAvatarVersion(db, USER, 'p1');

    const before = await syncProfile(db, server.transport, USER, photos.port);

    expect(before.photo).toBe('unsupported');
    expect(photos.state.log).toEqual([]);
    expect(server.state.updates.every((update) => !(PHOTO_FIELD in update))).toBe(true);
    expect((await getProfile(db, USER))?.avatar_version).toBe('p1');

    server.state.addPhotoColumn();
    const after = await syncProfile(db, server.transport, USER, photos.port);
    expect(after.photo).toBe('uploaded');
    expect(server.state.row?.avatar_version).toBe('p1');
  });

  it('is fetched again, not deleted from the cloud, when the file here has gone missing', async () => {
    const { db, server, photos } = await withPicture('p1');
    await syncProfile(db, server.transport, USER, photos.port);

    // The file vanished: nothing the user did. Without care this reads as "removed here".
    photos.state.onPhone = null;
    await forgetMissingPhoto(db, USER);
    photos.state.log.length = 0;
    const result = await syncProfile(db, server.transport, USER, photos.port);

    expect(result.photo).toBe('downloaded');
    expect(photos.state.log).toEqual(['download p1']);
    expect(photos.state.cloud.has('p1')).toBe(true);
    expect(server.state.row?.avatar_version).toBe('p1');
    // And the rest of the agreement was not thrown away with it.
    expect(server.state.updates).toHaveLength(1);
  });

  it('leaves the picture out entirely when there is no way to move one', async () => {
    const { db, server } = await withPicture('p1');

    const result = await syncProfile(db, server.transport, USER);

    expect(result.photo).toBe('unsupported');
    expect(server.state.row?.avatar_version).toBeNull();
    expect((await getProfile(db, USER))?.avatar_version).toBe('p1');
  });
});

describe('recording which picture is on the phone', () => {
  it('creates the profile row for an account that has not filled anything in', async () => {
    const db = phone();
    await setAvatarVersion(db, USER, 'p1');
    expect(await getProfile(db, USER)).toMatchObject({ avatar_version: 'p1', display_name: null });
  });

  it('touches nothing else on a profile that exists', async () => {
    const db = phone();
    await saveProfile(db, USER, FULL);
    await setAvatarVersion(db, USER, 'p1');
    await setAvatarVersion(db, USER, null);
    expect(await fields(db)).toMatchObject({ display_name: 'אפק', height_cm: 178, goal: 'bulk' });
    expect((await getProfile(db, USER))?.avatar_version).toBeNull();
  });
});
