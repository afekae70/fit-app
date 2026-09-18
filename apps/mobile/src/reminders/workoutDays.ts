/**
 * Which workout-day reminders should exist, and when each one fires.
 *
 * Kept free of expo-notifications and the database so it can be tested to the minute; `sync.ts`
 * reads the calendar, calls this, and hands the result to the notification scheduler.
 *
 * A workout day is a date with at least one workout planned on the calendar. An undecided date is
 * not one: the rotation would fill it, but a reminder for a workout nobody chose is a reminder to
 * be ignored, and a rest day the user picked must never be interrupted.
 */

export interface ReminderTime {
  hour: number;
  minute: number;
}

export interface WorkoutReminderSettings {
  enabled: boolean;
  /** The time used for every day that has no time of its own. */
  time: ReminderTime;
  /**
   * An optional time for each weekday, Sunday first — `Date#getDay` order. Null means "use
   * `time`". Seven entries, always.
   */
  perWeekday: (ReminderTime | null)[];
}

export const DEFAULT_REMINDER_SETTINGS: WorkoutReminderSettings = {
  enabled: false,
  time: { hour: 7, minute: 0 },
  perWeekday: [null, null, null, null, null, null, null],
};

/** How far ahead reminders are laid down. Re-laid every time the app opens, so this is plenty. */
export const REMINDER_HORIZON_DAYS = 30;

/** Every workout-day reminder carries this prefix, so they can be found and replaced as a set. */
export const REMINDER_ID_PREFIX = 'workout-day-';

export interface PlannedDay {
  /** Local `YYYY-MM-DD`. */
  date: string;
  /** The day's workouts by name, in order. Empty for a rest day. */
  names: string[];
}

export interface ReminderToSchedule {
  id: string;
  date: string;
  fireAt: Date;
  names: string[];
}

export function timeFor(settings: WorkoutReminderSettings, weekday: number): ReminderTime {
  return settings.perWeekday[weekday] ?? settings.time;
}

/** "07:05" — two digits each, as the time is shown and as it is read back. */
export function formatTime(time: ReminderTime): string {
  return `${String(time.hour).padStart(2, '0')}:${String(time.minute).padStart(2, '0')}`;
}

/** A time moved by some minutes, wrapping around midnight in either direction. */
export function shiftTime(time: ReminderTime, minutes: number): ReminderTime {
  const total = (((time.hour * 60 + time.minute + minutes) % 1440) + 1440) % 1440;
  return { hour: Math.floor(total / 60), minute: total % 60 };
}

/**
 * The reminders that should exist right now.
 *
 * Only days with a workout, only fire times still in the future, and none for a day in `skip` —
 * which is how today's reminder is dropped once today's workouts are already done: the reminder
 * was laid down in advance, but a nudge to train after training is the kind of notification that
 * teaches someone to turn notifications off.
 */
export function remindersToSchedule(
  days: readonly PlannedDay[],
  settings: WorkoutReminderSettings,
  now: Date,
  skip: ReadonlySet<string> = new Set(),
): ReminderToSchedule[] {
  if (!settings.enabled) return [];
  const reminders: ReminderToSchedule[] = [];
  for (const day of days) {
    if (day.names.length === 0 || skip.has(day.date)) continue;
    const [year, month, date] = day.date.split('-').map(Number);
    const weekday = new Date(year!, month! - 1, date).getDay();
    const { hour, minute } = timeFor(settings, weekday);
    const fireAt = new Date(year!, month! - 1, date, hour, minute);
    if (fireAt.getTime() <= now.getTime()) continue;
    reminders.push({ id: `${REMINDER_ID_PREFIX}${day.date}`, date: day.date, fireAt, names: day.names });
  }
  return reminders;
}

/**
 * Settings read back from storage, trusted only as far as they check out.
 *
 * A stored value from an older build — or a hand-edited one — could be missing fields or hold
 * an impossible hour. Anything that does not fit falls back to the default rather than
 * scheduling a reminder for 25:70 or failing to schedule one at all.
 */
export function parseReminderSettings(raw: string | null): WorkoutReminderSettings {
  if (!raw) return DEFAULT_REMINDER_SETTINGS;
  try {
    const value = JSON.parse(raw) as Partial<WorkoutReminderSettings>;
    const valid = (time: unknown): time is ReminderTime =>
      typeof time === 'object' &&
      time !== null &&
      Number.isInteger((time as ReminderTime).hour) &&
      Number.isInteger((time as ReminderTime).minute) &&
      (time as ReminderTime).hour >= 0 &&
      (time as ReminderTime).hour < 24 &&
      (time as ReminderTime).minute >= 0 &&
      (time as ReminderTime).minute < 60;
    const perWeekday = Array.from({ length: 7 }, (_, i) => {
      const entry = Array.isArray(value.perWeekday) ? value.perWeekday[i] : null;
      return valid(entry) ? entry : null;
    });
    return {
      enabled: value.enabled === true,
      time: valid(value.time) ? value.time : DEFAULT_REMINDER_SETTINGS.time,
      perWeekday,
    };
  } catch {
    return DEFAULT_REMINDER_SETTINGS;
  }
}
