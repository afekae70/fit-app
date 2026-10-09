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
  addMonths,
  addScheduledWorkout,
  clearScheduledDay,
  getRange,
  getWeek,
  isWeekUnplanned,
  localDate,
  monthGrid,
  monthKey,
  nextWeekStart,
  removeScheduledWorkout,
  repeatWeekAcrossMonth,
  scheduledFor,
  seedWeekFromPrevious,
  setScheduledDay,
  setScheduledWorkouts,
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
    expect(await scheduledFor(db, USER, '2026-08-17')).toEqual(['day-push']);
  });

  it('tells a chosen rest day apart from an undecided one', async () => {
    await setScheduledDay(db, USER, newId, '2026-08-17', null, clock);

    // null = the user chose to rest. undefined = nobody has decided, so the rotation still owns
    // the date. Collapsing these would refill a day that was cleared on purpose.
    expect(await scheduledFor(db, USER, '2026-08-17')).toBeNull();
    expect(await scheduledFor(db, USER, '2026-08-18')).toBeUndefined();
  });

  it('replaces what a date held rather than adding to it', async () => {
    await setScheduledDay(db, USER, newId, '2026-08-17', 'day-push', clock);
    await setScheduledDay(db, USER, newId, '2026-08-17', 'day-legs', clock);

    expect(await scheduledFor(db, USER, '2026-08-17')).toEqual(['day-legs']);
    expect(await db.all('SELECT id FROM scheduled_days WHERE deleted_at IS NULL')).toHaveLength(1);
  });

  it('marks what it replaces as deleted, so another device hears about it', async () => {
    // The calendar syncs. A row that simply vanished would say nothing to the other phone, or
    // to a coach, and the workout it named would stay on their copy of the date for good.
    await setScheduledDay(db, USER, newId, '2026-08-17', 'day-push', clock);
    await setScheduledDay(db, USER, newId, '2026-08-17', 'day-legs', clock);
    await clearScheduledDay(db, USER, '2026-08-17', clock);

    const rows = await db.all<{ plan_day_id: string; deleted_at: string | null }>(
      `SELECT plan_day_id, deleted_at FROM scheduled_days ORDER BY plan_day_id`,
    );
    expect(rows.map((row) => row.plan_day_id)).toEqual(['day-legs', 'day-push']);
    expect(rows.every((row) => row.deleted_at !== null)).toBe(true);
    expect(await scheduledFor(db, USER, '2026-08-17')).toBeUndefined();
  });

  it('counts a workout once when two rows name it on the same date', async () => {
    // What two devices produce: this phone and a coach each put the same workout on a date.
    await setScheduledDay(db, USER, newId, '2026-08-17', 'day-legs', clock);
    await db.run(
      `INSERT INTO scheduled_days (id, user_id, scheduled_on, plan_day_id, position, updated_at)
         VALUES ('from-the-coach', ?, '2026-08-17', 'day-legs', 0, ?)`,
      [USER, clock()],
    );

    expect(await scheduledFor(db, USER, '2026-08-17')).toEqual(['day-legs']);
  });

  it('revives a cleared date instead of leaving the tombstone in the way', async () => {
    await setScheduledDay(db, USER, newId, '2026-08-17', 'day-push', clock);
    await clearScheduledDay(db, USER, '2026-08-17');
    expect(await scheduledFor(db, USER, '2026-08-17')).toBeUndefined();

    await setScheduledDay(db, USER, newId, '2026-08-17', 'day-pull', clock);
    expect(await scheduledFor(db, USER, '2026-08-17')).toEqual(['day-pull']);
  });

  it('keeps two users calendars apart', async () => {
    await setScheduledDay(db, USER, newId, '2026-08-17', 'day-push', clock);
    await setScheduledDay(db, 'user-2', newId, '2026-08-17', 'day-legs', clock);

    expect(await scheduledFor(db, USER, '2026-08-17')).toEqual(['day-push']);
    expect(await scheduledFor(db, 'user-2', '2026-08-17')).toEqual(['day-legs']);
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

    expect(await scheduledFor(db, USER, '2026-08-16')).toEqual(['day-legs']);
  });

  it('reports nothing to copy when there is no history', async () => {
    expect(await seedWeekFromPrevious(db, USER, newId, '2026-08-16', clock)).toBe(false);
  });

  it('ignores another user\'s calendar when seeding', async () => {
    await setScheduledDay(db, 'user-2', newId, '2026-08-09', 'their-day', clock);

    expect(await seedWeekFromPrevious(db, USER, newId, '2026-08-16', clock)).toBe(false);
  });
});

