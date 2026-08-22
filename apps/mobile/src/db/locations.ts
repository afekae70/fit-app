/**
 * Gyms.
 *
 * `workout_sessions.location_id` has been in the schema since the first version and nothing has
 * ever written to it. This is the table it was always pointing at, and the reason to fill it in
 * is the same one that produced `sessionType.ts`: the same lift on another gym's machine is a
 * different number, and comparing across the two makes a lifter who is progressing in both look
 * like they are lurching up and down.
 *
 * A workout's *kind* — its plan day or its name — was the closest thing available before this.
 * It is a good proxy and not the real thing: doing the same push day at two gyms is one kind and
 * two sets of numbers. With a gym recorded, a comparison can require both.
 *
 * Names are the whole model. No address, no equipment list, no opening hours — a gym here exists
 * only to tell two sets of numbers apart, and every field beyond the name would be one more
 * thing to fill in for no gain.
 */

import type { SqlExecutor } from './executor.js';
import type { Clock, IdFactory } from './workouts.js';

const defaultClock: Clock = () => new Date().toISOString();

/*
 * Nothing here writes to the outbox, unlike the other repositories.
 *
 * The sync engine does not read the outbox — it scans the tables it has registered, by
 * `updated_at`. `locations` is not registered, because the remote table has no `updated_at` or
 * `deleted_at` for the engine to track; the migration that adds them is written and waiting in
 * `apps/api/drizzle` for someone with the database URL to apply.
 *
 * So an outbox row for a gym could only sit there undeliverable, and would be the first thing to
 * break if the outbox were ever wired up to a remote that still has no column to put it in.
 * Gyms are local until that migration runs. They are a handful of names and re-entering them
 * costs a minute, which is why this is a reasonable thing to ship ahead of the sync.
 */

export interface LocationRow {
  id: string;
  user_id: string;
  name: string;
  updated_at: string | null;
  deleted_at: string | null;
}

/** Every gym this user has named, oldest first so the list does not reshuffle itself. */
export async function listLocations(
  db: SqlExecutor,
  userId: string,
): Promise<LocationRow[]> {
  return db.all<LocationRow>(
    `SELECT * FROM locations
      WHERE user_id = ? AND deleted_at IS NULL
      ORDER BY COALESCE(updated_at, ''), name`,
    [userId],
  );
}

export async function getLocation(
  db: SqlExecutor,
  locationId: string,
): Promise<LocationRow | null> {
  return db.get<LocationRow>(
    `SELECT * FROM locations WHERE id = ? AND deleted_at IS NULL`,
    [locationId],
  );
}

/**
 * Add a gym, or return the one that already carries this name.
 *
 * Names are matched case-insensitively and trimmed, because "Gym" and "gym " are one place and
 * two rows here would silently split a lift's history in half — the exact failure this table
 * exists to prevent.
 */
export async function addLocation(
  db: SqlExecutor,
  newId: IdFactory,
  userId: string,
  name: string,
  clock: Clock = defaultClock,
): Promise<string | null> {
  const trimmed = name.trim();
  if (trimmed.length === 0) return null;

  const existing = await db.get<{ id: string }>(
    `SELECT id FROM locations
      WHERE user_id = ? AND deleted_at IS NULL AND LOWER(name) = LOWER(?)`,
    [userId, trimmed],
  );
  if (existing) return existing.id;

  const id = newId();
  const at = clock();
  await db.run(
    `INSERT INTO locations (id, user_id, name, updated_at) VALUES (?, ?, ?, ?)`,
    [id, userId, trimmed, at],
  );
  return id;
}

export async function renameLocation(
  db: SqlExecutor,
  locationId: string,
  name: string,
  clock: Clock = defaultClock,
): Promise<void> {
  const trimmed = name.trim();
  if (trimmed.length === 0) return;
  const at = clock();
  await db.run(`UPDATE locations SET name = ?, updated_at = ? WHERE id = ?`, [
    trimmed,
    at,
    locationId,
  ]);
}

/**
 * Forget a gym without disowning the workouts done there.
 *
 * Soft-deleted, and the sessions keep their `location_id`. A hard delete would either orphan
 * every session that pointed here or, worse, take them with it — and a year of training is not
 * something to lose because a gym closed.
 */
export async function removeLocation(
  db: SqlExecutor,
  locationId: string,
  clock: Clock = defaultClock,
): Promise<void> {
  const at = clock();
  await db.run(`UPDATE locations SET deleted_at = ?, updated_at = ? WHERE id = ?`, [
    at,
    at,
    locationId,
  ]);
}

/** Point a session at a gym, or clear it when `locationId` is null. */
export async function setSessionLocation(
  db: SqlExecutor,
  sessionId: string,
  locationId: string | null,
  clock: Clock = defaultClock,
): Promise<void> {
  const at = clock();
  await db.run(`UPDATE workout_sessions SET location_id = ?, updated_at = ? WHERE id = ?`, [
    locationId,
    at,
    sessionId,
  ]);
  // Deliberately not enqueued: `location_id` is not in the sync payload for sessions, because
  // the remote `locations` table has no `updated_at`/`deleted_at` for the engine to track. See
  // the note in sync/tables.ts and the migration waiting in apps/api/drizzle.
}
