/**
 * The weekly programme: what you intend to train, and which day is due next.
 *
 * Deliberately separate from the Workouts tab. That tab answers "what am I doing right now";
 * this one answers "what does the week look like". Merging them would put a programme editor
 * in front of someone standing at a rack trying to log a set.
 *
 * Days are shown in plan order with how long ago each was trained, and the primary action
 * starts the one that is most overdue — see `getNextPlanDay`, which sorts by least-recently
 * trained rather than mapping onto weekdays.
 */

import { router, useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useCurrentUserId } from '../../src/auth/CurrentUserProvider.js';
import { useActionSheet } from '../../src/components/ActionSheetProvider.js';
import { FadeSlideIn } from '../../src/components/motion.js';
import {
  Banner,
  Button,
  Card,
  EmptyState,
  Hint,
  ScreenHeader,
  SkeletonScreen,
} from '../../src/components/ui.js';
import {
  addPlanDay,
  createPlan,
  deletePlan,
  getActivePlan,
  getNextPlanDay,
  duplicatePlanWeek,
  listPlanDayStatus,
  reorderPlanDay,
  startSessionFromPlanDay,
  type PlanRow,
} from '../../src/db/plans.js';
import { getExecutor, newId } from '../../src/db/provider.js';
import { getActiveSession } from '../../src/db/workouts.js';
import { useTheme } from '../../src/ThemeProvider.js';
import { fontSize, fontWeight, radius, spacing, type ColorPalette } from '../../src/theme.js';

type DayStatus = {
  id: string;
  day_index: number;
  name: string | null;
  exercise_count: number;
  last_trained_at: string | null;
  session_count: number;
};

/** "3 days ago" in whole days — precise enough for deciding what to train, and language-free. */
function daysSince(iso: string, nowMs: number): number {
  return Math.max(0, Math.floor((nowMs - new Date(iso).getTime()) / 86_400_000));
}

