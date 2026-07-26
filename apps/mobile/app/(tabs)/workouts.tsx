/**
 * Active workout screen — the heart of the app.
 *
 * State lives in SQLite, not React: every edit writes through immediately, so closing the app
 * mid-session (or the OS killing it while the phone sits in a pocket between sets) loses
 * nothing. React state is a render cache reloaded from the database after each mutation.
 *
 * The screen is deliberately dumb about set counts. It renders one ExerciseCard per
 * session_exercise row and lets each card manage its own sets — which is what makes 4 sets of
 * chest press and 2 of face pulls fall out naturally rather than needing special handling.
 */

import { EXERCISE_SEED, type ExerciseSeed } from '@fit/shared/catalog';
import { router, useLocalSearchParams } from 'expo-router';
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
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ExerciseCard, type PreviousSet } from '../../src/components/ExerciseCard.js';
import { FinishSummary } from '../../src/components/FinishSummary.js';
import { WorkoutHome, type TemplateEntry } from '../../src/components/WorkoutHome.js';
import { getExecutor, newId } from '../../src/db/provider.js';
import {
  addExerciseToSession,
  addSetCopyingPrevious,
  finishSession,
  getActiveSession,
  getPreviousSessionSets,
  getSessionDetail,
  listNamedTemplates,
  listSessionSummaries,
  removeExerciseFromSession,
  removeSet,
  renameSession,
  repeatSession,
  startSession,
  updateSet,
  type SessionExerciseWithSets,
  type SessionSummaryRow,
} from '../../src/db/workouts.js';
import { colors, fontSize, radius, spacing } from '../../src/theme.js';

const EXERCISE_BY_KEY = new Map<string, ExerciseSeed>(
  EXERCISE_SEED.map((exercise) => [exercise.nameEn, exercise]),
);

/**
 * Whole minutes elapsed. Reported once, at the end.
 *
 * The screen deliberately does NOT show a running clock: a timer ticking through every set
 * pressures the user to cut rest short, which is the opposite of useful. Total duration is
 * genuinely interesting afterwards, so it surfaces in the finish summary instead.
 */
function elapsedMinutes(startedAt: string, endMs: number): number {
  return Math.max(0, Math.round((endMs - new Date(startedAt).getTime()) / 60000));
}

