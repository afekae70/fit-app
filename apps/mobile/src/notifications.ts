/**
 * The Saturday reminder to plan the coming week.
 *
 * One notification, repeating weekly, and nothing else. This app has exactly one thing worth
 * interrupting someone for — the weekly planning ritual is the only part of it that has to
 * happen at a particular time, and everything else (a due workout, a rest day) is answered by
 * opening the app. A second reminder would make the first one noise.
 *
 * `expo-notifications` is a native module, so this only works in a build that includes it — a
 * dev client or a real APK, never Expo Go from SDK 53 onward. Every entry point here is written
 * to no-op rather than throw when the module cannot schedule, so a JS-only environment (and the
 * tests) degrade quietly instead of taking a screen down.
 *
 * Local notifications only. There is no push token, no server, and nothing leaves the device.
 */

import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

/** Saturday. `expo-notifications` weekdays are 1-based with Sunday = 1, so Saturday is 7. */
const SATURDAY = 7;
const HOUR = 19;
const MINUTE = 0;

/**
 * Identifies our reminder among any others.
 *
 * Scheduling is not idempotent — calling it twice queues two notifications — so every schedule
 * cancels this identifier first. Without that, a user who opened the app on ten Saturdays would
 * be reminded ten times on the eleventh.
 */
const REMINDER_ID = 'weekly-plan-reminder';

const ANDROID_CHANNEL = 'planning';

export interface ReminderCopy {
  title: string;
  body: string;
}

/**
 * Ask for permission, returning whether it was granted.
 *
 * Never asks twice: a request when the answer is already recorded returns the existing status
 * without a prompt, and a user who said no should not be re-prompted every launch.
 */
export async function ensureNotificationPermission(): Promise<boolean> {
  try {
    const existing = await Notifications.getPermissionsAsync();
    if (existing.granted) return true;
    // `canAskAgain` false means the user denied it in a way the OS will not re-prompt for.
    // Asking anyway returns immediately, but checking keeps the intent legible.
    if (!existing.canAskAgain) return false;

    const requested = await Notifications.requestPermissionsAsync();
    return requested.granted;
  } catch {
    return false;
  }
}

/**
 * Android requires a channel before anything can be delivered; iOS ignores this entirely.
 * Creating an existing channel is a no-op, so this is safe to call on every schedule.
 */
async function ensureAndroidChannel(name: string): Promise<void> {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync(ANDROID_CHANNEL, {
    name,
    importance: Notifications.AndroidImportance.DEFAULT,
  });
}

/**
 * Schedule (or re-schedule) the weekly reminder.
 *
 * Copy is passed in rather than read from i18n here, so this module stays free of the
 * translation runtime and the caller — which already has `t` — decides the language. A reminder
 * scheduled in Hebrew keeps its text until rescheduled, which is why `configureWeeklyReminder`
 * is called on language change too.
 */
export async function scheduleWeeklyReminder(copy: ReminderCopy): Promise<boolean> {
  try {
    if (!(await ensureNotificationPermission())) return false;
    await ensureAndroidChannel(copy.title);

    // Cancel first — scheduling is additive, and this identifier must exist at most once.
    await Notifications.cancelScheduledNotificationAsync(REMINDER_ID).catch(() => {});

    await Notifications.scheduleNotificationAsync({
      identifier: REMINDER_ID,
      content: { title: copy.title, body: copy.body },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.WEEKLY,
        weekday: SATURDAY,
        hour: HOUR,
        minute: MINUTE,
        channelId: ANDROID_CHANNEL,
      },
    });
    return true;
  } catch {
    // A build without the native module, or a device that refuses to schedule. The reminder is
    // a convenience; failing to arrange it must never surface as an error the user has to clear.
    return false;
  }
}

export async function cancelWeeklyReminder(): Promise<void> {
  try {
    await Notifications.cancelScheduledNotificationAsync(REMINDER_ID);
  } catch {
    /* nothing scheduled, or no native module — either way there is nothing to cancel */
  }
}

/** Whether our reminder is currently queued — what the settings toggle reflects. */
export async function isWeeklyReminderScheduled(): Promise<boolean> {
  try {
    const scheduled = await Notifications.getAllScheduledNotificationsAsync();
    return scheduled.some((n) => n.identifier === REMINDER_ID);
  } catch {
    return false;
  }
}

/* -------------------------------------------------------------------------- */
/* Workout-day reminders                                                       */
/* -------------------------------------------------------------------------- */

/*
 * The one exception to "a single reminder". Asked for directly, and different in kind from the
 * weekly one: it is not a ritual at a fixed hour but a nudge on the days a workout is planned, at
 * a time the user chose. It stays off until turned on, and it never fires on a rest day.
 *
 * One notification per planned date, each with its own identifier, laid down a month ahead and
 * replaced as a set whenever the calendar or the settings change — see src/reminders/sync.ts.
 * Individual dated notifications rather than a repeating one, because what the reminder says
 * (which workout) and whether it fires at all (rest day, already trained) differ day by day.
 */

const WORKOUT_CHANNEL = 'workout-days';

export interface DatedReminder {
  id: string;
  fireAt: Date;
  title: string;
  body: string;
}

/** Cancel every workout-day reminder whose identifier starts with `prefix`. */
export async function cancelRemindersWithPrefix(prefix: string): Promise<void> {
  try {
    const scheduled = await Notifications.getAllScheduledNotificationsAsync();
    await Promise.all(
      scheduled
        .filter((notification) => notification.identifier.startsWith(prefix))
        .map((notification) =>
          Notifications.cancelScheduledNotificationAsync(notification.identifier).catch(() => {}),
        ),
    );
  } catch {
    /* no native module — nothing to cancel */
  }
}

/**
 * Replace the workout-day reminders with exactly these.
 *
 * Cancel-then-schedule as a set: a calendar edit can move, add or remove any number of days, and
 * working out which of thirty reminders changed is bookkeeping with a bug in it waiting. Returns
 * false when permission is refused, so the settings screen can say so.
 */
export async function replaceDatedReminders(
  prefix: string,
  reminders: readonly DatedReminder[],
  channelName: string,
): Promise<boolean> {
  try {
    await cancelRemindersWithPrefix(prefix);
    if (reminders.length === 0) return true;
    if (!(await ensureNotificationPermission())) return false;
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync(WORKOUT_CHANNEL, {
        name: channelName,
        importance: Notifications.AndroidImportance.HIGH,
      });
    }
    for (const reminder of reminders) {
      await Notifications.scheduleNotificationAsync({
        identifier: reminder.id,
        content: { title: reminder.title, body: reminder.body },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.DATE,
          date: reminder.fireAt,
          channelId: WORKOUT_CHANNEL,
        },
      });
    }
    return true;
  } catch {
    return false;
  }
}
