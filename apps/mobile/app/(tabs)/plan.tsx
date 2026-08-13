/**
 * Plan screen — the programme you intend to run.
 *
 * The whole reason this tab exists separately from Workouts: Workouts answers "what did I do",
 * and answering "what am I doing today" from it means reading last week's history and
 * reconstructing the rotation in your head, standing in the gym. Here the answer is the card
 * marked "next up", and starting it is one tap.
 *
 * Every edit writes straight through to SQLite and the screen reloads from it — same discipline
 * as the workout screen, for the same reason. React state is a render cache, never the truth.
 */

import { EXERCISE_SEED, type ExerciseSeed } from '@fit/shared/catalog';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import Animated, { FadeIn, LinearTransition } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { SqlExecutor } from '../../src/db/executor.js';
import { PlanDayCard } from '../../src/components/PlanDayCard.js';
import { PromptSheet } from '../../src/components/PromptSheet.js';
import { TargetEditor } from '../../src/components/TargetEditor.js';
import { Button, EmptyState, Hint, ScreenTitle } from '../../src/components/ui.js';
import {
  addExerciseToPlanDay,
  addPlanDay,
  createPlan,
  DEFAULT_PLAN_TARGETS,
  deletePlan,
  getActivePlanDetail,
  lastTrainedByPlanDay,
  movePlanDayExercise,
  removePlanDay,
  removePlanDayExercise,
  renamePlanDay,
  startSessionFromPlanDay,
  updatePlan,
  updatePlanTargets,
  type PlanDayExerciseRow,
  type PlanDetail,
  type PlanTargets,
} from '../../src/db/plans.js';
import { getExecutor, newId } from '../../src/db/provider.js';
import { getActiveSession } from '../../src/db/workouts.js';
import { useSettings } from '../../src/settings.js';
import { colors, fontSize, fontWeight, radius, spacing } from '../../src/theme.js';

const EXERCISE_BY_KEY = new Map<string, ExerciseSeed>(
  EXERCISE_SEED.map((exercise) => [exercise.nameEn, exercise]),
);

const EMPTY_DETAIL: PlanDetail = { plan: null, days: [] };

/** Which sheet is open. One field rather than three booleans that could disagree. */
type Prompt =
  | { kind: 'plan-name'; initial: string }
  | { kind: 'day-name'; dayId: string; initial: string }
  | null;

