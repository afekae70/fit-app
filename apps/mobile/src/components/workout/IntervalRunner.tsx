/**
 * The screen of a timed workout: one big countdown, what to do now, and what comes next.
 *
 * Replaces the sets-and-reps cards entirely for a timed day. There is nothing to type during an
 * interval — the time is the prescription — so the fields would only be something to knock with
 * a sweaty hand. Each exercise is logged by the timer itself when its work phase runs out, as a
 * set carrying its duration, which keeps it in the history, the streak and the weekly count like
 * any other workout.
 *
 * The countdown is the widest thing on the screen because it is read from the floor, mid-plank,
 * at arm's length or more. Work and rest are told apart by colour and by a word, and at the end
 * of each by a different sound (see workout/sounds.ts), so the phone never has to be looked at to
 * know whether to move or to stop.
 *
 * The screen stays awake while the timer runs. A phone that locks itself thirty seconds into a
 * fifty-second plank takes the countdown, and the sound at the end of it, away with it.
 */

import type { ExerciseSeed } from '@fit/shared/catalog';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View, type TextStyle, type ViewStyle } from 'react-native';

import { hapticMedium, hapticSuccess } from '../../haptics.js';
import { useTheme } from '../../ThemeProvider.js';
import { fontSize, fontWeight, radius, spacing, type ColorPalette } from '../../theme.js';
import { formatRemaining } from '../../workout/derived.js';
import {
  advance,
  buildPhases,
  countdownCue,
  isFinished,
  pause,
  remainingSeconds,
  resume,
  skip,
  startIntervals,
  type IntervalState,
} from '../../workout/interval.js';
import {
  playCue,
  prepareCues,
  releaseCues,
  startKeepAlive,
  stopKeepAlive,
} from '../../workout/sounds.js';
import { ExerciseVisual } from '../ExerciseVisual.js';

export interface IntervalExercise {
  name: string;
  seed: ExerciseSeed | undefined;
}

const KEEP_AWAKE_TAG = 'interval-workout';

/** Four times a second: the display changes once a second, and this keeps it from lagging by one. */
const TICK_MS = 250;

