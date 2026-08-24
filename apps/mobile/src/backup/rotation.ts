/**
 * When to take an automatic backup, and which old ones to throw away.
 *
 * Pure, and kept apart from the file system on purpose: this is the half that decides, and
 * deciding wrongly means either a backup nobody asked for every time the app opens, or — far
 * worse — a gap where somebody believed they were covered.
 *
 * ## One a day, and one after training
 *
 * Training is when new data appears, so a finished workout earns a backup regardless of the
 * clock. Otherwise a day is the interval: often enough that a mistake costs at most a day, rare
 * enough that the folder does not fill with near-identical copies of a rest day.
 *
 * ## Keeping several
 *
 * A single rolling backup protects against a broken phone and not against a mistake, because
 * the mistake gets written over the only good copy on the next run. Keeping a handful means
 * something from before whatever went wrong still exists — which is exactly the failure the
 * cloud sync cannot help with, since a deletion syncs as faithfully as anything else.
 */

/** How long an automatic backup stays fresh enough not to be repeated. */
export const BACKUP_INTERVAL_MS = 24 * 60 * 60 * 1000;

/** How many to keep. Roughly a week of daily backups, plus whatever training added. */
export const BACKUP_KEEP = 7;

/** `novafit-backup-2026-08-24T161500.json` — sorts chronologically as plain text. */
export function backupFileName(now: Date): string {
  const iso = now.toISOString();
  return `novafit-backup-${iso.slice(0, 10)}T${iso.slice(11, 19).replace(/:/g, '')}.json`;
}

/** Is this one of ours? Guards against deleting somebody's own files from a shared folder. */
export function isBackupFileName(name: string): boolean {
  return /^novafit-backup-\d{4}-\d{2}-\d{2}T\d{6}\.json$/.test(name);
}

/** Epoch milliseconds from one of our file names, or null if it is not one. */
export function parseBackupTime(name: string): number | null {
  if (!isBackupFileName(name)) return null;
  const stripped = name.replace('novafit-backup-', '').replace('.json', '');
  const [datePart, timePart] = stripped.split('T');
  if (!datePart || !timePart) return null;
  const iso = `${datePart}T${timePart.slice(0, 2)}:${timePart.slice(2, 4)}:${timePart.slice(4, 6)}Z`;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : ms;
}

export interface DueInput {
  /** Names already in the folder. Anything unrecognised is ignored, not counted. */
  existing: readonly string[];
  now: Date;
  /** True straight after a session was finished. */
  afterWorkout?: boolean;
}

/**
 * Whether to write one now.
 *
 * An empty folder is always due: the first run is the one where somebody has just turned this
 * on and would otherwise see nothing happen at all.
 */
export function isBackupDue({ existing, now, afterWorkout = false }: DueInput): boolean {
  const ours = existing.filter(isBackupFileName).sort();
  const newest = ours[ours.length - 1];
  if (!newest) return true;
  if (afterWorkout) return true;

  const stamp = parseBackupTime(newest);
  if (stamp === null) return true;
  return now.getTime() - stamp >= BACKUP_INTERVAL_MS;
}

/**
 * Which files to delete once a new one has been written.
 *
 * Only ever our own, and only ever the oldest. A folder the user picked is somewhere they keep
 * their own things, and deleting anything else from it would be unforgivable.
 */
export function pruneList(existing: readonly string[], keep = BACKUP_KEEP): string[] {
  const ours = existing.filter(isBackupFileName).sort();
  if (ours.length <= keep) return [];
  return ours.slice(0, ours.length - keep);
}
