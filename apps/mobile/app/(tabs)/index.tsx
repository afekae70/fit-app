/**
 * Today — the design handoff's home screen.
 *
 * One question, answered in one glance: what am I training today, and can I start it now. The
 * greeting and date place you, the workout card is the whole point, the streak strip is the
 * reason to come back, and three numbers say how the week is going. Nothing else: the handoff is
 * explicit that the week summary is "deliberately three numbers, no more".
 *
 * Four states, all specified: loaded, brand-new user, loading and error. The error state
 * deliberately says the local data is safe — everything here is read from SQLite on the device,
 * so a failure is always about the read, never about lost training.
 */

import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Barbell, CalendarBlank, ForkKnife, Scales, Sparkle } from 'phosphor-react-native';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAuth } from '../../src/auth/AuthProvider.js';
import { useCurrentUserId } from '../../src/auth/CurrentUserProvider.js';
import { loadAvatar } from '../../src/profile/avatar.js';
import { writeWidgetSnapshot } from '../../src/widget/snapshot.js';
import { QuickActions } from '../../src/components/home/QuickActions.js';
import {
  GreetingRow,
  NutritionCard,
  RestDayCard,
  StreakCard,
  TodayWorkoutCard,
  WeekSummaryRow,
  WeightTrendCard,
  TrainedTodayCard,
} from '../../src/components/home/TodayCards.js';
import { FadeSlideIn } from '../../src/components/motion.js';
import { Skeleton } from '../../src/components/ui.js';
import {
  getHomeNutrition,
  getTodayWorkout,
  getTrainedToday,
  isScheduledRestDay,
  weekStrip,
  weekSummary,
  type HomeNutrition,
  type StripDay,
  type TodayWorkout,
  type WeekSummary,
  type TrainedToday,
  monthWeeks,
  type MonthWeeks,
} from '../../src/db/home.js';
import { startSessionFromPlanDay } from '../../src/db/plans.js';
import { getExecutor, newId } from '../../src/db/provider.js';
import { getActiveSession } from '../../src/db/workouts.js';
import { syncWorkoutReminders } from '../../src/reminders/sync.js';
import { hapticLight } from '../../src/haptics.js';
import { useTheme } from '../../src/ThemeProvider.js';
import { radius, type ColorPalette } from '../../src/theme.js';

interface HomeData {
  workout: TodayWorkout | null;
  strip: StripDay[];
  summary: WeekSummary;
  monthWeeks: MonthWeeks;
  nutrition: HomeNutrition;
  /**
   * Today was deliberately marked as a rest day, as opposed to there being no plan at all.
   *
   * `getTodayWorkout` returns null for both, and they deserve opposite screens: one is the plan
   * working, the other is an invitation to make one.
   */
  restDay: boolean;
  trained: TrainedToday | null;
}