export function IntervalRunner({
  exercises,
  workSeconds,
  restSeconds,
  firstUnfinished,
  onWorkDone,
}: {
  exercises: readonly IntervalExercise[];
  workSeconds: number;
  restSeconds: number;
  /** Where to begin — the first exercise with nothing logged, so a resumed workout skips the done ones. */
  firstUnfinished: number;
  /** An exercise's work phase ran out: log it. */
  onWorkDone: (exerciseIndex: number) => void;
}) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const s = useMemo(() => createStyles(colors), [colors]);

  const phases = useMemo(
    () => buildPhases(exercises.length, workSeconds, restSeconds),
    [exercises.length, workSeconds, restSeconds],
  );

  const [state, setState] = useState<IntervalState | null>(null);
  const [now, setNow] = useState(() => Date.now());

  // The tick reads these through refs: it is created once per run, and would otherwise report
  // work done against the callback and phases of the render that started it.
  const stateRef = useRef(state);
  stateRef.current = state;
  const onWorkDoneRef = useRef(onWorkDone);
  onWorkDoneRef.current = onWorkDone;
  /** The countdown second last sounded, so each of 3, 2, 1 is heard once and not four times. */
  const lastCountdown = useRef<string | null>(null);

  const running = state !== null && state.endsAt !== null;
  const finished = state !== null && isFinished(phases, state);

  useEffect(() => {
    void prepareCues();
    return () => {
      releaseCues();
      void deactivateKeepAwake(KEEP_AWAKE_TAG);
    };
  }, []);

  // Awake from Start to the end, paused included: a pause is usually a breath or a sip of water,
  // and coming back to a locked phone to resume is exactly the friction to avoid.
  useEffect(() => {
    if (state !== null && !finished)
      void activateKeepAwakeAsync(KEEP_AWAKE_TAG).catch(() => undefined);
    else void deactivateKeepAwake(KEEP_AWAKE_TAG);
  }, [state, finished]);

  // The audio output stays awake exactly while the countdown can make a sound: running, not
  // paused, not finished. See sounds.ts for why a quiet output cut off the first pip.
  useEffect(() => {
    if (!running) return;
    startKeepAlive();
    return () => stopKeepAlive();
  }, [running]);

  useEffect(() => {
    if (!running) return;
    const handle = setInterval(() => {
      const current = stateRef.current;
      if (!current) return;
      const at = Date.now();
      const result = advance(phases, current, at);
      setNow(at);
      if (result.completed.length === 0) {
        // The last three seconds of whatever is running — exercise or rest — each get a pip, so
        // the end can be seen coming without looking at the screen.
        const cue = countdownCue(phases, result.state, at, lastCountdown.current);
        if (cue) {
          lastCountdown.current = cue;
          playCue('tick');
        }
        return;
      }

      for (const phase of result.completed) {
        if (phase.kind === 'work') onWorkDoneRef.current(phase.exercise);
      }

      // One sound per tick, not one per phase. After the screen was off, several phases can end
      // at once, and three beeps stacked on top of each other say nothing; the one that matters
      // is what is true now.
      if (isFinished(phases, result.state)) {
        playCue('done');
        hapticSuccess();
      } else {
        const last = result.completed[result.completed.length - 1]!;
        playCue(last.kind === 'work' ? 'workEnd' : 'restEnd');
        hapticMedium();
      }
      setState(result.state);
    }, TICK_MS);
    return () => clearInterval(handle);
  }, [running, phases]);

  const start = useCallback(() => {
    const at = Date.now();
    setNow(at);
    setState(
      startIntervals(phases, at, Math.min(firstUnfinished, Math.max(0, exercises.length - 1))),
    );
    hapticMedium();
  }, [phases, firstUnfinished, exercises.length]);

  const togglePause = useCallback(() => {
    const at = Date.now();
    setNow(at);
    setState((current) => {
      if (!current) return current;
      return current.endsAt === null ? resume(phases, current, at) : pause(current, at);
    });
  }, [phases]);

  const skipPhase = useCallback(() => {
    const current = stateRef.current;
    if (!current) return;
    const at = Date.now();
    const next = skip(phases, current, at);
    // Outside the state updater: React may run an updater twice, and a sound played in one would
    // play twice with it.
    if (isFinished(phases, next)) playCue('done');
    setNow(at);
    setState(next);
  }, [phases]);

  const totalSeconds = phases.reduce((sum, phase) => sum + phase.seconds, 0);

  /* ---------------------------------------------------------------- not started */

  if (state === null) {
    const first = exercises[Math.min(firstUnfinished, exercises.length - 1)];
    return (
      <View style={s.card}>
        <Text style={s.kicker}>{t('interval.title')}</Text>
        <Text style={s.summary}>
          {t('interval.summary', {
            count: exercises.length,
            work: t('interval.seconds', { count: workSeconds }),
            rest: t('interval.seconds', { count: restSeconds }),
          })}
        </Text>
        <Text style={s.total}>{t('interval.total', { time: formatRemaining(totalSeconds) })}</Text>

        {first ? (
          <>
            {first.seed ? <ExerciseVisual exercise={first.seed} height={150} /> : null}
            <Text style={s.firstUp}>
              {firstUnfinished > 0 ? t('interval.resumeFrom', { name: first.name }) : first.name}
            </Text>
          </>
        ) : null}

        <Pressable
          onPress={start}
          accessibilityRole="button"
          style={({ pressed }) => [s.startButton, pressed && s.pressed]}
        >
          <Text style={s.startText}>▶ {t('interval.start')}</Text>
        </Pressable>
      </View>
    );
  }

  /* ---------------------------------------------------------------- finished */

  if (finished) {
    return (
      <View style={[s.card, s.cardDone]}>
        <Text style={s.doneTitle}>{t('interval.finished')}</Text>
        <Text style={s.hint}>{t('interval.finishedHint')}</Text>
      </View>
    );
  }

  /* ---------------------------------------------------------------- running or paused */

  const phase = phases[state.phase]!;
  const isWork = phase.kind === 'work';
  const exercise = exercises[phase.exercise];
  const left = remainingSeconds(state, now);
  const progress = 1 - Math.min(1, Math.max(0, left / phase.seconds));
  const tint = isWork ? colors.accent : colors.info;

  const nextWork = phases.slice(state.phase + 1).find((p) => p.kind === 'work');
  const upNext = isWork && nextWork ? exercises[nextWork.exercise] : undefined;

  return (
    <View style={[s.card, { borderColor: tint }]}>
      <View style={s.phaseRow}>
        <Text style={[s.phaseLabel, { color: tint }]}>
          {isWork ? t('interval.work') : t('interval.rest')}
        </Text>
        <Text style={s.position}>
          {t('interval.exerciseOf', { current: phase.exercise + 1, total: exercises.length })}
        </Text>
      </View>

      <Text
        style={[s.countdown, { color: tint }, !running && s.countdownPaused]}
        accessibilityLiveRegion="polite"
      >
        {left >= 60 ? formatRemaining(left) : left}
      </Text>

      <View style={s.track}>
        <View style={[s.fill, { width: `${progress * 100}%`, backgroundColor: tint }]} />
      </View>

      {/* During rest the exercise shown is the one about to start — rest is for getting into
          position for it, so that is the one worth seeing. */}
      {!isWork ? <Text style={s.getReady}>{t('interval.getReady')}</Text> : null}
      <Text style={s.exerciseName}>{exercise?.name}</Text>
      {exercise?.seed ? (
        <ExerciseVisual exercise={exercise.seed} height={isWork ? 170 : 130} />
      ) : null}

      {upNext ? <Text style={s.upNext}>{t('interval.next', { name: upNext.name })}</Text> : null}

      <View style={s.controls}>
        <Pressable
          onPress={togglePause}
          accessibilityRole="button"
          style={({ pressed }) => [s.control, s.controlPrimary, pressed && s.pressed]}
        >
          <Text style={s.controlPrimaryText}>
            {running ? `❚❚ ${t('interval.pause')}` : `▶ ${t('interval.resume')}`}
          </Text>
        </Pressable>
        <Pressable
          onPress={skipPhase}
          accessibilityRole="button"
          style={({ pressed }) => [s.control, pressed && s.pressed]}
        >
          <Text style={s.controlText}>{t('interval.skip')} ⏭</Text>
        </Pressable>
      </View>
    </View>
  );
}

