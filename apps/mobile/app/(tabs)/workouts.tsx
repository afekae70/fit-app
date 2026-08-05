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

import { useCurrentUserId } from '../../src/auth/CurrentUserProvider.js';
import {
  ExerciseCard,
  type ExerciseTarget,
  type PreviousSet,
} from '../../src/components/ExerciseCard.js';
import { FinishSummary } from '../../src/components/FinishSummary.js';
import { PrToast, type PrToastData } from '../../src/components/PrToast.js';
import { EmptyState, SkeletonScreen } from '../../src/components/ui.js';
import { WorkoutHome, type TemplateEntry } from '../../src/components/WorkoutHome.js';
import { listPlanDayExercises } from '../../src/db/plans.js';
import { getExecutor, newId } from '../../src/db/provider.js';
import { checkHealthAvailability, importForSession, requestHealthPermissions } from '../../src/health/reader.js';
import {
  addExerciseToSession,
  addSetCopyingPrevious,
  finishSession,
  getActiveSession,
  getPreviousBest,
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
import { hapticSuccess } from '../../src/haptics.js';
import { useTheme } from '../../src/ThemeProvider.js';
import { fontSize, radius, spacing, type ColorPalette } from '../../src/theme.js';

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
  const { t, i18n } = useTranslation();
  const isHebrew = i18n.language === 'he';
  const insets = useSafeAreaInsets();
  const userId = useCurrentUserId();
  const params = useLocalSearchParams<{ addExercise?: string; sessionId?: string }>();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const [sessionId, setSessionId] = useState<string | null>(null);
  const [startedAt, setStartedAt] = useState<string | null>(null);
  const [exercises, setExercises] = useState<SessionExerciseWithSets[]>([]);
  const [watchAvailable, setWatchAvailable] = useState(false);
  const [watchDuration, setWatchDuration] = useState<number | null>(null);
  const [targets, setTargets] = useState<Record<string, ExerciseTarget>>({});
  const [previous, setPrevious] = useState<Record<string, PreviousSet[] | null>>(
    {},
  );
  const [loading, setLoading] = useState(true);
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [sessionName, setSessionName] = useState<string | null>(null);
  const [templates, setTemplates] = useState<TemplateEntry[]>([]);
  const [history, setHistory] = useState<SessionSummaryRow[]>([]);
  const [prToast, setPrToast] = useState<PrToastData | null>(null);
  // A set that already triggered a celebration stays quiet on further edits this session —
  // otherwise nudging the same field twice (even to the same value) would re-fire the toast.
  const celebratedSetIds = useRef<Set<string>>(new Set());

  /** Refresh the idle-state lists (templates + history). */
  const reloadHome = useCallback(async () => {
    const db = await getExecutor();
    setTemplates((await listNamedTemplates(db, userId)) as TemplateEntry[]);
    setHistory(await listSessionSummaries(db, userId, 50));
  }, [userId]);

  const [homeRefreshing, setHomeRefreshing] = useState(false);
  const handleHomeRefresh = useCallback(() => {
    setHomeRefreshing(true);
    void reloadHome().finally(() => setHomeRefreshing(false));
  }, [reloadHome]);

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
      const sets = await getPreviousSessionSets(db, userId, exercise.exercise_key, id);
      nextPrevious[exercise.exercise_key] = sets.length > 0 ? sets : null;
    }
    setPrevious(nextPrevious);

    // Targets exist only for a session started from a plan day. A freestyle session leaves this
    // empty and the cards simply show no target badge.
    const nextTargets: Record<string, ExerciseTarget> = {};
    if (session?.plan_day_id) {
      for (const prescription of await listPlanDayExercises(db, session.plan_day_id)) {
        nextTargets[prescription.exercise_key] = {
          target_sets: prescription.target_sets,
          target_reps_min: prescription.target_reps_min,
          target_reps_max: prescription.target_reps_max,
        };
      }
    }
    setTargets(nextTargets);
    return loaded;
  }, [userId]);

  // Resume whatever session was left open — being backgrounded mid-workout is the normal
  // case here, not an edge case.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const db = await getExecutor();
      const active = await getActiveSession(db, userId);
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
    const id = await startSession(db, userId, newId);
    setSessionId(id);
    handledParam.current = null;
    celebratedSetIds.current.clear();
    await reload(id);
  };

  /** Clone a previous session's structure — same exercises and set counts, all values blank. */
  const useTemplate = (sourceSessionId: string) => {
    void (async () => {
      const db = await getExecutor();
      const id = await repeatSession(db, userId, newId, sourceSessionId);
      if (!id) return;
      setSessionId(id);
      handledParam.current = null;
      celebratedSetIds.current.clear();
      await reload(id);
    })();
  };

  const closeOut = useCallback(async () => {
    setSessionId(null);
    setStartedAt(null);
    setSessionName(null);
    setExercises([]);
    handledParam.current = null;
    celebratedSetIds.current.clear();
    setPrToast(null);
    await reloadHome();
  }, [reloadHome]);

  // Whether the watch can be read at all. Checked once on mount: it depends on the build and on
  // Health Connect being installed, neither of which changes while the app is open.
  useEffect(() => {
    void (async () => {
      setWatchAvailable((await checkHealthAvailability()).available);
    })();
  }, []);

  /**
   * Pull duration and heart rate from the watch for the session being finished.
   *
   * Only the duration is adopted, and only as a display value in the summary — the watch is a
   * better clock than the app (it was started at the first rep, not when the screen was opened),
   * but it is not authoritative about what was lifted. Nothing here touches a `sets` row.
   */
  const importFromWatch = useCallback(() => {
    if (!startedAt) return;
    void (async () => {
      await requestHealthPermissions();
      const imported = await importForSession({
        startedAt,
        endedAt: new Date().toISOString(),
      });
      setWatchDuration(imported?.durationMinutes ?? null);
    })();
  }, [startedAt]);

  /** Confirm through the summary sheet — the name is captured in the same step. */
  const confirmFinish = (name: string | null) => {
    if (!sessionId) return;
    void (async () => {
      const db = await getExecutor();
      if (name !== null) await renameSession(db, userId, sessionId, name);
      await finishSession(db, userId, sessionId);
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
        if (!sessionId) return;
        const loaded = await reload(sessionId);

        // Only a weight/reps edit on a working set can be a PR — skip the warmup toggle, set
        // add/remove, and edits already celebrated once this session.
        if (typeof patch.weightKg !== 'number' && typeof patch.reps !== 'number') return;
        const exercise = loaded.find((ex) => ex.sets.some((s) => s.id === setId));
        const set = exercise?.sets.find((s) => s.id === setId);
        if (
          !exercise ||
          !set ||
          set.is_warmup === 1 ||
          set.weight_kg === null ||
          set.reps === null ||
          celebratedSetIds.current.has(setId)
        ) {
          return;
        }

        const best = await getPreviousBest(db, userId, exercise.exercise_key, sessionId);
        const isPr =
          !best || set.weight_kg > best.weight_kg || (set.weight_kg === best.weight_kg && set.reps > best.reps);
        if (!isPr) return;

        celebratedSetIds.current.add(setId);
        hapticSuccess();
        const seed = EXERCISE_BY_KEY.get(exercise.exercise_key);
        setPrToast({
          exerciseLabel: seed ? (isHebrew ? seed.nameHe : seed.nameEn) : exercise.exercise_key,
          weightKg: set.weight_kg,
          reps: set.reps,
        });
      })();
    },
    [sessionId, reload, userId, isHebrew],
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
    // "Filled in" is what the progress bar counts. A set row exists from the moment it is added,
    // so counting rows would show a full bar before a single rep was performed; a set with both
    // numbers entered is the closest thing to "done" that needs no schema change.
    let done = 0;
    for (const exercise of exercises) {
      for (const set of exercise.sets) {
        if (set.is_warmup === 1) continue;
        sets += 1;
        volume += (set.weight_kg ?? 0) * (set.reps ?? 0);
        if (set.weight_kg !== null && set.reps !== null) done += 1;
      }
    }
    return { sets, volume, done };
  }, [exercises]);

  if (loading) {
    return <SkeletonScreen paddingTop={insets.top + spacing.md} />;
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
        refreshing={homeRefreshing}
        onRefresh={handleHomeRefresh}
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
          {/* Progress, not a clock. The Nocturne prototype puts a running elapsed time here; it
              is deliberately still absent — a ticking timer pressures people to cut rest short,
              which is why it was removed in the first place (see CLAUDE.md). Sets completed is
              the same reassurance without the pressure. */}
          <Text style={styles.topSub}>
            {t('workout.setsProgress', { done: totals.done, total: totals.sets })}
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

      {totals.sets > 0 ? (
        <View style={styles.progressTrack}>
          <View
            style={[
              styles.progressFill,
              { width: `${Math.round((totals.done / totals.sets) * 100)}%` },
            ]}
          />
        </View>
      ) : null}

      <PrToast data={prToast} onDone={() => setPrToast(null)} />

      <FinishSummary
        visible={summaryOpen}
        // The watch's duration wins when imported: it was started at the first rep rather than
        // whenever this screen happened to be opened.
        durationMinutes={
          watchDuration ?? (startedAt ? elapsedMinutes(startedAt, Date.now()) : 0)
        }
        exerciseCount={exercises.length}
        setCount={totals.sets}
        volumeKg={totals.volume}
        initialName={sessionName}
        watchAvailable={watchAvailable}
        onImportFromWatch={importFromWatch}
        onConfirm={confirmFinish}
        onCancel={() => setSummaryOpen(false)}
      />

      <ScrollView
        contentContainerStyle={{ paddingBottom: insets.bottom + spacing.xxl }}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
      >
        {exercises.length === 0 ? (
          <EmptyState emoji="➕" title={t('workout.noExercises')} hint={t('workout.noExercisesHint')} />
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
                target={targets[exercise.exercise_key] ?? null}
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

const createStyles = (colors: ColorPalette) =>
  StyleSheet.create<{
    screen: ViewStyle;
    topBar: ViewStyle;
    topMain: ViewStyle;
    sessionName: TextStyle;
    elapsed: TextStyle;
    topSub: TextStyle;
    progressTrack: ViewStyle;
    progressFill: ViewStyle;
    finishButton: ViewStyle;
    finishButtonText: TextStyle;
    addExercise: ViewStyle;
    addExerciseText: TextStyle;
  }>({
  screen: { flex: 1, backgroundColor: colors.bg, paddingHorizontal: spacing.lg },
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
  // 4px rail, matching the prototype's sticky header. `sunk` there is the app background, so
  // the unfilled portion reads as a groove rather than another surface.
  progressTrack: {
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
    marginBottom: spacing.md,
  },
  progressFill: { height: '100%', backgroundColor: colors.accent, borderRadius: 2 },
  finishButton: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.pill,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
  },
  finishButtonText: { color: colors.text, fontSize: fontSize.sm, fontWeight: '700' },
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