export default function TodayScreen() {
  const { t, i18n } = useTranslation();
  const insets = useSafeAreaInsets();
  const userId = useCurrentUserId();
  const { session } = useAuth();
  // The reader's own name and face at the top of their own screen — the picture from the profile
  // page, the name from the address they signed in with.
  const displayName = (session?.user.email ?? '').split('@')[0] ?? '';
  const [avatarUri, setAvatarUri] = useState<string | null>(null);
  useEffect(() => {
    void loadAvatar(userId).then(setAvatarUri);
  }, [userId]);
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const [data, setData] = useState<HomeData | null>(null);
  const [failed, setFailed] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const db = await getExecutor();
      const [workout, strip, summary, weeks, nutrition, restDay, trained] = await Promise.all([
        getTodayWorkout(db, userId),
        weekStrip(db, userId),
        weekSummary(db, userId),
        monthWeeks(db, userId),
        getHomeNutrition(db, userId),
        isScheduledRestDay(db, userId),
        getTrainedToday(db, userId),
      ]);
      setData({ workout, strip, summary, monthWeeks: weeks, nutrition, restDay, trained });
      setFailed(false);

      // Leave the home-screen widget something to show. Not awaited: a launcher label must never
      // hold up the screen it was read from.
      writeWidgetSnapshot(
        workout
          ? {
              title: workout.dayName,
              detail: t('home.workoutMeta', {
                exercises: workout.exerciseCount,
                sets: workout.setCount,
                minutes: workout.estimatedMinutes,
              }),
              action: t('home.startWorkout'),
            }
          : null,
      );
      // After a workout this drops today's reminder; on launch it extends the month ahead.
      void syncWorkoutReminders(db, userId, {
        title: t('settings.workoutReminderNotification'),
        channel: t('settings.workoutReminderTitle'),
      });
    } catch {
      setFailed(true);
    }
  }, [userId, t]);

  // On focus, not just on mount: finishing a workout on another tab changes every number here.
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    void load().finally(() => setRefreshing(false));
  }, [load]);

  /**
   * Open today's planned workout, already populated.
   *
   * This used to only navigate, which left the user on the Workouts tab facing a Start button
   * and an empty session — the plan was named on the card they had just tapped and then not
   * carried across. `getTodayWorkout` already resolves which plan day today is, so starting it
   * here is what the card was always promising.
   *
   * An already-open session wins: starting a second would strand the first unfinished, and
   * resuming is what someone returning mid-workout expects anyway.
   */
  const startWorkout = useCallback(() => {
    void hapticLight();
    void (async () => {
      const db = await getExecutor();
      const planDayId = data?.workout?.planDayId;

      if (!(await getActiveSession(db, userId)) && planDayId) {
        await startSessionFromPlanDay(db, userId, newId, planDayId);
      }
      router.push('/(tabs)/workouts');
    })();
  }, [userId, data]);

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[
        styles.content,
        { paddingTop: 8, paddingBottom: insets.bottom + 28 },
      ]}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} />
      }
    >
      <GreetingRow
        greeting={t(greetingKey(new Date()))}
        date={formatDate(new Date(), i18n.language)}
        name={displayName}
        avatarUri={avatarUri}
        onOpenProfile={() => router.push('/profile')}
      />

      {failed ? (
        <ErrorPanel onRetry={() => void load()} />
      ) : !data ? (
        <LoadingPanel />
      ) : (
        <>
          {data.trained ? (
            /* Training today outranks the invitation to train. The card used to go on offering
               to start a workout that had just been finished, because the screen worked out
               which workout today calls for and never asked whether it had happened. */
            <>
              <FadeSlideIn index={0}>
                <TrainedTodayCard
                  trained={data.trained}
                  onOpen={() =>
                    router.push({
                      pathname: '/session/[id]',
                      params: { id: data.trained!.sessionId },
                    })
                  }
                  onStartAnother={startWorkout}
                />
              </FadeSlideIn>
              {/* A second workout planned for today stays on offer after the first is done.
                  Without this, finishing the morning session hid the evening one until
                  tomorrow, which is exactly the day it was not planned for. */}
              {data.workout ? (
                <FadeSlideIn index={1}>
                  <TodayWorkoutCard workout={data.workout} onStart={startWorkout} />
                </FadeSlideIn>
              ) : null}
              <FadeSlideIn index={1}>
                <StreakCard
                  days={data.strip}
                  monthWeeks={data.monthWeeks}
                />
              </FadeSlideIn>
              <FadeSlideIn index={2}>
                <WeekSummaryRow summary={data.summary} />
              </FadeSlideIn>
            </>
          ) : data.workout ? (
            <>
              {/* Staggered in the order they are read: what to train, then the streak that argues
                  for doing it, then the week behind it. */}
              <FadeSlideIn index={0}>
                <TodayWorkoutCard workout={data.workout} onStart={startWorkout} />
              </FadeSlideIn>
              <FadeSlideIn index={1}>
                <StreakCard
                  days={data.strip}
                  monthWeeks={data.monthWeeks}
                />
              </FadeSlideIn>
              <FadeSlideIn index={2}>
                <WeekSummaryRow summary={data.summary} />
              </FadeSlideIn>
            </>
          ) : data.restDay ? (
            /* A scheduled rest day keeps the streak strip and the week's numbers — they say the
               week is going fine, which is the reassurance a rest day wants — and drops only
               the invitation to train. */
            <>
              <FadeSlideIn index={0}>
                <RestDayCard />
              </FadeSlideIn>
              <FadeSlideIn index={1}>
                <StreakCard
                  days={data.strip}
                  monthWeeks={data.monthWeeks}
                />
              </FadeSlideIn>
              <FadeSlideIn index={2}>
                <WeekSummaryRow summary={data.summary} />
              </FadeSlideIn>
            </>
          ) : (
            <EmptyPanel
              onStartEmpty={startWorkout}
              onPickPlan={() => router.push('/(tabs)/plan')}
            />
          )}

          {/* The five places worth reaching in one tap, under the training block: what to do
              today comes first, and these are what follows it. */}
          <FadeSlideIn index={3}>
            <QuickActions
              actions={[
                {
                  key: 'workout',
                  label: t('tabs.workout'),
                  Glyph: Barbell,
                  onPress: startWorkout,
                  primary: true,
                },
                {
                  key: 'plan',
                  label: t('tabs.plan'),
                  Glyph: CalendarBlank,
                  onPress: () => router.push('/(tabs)/plan'),
                },
                {
                  key: 'nutrition',
                  label: t('profileScreen.nutrition'),
                  Glyph: ForkKnife,
                  onPress: () => router.push('/nutrition'),
                },
                {
                  key: 'metrics',
                  label: t('profileScreen.metrics'),
                  Glyph: Scales,
                  onPress: () => router.push('/metrics'),
                },
                {
                  key: 'coach',
                  label: t('profileScreen.coach'),
                  Glyph: Sparkle,
                  onPress: () => router.push('/coach'),
                },
              ]}
            />
          </FadeSlideIn>

          {/*
            Below the training block, and outside the `data.workout` branch on purpose: a rest day
            still has a calorie target and a weight to watch, and hiding them on the days someone
            is most likely to eat off plan would be exactly backwards.

            Withheld only from a genuinely brand-new account, where there is neither a weigh-in
            nor a profile to compute from — the empty state above is deliberately two ways in and
            not a dashboard, and two blank cards under it would undo that.
          */}
          {data.workout || data.trained || hasBodyData(data.nutrition) ? (
            <>
              <FadeSlideIn index={data.workout ? 3 : 0}>
                <WeightTrendCard
                  latestKg={data.nutrition.latestKg}
                  ratePerWeek={data.nutrition.ratePerWeek}
                  points={data.nutrition.weightPoints}
                  onPress={() => router.push('/metrics')}
                />
              </FadeSlideIn>
              <FadeSlideIn index={data.workout ? 4 : 1}>
                <NutritionCard
                  targets={data.nutrition.targets}
                  onPress={() => router.push('/metrics')}
                />
              </FadeSlideIn>
            </>
          ) : null}
        </>
      )}
    </ScrollView>
  );
}

