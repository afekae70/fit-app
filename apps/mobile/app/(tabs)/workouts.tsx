/**
 * Active workout screen — the heart of the app.
 *
 * State lives in SQLite, not React: every edit writes through immediately, so closing the app
 * mid-session (or the OS killing it while the phone sits in a pocket between sets) loses
 * nothing. React state is a render cache reloaded from the database after each mutation.
 *
 * The screen is deliberately dumb about set counts. It renders one ExercisePanel per
 * session_exercise row and lets each card manage its own sets — which is what makes 4 sets of
 * chest press and 2 of face pulls fall out naturally rather than needing special handling.
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
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useCurrentUserId } from '../../src/auth/CurrentUserProvider.js';
import type { ExerciseTarget, PreviousSet } from '../../src/components/ExerciseCard.js';
import { FinishSummary } from '../../src/components/FinishSummary.js';
import { DragReorderList } from '../../src/components/DragReorderList.js';
import { KeyboardSafe } from '../../src/components/KeyboardSafe.js';
import { ExercisePanel } from '../../src/components/workout/ExercisePanel.js';
import { EXTEND_SECONDS, RestBanner } from '../../src/components/workout/RestBanner.js';
import { WorkoutHeader } from '../../src/components/workout/WorkoutHeader.js';
import { PrToast, type PrToastData } from '../../src/components/PrToast.js';
import { DEFAULT_REST_SECONDS } from '../../src/workout/derived.js';
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
  markSetDone,
  removeExerciseFromSession,
  removeSet,
  reorderSessionExercise,
  renameSession,
  repeatSession,
  startSession,
  swapSessionExercise,
  updateSet,
  type SessionExerciseWithSets,
  type SessionSummaryRow,
  type SetInput,
} from '../../src/db/workouts.js';
import { hapticLight, hapticSuccess } from '../../src/haptics.js';
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
  const params = useLocalSearchParams<{
    addExercise?: string;
    sessionId?: string;
    swapExerciseId?: string;
  }>();
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
  // Held as an absolute deadline, not a countdown — see RestBanner for why a tick counter drifts
  // and stalls when the phone sleeps mid-set.
  const [rest, setRest] = useState<{ deadline: number; total: number } | null>(null);
  // A set that already triggered a celebration stays quiet on further edits this session —
  // otherwise nudging the same field twice (even to the same value) would re-fire the toast.
  const celebratedSetIds = useRef<Set<string>>(new Set());

  /** Refresh the idle-state lists (templates + history). */
  const reloadHome = useCallback(async () => {
    const db = await getExecutor();
    setTemplates((await listNamedTemplates(db, userId)));
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

  /*
   * On focus, pick up whatever happened while this tab was in the background.
   *
   * Two different things arrive here. A session may have been STARTED elsewhere — the Today
   * card and the Plan screen both create one and then navigate here — and a session may have
   * been DELETED on the detail screen, which sits above this tab.
   *
   * Checking for an active session is the half that was missing. Tabs stay mounted, and the
   * resume logic below runs only on mount, so a session created after that was never adopted:
   * the tab kept showing the idle home list with the freshly created workout sitting in its
   * history, which reads as Start having opened and immediately closed a workout.
   *
   * Skipped entirely while a session is already on screen — the user is typing into it, and the
   * detours that happen then (the exercise picker) reload it themselves.
   */
  useFocusEffect(
    useCallback(() => {
      if (sessionId) return;
      let cancelled = false;
      void (async () => {
        const db = await getExecutor();
        const active = await getActiveSession(db, userId);
        if (cancelled) return;

        if (active) {
          setSessionId(active.id);
          await reload(active.id);
          return;
        }
        await reloadHome();
      })();
      return () => {
        cancelled = true;
      };
    }, [sessionId, userId, reload, reloadHome]),
  );

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
    // `userId` is covered transitively: both callbacks are memoised on it, so a change of
    // account already produces new identities here and re-runs this effect. The rule cannot see
    // through a useCallback to know that.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reload, reloadHome]);


  /*
   * The picker navigates back with an exercise name in params, and possibly the id of an
   * exercise to replace.
   *
   * The ref guards against the effect re-firing on an unrelated re-render and acting twice. It
   * keys on the id as well as the name, because swapping an exercise for one already used
   * elsewhere in the session is ordinary, and a name-only guard would silently ignore it.
   */
  const handledParam = useRef<string | null>(null);
  useEffect(() => {
    const key = params.addExercise;
    const swapId = params.swapExerciseId || null;
    if (!key || !sessionId) return;

    const token = `${swapId ?? 'add'}:${key}`;
    if (handledParam.current === token) return;
    handledParam.current = token;

    void (async () => {
      const db = await getExecutor();
      if (swapId) {
        await swapSessionExercise(db, newId, swapId, key);
      } else {
        const exerciseId = await addExerciseToSession(db, newId, sessionId, key);
        // Seed one blank set: an exercise with zero sets is never what the user wanted, and it
        // saves a tap on the overwhelmingly common path.
        await addSetCopyingPrevious(db, newId, exerciseId);
      }
      await reload(sessionId);
      router.setParams({ addExercise: '', swapExerciseId: '' });
    })();
  }, [params.addExercise, params.swapExerciseId, sessionId, reload]);

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
    setRest(null);
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

  const toggleDone = useCallback(
    (setId: string, done: boolean) => {
      if (done) hapticLight();
      void (async () => {
        const db = await getExecutor();
        await markSetDone(db, setId, done);
        if (sessionId) await reload(sessionId);
      })();
      // Only ticking starts a rest; unticking a set is a correction, not the end of a set.
      setRest(
        done
          ? { deadline: Date.now() + DEFAULT_REST_SECONDS * 1000, total: DEFAULT_REST_SECONDS }
          : null,
      );
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
    // Typed as SetInput, not Record<string, …>. A loose index signature is what let
    // `{ weight_kg: … }` compile here while updateSet reads `weightKg` — the write was silently
    // dropped and the weight simply never changed on screen.
    (setId: string, patch: SetInput) => {
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

  /**
   * Move an exercise one place up or down the running session.
   *
   * Reorders this workout only. The plan it came from is left alone on purpose: swapping two
   * lifts because a rack is busy today should not rewrite what you intend to do every week.
   */
  const moveExercise = useCallback(
    (fromIndex: number, toIndex: number) => {
      const exercise = exercises[fromIndex];
      if (!sessionId || !exercise) return;
      void hapticSuccess();
      void (async () => {
        const db = await getExecutor();
        await reorderSessionExercise(db, sessionId, exercise.id, toIndex);
        await reload(sessionId);
      })();
    },
    [sessionId, exercises, reload],
  );

  /*
   * Scrolling is frozen while a card is in the air, and driven from the drag instead.
   *
   * Both halves are needed. Leaving the ScrollView live means the list slides under a card that
   * is already following the finger, and the two motions add up to something nobody aimed. But
   * only a couple of exercise cards fit on screen at once, so with no scrolling at all a card
   * could never reach a position that is currently off screen — which is most of them.
   */
  const [dragging, setDragging] = useState(false);
  const scrollRef = useRef<ScrollView | null>(null);
  const scrollY = useRef(0);
  const viewportHeight = useRef(0);

  const autoScroll = useCallback((screenY: number) => {
    const height = viewportHeight.current;
    if (height <= 0) return;

    // A band at each edge, and a speed that grows the deeper into it the finger goes — a fixed
    // step is either too slow to be worth it or too fast to aim with.
    const EDGE = 110;
    // Halved from the first attempt, which overshot: the list ran away faster than the eye
    // could pick a landing spot, so aiming meant backing off the edge and creeping in again.
    const MAX_STEP = 11;
    const fromTop = screenY - EDGE;
    const fromBottom = screenY - (height - EDGE);

    let step = 0;
    if (fromTop < 0) step = Math.max(-MAX_STEP, (fromTop / EDGE) * MAX_STEP);
    else if (fromBottom > 0) step = Math.min(MAX_STEP, (fromBottom / EDGE) * MAX_STEP);
    if (step === 0) return;

    scrollY.current = Math.max(0, scrollY.current + step);
    scrollRef.current?.scrollTo({ y: scrollY.current, animated: false });
  }, []);

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

  /**
   * The exercise menu: swap it out, or take it out.
   *
   * Both live behind one button because they answer the same question — this exercise is not
   * what is happening — differently. Swapping leads: it is the one that keeps the work, and the
   * one someone mid-workout is far more likely to want.
   */
  const openExerciseOptions = useCallback(
    (sessionExerciseId: string, exerciseLabel: string) => {
      Alert.alert(exerciseLabel, undefined, [
        {
          text: t('workout.swapExercise'),
          onPress: () =>
            router.push({
              pathname: '/exercise-picker',
              params: { sessionId, swapExerciseId: sessionExerciseId },
            }),
        },
        {
          text: t('workout.removeExercise'),
          style: 'destructive',
          onPress: () => dropExercise(sessionExerciseId),
        },
        { text: t('common.cancel'), style: 'cancel' },
      ]);
    },
    [sessionId, t, dropExercise],
  );

  const totals = useMemo(() => {
    let sets = 0;
    let volume = 0;
    // The rail counts sets the user actually ticked off — the design's checkmark — rather than
    // sets with numbers in them, which exist from the moment a row is added.
    let done = 0;
    for (const exercise of exercises) {
      for (const set of exercise.sets) {
        if (set.is_warmup === 1) continue;
        sets += 1;
        volume += (set.weight_kg ?? 0) * (set.reps ?? 0);
        if (set.done_at !== null) done += 1;
      }
    }
    return { sets, volume, done };
  }, [exercises]);

  /** The first set still untouched, as "Exercise · set N" — the prototype's `nextSetLabel`. */
  const nextSetLabel = useMemo(() => {
    for (const exercise of exercises) {
      const index = exercise.sets.findIndex((set) => set.done_at === null);
      if (index >= 0) {
        const seed = EXERCISE_BY_KEY.get(exercise.exercise_key);
        const name = seed ? (isHebrew ? seed.nameHe : seed.nameEn) : exercise.exercise_key;
        return `${name} · ${t('workout.setNumber')} ${index + 1}`;
      }
    }
    return t('workout.restAllDone');
  }, [exercises, isHebrew, t]);

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
    <KeyboardSafe style={[styles.screen, { paddingTop: insets.top + spacing.md }]}>
      <WorkoutHeader
        name={sessionName ?? t('workout.activeTitle')}
        doneSets={totals.done}
        totalSets={totals.sets}
        startedAt={startedAt ?? new Date().toISOString()}
        progress={totals.sets === 0 ? 0 : totals.done / totals.sets}
      />

      <PrToast data={prToast} onDone={() => setPrToast(null)} />

      <RestBanner
        deadline={rest?.deadline ?? null}
        totalSeconds={rest?.total ?? DEFAULT_REST_SECONDS}
        nextLabel={nextSetLabel}
        onExtend={() =>
          setRest((current) =>
            current
              ? {
                  deadline: current.deadline + EXTEND_SECONDS * 1000,
                  total: current.total + EXTEND_SECONDS,
                }
              : current,
          )
        }
        onSkip={() => setRest(null)}
        onComplete={() => setRest(null)}
      />

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
        ref={scrollRef}
        contentContainerStyle={{ paddingBottom: insets.bottom + spacing.xxl }}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        scrollEnabled={!dragging}
        scrollEventThrottle={16}
        onScroll={(event) => {
          scrollY.current = event.nativeEvent.contentOffset.y;
        }}
        onLayout={(event) => {
          viewportHeight.current = event.nativeEvent.layout.height;
        }}
      >
        {exercises.length === 0 ? (
          <EmptyState emoji="➕" title={t('workout.noExercises')} hint={t('workout.noExercisesHint')} />
        ) : (
          <DragReorderList
            data={exercises}
            keyExtractor={(exercise) => exercise.id}
            onReorder={moveExercise}
            onDragStateChange={setDragging}
            onDragMove={autoScroll}
            renderItem={(exercise, _index, dragHandle) => {
              const seed = EXERCISE_BY_KEY.get(exercise.exercise_key);
              if (!seed) return null;
              const prescription = targets[exercise.exercise_key] ?? null;
              return (
                <ExercisePanel
                  name={seed.nameHe}
                  // The panel works in positions; the repository works in row ids. Mapped here
                  // rather than pushing ids into the component, so the card stays a view of a
                  // list and knows nothing about how the rows are stored.
                  sets={exercise.sets.map((set) => ({
                    weightKg: set.weight_kg,
                    reps: set.reps,
                    done: set.done_at !== null,
                  }))}
                  previous={
                    previous[exercise.exercise_key]?.map((p) => ({
                      weightKg: p.weight_kg,
                      reps: p.reps,
                    })) ?? null
                  }
                  target={
                    prescription
                      ? {
                          sets: prescription.target_sets,
                          repsMin: prescription.target_reps_min,
                          repsMax: prescription.target_reps_max,
                        }
                      : null
                  }
                  onChangeWeight={(i, next) => {
                    const set = exercise.sets[i];
                    if (set) patchSet(set.id, { weightKg: next });
                  }}
                  onChangeReps={(i, next) => {
                    const set = exercise.sets[i];
                    if (set) patchSet(set.id, { reps: next });
                  }}
                  onToggle={(i) => {
                    const set = exercise.sets[i];
                    // The panel exposes a toggle; the repository wants the state to move to. The
                    // flip happens here so the card never has to know the current value twice.
                    if (set) toggleDone(set.id, set.done_at === null);
                  }}
                  onAddSet={() => addSet(exercise.id)}
                  onRemoveSet={(i) => {
                    const set = exercise.sets[i];
                    if (set) deleteSet(set.id);
                  }}
                  onOptions={() => openExerciseOptions(exercise.id, seed.nameHe)}
                  dragHandle={dragHandle}
                  onBarbell={seed.equipmentSlug === 'barbell'}
                />
              );
            }}
          />
        )}

        <Pressable
          onPress={() => router.push({ pathname: '/exercise-picker', params: { sessionId } })}
          style={styles.addExercise}
          accessibilityRole="button"
        >
          <Text style={styles.addExerciseText}>+ {t('workout.addExercise')}</Text>
        </Pressable>

        {/* Finishing lives at the end of the sets, not under the header. It is the last thing
            you do, and at the top it sat directly under the progress bar where a mis-tap ends
            the workout. Scrolled rather than pinned: RestBanner owns the bottom of the screen
            while resting, and two bars competing for that strip is worse than one scroll. */}
        <Pressable
          onPress={() => setSummaryOpen(true)}
          style={styles.finishButton}
          accessibilityRole="button"
        >
          <Text style={styles.finishButtonText}>{t('workout.finishButton')}</Text>
        </Pressable>
      </ScrollView>
    </KeyboardSafe>
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
    marginTop: spacing.lg,
    borderWidth: 1,
    borderColor: colors.accentBorder,
    backgroundColor: colors.accentSoft,
    borderRadius: radius.pill,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    alignItems: 'center',
  },
  finishButtonText: { color: colors.accent, fontSize: fontSize.md, fontWeight: '700' },
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
