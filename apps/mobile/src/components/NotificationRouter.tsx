/**
 * Opens the screen a tapped notification points at, keeps the Saturday reminder's words and link
 * current, and has the coach write the week's review once it is due. Draws nothing.
 *
 * Mounted inside `AppGate`, beside the router, so it runs only once the database is open and the
 * router can navigate — a tap that launched the app is handled when the app is ready for it, not
 * before.
 *
 * Two ways a tap arrives: while the app is running (the listener), and as the tap that started it
 * (`getLastNotificationResponseAsync`). The second is cleared once handled, or every later launch
 * would open the summary again. The target comes from `notificationTarget`, an allow-list.
 */

import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { AppState } from 'react-native';

import { useAuth } from '../auth/AuthProvider.js';
import { useCurrentUserId } from '../auth/CurrentUserProvider.js';
import { ensureDueWeekReview } from '../coach/autoWeekReview.js';
import { useAiAge } from '../coach/useAiAge.js';
import { API_BASE_URL } from '../config.js';
import { getExecutor, newId } from '../db/provider.js';
import { notificationTarget } from '../notificationLinks.js';
import { refreshWeeklyReminder } from '../notifications.js';

function open(response: Notifications.NotificationResponse | null): void {
  const target = notificationTarget(response?.notification.request.content.data);
  if (target) router.push(target);
}

export function NotificationRouter() {
  const { t, i18n } = useTranslation();

  useEffect(() => {
    let subscription: { remove: () => void } | null = null;
    try {
      subscription = Notifications.addNotificationResponseReceivedListener(open);
    } catch {
      // A build without the native module: there are no notifications to be tapped.
    }
    void (async () => {
      try {
        const launched = await Notifications.getLastNotificationResponseAsync();
        if (!launched) return;
        await Notifications.clearLastNotificationResponseAsync();
        open(launched);
      } catch {
        /* no native module, or nothing to read */
      }
    })();
    return () => subscription?.remove();
  }, []);

  // The reminder already on the phone gets today's words, in today's language, and the link.
  useEffect(() => {
    void refreshWeeklyReminder({
      title: t('weekSummary.reminderTitle'),
      body: t('weekSummary.reminderBody'),
    });
  }, [t, i18n.language]);

  // The coach's weekly review, written by itself once the week is due (Saturday 19:00 — see
  // coach/autoWeekReview.ts): when the app opens and whenever it comes back to the front, so the
  // review is there by the time the summary is opened. Does nothing once the week has one.
  const userId = useCurrentUserId();
  const { session } = useAuth();
  const aiAge = useAiAge();
  const accessToken = session?.access_token ?? null;
  useEffect(() => {
    if (aiAge !== 'adult' || !API_BASE_URL || !accessToken) return;
    const baseUrl = API_BASE_URL;
    const locale = i18n.language === 'he' ? 'he' : 'en';
    const run = () => {
      void (async () =>
        ensureDueWeekReview({ db: await getExecutor(), userId, newId, locale, baseUrl, accessToken }))();
    };
    run();
    const subscription = AppState.addEventListener('change', (next) => {
      if (next === 'active') run();
    });
    return () => subscription.remove();
  }, [aiAge, accessToken, userId, i18n.language]);

  return null;
}
