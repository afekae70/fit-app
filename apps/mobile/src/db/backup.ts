/**
 * A backup you can actually restore from.
 *
 * Two things already protect this data and neither is a backup in the sense that matters. The
 * Supabase sync is a live mirror: it protects against losing the phone, and not at all against
 * a mistake, because a deletion syncs as faithfully as anything else. The CSV export is a
 * takeout — readable, sortable, and impossible to load back in.
 *
 * This is the third thing: every user-owned table, verbatim, in a file that can be turned back
 * into the database it came from.
 *
 * ## Restoring replaces; it does not merge
 *
 * A merge has to decide what happens when a row exists on both sides with different contents,
 * and every answer to that is wrong some of the time. Replacement has one rule and the user can
 * predict it: after a restore, the app holds exactly what the backup holds.
 *
 * That makes restoring destructive, so it is validated completely before a single row is
 * touched, and the whole thing runs in one transaction. A restore that fails halfway would take
 * the training history with it, which is the precise disaster a backup exists to prevent.
 *
 * ## Refusing someone else's data
 *
 * A backup carries the user id it was taken from and a restore refuses to load one belonging to
 * anybody else. Re-stamping the rows would be the easy thing and would quietly merge two
 * people's training into one history with no way to tell afterwards which was which.
 */

import type { SqlExecutor } from './executor.js';

/** Bumped only when the file's own shape changes — not when the database schema does. */
export const BACKUP_FORMAT = 'novafit-backup-v1';

/**
 * Every table holding something a user would grieve.
 *
 * `outbox` and `sync_state` are deliberately absent: they describe a conversation with the
 * server that the restored database has not had. Carrying them across would have the app
 * re-push rows it had already pushed, against a cursor from a different device's timeline.
 */
export const BACKED_UP_TABLES = [
  'profile',
  'locations',
  'plans',
  'plan_days',
  'plan_day_exercises',
  'scheduled_days',
  'workout_sessions',
  'session_exercises',
  'sets',
  'body_metrics',
  'nutrition_targets',
  'coach_briefs',
] as const;

export type BackedUpTable = (typeof BACKED_UP_TABLES)[number];

export interface BackupFile {
  format: string;
  /** The app's SCHEMA_VERSION when the backup was taken. */
  schemaVersion: number;
  exportedAt: string;
  userId: string;
  tables: Record<string, Record<string, unknown>[]>;
}

export interface BackupSummary {
  exportedAt: string;
  schemaVersion: number;
  sessions: number;
  sets: number;
  weighIns: number;
}

/** Which of these tables carry a `user_id` of their own; the rest are owned through a parent. */
const USER_SCOPED = new Set<string>([
  'profile',
  'locations',
  'plans',
  'scheduled_days',
  'workout_sessions',
  'body_metrics',
  'nutrition_targets',
  'coach_briefs',
]);

/**
 * Read every table out.
 *
 * Child tables are taken whole rather than filtered by owner. They have no `user_id` to filter
 * on, and this database holds one user's data — the filter on the parents is belt and braces
 * for the case where a previous account's rows were left behind by a sign-out.
 */
export async function createBackup(
  db: SqlExecutor,
  userId: string,
  schemaVersion: number,
  now = new Date(),
): Promise<BackupFile> {
  const tables: Record<string, Record<string, unknown>[]> = {};

  for (const table of BACKED_UP_TABLES) {
    tables[table] = USER_SCOPED.has(table)
      ? await db.all<Record<string, unknown>>(`SELECT * FROM ${table} WHERE user_id = ?`, [userId])
      : await db.all<Record<string, unknown>>(`SELECT * FROM ${table}`);
  }

  return {
    format: BACKUP_FORMAT,
    schemaVersion,
    exportedAt: now.toISOString(),
    userId,
    tables,
  };
}

export type BackupProblem =
  | 'not-json'
  | 'wrong-format'
  | 'newer-schema'
  | 'different-user'
  | 'no-tables';