export default function PlanScreen() {
  const { confirm, notify } = useActionSheet();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const userId = useCurrentUserId();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const [plan, setPlan] = useState<PlanRow | null>(null);
  const [days, setDays] = useState<DayStatus[]>([]);
  const [nextDayId, setNextDayId] = useState<string | null>(null);
  const [nameDraft, setNameDraft] = useState('');
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    const db = await getExecutor();
    const active = await getActivePlan(db, userId);
    setPlan(active);

    if (active) {
      setDays((await listPlanDayStatus(db, userId, active.id)));
      setNextDayId((await getNextPlanDay(db, userId, active.id))?.id ?? null);
    } else {
      setDays([]);
      setNextDayId(null);
    }
    setLoading(false);
  }, [userId]);

  /**
   * Reorder with buttons rather than a drag. The prototype drags days, but a drag inside a
   * vertical ScrollView has to win a gesture race against the scroll to start, and the loser is
   * always the user — either the list will not scroll or the day will not pick up. Two arrows
   * do the same job with no ambiguity and stay reachable one-handed at the gym.
   */
  const move = useCallback(
    (dayId: string, delta: number) => {
      if (!plan) return;
      const from = days.findIndex((d) => d.id === dayId);
      if (from < 0) return;
      void (async () => {
        const db = await getExecutor();
        await reorderPlanDay(db, plan.id, dayId, from + delta);
        await reload();
      })();
    },
    [plan, days, reload],
  );

  const duplicate = useCallback(() => {
    if (!plan) return;
    void (async () => {
      const db = await getExecutor();
      await duplicatePlanWeek(db, newId, plan.id);
      await reload();
    })();
  }, [plan, reload]);

  const [refreshing, setRefreshing] = useState(false);
  const handleRefresh = useCallback(() => {
    setRefreshing(true);
    void reload().finally(() => setRefreshing(false));
  }, [reload]);

  // useFocusEffect rather than useEffect: editing a day happens on another screen, and coming
  // back must show the new exercise counts rather than a stale snapshot.
  useFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload]),
  );

  const create = () => {
    const name = nameDraft.trim();
    if (!name) return;
    void (async () => {
      const db = await getExecutor();
      await createPlan(db, userId, newId, name);
      setNameDraft('');
      await reload();
    })();
  };

  const addDay = () => {
    if (!plan) return;
    void (async () => {
      const db = await getExecutor();
      const dayId = await addPlanDay(db, newId, plan.id, null);
      await reload();
      router.push({ pathname: '/plan-day/[id]', params: { id: dayId } });
    })();
  };

  const removePlan = () => {
    if (!plan) return;
    void (async () => {
      const ok = await confirm({
        message: t('plan.confirmDeletePlan'),
        confirmLabel: t('plan.deletePlan'),
      });
      if (!ok) return;
      const db = await getExecutor();
      await deletePlan(db, userId, plan.id);
      await reload();
    })();
  };

  const start = (planDayId: string) => {
    void (async () => {
      const db = await getExecutor();

      // Only one session can be open at a time; starting a second would strand the first.
      const active = await getActiveSession(db, userId);
      if (active) {
        await notify({ message: t('history.activeWarning') });
        return;
      }

      const sessionId = await startSessionFromPlanDay(db, userId, newId, planDayId);
      if (sessionId) router.replace('/(tabs)/workouts');
    })();
  };

  if (loading) {
    return <SkeletonScreen paddingTop={insets.top + spacing.xxl} />;
  }

  const nowMs = Date.now();

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[
        styles.content,
        { paddingTop: insets.top + spacing.lg, paddingBottom: insets.bottom + spacing.xxl },
      ]}
      keyboardShouldPersistTaps="handled"
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={colors.accent} />
      }
    >
      <ScreenHeader title={t('plan.title')} back />

      {!plan ? (
        <>
          <EmptyState emoji="🗓️" title={t('plan.empty')} hint={t('plan.emptyHint')} />
          <Card>
            <TextInput
              value={nameDraft}
              onChangeText={setNameDraft}
              placeholder={t('plan.namePlaceholder')}
              placeholderTextColor={colors.textMuted}
              style={styles.input}
              returnKeyType="done"
              onSubmitEditing={create}
            />
            <View style={styles.spacer} />
            <Button label={t('plan.create')} onPress={create} />
          </Card>
        </>
      ) : (
        <>
          <Hint>{t('plan.subtitle')}</Hint>

          <Text style={styles.planName}>{plan.name}</Text>

          {days.length === 0 ? (
            <EmptyState emoji="➕" title={t('plan.noDays')} hint={t('plan.noDaysHint')} />
          ) : (
            days.map((day, index) => {
              const isNext = day.id === nextDayId;
              const label = day.name?.trim() || `${t('plan.day')} ${day.day_index}`;
              return (
                <FadeSlideIn key={day.id} index={index}>
                <Pressable
                  onPress={() => router.push({ pathname: '/plan-day/[id]', params: { id: day.id } })}
                  style={[styles.dayCard, isNext && styles.dayCardNext]}
                  accessibilityRole="button"
                >
                  <View style={styles.dayHeader}>
                    <View style={styles.dayHeaderMain}>
                      <Text style={styles.dayName}>{label}</Text>
                      <Text style={styles.dayMeta}>
                        {t('plan.exercises', { count: day.exercise_count })}
                        {day.last_trained_at
                          ? ` · ${t('plan.trained')} ${daysSince(day.last_trained_at, nowMs)} ${t('plan.daysAgo')}`
                          : ` · ${t('plan.neverTrained')}`}
                      </Text>
                    </View>
                    {isNext ? (
                      <View style={styles.nextBadge}>
                        <Text style={styles.nextBadgeText}>{t('plan.next')}</Text>
                      </View>
                    ) : null}
                    <View style={styles.reorder}>
                      <Pressable
                        onPress={() => move(day.id, -1)}
                        disabled={index === 0}
                        style={[styles.moveBtn, index === 0 && styles.moveBtnOff]}
                        accessibilityRole="button"
                        accessibilityLabel={t('plan.moveUp')}
                        hitSlop={6}
                      >
                        <Text style={styles.moveText}>↑</Text>
                      </Pressable>
                      <Pressable
                        onPress={() => move(day.id, 1)}
                        disabled={index === days.length - 1}
                        style={[styles.moveBtn, index === days.length - 1 && styles.moveBtnOff]}
                        accessibilityRole="button"
                        accessibilityLabel={t('plan.moveDown')}
                        hitSlop={6}
                      >
                        <Text style={styles.moveText}>↓</Text>
                      </Pressable>
                    </View>
                  </View>

                  {day.exercise_count > 0 ? (
                    <Pressable
                      onPress={() => start(day.id)}
                      style={styles.startButton}
                      accessibilityRole="button"
                    >
                      <Text style={styles.startButtonText}>▶ {t('plan.startDay')}</Text>
                    </Pressable>
                  ) : (
                    <Text style={styles.emptyDayHint}>{t('plan.dayEmptyHint')}</Text>
                  )}
                </Pressable>
                </FadeSlideIn>
              );
            })
          )}

          <Pressable
            onPress={() => router.push('/plan-week')}
            style={styles.addDayButton}
            accessibilityRole="button"
          >
            <Text style={styles.addDayText}>🗓️ {t('week.planNext')}</Text>
          </Pressable>

          {days.length > 0 ? (
            <Pressable
              onPress={duplicate}
              style={styles.addDayButton}
              accessibilityRole="button"
            >
              <Text style={styles.addDayText}>⧉ {t('plan.duplicateWeek')}</Text>
            </Pressable>
          ) : null}

          <Pressable onPress={addDay} style={styles.addDayButton} accessibilityRole="button">
            <Text style={styles.addDayText}>+ {t('plan.addDay')}</Text>
          </Pressable>

          <Banner tone="info">{t('plan.prescriptionNote')}</Banner>

          <Pressable onPress={removePlan} style={styles.deleteButton} accessibilityRole="button">
            <Text style={styles.deleteButtonText}>{t('plan.deletePlan')}</Text>
          </Pressable>
        </>
      )}
    </ScrollView>
  );
}

