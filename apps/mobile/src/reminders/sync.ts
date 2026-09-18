/**
 * Lay down the workout-day reminders from the calendar and the saved settings.
 *
 * Called whenever something they depend on may have changed — the app coming to the home screen,
 * a day edited on the calendar, the settings themselves — and cheap enough to call freely: it
 * reads a month of the calendar and replaces the reminders as a set.
 */

import * as SecureStore from 'expo-secure-store';

import type { SqlExecutor } from '../db/executor.js';
import { getTodayWorkout } from '../db/home.js';
import { addDays, getRange, localDate } from '../db/schedule.js';
import { replaceDatedReminders } from '../notifications.js';
import {
  parseReminderSettings,
  REMINDER_HORIZON_DAYS,
  REMINDER_ID_PREFIX,
  remindersToSchedule,
  type WorkoutReminderSettings,
} from './workoutDays.js';

const SETTINGS_KEY = 'workout-reminders';

export async function loadReminderSettings(): Promise<WorkoutReminderSettings> {
  try {
    return parseReminderSettings(await SecureStore.getItemAsync(SETTINGS_KEY));
  } catch {
    return parseReminderSettings(null);
  }
}

export async function saveReminderSettings(settings: WorkoutReminderSettings): Promise<void> {
  await SecureStore.setItemAsync(SETTINGS_KEY, JSON.stringify(settings)).catch(() => undefined);
}

export interface ReminderCopy {
  /** The notification's title — "Workout today". */
  title: string;
  /** The Android channel's name, as it appears in the phone's notification settings. */
  channel: string;
}

/**
 * Replace the scheduled reminders with the ones the calendar and settings call for now.
 *
 * Resolves false only when permission was refused; the settings screen shows that.
 */
export async function syncWorkoutReminders(
  db: SqlExecutor,
  userId: string,
  copy: ReminderCopy,
  now = new Date(),
): Promise<boolean> {
  const settings = await loadReminderSettings();
  const today = localDate(now);
  const range = await getRange(db, userId, today, addDays(today, REMINDER_HORIZON_DAYS));

  const planDayIds = [...new Set([...range.values()].flatMap((ids) => ids ?? []))];
  const names = new Map<string, string>();
  for (const id of planDayIds) {
    const row = await db.get<{ name: string | null; day_index: number }>(
      `SELECT name, day_index FROM plan_days WHERE id = ?`,
      [id],
    );
    if (row) names.set(id, row.name?.trim() || `#${row.day_index}`);
  }

  const days = [...range.entries()].map(([date, ids]) => ({
    date,
    names: (ids ?? []).map((id) => names.get(id)).filter((name): name is string => Boolean(name)),
  }));

  // Today's reminder is dropped once today's planned workouts are all done — the same "done"
  // the home card uses, so the two never disagree about whether today still has training in it.
  const skip = new Set<string>();
  const todayPlanned = days.find((day) => day.date === today)?.names.length ?? 0;
  if (todayPlanned > 0 && (await getTodayWorkout(db, userId, now)) === null) skip.add(today);

  const reminders = remindersToSchedule(days, settings, now, skip).map((reminder) => ({
    id: reminder.id,
    fireAt: reminder.fireAt,
    title: copy.title,
    body: reminder.names.join(' · '),
  }));
  return replaceDatedReminders(REMINDER_ID_PREFIX, reminders, copy.channel);
}