/* -------------------------------------------------------------------------- */

/**
 * Heights matched to the real cards — 186 / 96 / 120 — so the content that arrives lands where
 * the placeholder was instead of shoving the page around as it loads.
 */
function LoadingPanel() {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  return (
    <View style={styles.loading}>
      <Skeleton style={[styles.skeletonCard, { height: 186 }]} />
      <Skeleton style={[styles.skeletonCard, { height: 96 }]} delay={200} />
      <Skeleton style={[styles.skeletonCard, { height: 120 }]} delay={400} />
    </View>
  );
}

/** No fake data and no zeroed stat cards — a new user is offered two ways in, not a dashboard. */
function EmptyPanel({
  onStartEmpty,
  onPickPlan,
}: {
  onStartEmpty: () => void;
  onPickPlan: () => void;
}) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  return (
    <View style={styles.stateGroup}>
      <View style={styles.emptyPanel}>
        <Text style={styles.emptyGlyph}>🏋</Text>
        <Text style={styles.emptyTitle}>{t('home.emptyTitle')}</Text>
        <Text style={styles.emptyBody}>{t('home.emptyBody')}</Text>
      </View>
      <Pressable
        onPress={onStartEmpty}
        accessibilityRole="button"
        style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed]}
      >
        <Text style={styles.primaryLabel}>{t('home.startEmpty')}</Text>
      </Pressable>
      <Pressable
        onPress={onPickPlan}
        accessibilityRole="button"
        style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed]}
      >
        <Text style={styles.secondaryLabel}>{t('home.pickPlan')}</Text>
      </Pressable>
    </View>
  );
}