describe('months', () => {
  it('moves across a year boundary in both directions', () => {
    expect(addMonths('2026-12', 1)).toBe('2027-01');
    expect(addMonths('2026-01', -1)).toBe('2025-12');
    expect(addMonths('2026-09', 0)).toBe('2026-09');
  });

  it('never skips a month the way Date.setMonth does on the 31st', () => {
    expect(addMonths(monthKey('2026-01-31'), 1)).toBe('2026-02');
  });

  it('lays out a month that starts on Sunday as exactly four rows', () => {
    const grid = monthGrid('2026-02');
    expect(grid).toHaveLength(4);
    expect(grid[0]?.[0]).toEqual({ date: '2026-02-01', inMonth: true });
  });

  it('borrows days from the neighbouring months to complete the rows', () => {
    // August 2026 begins on a Saturday: the first row is six July days and then August 1st.
    const grid = monthGrid('2026-08');
    expect(grid).toHaveLength(6);
    expect(grid[0]?.[0]).toEqual({ date: '2026-07-26', inMonth: false });
    expect(grid[0]?.[6]).toEqual({ date: '2026-08-01', inMonth: true });
  });

  it('puts every date of the month in the grid exactly once, in order', () => {
    const cells = monthGrid('2026-09').flat();
    const september = cells.filter((cell) => cell.inMonth).map((cell) => cell.date);
    expect(september).toHaveLength(30);
    expect(new Set(september).size).toBe(30);
    for (let i = 1; i < cells.length; i += 1) {
      expect(cells[i]?.date).toBe(addDays(cells[i - 1]?.date ?? '', 1));
    }
  });

  it('keeps every row at seven days', () => {
    for (const month of ['2026-02', '2026-08', '2026-09', '2026-12']) {
      expect(monthGrid(month).every((row) => row.length === 7)).toBe(true);
    }
  });
});

describe('reading a range', () => {
  it('keeps rest and undecided apart', async () => {
    await setScheduledDay(db, USER, newId, '2026-09-06', 'push', clock);
    await setScheduledDay(db, USER, newId, '2026-09-07', null, clock);

    const range = await getRange(db, USER, '2026-09-01', '2026-09-30');
    expect(range.get('2026-09-06')).toEqual(['push']);
    expect(range.has('2026-09-07')).toBe(true);
    expect(range.get('2026-09-07')).toBeNull();
    expect(range.has('2026-09-08')).toBe(false);
  });

  it('includes both ends and nothing outside them', async () => {
    for (const date of ['2026-08-31', '2026-09-01', '2026-09-30', '2026-10-01']) {
      await setScheduledDay(db, USER, newId, date, 'push', clock);
    }
    const range = await getRange(db, USER, '2026-09-01', '2026-09-30');
    expect([...range.keys()].sort()).toEqual(['2026-09-01', '2026-09-30']);
  });

  it('leaves out a cleared date', async () => {
    await setScheduledDay(db, USER, newId, '2026-09-06', 'push', clock);
    await clearScheduledDay(db, USER, '2026-09-06');
    expect((await getRange(db, USER, '2026-09-01', '2026-09-30')).has('2026-09-06')).toBe(false);
  });
});