const createStyles = (colors: ColorPalette) =>
  StyleSheet.create<{
    screen: ViewStyle;
    content: ViewStyle;
    centered: ViewStyle;
    muted: TextStyle;
    input: TextStyle;
    spacer: ViewStyle;
    planName: TextStyle;
    dayCard: ViewStyle;
    dayCardNext: ViewStyle;
    dayHeader: ViewStyle;
    dayHeaderMain: ViewStyle;
    dayName: TextStyle;
    dayMeta: TextStyle;
    reorder: ViewStyle;
    moveBtn: ViewStyle;
    moveBtnOff: ViewStyle;
    moveText: TextStyle;
    nextBadge: ViewStyle;
    nextBadgeText: TextStyle;
    startButton: ViewStyle;
    startButtonText: TextStyle;
    emptyDayHint: TextStyle;
    addDayButton: ViewStyle;
    addDayText: TextStyle;
    deleteButton: ViewStyle;
    deleteButtonText: TextStyle;
  }>({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { paddingHorizontal: spacing.lg },
  centered: { flex: 1, backgroundColor: colors.bg, alignItems: 'center' },
  muted: { color: colors.textMuted, fontSize: fontSize.sm },
  input: {
    color: colors.text,
    fontSize: fontSize.md,
    backgroundColor: colors.surfaceRaised,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    textAlign: 'auto',
  },
  spacer: { height: spacing.md },
  planName: {
    color: colors.text,
    fontSize: fontSize.lg,
    fontWeight: fontWeight.bold,
    marginBottom: spacing.md,
    textAlign: 'auto',
  },
  dayCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  dayCardNext: { borderColor: colors.accentBorder, backgroundColor: colors.accentSoft },
  dayHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  dayHeaderMain: { flex: 1 },
  dayName: {
    color: colors.text,
    fontSize: fontSize.md,
    fontWeight: fontWeight.bold,
    textAlign: 'auto',
  },
  dayMeta: { color: colors.textMuted, fontSize: fontSize.xs, marginTop: 2, textAlign: 'auto' },
  reorder: { flexDirection: 'row', gap: spacing.xs },
  moveBtn: {
    width: 30,
    height: 30,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  moveBtnOff: { opacity: 0.3 },
  moveText: { color: colors.textMuted, fontSize: fontSize.sm },
  nextBadge: {
    paddingVertical: spacing.xxs,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.accent,
  },
  nextBadgeText: { color: colors.accent, fontSize: fontSize.xxs, fontWeight: fontWeight.bold },
  startButton: {
    marginTop: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.sm,
    backgroundColor: colors.accent,
    alignItems: 'center',
  },
  startButtonText: { color: colors.bg, fontSize: fontSize.sm, fontWeight: fontWeight.bold },
  emptyDayHint: {
    color: colors.textFaint,
    fontSize: fontSize.xs,
    marginTop: spacing.sm,
    textAlign: 'auto',
  },
  addDayButton: {
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderStyle: 'dashed',
    alignItems: 'center',
    marginBottom: spacing.lg,
  },
  addDayText: { color: colors.accent, fontSize: fontSize.sm, fontWeight: fontWeight.bold },
  deleteButton: { marginTop: spacing.xl, padding: spacing.md, alignItems: 'center' },
  deleteButtonText: { color: colors.danger, fontSize: fontSize.sm },
});
