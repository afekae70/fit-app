/**
 * Weekly calendar tests.
 *
 * Two things carry the risk here. The date arithmetic — a week boundary computed with
 * `toISOString` lands a day early for anyone east of UTC, which is where this app's users are,
 * and the bug only shows near midnight. And the three-way distinction between a planned
 * workout, a deliberately chosen rest day, and a date nobody has decided: collapsing the last
 * two is what would put a workout on a day the user cleared on purpose.
 */

import { beforeEach, describe, expect, it } from 'vitest';

import type { SqlExecutor } from './executor.js';
import {
  addDays,
  clearScheduledDay,
  getWeek,
  isWeekUnplanned,
  localDate,
  nextWeekStart,
  scheduledFor,
  seedWeekFromPrevious,
  setScheduledDay,
  weekDates,
  weekStart,
} from './schedule.js';
import { createTestExecutor } from './testUtils.js';

const USER = 'user-1';
let db: SqlExecutor;
let counter = 0;
const newId = () => `id-${String(++counter).padStart(3, '0')}`;
const clock = () => '2026-08-15T10:00:00.000Z';

beforeEach(() => {
  db = createTestExecutor();
  counter = 0;
});

describe('date arithmetic', () => {
  it('formats a local date without drifting through UTC', () => {
    // 00:30 local on the 16th. toISOString() would render this as the 15th anywhere east of
    // UTC — the exact bug this helper exists to avoid.
    expect(localDate(new Date(2026, 7, 16, 0, 30))).toBe('2026-08-16');
    expect(localDate(new Date(2026, 7, 16, 23, 45))).toBe('2026-08-16');
  });

  it('starts the week on Sunday', () => {
    // 2026-08-16 is a Sunday; 2026-08-15 a Saturday.
    expect(weekStart('2026-08-16')).toBe('2026-08-16');
    expect(weekStart('2026-08-19')).toBe('2026-08-16');
    expect(weekStart('2026-08-22')).toBe('2026-08-16');
    // Saturday belongs to the week that began the previous Sunday.
    expect(weekStart('2026-08-15')).toBe('2026-08-09');
  });

  it('means the same coming week whichever day it is asked on', () => {
    // The point of the ritual is Saturday, but the answer must not change on Wednesday.
    const fromSaturday = nextWeekStart('2026-08-15');
    expect(fromSaturday).toBe('2026-08-16');
    expect(nextWeekStart('2026-08-12')).toBe(fromSaturday);
    expect(nextWeekStart('2026-08-09')).toBe(fromSaturday);
  });

  it('crosses a month and a year boundary', () => {
    expect(addDays('2026-08-31', 1)).toBe('2026-09-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2027-01-01', -1)).toBe('2026-12-31');
  });

  it('lays out seven consecutive dates, Sunday first', () => {
    expect(weekDates('2026-08-16')).toEqual([
      '2026-08-16',
      '2026-08-17',
      '2026-08-18',
      '2026-08-19',
      '2026-08-20',
      '2026-08-21',
      '2026-08-22',
    ]);
  });
});

describe('committing a day', () => {
  it('records a workout and reads it back', async () => {
    await setScheduledDay(db, USER, newId, '2026-08-17', 'day-push', clock);
    expect(await scheduledFor(db, USER, '2026-08-17')).toBe('day-push');
  });

  it('tells a chosen rest day apart from an undecided one', async () => {
    await setScheduledDay(db, USER, newId, '2026-08-17', null, clock);

    // null = the user chose to rest. undefined = nobody has decided, so the rotation still owns
    // the date. Collapsing these would refill a day that was cleared on purpose.
    expect(await scheduledFor(db, USER, '2026-08-17')).toBeNull();
    expect(await scheduledFor(db, USER, '2026-08-18')).toBeUndefined();
  });

  it('updates in place rather than leaving two rows for one date', async () => {
    await setScheduledDay(db, USER, newId, '2026-08-17', 'day-push', clock);
    await setScheduledDay(db, USER, newId, '2026-08-17', 'day-legs', clock);

    expect(await scheduledFor(db, USER, '2026-08-17')).toBe('day-legs');
    expect(await db.all('SELECT id FROM scheduled_days')).toHaveLength(1);
  });

  it('revives a cleared date instead of leaving the tombstone in the way', async () => {
    await setScheduledDay(db, USER, newId, '2026-08-17', 'day-push', clock);
    await clearScheduledDay(db, USER, '2026-08-17', clock);
    expect(await scheduledFor(db, USER, '2026-08-17')).toBeUndefined();

    await setScheduledDay(db, USER, newId, '2026-08-17', 'day-pull', clock);
    expect(await scheduledFor(db, USER, '2026-08-17')).toBe('day-pull');
  });

  it('keeps two users calendars apart', async () => {
    await setScheduledDay(db, USER, newId, '2026-08-17', 'day-push', clock);
    await setScheduledDay(db, 'user-2', newId, '2026-08-17', 'day-legs', clock);

    expect(await scheduledFor(db, USER, '2026-08-17')).toBe('day-push');
    expect(await scheduledFor(db, 'user-2', '2026-08-17')).toBe('day-legs');
  });
});