describe('repeating a week across the month', () => {
  // September 6th 2026 is a Sunday. Push on Sundays, rest on Tuesdays, Mondays left open.
  async function planFirstWeek() {
    await setScheduledDay(db, USER, newId, '2026-09-06', 'push', clock);
    await setScheduledDay(db, USER, newId, '2026-09-08', null, clock);
  }

  it('copies each weekday forward, workout and rest alike', async () => {
    await planFirstWeek();

    const written = await repeatWeekAcrossMonth(db, USER, newId, '2026-09', '2026-09-06', clock);

    const range = await getRange(db, USER, '2026-09-01', '2026-09-30');
    for (const sunday of ['2026-09-13', '2026-09-20', '2026-09-27']) {
      expect(range.get(sunday)).toEqual(['push']);
    }
    for (const tuesday of ['2026-09-15', '2026-09-22', '2026-09-29']) {
      expect(range.has(tuesday)).toBe(true);
      expect(range.get(tuesday)).toBeNull();
    }
    expect(written).toBe(6);
  });

  it('leaves the weekdays the source week never decided to the rotation', async () => {
    await planFirstWeek();
    await repeatWeekAcrossMonth(db, USER, newId, '2026-09', '2026-09-06', clock);

    const range = await getRange(db, USER, '2026-09-01', '2026-09-30');
    for (const monday of ['2026-09-14', '2026-09-21', '2026-09-28']) {
      expect(range.has(monday)).toBe(false);
    }
  });

  it('never overwrites a date that was already decided', async () => {
    await planFirstWeek();
    await setScheduledDay(db, USER, newId, '2026-09-20', 'legs', clock);

    await repeatWeekAcrossMonth(db, USER, newId, '2026-09', '2026-09-06', clock);

    expect((await getRange(db, USER, '2026-09-20', '2026-09-20')).get('2026-09-20')).toEqual(['legs']);
  });

  it('copies the fullest planned week, not a one-off date further ahead', async () => {
    // Taking the week of the latest decision would make the lone Sunday on the 20th the whole
    // pattern, and every Tuesday rest from the fully planned first week would be lost.
    await planFirstWeek();
    await setScheduledDay(db, USER, newId, '2026-09-20', 'legs', clock);

    await repeatWeekAcrossMonth(db, USER, newId, '2026-09', '2026-09-06', clock);

    const range = await getRange(db, USER, '2026-09-01', '2026-09-30');
    expect(range.get('2026-09-13')).toEqual(['push']);
    expect(range.has('2026-09-15')).toBe(true);
    expect(range.get('2026-09-15')).toBeNull();
  });

  it('does not rewrite anything before today', async () => {
    // Rewriting the past of a calendar is not planning.
    await planFirstWeek();

    await repeatWeekAcrossMonth(db, USER, newId, '2026-09', '2026-09-14', clock);

    const range = await getRange(db, USER, '2026-09-01', '2026-09-30');
    expect(range.has('2026-09-13')).toBe(false);
    expect(range.get('2026-09-20')).toEqual(['push']);
  });

  it('fills a future month from the week planned before it', async () => {
    // Planning a month ahead: the source is last month, and all of the target is still to come.
    await planFirstWeek();

    const written = await repeatWeekAcrossMonth(db, USER, newId, '2026-10', '2026-09-06', clock);

    const october = await getRange(db, USER, '2026-10-01', '2026-10-31');
    expect(october.get('2026-10-04')).toEqual(['push']);
    expect(october.has('2026-10-06')).toBe(true);
    expect(october.get('2026-10-06')).toBeNull();
    expect(written).toBeGreaterThan(0);
  });

  it('does nothing and reports zero when there is no week to copy', async () => {
    expect(await repeatWeekAcrossMonth(db, USER, newId, '2026-09', '2026-09-06', clock)).toBe(0);
  });

  it('can be pressed twice without changing the result', async () => {
    await planFirstWeek();
    await repeatWeekAcrossMonth(db, USER, newId, '2026-09', '2026-09-06', clock);
    expect(await repeatWeekAcrossMonth(db, USER, newId, '2026-09', '2026-09-06', clock)).toBe(0);
  });

  it('keeps two users calendars apart', async () => {
    await planFirstWeek();
    await repeatWeekAcrossMonth(db, 'someone-else', newId, '2026-09', '2026-09-06', clock);
    expect((await getRange(db, 'someone-else', '2026-09-01', '2026-09-30')).size).toBe(0);
  });
});

