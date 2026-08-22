import { beforeEach, describe, expect, it } from 'vitest';

import type { SqlExecutor } from './executor.js';
import {
  addLocation,
  getLocation,
  listLocations,
  removeLocation,
  renameLocation,
  setSessionLocation,
} from './locations.js';
import { createTestExecutor } from './testUtils.js';
import { startSession } from './workouts.js';

const USER = 'user-1';

let db: SqlExecutor;
let counter = 0;
const newId = () => `id-${String(++counter).padStart(3, '0')}`;
const clock = () => '2026-06-01T10:00:00.000Z';

beforeEach(() => {
  db = createTestExecutor();
  counter = 0;
});

describe('gyms', () => {
  it('adds one and reads it back', async () => {
    const id = await addLocation(db, newId, USER, 'Gold Gym', clock);
    expect(id).not.toBeNull();
    expect((await getLocation(db, id!))?.name).toBe('Gold Gym');
  });

  it('trims the name rather than storing the spaces', async () => {
    const id = await addLocation(db, newId, USER, '  Holmes Place  ', clock);
    expect((await getLocation(db, id!))?.name).toBe('Holmes Place');
  });

  it('refuses a name that is only whitespace', async () => {
    expect(await addLocation(db, newId, USER, '   ', clock)).toBeNull();
    expect(await listLocations(db, USER)).toHaveLength(0);
  });

  it('returns the existing gym instead of creating a near-duplicate', async () => {
    // The failure this prevents: "Gym" and "gym " as two rows would split one lift's history in
    // half, which is the exact thing recording a gym is meant to stop.
    const first = await addLocation(db, newId, USER, 'Gym', clock);
    const again = await addLocation(db, newId, USER, ' gym ', clock);

    expect(again).toBe(first);
    expect(await listLocations(db, USER)).toHaveLength(1);
  });

  it('renames without creating a second row', async () => {
    const id = await addLocation(db, newId, USER, 'Old name', clock);
    await renameLocation(db, id!, 'New name', clock);

    const all = await listLocations(db, USER);
    expect(all).toHaveLength(1);
    expect(all[0]?.name).toBe('New name');
  });

  it('keeps one user out of another user\'s gyms', async () => {
    await addLocation(db, newId, USER, 'Mine', clock);
    await addLocation(db, newId, 'someone-else', 'Theirs', clock);

    expect((await listLocations(db, USER)).map((l) => l.name)).toEqual(['Mine']);
  });

  it('lets two users each have a gym of the same name', async () => {
    // The uniqueness check is per user; it must not stop somebody else naming their gym "Gym".
    const mine = await addLocation(db, newId, USER, 'Gym', clock);
    const theirs = await addLocation(db, newId, 'someone-else', 'Gym', clock);
    expect(theirs).not.toBe(mine);
  });
});

describe('forgetting a gym', () => {
  it('hides it from the list', async () => {
    const id = await addLocation(db, newId, USER, 'Closed down', clock);
    await removeLocation(db, id!, clock);

    expect(await listLocations(db, USER)).toHaveLength(0);
    expect(await getLocation(db, id!)).toBeNull();
  });

  it('leaves the workouts done there pointing at it', async () => {
    // A year of training is not something to lose because a gym closed. The sessions keep their
    // location_id; only the gym stops being offered.
    const gym = await addLocation(db, newId, USER, 'Closed down', clock);
    const session = await startSession(db, USER, newId, {}, clock);
    await setSessionLocation(db, session, gym, clock);

    await removeLocation(db, gym!, clock);

    const row = await db.get<{ location_id: string | null }>(
      `SELECT location_id FROM workout_sessions WHERE id = ?`,
      [session],
    );
    expect(row?.location_id).toBe(gym);
  });

  it('frees the name for reuse', async () => {
    const first = await addLocation(db, newId, USER, 'Gym', clock);
    await removeLocation(db, first!, clock);

    const second = await addLocation(db, newId, USER, 'Gym', clock);
    expect(second).not.toBe(first);
  });
});

describe('a session and its gym', () => {
  it('records where a workout happened', async () => {
    const gym = await addLocation(db, newId, USER, 'Gold Gym', clock);
    const session = await startSession(db, USER, newId, {}, clock);

    await setSessionLocation(db, session, gym, clock);

    const row = await db.get<{ location_id: string | null }>(
      `SELECT location_id FROM workout_sessions WHERE id = ?`,
      [session],
    );
    expect(row?.location_id).toBe(gym);
  });

  it('can be cleared again', async () => {
    const gym = await addLocation(db, newId, USER, 'Gold Gym', clock);
    const session = await startSession(db, USER, newId, { locationId: gym }, clock);

    await setSessionLocation(db, session, null, clock);

    const row = await db.get<{ location_id: string | null }>(
      `SELECT location_id FROM workout_sessions WHERE id = ?`,
      [session],
    );
    expect(row?.location_id).toBeNull();
  });
});