const createStyles = (colors: ColorPalette) =>
  StyleSheet.create<{
    card: ViewStyle;
    cardDone: ViewStyle;
    kicker: TextStyle;
    summary: TextStyle;
    total: TextStyle;
    firstUp: TextStyle;
    startButton: ViewStyle;
    startText: TextStyle;
    doneTitle: TextStyle;
    hint: TextStyle;
    phaseRow: ViewStyle;
    phaseLabel: TextStyle;
    position: TextStyle;
    countdown: TextStyle;
    countdownPaused: TextStyle;
    track: ViewStyle;
    fill: ViewStyle;
    getReady: TextStyle;
    exerciseName: TextStyle;
    upNext: TextStyle;
    controls: ViewStyle;
    control: ViewStyle;
    controlPrimary: ViewStyle;
    controlText: TextStyle;
    controlPrimaryText: TextStyle;
    pressed: ViewStyle;
  }>({
    card: {
      backgroundColor: colors.surface,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: colors.borderSubtle,
      padding: spacing.lg,
      gap: spacing.md,
      marginTop: spacing.md,
    },
    cardDone: {
      borderColor: colors.accentBorder,
      backgroundColor: colors.accentSoft,
      alignItems: 'center',
    },
    kicker: {
      color: colors.accent,
      fontSize: fontSize.sm,
      fontWeight: fontWeight.bold,
      textAlign: 'auto',
    },
    summary: { color: colors.text, fontSize: fontSize.md, textAlign: 'auto' },
    total: { color: colors.textMuted, fontSize: fontSize.sm, textAlign: 'auto' },
    firstUp: {
      color: colors.text,
      fontSize: fontSize.lg,
      fontWeight: fontWeight.bold,
      textAlign: 'center',
    },
    startButton: {
      backgroundColor: colors.accent,
      borderRadius: radius.md,
      paddingVertical: spacing.lg,
      alignItems: 'center',
    },
    startText: { color: colors.bg, fontSize: fontSize.lg, fontWeight: fontWeight.bold },
    doneTitle: {
      color: colors.accent,
      fontSize: fontSize.xl,
      fontWeight: fontWeight.bold,
      textAlign: 'center',
    },
    hint: { color: colors.textMuted, fontSize: fontSize.sm, textAlign: 'center' },
    phaseRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    phaseLabel: { fontSize: fontSize.xl, fontWeight: fontWeight.bold },
    position: { color: colors.textMuted, fontSize: fontSize.sm, fontVariant: ['tabular-nums'] },
    // Sized to be read from the floor. Tabular digits so the number does not jitter sideways
    // as it counts — a 1 is narrower than a 0 in most proportional fonts.
    countdown: {
      fontSize: 96,
      lineHeight: 104,
      fontWeight: fontWeight.bold,
      textAlign: 'center',
      fontVariant: ['tabular-nums'],
    },
    countdownPaused: { opacity: 0.45 },
    track: {
      height: 8,
      borderRadius: radius.pill,
      backgroundColor: colors.surfaceRaised,
      overflow: 'hidden',
    },
    fill: { height: '100%', borderRadius: radius.pill },
    getReady: {
      color: colors.info,
      fontSize: fontSize.sm,
      fontWeight: fontWeight.bold,
      textAlign: 'center',
    },
    exerciseName: {
      color: colors.text,
      fontSize: fontSize.xl,
      fontWeight: fontWeight.bold,
      textAlign: 'center',
    },
    upNext: { color: colors.textMuted, fontSize: fontSize.sm, textAlign: 'center' },
    controls: { flexDirection: 'row', gap: spacing.sm },
    control: {
      flex: 1,
      paddingVertical: spacing.md,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.border,
      alignItems: 'center',
    },
    controlPrimary: { flex: 2, backgroundColor: colors.surfaceRaised },
    controlText: {
      color: colors.textSecondary,
      fontSize: fontSize.md,
      fontWeight: fontWeight.medium,
    },
    controlPrimaryText: { color: colors.text, fontSize: fontSize.md, fontWeight: fontWeight.bold },
    pressed: { opacity: 0.7 },
  });
