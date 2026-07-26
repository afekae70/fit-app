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

import { EXERCISE_SEED, type ExerciseSeed } from '@fit/shared/catalog';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Banner, Button, Card, EmptyState, Hint, ScreenTitle } from '../../src/components/ui.js';
import {
  addPlanDay,
  createPlan,
  deletePlan,
  getActivePlan,
  getNextPlanDay,
  listPlanDayStatus,
  startSessionFromPlanDay,
  type PlanRow,
} from '../../src/db/plans.js';
import { getExecutor, newId } from '../../src/db/provider.js';
import { getActiveSession } from '../../src/db/workouts.js';
import { colors, fontSize, fontWeight, radius, spacing } from '../../src/theme.js';

const EXERCISE_BY_KEY = new Map<string, ExerciseSeed>(
  EXERCISE_SEED.map((exercise) => [exercise.nameEn, exercise]),
);

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
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();

  const [plan, setPlan] = useState<PlanRow | null>(null);
  const [days, setDays] = useState<DayStatus[]>([]);
  const [nextDayId, setNextDayId] = useState<string | null>(null);
  const [nameDraft, setNameDraft] = useState('');
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    const db = await getExecutor();
    const active = await getActivePlan(db);
    setPlan(active);

    if (active) {
      setDays((await listPlanDayStatus(db, active.id)) as DayStatus[]);
      setNextDayId((await getNextPlanDay(db, active.id))?.id ?? null);
    } else {
      setDays([]);
      setNextDayId(null);
    }
    setLoading(false);
  }, []);

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
      await createPlan(db, newId, name);
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
    Alert.alert('', t('plan.confirmDeletePlan'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('plan.deletePlan'),
        style: 'destructive',
        onPress: () => {
          void (async () => {
            const db = await getExecutor();
            await deletePlan(db, plan.id);
            await reload();
          })();
        },
      },
    ]);
  };

  const start = (planDayId: string) => {
    void (async () => {
      const db = await getExecutor();

      // Only one session can be open at a time; starting a second would strand the first.
      const active = await getActiveSession(db);
      if (active) {
        Alert.alert('', t('history.activeWarning'));
        return;
      }

      const sessionId = await startSessionFromPlanDay(db, newId, planDayId);
      if (sessionId) router.replace('/(tabs)/workouts');
    })();
  };

  if (loading) {
    return (
      <View style={[styles.centered, { paddingTop: insets.top + spacing.xxl }]}>
        <Text style={styles.muted}>{t('common.loading')}</Text>
      </View>
    );
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
    >
      <ScreenTitle>{t('plan.title')}</ScreenTitle>

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
            days.map((day) => {
              const isNext = day.id === nextDayId;
              const label = day.name?.trim() || `${t('plan.day')} ${day.day_index}`;
              return (
                <Pressable
                  key={day.id}
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
              );
            })
          )}

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

const styles = StyleSheet.create<{
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
    borderColor: colors.border,
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