function ErrorPanel({ onRetry }: { onRetry: () => void }) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  return (
    <View style={styles.errorPanel}>
      <Text style={styles.errorTitle}>{t('home.errorTitle')}</Text>
      {/* The reassurance is the point of this panel. Everything on this screen is read from the
          phone, so a failure here never means training was lost — say so before they wonder. */}
      <Text style={styles.errorBody}>{t('home.errorBody')}</Text>
      <Pressable
        onPress={onRetry}
        accessibilityRole="button"
        style={({ pressed }) => [styles.retryButton, pressed && styles.pressed]}
      >
        <Text style={styles.retryLabel}>{t('common.retry')}</Text>
      </Pressable>
    </View>
  );
}

/* -------------------------------------------------------------------------- */

/** Is there anything for the weight and nutrition cards to say yet? */
function hasBodyData(nutrition: HomeNutrition): boolean {
  return nutrition.latestKg !== null || nutrition.targets.ok;
}

function greetingKey(now: Date): string {
  const hour = now.getHours();
  if (hour < 12) return 'home.greetingMorning';
  if (hour < 18) return 'home.greetingAfternoon';
  return 'home.greetingEvening';
}

function formatDate(now: Date, language: string): string {
  return now.toLocaleDateString(language, { weekday: 'long', day: 'numeric', month: 'long' });
}

const createStyles = (colors: ColorPalette) =>
  StyleSheet.create({
    screen: { flex: 1 },
    content: { paddingHorizontal: 20, gap: 18 },

    loading: { gap: 14 },
    skeletonCard: {
      borderRadius: radius.lg,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.borderSubtle,
    },
    stateGroup: { gap: 16 },

    emptyPanel: {
      borderWidth: 1,
      borderColor: colors.borderStrong,
      borderStyle: 'dashed',
      borderRadius: radius.lg,
      paddingVertical: 34,
      paddingHorizontal: 22,
      alignItems: 'center',
      gap: 10,
    },
    emptyGlyph: { fontSize: 34, color: colors.accent },
    emptyTitle: { color: colors.text, fontSize: 17, fontWeight: '500', textAlign: 'center' },
    emptyBody: {
      color: colors.textMuted,
      fontSize: 13,
      lineHeight: 21,
      textAlign: 'center',
      maxWidth: 320,
    },

    primaryButton: {
      minHeight: 56,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: colors.accent,
      backgroundColor: colors.accentSoft,
      alignItems: 'center',
      justifyContent: 'center',
    },
    primaryLabel: { color: colors.accent, fontSize: 17, fontWeight: '500' },
    secondaryButton: {
      minHeight: 48,
      borderRadius: radius.sm,
      borderWidth: 1,
      borderColor: colors.borderStrong,
      alignItems: 'center',
      justifyContent: 'center',
    },
    secondaryLabel: { color: colors.text, fontSize: 15 },
    pressed: { opacity: 0.7 },

    errorPanel: {
      borderWidth: 1,
      borderColor: colors.danger,
      backgroundColor: colors.dangerSoft,
      borderRadius: radius.lg,
      padding: 20,
      gap: 10,
    },
    errorTitle: { color: colors.danger, fontSize: 16, fontWeight: '500', textAlign: 'auto' },
    errorBody: { color: colors.textMuted, fontSize: 13, lineHeight: 21, textAlign: 'auto' },
    retryButton: {
      alignSelf: 'flex-start',
      minHeight: 44,
      justifyContent: 'center',
      paddingHorizontal: 18,
      borderRadius: radius.sm,
      borderWidth: 1,
      borderColor: colors.accent,
    },
    retryLabel: { color: colors.accent, fontSize: 14, fontWeight: '500' },
  });
