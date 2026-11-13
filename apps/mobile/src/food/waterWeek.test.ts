/**
 * Water week by week. 2026-11-12 is a Thursday, so its week runs Sunday 8 to Saturday 14.
 */

import { describe, expect, it } from 'vitest';

import { DEFAULT_GOAL_ML } from './water.js';
import { waterWeeks, waterWeeksFrom, weightOn, type Weighing } from './waterWeek.js';

const TODAY = '2026-11-12';
/** Weighed at 08:00 local on a day. */
const weighed = (day: string, kg: number): Weighing => ({
  measured_at: new Date(`${day}T08:00:00`).toISOString(),
  weight_kg: kg,
});

describe('the weight a day is judged by', () => {
  const weighings = [weighed('2026-11-01', 80), weighed('2026-11-10', 84)];

  it('is the latest weighing on or before the day, the same day included', () => {
    expect(weightOn('2026-11-05', weighings)).toBe(80);
    expect(weightOn('2026-11-10', weighings)).toBe(84);
    expect(weightOn('2026-11-12', weighings)).toBe(84);
  });

  it('is the earliest weighing before there was any, and null with none at all', () => {
    expect(weightOn('2026-10-20', weighings)).toBe(80);
    expect(weightOn('2026-11-05', [])).toBeNull();
  });
});

describe('water week by week', () => {
  it('counts the days the aim was reached, judged by the weight of that day', () => {
    // 80 kg → 3600 ml until the 10th; 84 kg → 3780 ml from then.
    const weighings = [weighed('2026-11-01', 80), weighed('2026-11-10', 84)];
    const daily = [
      { day: '2026-11-08', ml: 3600 }, // reached at 80 kg
      { day: '2026-11-09', ml: 2000 }, // short
      { day: '2026-11-10', ml: 3700 }, // short now: 84 kg asks 3780
      { day: '2026-11-11', ml: 3800 }, // reached
    ];
    const [week] = waterWeeks(daily, weighings, TODAY, 1);
    expect(week!.start).toBe('2026-11-08');
    expect(week!.days.map((d) => d.goalMl).slice(0, 4)).toEqual([3600, 3600, 3780, 3780]);
    expect(week!.reached).toBe(2);
  });

  it('does not count this week’s days still to come, and marks a day with nothing written', () => {
    const [week] = waterWeeks([{ day: '2026-11-12', ml: 500 }], [], TODAY, 1);
    // Sunday to Thursday have happened; Friday and Saturday have not.
    expect(week!.counted).toBe(5);
    expect(week!.days.filter((d) => d.future).map((d) => d.day)).toEqual(['2026-11-13', '2026-11-14']);
    const sunday = week!.days[0]!;
    expect(sunday).toMatchObject({ ml: 0, logged: false, reached: false, future: false });
    expect(sunday.goalMl).toBe(DEFAULT_GOAL_ML);
  });

  it('gives every week, empty ones too, oldest first and ending on this one', () => {
    const weeks = waterWeeks([{ day: '2026-10-20', ml: 4000 }], [], TODAY, 4);
    expect(weeks.map((w) => w.start)).toEqual([
      '2026-10-18',
      '2026-10-25',
      '2026-11-01',
      '2026-11-08',
    ]);
    expect(weeks.map((w) => w.reached)).toEqual([1, 0, 0, 0]);
    expect(weeks.slice(0, 3).every((w) => w.counted === 7)).toBe(true);
    expect(waterWeeksFrom(TODAY, 4)).toBe('2026-10-18');
  });
});