describe('reading a week', () => {
  it('always returns seven days, planned or not', async () => {
    await setScheduledDay(db, USER, newId, '2026-08-17', 'day-push', clock);

    const week = await getWeek(db, USER, '2026-08-16');
    expect(week).toHaveLength(7);
    expect(week.map((d) => d.weekday)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(week[1]?.planDayId).toBe('day-push');
    expect(week[1]?.planned).toBe(true);
    expect(week[0]?.planned).toBe(false);
  });

  it('does not bleed into the neighbouring weeks', async () => {
    await setScheduledDay(db, USER, newId, '2026-08-15', 'day-before', clock);
    await setScheduledDay(db, USER, newId, '2026-08-23', 'day-after', clock);

    const week = await getWeek(db, USER, '2026-08-16');
    expect(week.every((d) => !d.planned)).toBe(true);
  });

  it('reports an untouched week as unplanned, and a single rest day as planned', async () => {
    expect(await isWeekUnplanned(db, USER, '2026-08-16')).toBe(true);

    // Choosing to rest the whole week IS a plan. The Saturday prompt must not keep nagging
    // someone who deliberately scheduled nothing.
    await setScheduledDay(db, USER, newId, '2026-08-18', null, clock);
    expect(await isWeekUnplanned(db, USER, '2026-08-16')).toBe(false);
  });
});

describe('seeding from the previous week', () => {
  it('copies the last planned week onto the new one, weekday for weekday', async () => {
    await setScheduledDay(db, USER, newId, '2026-08-09', 'day-push', clock); // Sunday
    await setScheduledDay(db, USER, newId, '2026-08-11', 'day-pull', clock); // Tuesday
    await setScheduledDay(db, USER, newId, '2026-08-13', null, clock); // Thursday, a rest

    expect(await seedWeekFromPrevious(db, USER, newId, '2026-08-16', clock)).toBe(true);

    const week = await getWeek(db, USER, '2026-08-16');
    expect(week[0]?.planDayId).toBe('day-push');
    expect(week[2]?.planDayId).toBe('day-pull');
    // The rest day carries across as a rest day, not as an undecided gap.
    expect(week[4]?.planned).toBe(true);
    expect(week[4]?.planDayId).toBeNull();
    expect(week[1]?.planned).toBe(false);
  });

  it('never overwrites a day already decided for the target week', async () => {
    await setScheduledDay(db, USER, newId, '2026-08-09', 'day-push', clock);
    await setScheduledDay(db, USER, newId, '2026-08-16', 'day-legs', clock);

    await seedWeekFromPrevious(db, USER, newId, '2026-08-16', clock);

    expect(await scheduledFor(db, USER, '2026-08-16')).toBe('day-legs');
  });

  it('reports nothing to copy when there is no history', async () => {
    expect(await seedWeekFromPrevious(db, USER, newId, '2026-08-16', clock)).toBe(false);
  });

  it('ignores another user\'s calendar when seeding', async () => {
    await setScheduledDay(db, 'user-2', newId, '2026-08-09', 'their-day', clock);

    expect(await seedWeekFromPrevious(db, USER, newId, '2026-08-16', clock)).toBe(false);
  });
});