export default function WorkoutsScreen() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ addExercise?: string; sessionId?: string }>();

  const [sessionId, setSessionId] = useState<string | null>(null);
  const [startedAt, setStartedAt] = useState<string | null>(null);
  const [exercises, setExercises] = useState<SessionExerciseWithSets[]>([]);
  const [previous, setPrevious] = useState<Record<string, PreviousSet[] | null>>(
    {},
  );
  const [loading, setLoading] = useState(true);
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [sessionName, setSessionName] = useState<string | null>(null);
  const [templates, setTemplates] = useState<TemplateEntry[]>([]);
  const [history, setHistory] = useState<SessionSummaryRow[]>([]);

  /** Refresh the idle-state lists (templates + history). */
  const reloadHome = useCallback(async () => {
    const db = await getExecutor();
    setTemplates((await listNamedTemplates(db)) as TemplateEntry[]);
    setHistory(await listSessionSummaries(db, 50));
  }, []);

  /** Reload the session from SQLite — the database is the source of truth, not component state. */
  const reload = useCallback(async (id: string) => {
    const db = await getExecutor();
    const { session, exercises: loaded } = await getSessionDetail(db, id);
    setExercises(loaded);
    setStartedAt(session?.started_at ?? null);
    setSessionName(session?.name ?? null);

    // Excluding the current session matters: without it, the sets being typed right now would
    // come back as their own "last time" the instant they are saved.
    const nextPrevious: Record<string, PreviousSet[] | null> = {};
    for (const exercise of loaded) {
      const sets = await getPreviousSessionSets(db, exercise.exercise_key, id);
      nextPrevious[exercise.exercise_key] = sets.length > 0 ? sets : null;
    }
    setPrevious(nextPrevious);
  }, []);

  // Resume whatever session was left open — being backgrounded mid-workout is the normal
  // case here, not an edge case.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const db = await getExecutor();
      const active = await getActiveSession(db);
      if (cancelled) return;
      if (active) {
        setSessionId(active.id);
        await reload(active.id);
      } else {
        await reloadHome();
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [reload, reloadHome]);


  // The picker navigates back with an exercise name in params. The ref guards against the
  // effect re-firing on an unrelated re-render and adding the same exercise twice.
  const handledParam = useRef<string | null>(null);
  useEffect(() => {
    const key = params.addExercise;
    if (!key || !sessionId || handledParam.current === key) return;
    handledParam.current = key;
    void (async () => {
      const db = await getExecutor();
      const exerciseId = await addExerciseToSession(db, newId, sessionId, key);
      // Seed one blank set: an exercise with zero sets is never what the user wanted, and it
      // saves a tap on the overwhelmingly common path.
      await addSetCopyingPrevious(db, newId, exerciseId);
      await reload(sessionId);
      router.setParams({ addExercise: '' });
    })();
  }, [params.addExercise, sessionId, reload]);

  const begin = async () => {
    const db = await getExecutor();
    const id = await startSession(db, newId);
    setSessionId(id);
    handledParam.current = null;
    await reload(id);
  };

  /** Clone a previous session's structure — same exercises and set counts, all values blank. */
  const useTemplate = (sourceSessionId: string) => {
    void (async () => {
      const db = await getExecutor();
      const id = await repeatSession(db, newId, sourceSessionId);
      if (!id) return;
      setSessionId(id);
      handledParam.current = null;
      await reload(id);
    })();
  };

  const closeOut = useCallback(async () => {
    setSessionId(null);
    setStartedAt(null);
    setSessionName(null);
    setExercises([]);
    handledParam.current = null;
    await reloadHome();
  }, [reloadHome]);

  /** Confirm through the summary sheet — the name is captured in the same step. */
  const confirmFinish = (name: string | null) => {
    if (!sessionId) return;
    void (async () => {
      const db = await getExecutor();
      if (name !== null) await renameSession(db, sessionId, name);
      await finishSession(db, sessionId);
      setSummaryOpen(false);
      await closeOut();
    })();
  };

  const addSet = useCallback(
    (sessionExerciseId: string) => {
      void (async () => {
        const db = await getExecutor();
        await addSetCopyingPrevious(db, newId, sessionExerciseId);
        if (sessionId) await reload(sessionId);
      })();
    },
    [sessionId, reload],
  );

  const deleteSet = useCallback(
    (setId: string) => {
      void (async () => {
        const db = await getExecutor();
        await removeSet(db, setId);
        if (sessionId) await reload(sessionId);
      })();
    },
    [sessionId, reload],
  );

  const patchSet = useCallback(
    (setId: string, patch: Record<string, number | boolean | null>) => {
      void (async () => {
        const db = await getExecutor();
        await updateSet(db, setId, patch);
        if (sessionId) await reload(sessionId);
      })();
    },
    [sessionId, reload],
  );

  const dropExercise = useCallback(
    (sessionExerciseId: string) => {
      Alert.alert('', t('workout.confirmRemoveExercise'), [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('common.remove'),
          style: 'destructive',
          onPress: () => {
            void (async () => {
              const db = await getExecutor();
              await removeExerciseFromSession(db, sessionExerciseId);
              if (sessionId) await reload(sessionId);
            })();
          },
        },
      ]);
    },
    [sessionId, reload, t],
  );

  const totals = useMemo(() => {
    let sets = 0;
    let volume = 0;
    for (const exercise of exercises) {
      for (const set of exercise.sets) {
        if (set.is_warmup === 1) continue;
        sets += 1;
        volume += (set.weight_kg ?? 0) * (set.reps ?? 0);
      }
    }
    return { sets, volume };
  }, [exercises]);

  if (loading) {
    return (
      <View style={[styles.centered, { paddingTop: insets.top }]}>
        <Text style={styles.muted}>{t('common.loading')}</Text>
      </View>
    );
  }

  if (!sessionId) {
    return (
      <WorkoutHome
        templates={templates}
        history={history}
        onStartEmpty={() => void begin()}
        onUseTemplate={useTemplate}
        onOpenSession={(id) => router.push({ pathname: '/session/[id]', params: { id } })}
        contentPadding={{
          paddingTop: insets.top + spacing.lg,
          paddingBottom: insets.bottom + spacing.xxl,
        }}
      />
    );
  }

  return (
    <View style={[styles.screen, { paddingTop: insets.top + spacing.md }]}>
      <View style={styles.topBar}>
        <View style={styles.topMain}>
          <Text style={styles.sessionName} numberOfLines={1}>
            {sessionName ?? t('workout.activeTitle')}
          </Text>
          {/* Sets and volume only — no running clock. See elapsedMinutes above. */}
          <Text style={styles.topSub}>
            {totals.sets} {t('workout.totalSets')}
            {totals.volume > 0
              ? ` · ${Math.round(totals.volume).toLocaleString()} ${t('common.kg')}`
              : ''}
          </Text>
        </View>
        <Pressable
          onPress={() => setSummaryOpen(true)}
          style={styles.finishButton}
          accessibilityRole="button"
        >
          <Text style={styles.finishButtonText}>{t('workout.finishButton')}</Text>
        </Pressable>
      </View>

      <FinishSummary
        visible={summaryOpen}
        durationMinutes={startedAt ? elapsedMinutes(startedAt, Date.now()) : 0}
        exerciseCount={exercises.length}
        setCount={totals.sets}
        volumeKg={totals.volume}
        initialName={sessionName}
        onConfirm={confirmFinish}
        onCancel={() => setSummaryOpen(false)}
      />

      <ScrollView
        contentContainerStyle={{ paddingBottom: insets.bottom + spacing.xxl }}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
      >
        {exercises.length === 0 ? (
          <View style={styles.emptyBlock}>
            <Text style={styles.emptyTitle}>{t('workout.noExercises')}</Text>
            <Text style={styles.emptyHint}>{t('workout.noExercisesHint')}</Text>
          </View>
        ) : (
          exercises.map((exercise) => {
            const seed = EXERCISE_BY_KEY.get(exercise.exercise_key);
            if (!seed) return null;
            return (
              <ExerciseCard
                key={exercise.id}
                exercise={seed}
                sets={exercise.sets}
                previousSets={previous[exercise.exercise_key] ?? null}
                onAddSet={() => addSet(exercise.id)}
                onRemoveSet={deleteSet}
                onUpdateSet={patchSet}
                onRemoveExercise={() => dropExercise(exercise.id)}
              />
            );
          })
        )}

        <Pressable
          onPress={() => router.push({ pathname: '/exercise-picker', params: { sessionId } })}
          style={styles.addExercise}
          accessibilityRole="button"
        >
          <Text style={styles.addExerciseText}>+ {t('workout.addExercise')}</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create<{
  screen: ViewStyle;
  centered: ViewStyle;
  muted: TextStyle;
  bigEmoji: TextStyle;
  startTitle: TextStyle;
  startSubtitle: TextStyle;
  primaryButton: ViewStyle;
  primaryButtonText: TextStyle;
  topBar: ViewStyle;
  topMain: ViewStyle;
  sessionName: TextStyle;
  elapsed: TextStyle;
  topSub: TextStyle;
  finishButton: ViewStyle;
  finishButtonText: TextStyle;
  emptyBlock: ViewStyle;
  emptyTitle: TextStyle;
  emptyHint: TextStyle;
  addExercise: ViewStyle;
  addExerciseText: TextStyle;
}>({
  screen: { flex: 1, backgroundColor: colors.bg, paddingHorizontal: spacing.lg },
  centered: {
    flex: 1,
    backgroundColor: colors.bg,
    alignItems: 'center',
    paddingHorizontal: spacing.xl,
  },
  muted: { color: colors.textMuted, fontSize: fontSize.sm },
  bigEmoji: { fontSize: 56, marginBottom: spacing.lg },
  startTitle: { color: colors.text, fontSize: fontSize.lg, fontWeight: '700', textAlign: 'center' },
  startSubtitle: {
    color: colors.textMuted,
    fontSize: fontSize.sm,
    textAlign: 'center',
    marginTop: spacing.sm,
    marginBottom: spacing.xl,
  },
  primaryButton: {
    backgroundColor: colors.accentSoft,
    borderWidth: 1,
    borderColor: colors.accent,
    borderRadius: radius.pill,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xxl,
  },
  primaryButtonText: { color: colors.accent, fontSize: fontSize.md, fontWeight: '700' },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
  },
  topMain: { flex: 1, marginEnd: spacing.sm },
  sessionName: {
    color: colors.accent,
    fontSize: fontSize.sm,
    fontWeight: '700',
    textAlign: 'auto',
  },
  elapsed: { color: colors.text, fontSize: fontSize.xl, fontWeight: '800' },
  topSub: { color: colors.textMuted, fontSize: fontSize.xs, textAlign: 'auto' },
  finishButton: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.pill,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
  },
  finishButtonText: { color: colors.text, fontSize: fontSize.sm, fontWeight: '700' },
  emptyBlock: { alignItems: 'center', paddingVertical: spacing.xxl },
  emptyTitle: { color: colors.text, fontSize: fontSize.md },
  emptyHint: { color: colors.textMuted, fontSize: fontSize.sm, marginTop: spacing.xs },
  addExercise: {
    marginTop: spacing.sm,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.accent,
    alignItems: 'center',
  },
  addExerciseText: { color: colors.accent, fontSize: fontSize.md, fontWeight: '700' },
});