describe('several workouts on one day', () => {
  const DAY = '2026-08-17';

  it('keeps every workout, in the order given', async () => {
    await setScheduledWorkouts(db, USER, newId, DAY, ['day-push', 'day-abs'], clock);
    expect(await scheduledFor(db, USER, DAY)).toEqual(['day-push', 'day-abs']);
  });

  it('adds a second workout after the first', async () => {
    await setScheduledDay(db, USER, newId, DAY, 'day-push', clock);
    await addScheduledWorkout(db, USER, newId, DAY, 'day-abs', clock);
    expect(await scheduledFor(db, USER, DAY)).toEqual(['day-push', 'day-abs']);
  });

  it('does not add the same workout twice', async () => {
    await setScheduledDay(db, USER, newId, DAY, 'day-push', clock);
    await addScheduledWorkout(db, USER, newId, DAY, 'day-push', clock);
    await setScheduledWorkouts(db, USER, newId, '2026-08-18', ['day-abs', 'day-abs'], clock);
    expect(await scheduledFor(db, USER, DAY)).toEqual(['day-push']);
    expect(await scheduledFor(db, USER, '2026-08-18')).toEqual(['day-abs']);
  });

  it('replaces a rest day when a workout is added to it', async () => {
    await setScheduledDay(db, USER, newId, DAY, null, clock);
    await addScheduledWorkout(db, USER, newId, DAY, 'day-abs', clock);
    expect(await scheduledFor(db, USER, DAY)).toEqual(['day-abs']);
  });

  it('removes one workout and keeps the others in order', async () => {
    await setScheduledWorkouts(db, USER, newId, DAY, ['a', 'b', 'c'], clock);
    await removeScheduledWorkout(db, USER, newId, DAY, 'b', clock);
    expect(await scheduledFor(db, USER, DAY)).toEqual(['a', 'c']);
  });

  it('leaves the day undecided, not resting, when the last workout is removed', async () => {
    await setScheduledDay(db, USER, newId, DAY, 'day-push', clock);
    await removeScheduledWorkout(db, USER, newId, DAY, 'day-push', clock);
    expect(await scheduledFor(db, USER, DAY)).toBeUndefined();
  });

  it('ignores removing a workout that is not on the day', async () => {
    await setScheduledDay(db, USER, newId, DAY, null, clock);
    await removeScheduledWorkout(db, USER, newId, DAY, 'day-push', clock);
    expect(await scheduledFor(db, USER, DAY)).toBeNull();
  });

  it('turns two workouts into one when a single workout is chosen for the day', async () => {
    await setScheduledWorkouts(db, USER, newId, DAY, ['day-push', 'day-abs'], clock);
    await setScheduledDay(db, USER, newId, DAY, 'day-legs', clock);
    expect(await scheduledFor(db, USER, DAY)).toEqual(['day-legs']);
  });

  it('clears every workout on the day at once', async () => {
    await setScheduledWorkouts(db, USER, newId, DAY, ['day-push', 'day-abs'], clock);
    await clearScheduledDay(db, USER, DAY);
    expect(await scheduledFor(db, USER, DAY)).toBeUndefined();
  });

  it('shows both in the week, the first as the headline', async () => {
    await setScheduledWorkouts(db, USER, newId, DAY, ['day-push', 'day-abs'], clock);
    const monday = (await getWeek(db, USER, '2026-08-16'))[1];
    expect(monday?.planDayIds).toEqual(['day-push', 'day-abs']);
    expect(monday?.planDayId).toBe('day-push');
    expect(monday?.planned).toBe(true);
  });

  it('gives a rest day and an undecided day an empty list in the week', async () => {
    await setScheduledDay(db, USER, newId, DAY, null, clock);
    const week = await getWeek(db, USER, '2026-08-16');
    expect(week[1]?.planDayIds).toEqual([]);
    expect(week[2]?.planDayIds).toEqual([]);
    expect([week[1]?.planned, week[2]?.planned]).toEqual([true, false]);
  });

  it('reads both back over a range', async () => {
    await setScheduledWorkouts(db, USER, newId, DAY, ['day-push', 'day-abs'], clock);
    const range = await getRange(db, USER, '2026-08-01', '2026-08-31');
    expect(range.get(DAY)).toEqual(['day-push', 'day-abs']);
  });

  it('copies both when seeding the next week', async () => {
    await setScheduledWorkouts(db, USER, newId, DAY, ['day-push', 'day-abs'], clock);
    await seedWeekFromPrevious(db, USER, newId, '2026-08-23', clock);
    expect(await scheduledFor(db, USER, '2026-08-24')).toEqual(['day-push', 'day-abs']);
  });

  it('copies both when repeating a week across the month', async () => {
    // September 7th 2026 is a Monday.
    await setScheduledWorkouts(db, USER, newId, '2026-09-07', ['day-push', 'day-abs'], clock);
    await repeatWeekAcrossMonth(db, USER, newId, '2026-09', '2026-09-06', clock);
    expect(await scheduledFor(db, USER, '2026-09-14')).toEqual(['day-push', 'day-abs']);
  });

  it('keeps two users apart', async () => {
    await setScheduledWorkouts(db, USER, newId, DAY, ['day-push', 'day-abs'], clock);
    await setScheduledDay(db, 'user-2', newId, DAY, 'day-legs', clock);
    await clearScheduledDay(db, 'user-2', DAY);
    expect(await scheduledFor(db, USER, DAY)).toEqual(['day-push', 'day-abs']);
  });
});
