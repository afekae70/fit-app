import { describe, expect, it } from 'vitest';

import {
  BACKUP_INTERVAL_MS,
  BACKUP_KEEP,
  backupFileName,
  isBackupDue,
  isBackupFileName,
  parseBackupTime,
  pruneList,
} from './rotation.js';

const at = (iso: string) => new Date(iso);

describe('file names', () => {
  it('sorts chronologically as plain text', () => {
    // The whole rotation reads "newest" as "last after a plain sort", so this is load-bearing.
    const early = backupFileName(at('2026-08-24T09:05:00.000Z'));
    const late = backupFileName(at('2026-08-24T16:15:00.000Z'));
    const nextDay = backupFileName(at('2026-08-25T01:00:00.000Z'));

    expect([nextDay, late, early].sort()).toEqual([early, late, nextDay]);
  });

  it('round-trips back to the time it was made', () => {
    const now = at('2026-08-24T16:15:30.000Z');
    expect(parseBackupTime(backupFileName(now))).toBe(now.getTime());
  });

  it('recognises only its own files', () => {
    expect(isBackupFileName(backupFileName(at('2026-08-24T16:15:00.000Z')))).toBe(true);
    expect(isBackupFileName('holiday-photo.jpg')).toBe(false);
    expect(isBackupFileName('novafit-backup.json')).toBe(false);
    expect(parseBackupTime('holiday-photo.jpg')).toBeNull();
  });
});

describe('isBackupDue', () => {
  const now = at('2026-08-24T16:00:00.000Z');
  const fresh = backupFileName(at('2026-08-24T10:00:00.000Z'));
  const stale = backupFileName(at('2026-08-20T10:00:00.000Z'));

  it('is due when there is nothing yet', () => {
    // The first run is the one where somebody has just turned this on and would otherwise see
    // nothing happen at all.
    expect(isBackupDue({ existing: [], now })).toBe(true);
  });

  it('is not due again the same day', () => {
    expect(isBackupDue({ existing: [fresh], now })).toBe(false);
  });

  it('is due once a day has passed', () => {
    expect(isBackupDue({ existing: [stale], now })).toBe(true);
  });

  it('is always due after a workout', () => {
    // Training is when new data appears, and that earns a copy whatever the clock says.
    expect(isBackupDue({ existing: [fresh], now, afterWorkout: true })).toBe(true);
  });

  it('judges by the newest, not by whatever the folder happens to list first', () => {
    expect(isBackupDue({ existing: [fresh, stale], now })).toBe(false);
    expect(isBackupDue({ existing: [stale, fresh], now })).toBe(false);
  });

  it('ignores files that are not ours', () => {
    expect(isBackupDue({ existing: ['notes.txt', 'photo.jpg'], now })).toBe(true);
  });

  it('is due exactly on the interval, not a millisecond after', () => {
    const edge = backupFileName(new Date(now.getTime() - BACKUP_INTERVAL_MS));
    expect(isBackupDue({ existing: [edge], now })).toBe(true);
  });
});

describe('pruneList', () => {
  const names = (count: number) =>
    Array.from({ length: count }, (_, i) =>
      backupFileName(at(`2026-08-${String(i + 1).padStart(2, '0')}T10:00:00.000Z`)),
    );

  it('keeps everything while under the limit', () => {
    expect(pruneList(names(BACKUP_KEEP))).toEqual([]);
  });

  it('drops the oldest once over', () => {
    const all = names(BACKUP_KEEP + 2);
    expect(pruneList(all)).toEqual([all[0], all[1]]);
  });

  it('never touches a file that is not ours', () => {
    // The folder is somewhere the user keeps their own things. Deleting anything else from it
    // would be unforgivable.
    const all = [...names(BACKUP_KEEP + 3), 'tax-return.pdf', 'photo.jpg'];
    const doomed = pruneList(all);

    expect(doomed).not.toContain('tax-return.pdf');
    expect(doomed).not.toContain('photo.jpg');
    expect(doomed.every(isBackupFileName)).toBe(true);
  });

  it('keeps several rather than one', () => {
    // A single rolling backup is written over by the mistake on the next run, which is precisely
    // the failure the cloud sync already cannot help with.
    expect(BACKUP_KEEP).toBeGreaterThan(1);
  });
});
