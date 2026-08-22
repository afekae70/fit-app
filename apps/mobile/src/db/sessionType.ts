/**
 * What makes two workouts "the same workout".
 *
 * Comparing an exercise against the last time it was performed sounds obviously right, and is
 * wrong for anyone who trains in more than one gym. A leg press at one gym and a leg press at
 * another are different machines with different lever arms and different plate stacks; the
 * number on the pin is not comparable, and neither is the number the app derives from it. Read
 * across gyms, a lifter who is progressing steadily in both looks like they are lurching up and
 * down, and the stall detector — which is watching for exactly that shape — starts calling
 * plateaus that are really just a change of address.
 *
 * So a comparison is scoped to the same *kind* of session, which in this schema means:
 *
 *  - **the plan day it came from**, when there is one. This is the strongest signal available:
 *    the same plan day is the same prescribed workout, and in practice the same place.
 *  - **the session's name**, otherwise. Naming a workout is already what makes it findable, and
 *    repeating a past session carries its name forward, so "Push A" is a lineage on its own.
 *  - **nothing**, when a session is neither planned nor named. There is no type to scope to, so
 *    the comparison falls back to every session — the behaviour before any of this existed.
 *    An ad-hoc unnamed workout genuinely has no peers, and inventing one would be worse than
 *    admitting it.
 *
 * Deliberately NOT `location_id`. The column exists on `workout_sessions` and would be the more
 * direct answer, but nothing in the app ever writes it — no screen collects a gym — so scoping
 * by it would silently match everything against everything.
 */

import type { SqlExecutor } from './executor.js';

export interface SessionType {
  planDayId: string | null;
  name: string | null;
}

/** Look up what kind of workout a session is. Null when the session does not exist. */
export async function getSessionType(
  db: SqlExecutor,
  sessionId: string,
): Promise<SessionType | null> {
  const row = await db.get<{ plan_day_id: string | null; name: string | null }>(
    `SELECT plan_day_id, name FROM workout_sessions WHERE id = ? AND deleted_at IS NULL`,
    [sessionId],
  );
  if (!row) return null;
  return { planDayId: row.plan_day_id, name: row.name };
}

/** True when this session carries enough identity to be compared against its own kind. */
export function hasType(type: SessionType | null | undefined): boolean {
  return Boolean(type && (type.planDayId !== null || type.name !== null));
}

/**
 * A WHERE fragment restricting `alias` to sessions of the same type, with its parameters.
 *
 * Returns an always-true fragment rather than an empty string when there is no type, so callers
 * can concatenate it unconditionally — an `AND` that sometimes has nothing after it is how a
 * query builder starts producing syntax errors at runtime only.
 */
export function sameTypeClause(
  alias: string,
  type: SessionType | null | undefined,
): { sql: string; params: unknown[] } {
  if (type?.planDayId != null) {
    return { sql: `${alias}.plan_day_id = ?`, params: [type.planDayId] };
  }
  if (type?.name != null) {
    // Only sessions that are ALSO unplanned. A plan day always wins as the identity, so a
    // planned session that happens to share a name belongs to its plan's lineage, not this one.
    return { sql: `(${alias}.plan_day_id IS NULL AND ${alias}.name = ?)`, params: [type.name] };
  }
  return { sql: '1 = 1', params: [] };
}
