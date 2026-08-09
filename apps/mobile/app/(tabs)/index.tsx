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
import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAuth } from '../../src/auth/AuthProvider.js';
import { useCurrentUserId } from '../../src/auth/CurrentUserProvider.js';
import {
  GreetingRow,
  StreakCard,
  TodayWorkoutCard,
  WeekSummaryRow,
} from '../../src/components/home/TodayCards.js';
import { Skeleton } from '../../src/components/ui.js';
import {
  getTodayWorkout,
  weekStrip,
  weekSummary,
  type StripDay,
  type TodayWorkout,
  type WeekSummary,
} from '../../src/db/home.js';
import { getExecutor } from '../../src/db/provider.js';
import { getWorkoutStreak, type WorkoutStreak } from '../../src/db/workouts.js';
import { hapticLight } from '../../src/haptics.js';
import { useTheme } from '../../src/ThemeProvider.js';
import { radius, type ColorPalette } from '../../src/theme.js';

/** How many sessions a week the streak line measures against, until settings can say otherwise. */
const WEEKLY_TARGET = 4;

interface HomeData {
  workout: TodayWorkout | null;
  strip: StripDay[];
  summary: WeekSummary;
  streak: WorkoutStreak;
}

export default function TodayScreen() {
  const { t, i18n } = useTranslation();
  const insets = useSafeAreaInsets();
  const userId = useCurrentUserId();
  const { session } = useAuth();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const [data, setData] = useState<HomeData | null>(null);
  const [failed, setFailed] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const db = await getExecutor();
      const [workout, strip, summary, streak] = await Promise.all([
        getTodayWorkout(db, userId),
        weekStrip(db, userId),
        weekSummary(db, userId),
        getWorkoutStreak(db, userId),
      ]);
      setData({ workout, strip, summary, streak });
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, [userId]);

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

  const startWorkout = useCallback(() => {
    void hapticLight();
    router.push('/(tabs)/workouts');
  }, []);

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[
        styles.content,
        { paddingTop: insets.top + 8, paddingBottom: insets.bottom + 28 },
      ]}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} />
      }
    >
      <GreetingRow
        greeting={t(greetingKey(new Date()))}
        date={formatDate(new Date(), i18n.language)}
        initials={initialsFor(session?.user.email)}
        onPressAvatar={() => router.push('/settings')}
      />

      {failed ? (
        <ErrorPanel onRetry={() => void load()} />
      ) : !data ? (
        <LoadingPanel />
      ) : data.workout ? (
        <>
          <TodayWorkoutCard workout={data.workout} onStart={startWorkout} />
          <StreakCard
            days={data.strip}
            streakWeeks={Math.floor(data.streak.currentDays / 7)}
            trainedThisWeek={data.summary.workouts}
            targetPerWeek={WEEKLY_TARGET}
          />
          <WeekSummaryRow summary={data.summary} />
        </>
      ) : (
        <EmptyPanel onStartEmpty={startWorkout} onPickPlan={() => router.push('/(tabs)/plan')} />
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

function greetingKey(now: Date): string {
  const hour = now.getHours();
  if (hour < 12) return 'home.greetingMorning';
  if (hour < 18) return 'home.greetingAfternoon';
  return 'home.greetingEvening';
}

function formatDate(now: Date, language: string): string {
  return now.toLocaleDateString(language, { weekday: 'long', day: 'numeric', month: 'long' });
}

/** Initials for the avatar. The design uses initials on a tinted circle — there are no images. */
function initialsFor(email: string | undefined): string {
  const name = email?.split('@')[0] ?? '';
  const letters = name.replace(/[^\p{L}]/gu, '');
  return letters.slice(0, 2).toUpperCase() || '·';
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
