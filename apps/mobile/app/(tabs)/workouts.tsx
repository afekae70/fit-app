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

import {
  OLYMPIC_BAR,
  restAfterWarmup,
  restSecondsFor,
  suggestProgression,
  warmupRamp,
  type ProgressionAdvice,
} from '@fit/shared/calculations';
import { EQUIPMENT_SEED, EXERCISE_SEED, type ExerciseSeed } from '@fit/shared/catalog';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Animated,
  Keyboard,
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useCurrentUserId } from '../../src/auth/CurrentUserProvider.js';
import { useActionSheet } from '../../src/components/ActionSheetProvider.js';
import type { ExerciseTarget, PreviousSet } from '../../src/components/ExerciseCard.js';
import { FinishedBurst } from '../../src/components/workout/FinishedBurst.js';
import { requestBackup } from '../../src/backup/AutoBackup.js';
import * as SecureStore from 'expo-secure-store';


import { DragReorderList, type DragHandleProps } from '../../src/components/DragReorderList.js';
import { KeyboardSafe } from '../../src/components/KeyboardSafe.js';
import { ExerciseVisual } from '../../src/components/ExerciseVisual.js';
import { ExercisePanel } from '../../src/components/workout/ExercisePanel.js';
import { ExerciseStrip } from '../../src/components/workout/ExerciseStrip.js';
import {
  NumberPadSheet,
  type NumberPadRequest,
} from '../../src/components/workout/NumberPadSheet.js';
import { useUnit } from '../../src/UnitsProvider.js';
import {
  displayDistanceToMetres,
  displayWeightToKg,
  distanceUnitKey,
  kgToDisplay,
  metresToDisplay,
  weightUnitKey,
} from '../../src/units.js';
import { IntervalRunner } from '../../src/components/workout/IntervalRunner.js';
import { EXTEND_SECONDS, RestBanner } from '../../src/components/workout/RestBanner.js';
import { WorkoutHeader } from '../../src/components/workout/WorkoutHeader.js';
import { PrToast, type PrToastData } from '../../src/components/PrToast.js';
import {
  DEFAULT_REST_SECONDS,
  firstUnfinishedStation,
  isExerciseDone,
  stations,
  swipeTarget,
} from '../../src/workout/derived.js';
import { Banner, EmptyState, SkeletonScreen } from '../../src/components/ui.js';
import { WorkoutHome } from '../../src/components/WorkoutHome.js';
import {
  DEFAULT_HISTORY_PERIOD,
  periodStart,
  type HistoryPeriod,
} from '../../src/workout/historyPeriod.js';
import { getPlanDay, listPlanDayExercises, timingOf, type PlanDayTiming } from '../../src/db/plans.js';
import { getLatestWeight } from '../../src/db/metrics.js';
import { getExecutor, newId } from '../../src/db/provider.js';
import { isExerciseStalling } from '../../src/db/progression.js';
import { listLocations, setSessionLocation, type LocationRow } from '../../src/db/locations.js';
import { getSessionType, hasType } from '../../src/db/sessionType.js';
import {
  addExerciseToSession,
  addSet as insertSet,
  addSetCopyingPrevious,
  addDropSet,
  addWarmupSets,
  setSupersetLink,
  finishSession,
  getActiveSession,
  getPreviousBest,
  getPreviousSessionSets,
  getSessionDetail,
  listSessionSummaries,
  markSetDone,
  removeExerciseFromSession,
  deleteSession,
  removeSet,
  reorderSessionExercise,
  startSession,
  swapSessionExercise,
  updateSet,
  type SessionExerciseWithSets,
  type SessionSummaryRow,
  type SetInput,
} from '../../src/db/workouts.js';
import { healthExportCopy } from '../../src/health/copy.js';
import { exportSessionToHealth } from '../../src/health/sync.js';
import { hapticLight, hapticRecord, hapticSuccess } from '../../src/haptics.js';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';

import { setWorkoutActive } from '../../src/workout/activeWorkout.js';
import { createLatestOnly } from '../../src/workout/latestOnly.js';
import { syncWorkoutReminders } from '../../src/reminders/sync.js';
import { stationMove } from '../../src/workout/stripReorder.js';
import { useTheme } from '../../src/ThemeProvider.js';
import { fontSize, radius, spacing, type ColorPalette } from '../../src/theme.js';

/** Held while a workout is open — see the effect that takes it. */
const WORKOUT_AWAKE_TAG = 'workout-open';

const EXERCISE_BY_KEY = new Map<string, ExerciseSeed>(
  EXERCISE_SEED.map((exercise) => [exercise.nameEn, exercise]),
);

/**
 * The ratings worth offering. Ten choices in a sheet is a list nobody reads; 6-10 is the span
 * that actually distinguishes one working set from another, and anything easier than 6 is a
 * warm-up, which this app records as a warm-up.
 */
/** Where the focus/list preference is remembered, alongside the app's other settings. */
const FOCUS_KEY = 'workout-focus-mode';

const RPE_CHOICES = [6, 7, 8, 9, 10] as const;