export default function PlanScreen() {
  const { t, i18n } = useTranslation();
  const insets = useSafeAreaInsets();
  const isHebrew = i18n.language === 'he';
  const { settings } = useSettings();
  const params = useLocalSearchParams<{ planDayId?: string; addExercise?: string }>();

  const [detail, setDetail] = useState<PlanDetail>(EMPTY_DETAIL);
  const [lastTrained, setLastTrained] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [expandedDayId, setExpandedDayId] = useState<string | null>(null);
  const [editing, setEditing] = useState<PlanDayExerciseRow | null>(null);
  const [prompt, setPrompt] = useState<Prompt>(null);

  /**
   * Reloads can overlap — returning from the exercise picker fires the focus reload and the
   * add-then-reload at nearly the same moment. Without the sequence guard the older read can
   * resolve last and paint the state from before the exercise was added, which looks exactly
   * like the add silently failing.
   */
  const reloadSeq = useRef(0);
  const reload = useCallback(async () => {
    const seq = ++reloadSeq.current;
    const db = await getExecutor();
    const next = await getActivePlanDetail(db);
    const trained = next.plan ? await lastTrainedByPlanDay(db, next.plan.id) : {};
    if (seq !== reloadSeq.current) return;

    setDetail(next);
    setLastTrained(trained);
    setLoading(false);
  }, []);

  // Reload on focus, not just on mount: finishing a workout on the Workouts tab changes what
  // "last trained" says here, and a stale date is exactly the thing that would send someone
  // into the wrong session.
  useFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload]),
  );

  // The picker navigates back with an exercise name in params. The ref stops an unrelated
  // re-render from replaying the same addition — same guard as the workouts screen.
  const handledParam = useRef<string | null>(null);
  useEffect(() => {
    const key = params.addExercise;
    const dayId = params.planDayId;
    if (!key || !dayId) return;
    const token = `${dayId}:${key}`;
    if (handledParam.current === token) return;
    handledParam.current = token;

    void (async () => {
      const db = await getExecutor();
      // Rest comes from the profile default rather than a constant, so changing it in settings
      // applies to everything added from then on.
      await addExerciseToPlanDay(db, newId, dayId, key, {
        ...DEFAULT_PLAN_TARGETS,
        restSeconds: settings.defaultRestSeconds,
      });
      setExpandedDayId(dayId);
      await reload();
      router.setParams({ addExercise: '', planDayId: '' });
    })();
  }, [params.addExercise, params.planDayId, reload, settings.defaultRestSeconds]);

  const exerciseLabel = useCallback(
    (exerciseKey: string) => {
      const seed = EXERCISE_BY_KEY.get(exerciseKey);
      if (!seed) return exerciseKey;
      return isHebrew ? seed.nameHe : seed.nameEn;
    },
    [isHebrew],
  );

  /**
   * The day that has gone longest without being trained — never-trained days first.
   *
   * Deliberately derived from what was logged rather than from a stored cursor: a cursor gets
   * out of step the moment you skip a day or train out of order, and then confidently points
   * at the wrong session.
   */
  const nextUpDayId = useMemo(() => {
    if (detail.days.length === 0) return null;
    const untrained = detail.days.find((day) => !(day.id in lastTrained));
    if (untrained) return untrained.id;

    return detail.days.reduce((oldest, day) =>
      (lastTrained[day.id] ?? '') < (lastTrained[oldest.id] ?? '') ? day : oldest,
    ).id;
  }, [detail.days, lastTrained]);

  const totals = useMemo(() => {
    let exercises = 0;
    let sets = 0;
    for (const day of detail.days) {
      exercises += day.exercises.length;
      for (const exercise of day.exercises) sets += exercise.target_sets ?? 0;
    }
    return { exercises, sets };
  }, [detail.days]);

  /* ---------------------------------------------------------------- mutations */

  const withDb = useCallback(
    (mutate: (db: SqlExecutor) => Promise<void>) => {
      void (async () => {
        const db = await getExecutor();
        await mutate(db);
        await reload();
      })();
    },
    [reload],
  );

  const create = () =>
    withDb(async (db) => {
      const planId = await createPlan(db, newId, { name: t('plan.defaultName') });
      // A plan with no days is a blank screen with a button on it. Seeding the first day means
      // the next thing the user does is add an exercise, which is the actual task.
      await addPlanDay(db, newId, planId, null);
    });

  const addDay = () =>
    withDb(async (db) => {
      if (!detail.plan) return;
      const dayId = await addPlanDay(db, newId, detail.plan.id, null);
      setExpandedDayId(dayId);
    });

  const confirmDeletePlan = () => {
    if (!detail.plan) return;
    const planId = detail.plan.id;
    Alert.alert('', t('plan.confirmDelete'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.remove'),
        style: 'destructive',
        onPress: () => withDb((db) => deletePlan(db, planId)),
      },
    ]);
  };

  const confirmRemoveDay = (dayId: string) => {
    Alert.alert('', t('plan.confirmRemoveDay'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.remove'),
        style: 'destructive',
        onPress: () => withDb((db) => removePlanDay(db, dayId)),
      },
    ]);
  };

  const submitPrompt = (value: string) => {
    const current = prompt;
    setPrompt(null);
    if (!current) return;

    if (current.kind === 'plan-name') {
      const planId = detail.plan?.id;
      // A plan with no name at all has nothing to show in the header, so a blank submit is
      // treated as a cancel rather than as clearing the name.
      if (!planId || value === '') return;
      withDb((db) => updatePlan(db, planId, { name: value }));
      return;
    }
    withDb((db) => renamePlanDay(db, current.dayId, value));
  };

  const saveTargets = (targets: PlanTargets) => {
    const row = editing;
    setEditing(null);
    if (!row) return;
    withDb((db) => updatePlanTargets(db, row.id, targets));
  };

  const removeEditing = () => {
    const row = editing;
    setEditing(null);
    if (!row) return;
    withDb((db) => removePlanDayExercise(db, row.id));
  };

  /**
   * Start a plan day, unless a workout is already open.
   *
   * Silently starting a second session would strand the first one unfinished in history, so
   * the check happens here rather than being left to the workouts screen to sort out later.
   */
  const startDay = (dayId: string) => {
    void (async () => {
      const db = await getExecutor();
      if (await getActiveSession(db)) {
        Alert.alert('', t('plan.activeWarning'));
        return;
      }
      const sessionId = await startSessionFromPlanDay(db, newId, dayId);
      if (!sessionId) return;
      await reload();
      router.push('/(tabs)/workouts');
    })();
  };

  /* ---------------------------------------------------------------- render */

  if (loading) {
    return (
      <View style={[styles.centered, { paddingTop: insets.top + spacing.xxl }]}>
        <Text style={styles.muted}>{t('common.loading')}</Text>
      </View>
    );
  }

  const contentPadding = {
    paddingTop: insets.top + spacing.lg,
    paddingBottom: insets.bottom + spacing.xxxl,
  };

  if (!detail.plan) {
    return (
      <ScrollView style={styles.screen} contentContainerStyle={[styles.content, contentPadding]}>
        <ScreenTitle>{t('plan.title')}</ScreenTitle>
        <EmptyState emoji="🗓️" title={t('plan.empty')} hint={t('plan.emptyHint')} />
        <Button label={t('plan.create')} onPress={create} />
      </ScrollView>
    );
  }

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[styles.content, contentPadding]}
      keyboardShouldPersistTaps="handled"
    >
      <ScreenTitle>{t('plan.title')}</ScreenTitle>

      <Animated.View
        style={styles.planHeader}
        entering={FadeIn.duration(240)}
        layout={LinearTransition}
      >
        <Pressable
          onPress={() => setPrompt({ kind: 'plan-name', initial: detail.plan?.name ?? '' })}
          accessibilityRole="button"
        >
          <Text style={styles.planName}>{detail.plan.name}</Text>
        </Pressable>
        <Text style={styles.planMeta}>
          {detail.days.length} {t('plan.day')} · {totals.exercises} {t('plan.exercises')}
          {totals.sets > 0 ? ` · ${totals.sets} ${t('plan.weeklySets')}` : ''}
        </Text>
        <Hint>{t('plan.subtitle')}</Hint>
      </Animated.View>

      {detail.days.map((day, index) => (
        <PlanDayCard
          key={day.id}
          day={day}
          index={index}
          expanded={expandedDayId === day.id}
          isNextUp={nextUpDayId === day.id}
          lastTrainedAt={lastTrained[day.id] ?? null}
          exerciseLabel={exerciseLabel}
          // One open day at a time — tapping the open one closes it.
          onToggle={() => setExpandedDayId((current) => (current === day.id ? null : day.id))}
          onStart={() => startDay(day.id)}
          onRename={() => setPrompt({ kind: 'day-name', dayId: day.id, initial: day.name ?? '' })}
          onRemoveDay={() => confirmRemoveDay(day.id)}
          onAddExercise={() =>
            router.push({ pathname: '/exercise-picker', params: { planDayId: day.id } })
          }
          onEditTargets={setEditing}
          onMove={(exercise, direction) =>
            withDb((db) => movePlanDayExercise(db, exercise.id, direction))
          }
        />
      ))}

      <Animated.View layout={LinearTransition}>
        <Pressable onPress={addDay} accessibilityRole="button" style={styles.addDay}>
          <Text style={styles.addDayText}>+ {t('plan.addDay')}</Text>
        </Pressable>

        <Pressable onPress={confirmDeletePlan} accessibilityRole="button" style={styles.deletePlan}>
          <Text style={styles.deletePlanText}>{t('plan.delete')}</Text>
        </Pressable>
      </Animated.View>

      <TargetEditor
        exercise={editing}
        exerciseName={editing ? exerciseLabel(editing.exercise_key) : ''}
        onSave={saveTargets}
        onRemove={removeEditing}
        onCancel={() => setEditing(null)}
      />

      <PromptSheet
        visible={prompt !== null}
        title={prompt?.kind === 'plan-name' ? t('plan.namePrompt') : t('plan.dayNamePrompt')}
        placeholder={prompt?.kind === 'day-name' ? t('plan.dayNamePlaceholder') : undefined}
        initialValue={prompt?.initial ?? ''}
        onSubmit={submitPrompt}
        onCancel={() => setPrompt(null)}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create<{
  screen: ViewStyle;
  content: ViewStyle;
  centered: ViewStyle;
  muted: TextStyle;
  planHeader: ViewStyle;
  planName: TextStyle;
  planMeta: TextStyle;
  addDay: ViewStyle;
  addDayText: TextStyle;
  deletePlan: ViewStyle;
  deletePlanText: TextStyle;
}>({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { paddingHorizontal: spacing.lg },
  centered: { flex: 1, backgroundColor: colors.bg, alignItems: 'center' },
  muted: { color: colors.textMuted, fontSize: fontSize.sm },

  planHeader: { marginBottom: spacing.lg },
  planName: {
    color: colors.text,
    fontSize: fontSize.xl,
    fontWeight: fontWeight.bold,
    textAlign: 'auto',
  },
  planMeta: {
    color: colors.textSecondary,
    fontSize: fontSize.xs,
    marginTop: spacing.xxs,
    marginBottom: spacing.xs,
    textAlign: 'auto',
  },

  addDay: {
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    alignItems: 'center',
  },
  addDayText: { color: colors.text, fontSize: fontSize.sm, fontWeight: fontWeight.bold },
  deletePlan: { alignItems: 'center', paddingVertical: spacing.lg, marginTop: spacing.sm },
  deletePlanText: { color: colors.danger, fontSize: fontSize.xs },
});