export interface BackupCheck {
  ok: boolean;
  problem?: BackupProblem;
  file?: BackupFile;
  summary?: BackupSummary;
}

/**
 * Decide whether a pasted string is a backup this app can safely load, without touching the
 * database.
 *
 * Every refusal is a named problem rather than a thrown error, so the screen can say which of
 * them happened. "Nothing happened" is the worst possible response to a restore.
 */
export function inspectBackup(
  raw: string,
  currentUserId: string,
  currentSchemaVersion: number,
): BackupCheck {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, problem: 'not-json' };
  }

  if (typeof parsed !== 'object' || parsed === null) return { ok: false, problem: 'not-json' };
  const file = parsed as Partial<BackupFile>;

  if (file.format !== BACKUP_FORMAT) return { ok: false, problem: 'wrong-format' };
  if (typeof file.tables !== 'object' || file.tables === null) {
    return { ok: false, problem: 'no-tables' };
  }

  // A backup from a newer schema may hold columns this build has never heard of. Refusing is the
  // honest answer; importing and dropping them would lose data while reporting success.
  if (typeof file.schemaVersion !== 'number' || file.schemaVersion > currentSchemaVersion) {
    return { ok: false, problem: 'newer-schema' };
  }

  if (file.userId !== currentUserId) return { ok: false, problem: 'different-user' };

  // Already narrowed by the guard above — no assertion needed.
  const tables = file.tables;
  // Rebuilt from the fields that were just checked rather than asserted into shape. An
  // assertion here would claim `exportedAt` is a string on the strength of nothing.
  const checked: BackupFile = {
    format: file.format,
    schemaVersion: file.schemaVersion,
    exportedAt: typeof file.exportedAt === 'string' ? file.exportedAt : '',
    userId: currentUserId,
    tables,
  };

  return {
    ok: true,
    file: checked,
    summary: {
      exportedAt: checked.exportedAt,
      schemaVersion: checked.schemaVersion,
      sessions: tables.workout_sessions?.length ?? 0,
      sets: tables.sets?.length ?? 0,
      weighIns: tables.body_metrics?.length ?? 0,
    },
  };
}

/**
 * Replace this user's data with the backup's, in one transaction.
 *
 * Children are cleared before parents and written after them, so a foreign key never points at
 * a row that does not exist yet in either direction.
 *
 * Columns are taken from each row rather than from a fixed list: a backup from an older schema
 * simply has fewer of them, and the columns it does not mention keep their defaults instead of
 * failing the insert.
 */
export async function restoreBackup(db: SqlExecutor, file: BackupFile): Promise<void> {
  const order = [...BACKED_UP_TABLES];

  await db.exec('BEGIN');
  try {
    // Reverse order: sets before session_exercises before workout_sessions.
    for (const table of [...order].reverse()) {
      await db.run(`DELETE FROM ${table}`);
    }

    for (const table of order) {
      for (const row of file.tables[table] ?? []) {
        const columns = Object.keys(row);
        if (columns.length === 0) continue;
        const placeholders = columns.map(() => '?').join(', ');
        await db.run(
          `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${placeholders})`,
          columns.map((c) => row[c] ?? null),
        );
      }
    }

    /*
     * Have the next sync send everything again.
     *
     * Sync pushes what is newer than its cursor, and a restored row carries the `updated_at` it
     * was backed up with — older than the cursor, nearly always. Left alone, the phone would
     * hold the backup while the server went on holding whatever it had before: a restored
     * workout the server never received, and under it exercises the server then refuses,
     * because their parent is not there.
     *
     * Only the push cursor. What has been pulled is still what has been pulled.
     */
    await db.run(`UPDATE sync_state SET last_synced_at = NULL`);

    await db.exec('COMMIT');
  } catch (error) {
    // Leaves the database exactly as it was. A half-restored history is worse than a failed
    // restore, because it looks like it worked.
    await db.exec('ROLLBACK');
    throw error;
  }
}
