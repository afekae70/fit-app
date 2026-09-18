import { describe, expect, it } from 'vitest';

import {
  DEFAULT_REMINDER_SETTINGS,
  formatTime,
  parseReminderSettings,
  remindersToSchedule,
  shiftTime,
  timeFor,
  type WorkoutReminderSettings,
} from './workoutDays.js';

const ON: WorkoutReminderSettings = { ...DEFAULT_REMINDER_SETTINGS, enabled: true, time: { hour: 7, minute: 30 } };
// Friday September 18th 2026, early morning.
const NOW = new Date(2026, 8, 18, 6, 0);

const local = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')} ${formatTime({ hour: date.getHours(), minute: date.getMinutes() })}`;

describe('which workout days get a reminder', () => {
  it('reminds on a day with a workout, at the chosen time, naming it', () => {
    const [reminder] = remindersToSchedule([{ date: '2026-09-20', names: ['חזה גב'] }], ON, NOW);
    expect(local(reminder!.fireAt)).toBe('2026-09-20 07:30');
    expect(reminder!.names).toEqual(['חזה גב']);
    expect(reminder!.id).toBe('workout-day-2026-09-20');
  });

  it('never reminds on a rest day', () => {
    expect(remindersToSchedule([{ date: '2026-09-21', names: [] }], ON, NOW)).toEqual([]);
  });

  it('schedules nothing when reminders are off', () => {
    expect(
      remindersToSchedule([{ date: '2026-09-20', names: ['x'] }], { ...ON, enabled: false }, NOW),
    ).toEqual([]);
  });

  it('keeps today when its time is still ahead, and drops it once it has passed', () => {
    const today = [{ date: '2026-09-18', names: ['בטן'] }];
    expect(remindersToSchedule(today, ON, NOW)).toHaveLength(1);
    expect(remindersToSchedule(today, ON, new Date(2026, 8, 18, 8, 0))).toHaveLength(0);
  });

  it('drops a day that was asked to be skipped — today, once it is trained', () => {
    const days = [
      { date: '2026-09-18', names: ['בטן'] },
      { date: '2026-09-20', names: ['חזה'] },
    ];
    const kept = remindersToSchedule(days, ON, NOW, new Set(['2026-09-18']));
    expect(kept.map((r) => r.date)).toEqual(['2026-09-20']);
  });

  it('uses a weekday of its own when one is set, and the shared time otherwise', () => {
    const perWeekday = [...ON.perWeekday];
    perWeekday[0] = { hour: 18, minute: 15 }; // Sundays
    const settings = { ...ON, perWeekday };
    const [sunday, monday] = remindersToSchedule(
      [
        { date: '2026-09-20', names: ['a'] },
        { date: '2026-09-21', names: ['b'] },
      ],
      settings,
      NOW,
    );
    expect(local(sunday!.fireAt)).toBe('2026-09-20 18:15');
    expect(local(monday!.fireAt)).toBe('2026-09-21 07:30');
  });

  it('keeps two workouts on one day together, in one reminder', () => {
    const reminders = remindersToSchedule([{ date: '2026-09-20', names: ['חזה', 'בטן'] }], ON, NOW);
    expect(reminders).toHaveLength(1);
    expect(reminders[0]!.names).toEqual(['חזה', 'בטן']);
  });
});

describe('the reminder time', () => {
  it('falls back to the shared time for a weekday without its own', () => {
    expect(timeFor(ON, 3)).toEqual({ hour: 7, minute: 30 });
  });

  it('moves in steps and wraps round midnight both ways', () => {
    expect(shiftTime({ hour: 7, minute: 30 }, 15)).toEqual({ hour: 7, minute: 45 });
    expect(shiftTime({ hour: 23, minute: 50 }, 15)).toEqual({ hour: 0, minute: 5 });
    expect(shiftTime({ hour: 0, minute: 0 }, -15)).toEqual({ hour: 23, minute: 45 });
  });

  it('reads as two-digit hours and minutes', () => {
    expect(formatTime({ hour: 7, minute: 5 })).toBe('07:05');
  });
});

describe('reading saved settings back', () => {
  it('returns the defaults when nothing was saved or the value is unreadable', () => {
    expect(parseReminderSettings(null)).toEqual(DEFAULT_REMINDER_SETTINGS);
    expect(parseReminderSettings('{not json')).toEqual(DEFAULT_REMINDER_SETTINGS);
  });

  it('keeps what was saved', () => {
    const perWeekday = [...ON.perWeekday];
    perWeekday[5] = { hour: 9, minute: 0 };
    const saved = { ...ON, perWeekday };
    expect(parseReminderSettings(JSON.stringify(saved))).toEqual(saved);
  });

  it('refuses an impossible time rather than scheduling it', () => {
    const parsed = parseReminderSettings(
      JSON.stringify({ enabled: true, time: { hour: 25, minute: 70 }, perWeekday: [{ hour: -1, minute: 0 }] }),
    );
    expect(parsed.time).toEqual(DEFAULT_REMINDER_SETTINGS.time);
    expect(parsed.perWeekday[0]).toBeNull();
    expect(parsed.perWeekday).toHaveLength(7);
    expect(parsed.enabled).toBe(true);
  });
});