export default function WorkoutsScreen() {
  const { confirm, ask, notify } = useActionSheet();
  const { t, i18n } = useTranslation();
  const isHebrew = i18n.language === 'he';
  const insets = useSafeAreaInsets();
  const unit = useUnit();
  const userId = useCurrentUserId();
  const params = useLocalSearchParams<{
    addExercise?: string;
    sessionId?: string;
    swapExerciseId?: string;
  }>();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const [sessionId, setSessionId] = useState<string | null>(null);
  // Tell the tab swipe a workout is open, so sideways belongs to the exercises until it ends.
  useEffect(() => {
    setWorkoutActive(sessionId !== null);
    /*
     * And keep the screen on for as long as it is.
     *
     * A phone that locks itself ninety seconds into a rest is a phone you unlock with chalk on
     * your hands, and the rest timer it was showing is gone behind a lock screen. Released the
     * moment the workout ends, and on the way out of the screen.
     */
    if (sessionId !== null) void activateKeepAwakeAsync(WORKOUT_AWAKE_TAG).catch(() => undefined);
    else void deactivateKeepAwake(WORKOUT_AWAKE_TAG);
    // And re-lay the reminders: today's is withdrawn while a workout is open, and comes back if
    // the session is abandoned rather than finished.
    void (async () => {
      const db = await getExecutor();
      await syncWorkoutReminders(db, userId, {
        title: t('settings.workoutReminderNotification'),
        channel: t('settings.workoutReminderTitle'),
      });
    })();
    return () => {
      void deactivateKeepAwake(WORKOUT_AWAKE_TAG);
    };
  }, [sessionId, userId, t]);
  const [startedAt, setStartedAt] = useState<string | null>(null);
  const [exercises, setExercises] = useState<SessionExerciseWithSets[]>([]);
  /** Set when this session came from a timed plan day; the screen is then a countdown, not cards. */
  const [timing, setTiming] = useState<PlanDayTiming | null>(null);

  const [targets, setTargets] = useState<Record<string, ExerciseTarget>>({});
  // Keyed by exercise key, like `previous`. Recomputed on reload rather than per render: it is
  // several queries deep and the answer only changes when a session is finished.
  const [stalling, setStalling] = useState<Record<string, boolean>>({});
  // False for a session that is neither planned nor named: there is no other workout of its
  // kind, so every comparison on screen silently widens to all of them. Worth saying out loud
  // rather than letting the numbers quietly mean something else.
  const [typed, setTyped] = useState(true);
  const [gyms, setGyms] = useState<LocationRow[]>([]);
  const [gymId, setGymId] = useState<string | null>(null);
  const [bodyWeightKg, setBodyWeightKg] = useState<number | null>(null);

  /*
   * The sets as they are right now, for the handlers below.
   *
   * A row was drawn from one snapshot and tapped a second later, by which time a reload may have
   * moved on — a warm-up ramp inserted above it, a set added. The id under the finger is the
   * right one; whether it is currently ticked is a question for the live copy, not for the
   * snapshot the row was painted from.
   */
  const liveExercises = useRef<SessionExerciseWithSets[]>([]);
  liveExercises.current = exercises;
  const liveSet = (setId: string) =>
    liveExercises.current.flatMap((e) => e.sets).find((set) => set.id === setId) ?? null;
  const [previous, setPrevious] = useState<Record<string, PreviousSet[] | null>>(
    {},
  );
  const [loading, setLoading] = useState(true);
  /** True from the tap on Finish until the trophy has played out. */
  const [finishing, setFinishing] = useState(false);
  /** What the number pad is currently editing, or null while it is closed. */
  const [pad, setPad] = useState<NumberPadRequest | null>(null);
  const [sessionName, setSessionName] = useState<string | null>(null);
  const [historyPeriod, setHistoryPeriod] = useState<HistoryPeriod>(DEFAULT_HISTORY_PERIOD);
  const [history, setHistory] = useState<SessionSummaryRow[]>([]);
  const [prToast, setPrToast] = useState<PrToastData | null>(null);
  // Held as an absolute deadline, not a countdown — see RestBanner for why a tick counter drifts
  // and stalls when the phone sleeps mid-set.
  /**
   * One station at a time, or the whole list.
   *
   * Remembered between sessions: a display preference that resets every workout is one the user
   * has to set again every workout.
   */
  const [focus, setFocus] = useState(true);
  const [stationIndex, setStationIndex] = useState<number | null>(null);
  const wasStationDone = useRef(false);

  const [rest, setRest] = useState<{ deadline: number; total: number } | null>(null);
  // A set that already triggered a celebration stays quiet on further edits this session —
  // otherwise nudging the same field twice (even to the same value) would re-fire the toast.
  const celebratedSetIds = useRef<Set<string>>(new Set());

  /**
   * Refresh the history list for the chosen period.
   *
   * No fifty-row cap any more: a period is the limit now, and capping a year of training at its
   * latest fifty sessions would quietly cut the year short. The ceiling left is only a guard.
   */
  const reloadHome = useCallback(async () => {
    const db = await getExecutor();
    const start = periodStart(historyPeriod, new Date());
    setHistory(await listSessionSummaries(db, userId, 2000, start?.toISOString()));
  }, [userId, historyPeriod]);

  /*
   * Re-read the history when the period changes.
   *
   * It used to ride on the focus effect, which re-runs when its callback changes and so happened
   * to cover this — except that effect returns immediately while a session is open, and it is
   * doing a different job: adopting a workout started elsewhere. Choosing "last week" and seeing
   * last year is the kind of bug that comes of a side effect being somebody else's.
   */
  useEffect(() => {
    if (sessionId) return;
    void reloadHome();
  }, [historyPeriod, sessionId, reloadHome]);

  const [homeRefreshing, setHomeRefreshing] = useState(false);
  /**
   * Hold a past workout: edit it, or delete it.
   *
   * Tapping one opens it to be read. Both of the things that change it live here, behind a
   * deliberate press — a list of finished sessions is scrolled far more often than it is edited,
   * and a delete that can be reached by a mis-tap on a scroll is a delete that will happen.
   */
  const openSessionOptions = useCallback(
    (id: string) => {
      void (async () => {
        // Headed by the workout's own name: a menu that says only "the workout" is a menu you
        // have to remember which row you held.
        const held = history.find((session) => session.id === id);
        const choice = await ask({
          title: held?.name?.trim() || t('history.unnamed'),
          actions: [{ label: t('history.edit') }, { label: t('history.delete'), destructive: true }],
        });
        if (choice === 0) {
          router.push({ pathname: '/session/[id]', params: { id, mode: 'edit' } });
          return;
        }
        if (choice !== 1) return;
        const ok = await confirm({
          message: t('history.confirmDelete'),
          confirmLabel: t('history.delete'),
        });
        if (!ok) return;
        const db = await getExecutor();
        await deleteSession(db, userId, id);
        await reloadHome();
      })();
    },
    [ask, confirm, t, userId, reloadHome, history],
  );

  const handleHomeRefresh = useCallback(() => {
    setHomeRefreshing(true);
    void reloadHome().finally(() => setHomeRefreshing(false));
  }, [reloadHome]);

  /*
   * Reloads overlap constantly — a tick, a typed number saving, the tab regaining focus — and
   * each is a chain of awaits. Until this, nothing made them land in the order they started, so
   * an older snapshot could arrive last and put the screen back the way it was: tick the second
   * set, watch the first one lose its tick. The data was never wrong; the picture was.
   */
  const latestReload = useRef(createLatestOnly()).current;

  /** Reload the session from SQLite — the database is the source of truth, not component state. */
  const reload = useCallback(async (id: string) => {
    const ticket = latestReload.begin();
    const db = await getExecutor();
    const { session, exercises: loaded } = await getSessionDetail(db, id);
    if (!latestReload.isCurrent(ticket)) return loaded;
    setExercises(loaded);
    setStartedAt(session?.started_at ?? null);
    setSessionName(session?.name ?? null);

    // Excluding the current session matters: without it, the sets being typed right now would
    // come back as their own "last time" the instant they are saved.
    // What kind of workout this is, resolved once. Every "last time" and every stall verdict
    // below is scoped to sessions of the same kind, so a lift done on another gym's machine
    // does not answer for this one.
    const type = await getSessionType(db, id);
    setTyped(hasType(type));
    setGymId(type?.locationId ?? null);
    setGyms(await listLocations(db, userId));
    // The latest weigh-in, which is half of the calorie estimate on a cardio effort.
    setBodyWeightKg((await getLatestWeight(db, userId))?.weight_kg ?? null);

    const nextPrevious: Record<string, PreviousSet[] | null> = {};
    const nextStalling: Record<string, boolean> = {};
    for (const exercise of loaded) {
      const sets = await getPreviousSessionSets(db, userId, exercise.exercise_key, id, type);
      nextPrevious[exercise.exercise_key] = sets.length > 0 ? sets : null;
      // Same exclusion, same reason: today's half-finished sets must not be weighed against
      // themselves when deciding whether this lift has stopped moving.
      nextStalling[exercise.exercise_key] = await isExerciseStalling(
        db,
        userId,
        exercise.exercise_key,
        id,
        type,
      );
    }
    if (!latestReload.isCurrent(ticket)) return loaded;
    setPrevious(nextPrevious);
    setStalling(nextStalling);

    // Targets exist only for a session started from a plan day. A freestyle session leaves this
    // empty and the cards simply show no target badge.
    const nextTargets: Record<string, ExerciseTarget> = {};
    // Read from the plan day each time rather than copied onto the session: changing a day's
    // timing between workouts should change the next one, and there is nothing to migrate when
    // it does.
    const planDay = session?.plan_day_id ? await getPlanDay(db, session.plan_day_id) : null;
    setTiming(planDay ? timingOf(planDay) : null);
    if (session?.plan_day_id) {
      for (const prescription of await listPlanDayExercises(db, session.plan_day_id)) {
        nextTargets[prescription.exercise_key] = {
          target_sets: prescription.target_sets,
          target_reps_min: prescription.target_reps_min,
          target_reps_max: prescription.target_reps_max,
        };
      }
    }
    if (!latestReload.isCurrent(ticket)) return loaded;
    setTargets(nextTargets);
    return loaded;
  }, [userId, latestReload]);

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

  /**
   * Finish, and save without asking.
   *
   * There used to be a sheet here: save or cancel, a name, an effort rating. Nobody cancels a
   * workout they just did, and both the name and the rating can be set afterwards from the
   * session itself — three questions between the last set and the feeling of having finished.
   * The session is written here, and `FinishedBurst` plays over it while the screen moves on.
   */
  const finishNow = () => {
    if (!sessionId || finishing) return;
    setFinishing(true);
    void (async () => {
      const db = await getExecutor();
      await finishSession(db, userId, sessionId, { sessionRpe: null });
      void hapticSuccess();
      // Out to Health Connect, and from there into Samsung Health and anything else reading it.
      // Deliberately unawaited and allowed to fail: the workout is saved either way, and the
      // trophy is not the place to find out that another app was not listening.
      void exportSessionToHealth(db, userId, sessionId, healthExportCopy(t)).catch(() => undefined);
      // The moment worth protecting: new data exists that did not a minute ago.
      void requestBackup(userId, { afterWorkout: true });
    })();
  };

  /** The trophy has had its couple of seconds; leave the session behind. */
  const finishDone = useCallback(() => {
    setFinishing(false);
    void closeOut();
  }, [closeOut]);

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
      // How long depends on what was just lifted. Ninety seconds after everything was too little
      // after squats and nearly double what a curl needs, so it was wrong nearly always, in both
      // directions at once.
      const owner = exercises.find((ex) => ex.sets.some((s) => s.id === setId));
      const set = owner?.sets.find((s) => s.id === setId);
      const seed = owner ? EXERCISE_BY_KEY.get(owner.exercise_key) : undefined;
      // Inside a superset the next exercise is the rest — stopping to watch a timer between the
      // two halves is the one thing a superset exists to avoid. Rest comes after the last member.
      const insideSuperset = owner?.superset_with_next === 1;
      // A drop set follows immediately, lighter — waiting between the two is the one thing a
      // drop set exists to avoid, exactly as with a superset one level up.
      const position = owner?.sets.findIndex((s) => s.id === setId) ?? -1;
      const nextIsDrop = position >= 0 && owner?.sets[position + 1]?.is_drop === 1;
      const seconds = insideSuperset || nextIsDrop
        ? 0
        : set?.is_warmup === 1
          ? restAfterWarmup()
          : restSecondsFor(seed?.movementPattern);

      // Only ticking starts a rest; unticking a set is a correction, not the end of a set.
      setRest(done && seconds > 0 ? { deadline: Date.now() + seconds * 1000, total: seconds } : null);
    },
    [sessionId, reload, exercises],
  );

  /**
   * A timed exercise ran its course: record it as a set carrying its duration.
   *
   * Fills the first open set the plan created before adding one, so a timed day started from a
   * plan does not end up with an empty set beside every logged one. Not a tick of the done box in
   * the usual sense — no rest timer is started, because in a timed workout the rest is already
   * part of the countdown.
   */
  const logTimedWork = useCallback(
    (index: number) => {
      const exercise = exercises[index];
      if (!exercise || !timing || !sessionId) return;
      void (async () => {
        const db = await getExecutor();
        const open = exercise.sets.find((set) => set.done_at === null && set.is_warmup === 0);
        let setId: string;
        if (open) {
          await updateSet(db, open.id, { durationSeconds: timing.workSeconds });
          setId = open.id;
        } else {
          setId = await insertSet(db, newId, exercise.id, { durationSeconds: timing.workSeconds });
        }
        await markSetDone(db, setId, true);
        await reload(sessionId);
      })();
    },
    [exercises, timing, sessionId, reload],
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

  /**
   * The "− set" button: take the last set off.
   *
   * A set not yet done goes at once — it was only a plan. A done one is a record of work, so it
   * is asked about first rather than lost to a stray tap.
   */
  const removeLastSet = useCallback(
    (exercise: SessionExerciseWithSets) => {
      const last = exercise.sets[exercise.sets.length - 1];
      if (!last) return;
      void (async () => {
        if (last.done_at !== null) {
          const ok = await confirm({
            message: t('workout.confirmRemoveDoneSet'),
            confirmLabel: t('workout.removeSet'),
          });
          if (!ok) return;
        }
        void hapticLight();
        deleteSet(last.id);
      })();
    },
    [confirm, t, deleteSet],
  );

  /** Which muscles an exercise works, and on what — the "muscles" button. */
  const showMuscles = useCallback(
    (seed: ExerciseSeed) => {
      const equipment = EQUIPMENT_SEED.find((item) => item.slug === seed.equipmentSlug);
      const lines = [
        `${t('workout.primaryMuscle')}: ${t(`muscle.${seed.primaryMuscle}`)}`,
        seed.secondaryMuscles && seed.secondaryMuscles.length > 0
          ? `${t('workout.secondaryMuscles')}: ${seed.secondaryMuscles
              .map((muscle) => t(`muscle.${muscle}`))
              .join(', ')}`
          : null,
        equipment ? `${t('workout.equipment')}: ${isHebrew ? equipment.nameHe : equipment.nameEn}` : null,
      ].filter((line): line is string => line !== null);
      void notify({ title: isHebrew ? seed.nameHe : seed.nameEn, message: lines.join('\n') });
    },
    [notify, t, isHebrew],
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
        hapticRecord();
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
  /** Where the list sits in the window — below the fixed masthead, not at the top of the screen. */
  const viewport = useRef({ top: 0, height: 0 });

  /*
   * Keep the row being typed into above the keyboard.
   *
   * On current Android the keyboard is drawn over the app rather than shrinking it, so a set
   * near the bottom of the page was covered by the very keys being used on it. KeyboardSafe
   * gives the page the room; this scrolls just far enough that the field clears the keys.
   */
  useEffect(() => {
    const shown = Keyboard.addListener('keyboardDidShow', (event) => {
      const field = TextInput.State.currentlyFocusedInput();
      if (!field) return;
      const keyboardTop = event.endCoordinates.screenY;
      field.measureInWindow((_x, y, _width, height) => {
        const overlap = y + height + spacing.xl - keyboardTop;
        if (overlap <= 0) return;
        scrollY.current += overlap;
        scrollRef.current?.scrollTo({ y: scrollY.current, animated: true });
      });
    });
    return () => shown.remove();
  }, []);

  const autoScroll = useCallback((screenY: number) => {
    const { top, height } = viewport.current;
    if (height <= 0) return;

    // A band at each edge, and a speed that grows the deeper into it the finger goes — a fixed
    // step is either too slow to be worth it or too fast to aim with.
    const EDGE = 110;
    // Halved from the first attempt, which overshot: the list ran away faster than the eye
    // could pick a landing spot, so aiming meant backing off the edge and creeping in again.
    const MAX_STEP = 11;
    // Measured from the list's own edges. The finger arrives in screen coordinates, and since the
    // masthead was fixed above every screen, taking the screen's top as the list's top put the
    // upper scroll band under the masthead, out of a dragging finger's reach.
    const fromTop = screenY - top - EDGE;
    const fromBottom = screenY - (top + height - EDGE);

    let step = 0;
    if (fromTop < 0) step = Math.max(-MAX_STEP, (fromTop / EDGE) * MAX_STEP);
    else if (fromBottom > 0) step = Math.min(MAX_STEP, (fromBottom / EDGE) * MAX_STEP);
    if (step === 0) return;

    scrollY.current = Math.max(0, scrollY.current + step);
    scrollRef.current?.scrollTo({ y: scrollY.current, animated: false });
  }, []);

  const dropExercise = useCallback(
    (sessionExerciseId: string) => {
      void (async () => {
        const ok = await confirm({
          message: t('workout.confirmRemoveExercise'),
          confirmLabel: t('common.remove'),
        });
        if (!ok) return;
        const db = await getExecutor();
        await removeExerciseFromSession(db, sessionExerciseId);
        if (sessionId) await reload(sessionId);
      })();
    },
    [sessionId, reload, t, confirm],
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
      const index = exercises.findIndex((ex) => ex.id === sessionExerciseId);
      const linked = exercises[index]?.superset_with_next === 1;
      // The last exercise has nothing to link to, so the action is not offered rather than
      // offered and refused.
      const canLink = index >= 0 && index < exercises.length - 1;

      void (async () => {
        const choice = await ask({
          title: exerciseLabel,
          actions: [
            { label: t('workout.swapExercise') },
            ...(canLink
              ? [{ label: t(linked ? 'workout.unlinkSuperset' : 'workout.linkSuperset') }]
              : []),
            { label: t('workout.removeExercise'), destructive: true },
          ],
        });
        if (choice === 0) {
          router.push({
            pathname: '/exercise-picker',
            params: { sessionId, swapExerciseId: sessionExerciseId },
          });
        } else if (canLink && choice === 1) {
          const db = await getExecutor();
          await setSupersetLink(db, sessionExerciseId, !linked);
          if (sessionId) await reload(sessionId);
        } else if (choice === (canLink ? 2 : 1)) {
          dropExercise(sessionExerciseId);
        }
      })();
    },
    [sessionId, t, dropExercise, ask, exercises, reload],
  );

  /**
   * Build a ramp toward the first working set and put it in front.
   *
   * The weight comes from the first set that is not already a warm-up, which is what the
   * session is actually building toward. A bar-loaded lift ramps against the bare bar as its
   * floor; anything else has no bar to fall back on and ramps in plain increments.
   */
  const addWarmup = useCallback(
    (sessionExerciseId: string, onBarbell: boolean) => {
      if (!sessionId) return;
      const exercise = exercises.find((e) => e.id === sessionExerciseId);
      const working = exercise?.sets.find((set) => set.is_warmup === 0)?.weight_kg;
      if (!working) return;

      const ramp = warmupRamp(working, { bar: onBarbell ? OLYMPIC_BAR : null });
      if (ramp.length === 0) return;

      void hapticLight();
      void (async () => {
        const db = await getExecutor();
        await addWarmupSets(
          db,
          newId,
          sessionExerciseId,
          ramp.map((set) => ({ weightKg: set.weight, reps: set.reps })),
        );
        await reload(sessionId);
      })();
    },
    [sessionId, exercises, reload],
  );

  /**
   * Write a suggestion into the sets it is about.
   *
   * Only sets that are not ticked off. A finished set is a record of what was lifted, and
   * overwriting it would turn a suggestion into a falsified history — the one thing this screen
   * must never do. Warm-ups are left alone for the same reason they are excluded from volume:
   * the ramp is not the work the suggestion is about.
   */
  const applyAdvice = useCallback(
    (sessionExerciseId: string, advice: ProgressionAdvice) => {
      const exercise = exercises.find((e) => e.id === sessionExerciseId);
      if (!exercise) return;

      const open = exercise.sets.filter((set) => set.done_at === null && set.is_warmup === 0);
      if (open.length === 0) return;

      void hapticLight();
      void (async () => {
        const db = await getExecutor();
        // Written straight through rather than via `patchSet`, which reloads the session and
        // checks for a personal record on every call. Looping that would race several reloads
        // against each other and, worse, celebrate a PR for a weight nobody has lifted yet — a
        // suggestion is a number in a field, and the record is earned when the set is ticked.
        for (const set of open) {
          await updateSet(db, set.id, { weightKg: advice.weightKg, reps: advice.reps });
        }
        if (sessionId) await reload(sessionId);
      })();
    },
    [exercises, sessionId, reload],
  );

  /**
   * What last session says to do today, per exercise.
   *
   * Computed from the same three things the card already shows — last session's sets, the plan's
   * range, and whether the lift has stopped moving — so the suggestion can never disagree with
   * the numbers printed beside it.
   */
  const advice = useMemo(() => {
    const out: Record<string, ProgressionAdvice | null> = {};
    for (const exercise of exercises) {
      const seed = EXERCISE_BY_KEY.get(exercise.exercise_key);
      const last = previous[exercise.exercise_key];
      if (!seed || !last) {
        out[exercise.id] = null;
        continue;
      }
      const prescription = targets[exercise.exercise_key];
      out[exercise.id] = suggestProgression({
        // Warm-ups are not the work; ramping toward 80 says nothing about whether 80 was earned.
        lastSets: last
          .filter((set) => set.is_warmup === 0)
          .map((set) => ({ weightKg: set.weight_kg, reps: set.reps, rpe: set.rpe })),
        repsMin: prescription?.target_reps_min,
        repsMax: prescription?.target_reps_max,
        movementPattern: seed.movementPattern,
        loadType: seed.loadType,
        isStalling: stalling[exercise.exercise_key] ?? false,
      });
    }
    return out;
  }, [exercises, previous, targets, stalling]);

  /**
   * One set's menu: change what it counts as, or take it out.
   *
   * Mirrors `openExerciseOptions` one level down. Both actions used to be invisible gestures on
   * a 30px chip — a tap that flipped the warm-up flag and a long press that deleted — and
   * deleting a set you added by mistake should not have been the more hidden of the two.
   */
  const openSetOptions = useCallback(
    (sessionExerciseId: string, setIndex: number) => {
      const exercise = exercises.find((e) => e.id === sessionExerciseId);
      const set = exercise?.sets[setIndex];
      if (!set) return;

      void (async () => {
        const choice = await ask({
          title: `${t('workout.setNumber')} ${setIndex + 1}`,
          actions: [
            { label: t(set.is_warmup === 1 ? 'workout.markAsWorking' : 'workout.markAsWarmup') },
            { label: t('workout.rateEffort') },
            { label: t(set.to_failure === 1 ? 'workout.clearToFailure' : 'workout.markToFailure') },
            { label: t('workout.addDropSet') },
            { label: t('workout.removeSet'), destructive: true },
          ],
        });

        if (choice === 0) patchSet(set.id, { isWarmup: set.is_warmup === 0 });
        else if (choice === 1) {
          // A second sheet rather than ten rows in the first: 6 to 10 is the range that carries
          // meaning — below 6 a set is a warm-up, and the app already has a word for that.
          const rated = await ask({
            title: t('workout.rateEffort'),
            message: t('workout.rateEffortHint'),
            actions: [
              ...RPE_CHOICES.map((value) => ({ label: t(`workout.rpe${value}`) })),
              { label: t('workout.rpeClear') },
            ],
          });
          if (rated === null) return;
          const value = RPE_CHOICES[rated] ?? null;
          patchSet(set.id, { rpe: value });
        } else if (choice === 2) patchSet(set.id, { toFailure: set.to_failure === 0 });
        else if (choice === 3) {
          // Starts at the parent's numbers rather than guessing a percentage: how far to drop is
          // a training decision, and the fields are right there to change.
          const db = await getExecutor();
          await addDropSet(db, newId, set.id, { weightKg: set.weight_kg, reps: set.reps });
          if (sessionId) await reload(sessionId);
        } else if (choice === 4) deleteSet(set.id);
      })();
    },
    [exercises, ask, t, patchSet, deleteSet, sessionId, reload],
  );

  /**
   * Choose where this workout is happening.
   *
   * Offered during the session rather than demanded before it: a workout that cannot start until
   * a question is answered is a workout someone abandons at the door. The gym narrows every
   * comparison on the card the moment it is set, and leaving it unset simply compares on the
   * workout's kind, as it did before gyms existed.
   */
  const openGymPicker = useCallback(() => {
    if (!sessionId) return;
    void (async () => {
      const choice = await ask({
        title: t('gyms.chooseTitle'),
        actions: [
          ...gyms.map((gym) => ({ label: gym.name })),
          { label: t('gyms.none') },
          { label: t('gyms.manage') },
        ],
      });
      if (choice === null) return;

      if (choice === gyms.length + 1) {
        router.push('/gyms');
        return;
      }

      const next = choice === gyms.length ? null : (gyms[choice]?.id ?? null);
      const db = await getExecutor();
      await setSessionLocation(db, sessionId, next);
      await reload(sessionId);
    })();
  }, [sessionId, gyms, ask, t, reload]);

  const groups = useMemo(
    () => stations(exercises.map((exercise) => exercise.superset_with_next === 1)),
    [exercises],
  );
  const exerciseDone = useMemo(
    () =>
      exercises.map((exercise) =>
        isExerciseDone(
          exercise.sets.map((set) => ({ done: set.done_at !== null, isWarmup: set.is_warmup === 1 })),
        ),
      ),
    [exercises],
  );

  const autoStation = firstUnfinishedStation(groups, exerciseDone);
  // Clamped: removing an exercise can leave a manual index pointing past the end.
  const activeStation = Math.max(
    0,
    Math.min(stationIndex ?? autoStation ?? groups.length - 1, groups.length - 1),
  );

  /**
   * Move on when the station in front of you becomes finished — not merely because it is.
   *
   * The difference matters: stepping back to a finished exercise to add a set or fix a number
   * would otherwise bounce straight forward again, which makes going back impossible.
   */
  useEffect(() => {
    if (!focus || groups.length === 0) return;
    const done = groups[activeStation]?.every((index) => exerciseDone[index]) ?? false;
    if (done && !wasStationDone.current) {
      const next = firstUnfinishedStation(groups, exerciseDone);
      if (next !== null && next !== activeStation) setStationIndex(next);
    }
    wasStationDone.current = done;
  }, [focus, groups, exerciseDone, activeStation]);

  /** Navigating by hand records the target as already seen, so it is not skipped past. */
  const goToStation = useCallback(
    (index: number) => {
      void hapticLight();
      wasStationDone.current = groups[index]?.every((i) => exerciseDone[i]) ?? false;
      setStationIndex(index);
    },
    [groups, exerciseDone],
  );

  /* ------------------------------------------------------------------ swiping */

  /**
   * The stations laid out as a filmstrip that runs left to right, dragged with a finger.
   *
   * Left to right in every language, deliberately, and the layout is pinned with `direction:
   * 'ltr'` so it does not mirror into Hebrew. A workout is a sequence in time, not a sentence:
   * the exercise after this one is the one to the right, the same way a video scrubs forward to
   * the right no matter what language its subtitles are in. Mirroring it meant "next" pointed
   * one way in the arrows and the other way under the thumb.
   *
   * The card follows the finger, so the direction never has to be learned — whichever way it is
   * dragged, the next exercise comes into view from the side it is being pulled from.
   */
  const { width: windowWidth } = useWindowDimensions();
  const slideX = useRef(new Animated.Value(0)).current;

  /*
   * The gesture is built once, so everything it reads has to come through a ref: handlers
   * created on mount would otherwise answer with the station that was current on mount.
   */
  const swipeState = useRef({ station: 0, count: 0, width: 0, go: (_index: number) => {} });
  swipeState.current.station = activeStation;
  swipeState.current.count = groups.length;
  swipeState.current.width = windowWidth;
  swipeState.current.go = goToStation;

  const swipeStation = useRef(
    PanResponder.create({
      /*
       * Claimed in the capture phase, and only for a decidedly horizontal drag.
       *
       * The card is full of things that want the touch first — weight and rep fields, the done
       * checkbox — and in the bubble phase they would each have taken it before this ever ran.
       * The thresholds are what keep taps and the vertical scroll out: 18px of travel, and more
       * than twice as much sideways as up.
       */
      onMoveShouldSetPanResponderCapture: (_evt, gesture) =>
        Math.abs(gesture.dx) > 18 && Math.abs(gesture.dx) > Math.abs(gesture.dy) * 2,
      onPanResponderMove: (_evt, gesture) => {
        const { station, count } = swipeState.current;
        // At either end the card still moves, but grudgingly. A card that refuses to budge reads
        // as a screen that has frozen; one that gives a little says there is nothing over there.
        const atEnd =
          (gesture.dx < 0 && station >= count - 1) || (gesture.dx > 0 && station <= 0);
        slideX.setValue(atEnd ? gesture.dx * 0.25 : gesture.dx);
      },
      onPanResponderRelease: (_evt, gesture) => {
        const { station, count, width, go } = swipeState.current;
        // Velocity as well as distance: a thumb flick is how anyone actually pages through
        // something, and it travels barely forty pixels.
        const target = swipeTarget(gesture.dx, station, count, width, gesture.vx);

        // Nothing to move to: too short a drag, or the end of the workout.
        if (target === null) {
          Animated.spring(slideX, { toValue: 0, useNativeDriver: true, friction: 9 }).start();
          return;
        }

        // Out the way it was pushed; the effect below brings the new one in from the far side.
        Animated.timing(slideX, {
          toValue: target > station ? -width : width,
          duration: 140,
          useNativeDriver: true,
        }).start(({ finished }) => {
          if (finished) go(target);
        });
      },
      onPanResponderTerminate: () => {
        Animated.spring(slideX, { toValue: 0, useNativeDriver: true, friction: 9 }).start();
      },
    }),
  ).current;

  /**
   * Slide the new station in whenever it changes — dragged to, tapped to, or arrived at by
   * finishing the last set.
   *
   * Here rather than in the gesture so that finishing an exercise looks the same as swiping to
   * the next one. Forward always enters from the right, which is the direction the strip runs,
   * so the animation says which way the workout just moved.
   */
  const shownStation = useRef<number | null>(null);
  useEffect(() => {
    if (!focus) {
      shownStation.current = null;
      return;
    }
    const previous = shownStation.current;
    shownStation.current = activeStation;
    if (previous === null || previous === activeStation) return;

    slideX.setValue(activeStation > previous ? windowWidth : -windowWidth);
    Animated.spring(slideX, { toValue: 0, useNativeDriver: true, friction: 9 }).start();
  }, [activeStation, focus, slideX, windowWidth]);

  /**
   * A picture dragged along the strip to a new place. The session is reordered, and the screen
   * stays on the exercise that was in front of you — wherever it has now moved to — rather than
   * on whatever slid into its old slot.
   */
  const reorderStation = useCallback(
    (from: number, to: number) => {
      const move = stationMove(groups, from, to);
      if (!move || !sessionId) return;
      const stayOn =
        activeStation === from
          ? to
          : from < activeStation && activeStation <= to
            ? activeStation - 1
            : to <= activeStation && activeStation < from
              ? activeStation + 1
              : activeStation;
      void (async () => {
        const db = await getExecutor();
        await reorderSessionExercise(db, sessionId, exercises[move.fromIndex]!.id, move.toIndex);
        await reload(sessionId);
        // Same exercise, new slot: no slide, since nothing on the card changes.
        shownStation.current = stayOn;
        wasStationDone.current = groups[activeStation]?.every((i) => exerciseDone[i]) ?? false;
        setStationIndex(stayOn);
      })();
    },
    [groups, sessionId, activeStation, exercises, reload, exerciseDone],
  );

  const setFocusMode = useCallback((next: boolean) => {
    void hapticLight();
    setFocus(next);
    // Cleared so switching back to focus lands on whatever is unfinished now, rather than on
    // wherever the user happened to be standing before they opened the list.
    setStationIndex(null);
    void SecureStore.setItemAsync(FOCUS_KEY, next ? 'on' : 'off').catch(() => undefined);
  }, []);

  useEffect(() => {
    void SecureStore.getItemAsync(FOCUS_KEY)
      .then((stored) => {
        if (stored === 'off') setFocus(false);
      })
      .catch(() => undefined);
  }, []);

  /** The first exercise of the next station, for the line that says what is coming. */
  const upNextIndex = groups[activeStation + 1]?.[0];
  const upNextName =
    upNextIndex === undefined
      ? null
      : (EXERCISE_BY_KEY.get(exercises[upNextIndex]?.exercise_key ?? '')?.nameHe ?? null);

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
    return <SkeletonScreen paddingTop={spacing.md} />;
  }

  if (!sessionId) {
    return (
      <WorkoutHome
        history={history}
        period={historyPeriod}
        onChangePeriod={setHistoryPeriod}
        onStartEmpty={() => void begin()}
        onOpenSession={(id) => router.push({ pathname: '/session/[id]', params: { id } })}
        onSessionOptions={openSessionOptions}
        contentPadding={{
          paddingTop: spacing.lg,
          paddingBottom: insets.bottom + spacing.xxl,
        }}
        refreshing={homeRefreshing}
        onRefresh={handleHomeRefresh}
      />
    );
  }

  /**
   * One exercise card.
   *
   * Lifted out of the list so focus mode and the full list draw the identical card — two copies
   * of eighty lines of props is two cards that drift apart, and the one nobody is looking at is
   * the one that rots.
   */
  /** "Machine · Back", under the exercise's name. */
  const subtitleFor = (seed: ExerciseSeed) => {
    const equipment = EQUIPMENT_SEED.find((item) => item.slug === seed.equipmentSlug);
    return [
      equipment ? (isHebrew ? equipment.nameHe : equipment.nameEn) : null,
      t(`muscle.${seed.primaryMuscle}`),
    ]
      .filter(Boolean)
      .join(' · ');
  };

  const renderExercise = (exercise: SessionExerciseWithSets, dragHandle?: DragHandleProps) => {
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
                  isWarmup: set.is_warmup === 1,
                  rpe: set.rpe,
                  toFailure: set.to_failure === 1,
                  isDrop: set.is_drop === 1,
                  durationSeconds: set.duration_seconds,
                  distanceM: set.distance_m,
                }))}
                previous={
                  previous[exercise.exercise_key]?.map((p) => ({
                    weightKg: p.weight_kg,
                    reps: p.reps,
                    durationSeconds: p.duration_seconds,
                    distanceM: p.distance_m,
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
                advice={advice[exercise.id] ?? null}
                onApplyAdvice={
                  advice[exercise.id] &&
                  exercise.sets.some((set) => set.done_at === null && set.is_warmup === 0)
                    ? () => applyAdvice(exercise.id, advice[exercise.id]!)
                    : undefined
                }
                onSetOptions={(i) => openSetOptions(exercise.id, i)}
                supersetWithNext={exercise.superset_with_next === 1}
                onChangeWeight={(i, next) => {
                  const set = exercise.sets[i];
                  if (set) patchSet(set.id, { weightKg: next });
                }}
                onChangeReps={(i, next) => {
                  const set = exercise.sets[i];
                  if (set) patchSet(set.id, { reps: next });
                }}
                // A walk or a ride: how long and how far, where the weights would be.
                cardio={seed.loadType === 'cardio'}
                cardioKey={exercise.id}
                exerciseKey={exercise.exercise_key}
                bodyWeightKg={bodyWeightKg}
                onChangeDuration={(i, seconds) => {
                  const set = exercise.sets[i];
                  if (set) patchSet(set.id, { durationSeconds: seconds });
                }}
                onChangeDistance={(i, metres) => {
                  const set = exercise.sets[i];
                  if (set) patchSet(set.id, { distanceM: metres });
                }}
                /*
                 * A tap on a number opens the app's own pad. The system keyboard swallowed the
                 * first keystroke of every entry on Android and covered the row being filled in;
                 * the pad names what it is editing instead of competing with it.
                 */
                onEditValue={(i, field) => {
                  const set = exercise.sets[i];
                  if (!set) return;
                  const label = `${seed.nameHe} · ${t('workout.setNumber')} ${i + 1}`;
                  const cardio = seed.loadType === 'cardio';
                  if (field === 'first') {
                    setPad(
                      cardio
                        ? {
                            title: `${label} · ${t('workout.duration')}`,
                            value: set.duration_seconds === null ? null : Math.round(set.duration_seconds / 60),
                            unit: t('workout.minutesShort'),
                            decimals: false,
                            onCommit: (value) =>
                              patchSet(set.id, {
                                durationSeconds: value === null ? null : Math.max(0, Math.round(value * 60)),
                              }),
                          }
                        : {
                            title: `${label} · ${t(`common.${weightUnitKey(unit)}`)}`,
                            value: set.weight_kg === null ? null : kgToDisplay(set.weight_kg, unit),
                            unit: t(`common.${weightUnitKey(unit)}`),
                            onCommit: (value) =>
                              patchSet(set.id, {
                                weightKg: value === null ? null : displayWeightToKg(value, unit),
                              }),
                          },
                    );
                    return;
                  }
                  setPad(
                    cardio
                      ? {
                          title: `${label} · ${t('workout.distance')}`,
                          value: set.distance_m === null ? null : metresToDisplay(set.distance_m, unit),
                          unit: t(`common.${distanceUnitKey(unit)}`),
                          onCommit: (value) =>
                            patchSet(set.id, {
                              distanceM: value === null ? null : displayDistanceToMetres(value, unit),
                            }),
                        }
                      : {
                          title: `${label} · ${t('workout.reps')}`,
                          value: set.reps,
                          decimals: false,
                          onCommit: (value) =>
                            patchSet(set.id, { reps: value === null ? null : Math.round(value) }),
                        },
                  );
                }}
                onToggle={(i) => {
                  const tapped = exercise.sets[i];
                  if (!tapped) return;
                  // The panel exposes a toggle; the repository wants the state to move to. The
                  // flip happens here so the card never has to know the current value twice —
                  // and it is read from the live copy, so a tap never argues with a reload that
                  // landed between the row being drawn and the finger arriving.
                  const current = liveSet(tapped.id) ?? tapped;
                  toggleDone(tapped.id, current.done_at === null);
                }}
                onAddSet={() => addSet(exercise.id)}
                onRemoveSet={exercise.sets.length > 0 ? () => removeLastSet(exercise) : undefined}
                onSwap={() =>
                  router.push({
                    pathname: '/exercise-picker',
                    params: { sessionId, swapExerciseId: exercise.id },
                  })
                }
                onShowMuscles={() => showMuscles(seed)}
                onOpenRecord={() =>
                  router.push({
                    pathname: '/exercise/[key]',
                    params: { key: exercise.exercise_key },
                  })
                }
                subtitle={subtitleFor(seed)}
                onOptions={() => openExerciseOptions(exercise.id, seed.nameHe)}
                dragHandle={dragHandle}
                // Big in focus mode, where it is the fastest way to confirm the machine in
                // front of you is the one on the screen; a thumbnail in the list, where the
                // question is only which card is which.
                visual={<ExerciseVisual exercise={seed} height={focus ? 210 : 52} />}
                visualLayout={focus ? 'banner' : 'thumb'}
                onBarbell={seed.equipmentSlug === 'barbell'}
                onAddWarmup={() => addWarmup(exercise.id, seed.equipmentSlug === 'barbell')}
                // Offered only with nothing warmed up yet and a working weight to ramp toward.
                canAddWarmup={
                  !exercise.sets.some((set) => set.is_warmup === 1) &&
                  (exercise.sets.find((set) => set.is_warmup === 0)?.weight_kg ?? 0) > 0
                }
              />
            );  };

  return (
    <KeyboardSafe style={[styles.screen, { paddingTop: spacing.md }]}>
      <WorkoutHeader
        name={sessionName ?? t('workout.activeTitle')}
        doneSets={totals.done}
        totalSets={totals.sets}
        startedAt={startedAt ?? new Date().toISOString()}
        progress={totals.sets === 0 ? 0 : totals.done / totals.sets}
        onFinish={finishNow}
      />

      {/* An unplanned, unnamed workout has no other session of its kind, so "last time" and the
          suggestions quietly widen to every gym. Said out loud rather than left to be inferred
          from numbers that look slightly wrong. */}
      {!typed ? <Banner tone="info">{t('workout.untypedComparison')}</Banner> : null}

      {/* Where this is happening. Shown as a quiet chip rather than a field: it changes what the
          numbers are compared against, which is worth surfacing, but it is not something to fill
          in before lifting. */}
      {/* Where, and how the exercises are shown, on one quiet line: both change how the screen
          behaves, neither is something to look at while lifting. Focus is the default — during a
          workout the question is what to do now, and eight cards of which seven are not it is an
          answer the reader has to search for. */}
      <View style={styles.controlsRow}>
        <Pressable
          onPress={openGymPicker}
          accessibilityRole="button"
          style={({ pressed }) => [styles.gymChip, pressed && { opacity: 0.7 }]}
        >
          <Text style={styles.gymChipText} numberOfLines={1}>
            📍 {gyms.find((g) => g.id === gymId)?.name ?? t('gyms.none')}
          </Text>
        </Pressable>

        {timing ? null : (
          <View style={styles.modeRow}>
            <Pressable
              onPress={() => setFocusMode(true)}
              accessibilityRole="button"
              accessibilityState={{ selected: focus }}
              style={({ pressed }) => [
                styles.modeChip,
                focus && styles.modeChipOn,
                pressed && styles.pressed,
              ]}
            >
              <Text style={[styles.modeText, focus && styles.modeTextOn]}>
                {t('workout.focusMode')}
              </Text>
            </Pressable>
            <Pressable
              onPress={() => setFocusMode(false)}
              accessibilityRole="button"
              accessibilityState={{ selected: !focus }}
              style={({ pressed }) => [
                styles.modeChip,
                !focus && styles.modeChipOn,
                pressed && styles.pressed,
              ]}
            >
              <Text style={[styles.modeText, !focus && styles.modeTextOn]}>
                {t('workout.listMode')}
              </Text>
            </Pressable>
          </View>
        )}
      </View>

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

      <NumberPadSheet request={pad} onClose={() => setPad(null)} />

      {/* Finishing saves straight away; this is the whole of the ceremony. */}
      {finishing ? <FinishedBurst onDone={finishDone} /> : null}

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
        onLayout={() => {
          scrollRef.current?.getNativeScrollRef()?.measureInWindow((_x, top, _width, height) => {
            viewport.current = { top, height };
          });
        }}
      >
        {exercises.length === 0 ? (
          <EmptyState emoji="➕" title={t('workout.noExercises')} hint={t('workout.noExercisesHint')} />
        ) : timing ? (
          <IntervalRunner
            exercises={exercises.map((exercise) => {
              const seed = EXERCISE_BY_KEY.get(exercise.exercise_key);
              return { name: (isHebrew ? seed?.nameHe : seed?.nameEn) ?? exercise.exercise_key, seed };
            })}
            workSeconds={timing.workSeconds}
            restSeconds={timing.restSeconds}
            rounds={timing.rounds}
            // After everything is logged, Start means another round from the top rather than
            // repeating only the last exercise.
            firstUnfinished={Math.max(0, exerciseDone.indexOf(false))}
            onWorkDone={logTimedWork}
          />
        ) : focus ? (
          <>
            {/* Every exercise as a small picture: where you are, what is done, and a tap to go
                anywhere. It replaced the ‹ › bar that could only step one at a time. */}
            <ExerciseStrip
              stations={groups.map((group, index) => {
                const members = group
                  .map((i) => exercises[i])
                  .filter((e): e is SessionExerciseWithSets => e !== undefined);
                const first = members[0];
                return {
                  key: first?.id ?? String(index),
                  seed: first ? EXERCISE_BY_KEY.get(first.exercise_key) : undefined,
                  label: members
                    .map((e) => {
                      const seed = EXERCISE_BY_KEY.get(e.exercise_key);
                      return seed ? (isHebrew ? seed.nameHe : seed.nameEn) : e.exercise_key;
                    })
                    .join(' + '),
                  done: group.every((i) => exerciseDone[i]),
                  movable: group.length === 1,
                };
              })}
              active={activeStation}
              onSelect={goToStation}
              onReorder={reorderStation}
            />

            {/* The whole station, which for a superset is both exercises: they are performed
                together with no rest between them, and showing one of them alone would be the
                screen arguing with the training. */}
            <Animated.View
              style={{ transform: [{ translateX: slideX }], gap: spacing.md, marginTop: spacing.md }}
              {...swipeStation.panHandlers}
            >
              {(groups[activeStation] ?? []).map((index) => {
                const exercise = exercises[index];
                return exercise ? (
                  <Fragment key={exercise.id}>{renderExercise(exercise)}</Fragment>
                ) : null;
              })}
            </Animated.View>

            {/* What is coming, so moving on is a decision rather than a surprise. */}
            {upNextName ? (
              <Text style={styles.stationNext} numberOfLines={1}>
                {t('workout.upNext')}: {upNextName}
              </Text>
            ) : autoStation === null ? (
              <Text style={styles.stationNext}>{t('workout.everythingDone')}</Text>
            ) : null}
          </>
        ) : (
          <DragReorderList
            data={exercises}
            keyExtractor={(exercise) => exercise.id}
            onReorder={moveExercise}
            onDragStateChange={setDragging}
            onDragMove={autoScroll}
            renderItem={(exercise, _index, dragHandle) => renderExercise(exercise, dragHandle)}
          />
        )}

        <Pressable
          onPress={() => router.push({ pathname: '/exercise-picker', params: { sessionId } })}
          style={styles.addExercise}
          accessibilityRole="button"
        >
          <Text style={styles.addExerciseText}>+ {t('workout.addExercise')}</Text>
        </Pressable>

        {/* Finishing is in the header now, top right. A tap there only opens the summary —
            the workout ends when that is confirmed — so a mis-tap costs nothing. */}
      </ScrollView>
    </KeyboardSafe>
  );
}

const createStyles = (colors: ColorPalette) =>
  StyleSheet.create<{
    screen: ViewStyle;
    controlsRow: ViewStyle;
    gymChip: ViewStyle;
    gymChipText: TextStyle;
    modeRow: ViewStyle;
    modeChip: ViewStyle;
    modeChipOn: ViewStyle;
    modeText: TextStyle;
    modeTextOn: TextStyle;
    stationNav: ViewStyle;
    stationButton: ViewStyle;
    stationButtonOff: ViewStyle;
    stationGlyph: TextStyle;
    stationMiddle: ViewStyle;
    stationCount: TextStyle;
    stationNext: TextStyle;
    pressed: ViewStyle;
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
  controlsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    marginTop: spacing.sm,
    marginBottom: spacing.md,
  },
  gymChip: {
    flexShrink: 1,
    paddingVertical: 4,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceRaised,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
  },
  gymChipText: { color: colors.textMuted, fontSize: 11, textAlign: 'auto' },
  modeRow: { flexDirection: 'row', gap: 6 },
  modeChip: {
    paddingVertical: 4,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceRaised,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
  },
  modeChipOn: { backgroundColor: colors.accentSoft, borderColor: colors.accentBorder },
  modeText: { color: colors.textMuted, fontSize: 11 },
  modeTextOn: { color: colors.accent, fontWeight: '700' },
  stationNav: {
    // Pinned against the app's RTL layout on purpose — see the swipe handler for why the strip
    // runs left to right in every language.
    direction: 'ltr',
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  stationButton: {
    width: 44,
    height: 44,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceRaised,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stationButtonOff: { opacity: 0.35 },
  stationGlyph: { color: colors.text, fontSize: 22, lineHeight: 24 },
  stationMiddle: { flex: 1, alignItems: 'center' },
  stationCount: {
    color: colors.textSecondary,
    fontSize: fontSize.xs,
    fontVariant: ['tabular-nums'],
  },
  stationNext: {
    color: colors.textFaint,
    fontSize: 12,
    marginTop: spacing.md,
    textAlign: 'center',
  },
  pressed: { opacity: 0.7 },
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
