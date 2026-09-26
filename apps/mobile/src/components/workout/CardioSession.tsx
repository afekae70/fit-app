/**
 * A cardio effort as it is actually done: start it, it runs, you stop it.
 *
 * No sets and no rounds. A walk or a ride is one continuous stretch, and a table of rows asking
 * for weight and reps is the wrong question three times over. What it records is what that
 * training is — how long, how far — and it shows the two numbers that follow from those, pace
 * and speed, while they are still worth knowing.
 *
 * The clock is derived from wall-clock stamps (see `cardioTimer.ts`), and the run survives the
 * screen locking, the app being closed and the phone being pocketed: the state is written to the
 * keystore under this exercise's own key and read back on the way in. The interval only asks for
 * a repaint; it is never what the time is made of.
 *
 * Keeps the screen awake while running, for the same reason the interval timer does — a
 * countdown nobody can see is a countdown that is not doing its job.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import * as SecureStore from 'expo-secure-store';

import { hapticLight, hapticSuccess } from '../../haptics.js';
import { useTheme } from '../../ThemeProvider.js';
import { useUnit } from '../../UnitsProvider.js';
import { radius, type ColorPalette } from '../../theme.js';
import { displayDistanceToMetres, distanceUnitKey, metresToDisplay } from '../../units.js';
import { caloriesBurned, cardioKind, cardioMet } from '../../workout/calories.js';
import {
  elapsedSeconds,
  formatDuration,
  isRunning,
  pacePerUnit,
  pauseRun,
  runFromSeconds,
  speedPerHour,
  startRun,
  type CardioRun,
} from '../../workout/cardioTimer.js';

const KEEP_AWAKE_TAG = 'cardio-session';

export interface CardioSessionProps {
  /** This exercise's own key, so a run in progress is found again after a restart. */
  storageKey: string;
  /** The catalogue key, which decides how hard this kind of movement is. */
  exerciseKey: string;
  /** The latest weigh-in, which is half of any calorie estimate. Null, and none is shown. */
  bodyWeightKg?: number | null;
  durationSeconds: number | null;
  distanceM: number | null;
  done: boolean;
  onChangeDuration: (seconds: number) => void;
  onChangeDistance: (metres: number) => void;
  /** Tick the effort off — the same tick a set has, for one thing instead of a list. */
  onToggleDone: () => void;
}

export function CardioSession({
  storageKey,
  exerciseKey,
  bodyWeightKg = null,
  durationSeconds,
  distanceM,
  done,
  onChangeDuration,
  onChangeDistance,
  onToggleDone,
}: CardioSessionProps) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const unit = useUnit();
  const s = useMemo(() => createStyles(colors), [colors]);

  const [run, setRun] = useState<CardioRun>(() => runFromSeconds(durationSeconds));
  const [, repaint] = useState(0);
  const running = isRunning(run);

  // The same bargain the interval timer strikes: the screen stays on while the clock is
  // running, and is released the moment it is not — including on the way out of the screen.
  useEffect(() => {
    if (running) void activateKeepAwakeAsync(KEEP_AWAKE_TAG).catch(() => undefined);
    else void deactivateKeepAwake(KEEP_AWAKE_TAG);
    return () => {
      void deactivateKeepAwake(KEEP_AWAKE_TAG);
    };
  }, [running]);

  const key = `cardio-run-${storageKey}`;

  // A run in progress, read back on the way in. Written on every change, which is a handful of
  // writes per workout rather than one per second.
  const restored = useRef(false);
  useEffect(() => {
    void SecureStore.getItemAsync(key)
      .then((raw) => {
        restored.current = true;
        if (!raw) return;
        const saved = JSON.parse(raw) as CardioRun;
        if (typeof saved?.accumulatedMs === 'number') setRun(saved);
      })
      .catch(() => {
        restored.current = true;
      });
  }, [key]);

  useEffect(() => {
    if (!restored.current) return;
    void SecureStore.setItemAsync(key, JSON.stringify(run)).catch(() => undefined);
  }, [key, run]);

  // A repaint a second while it runs. The number itself is always now minus the start.
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => repaint((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [running]);

  const seconds = elapsedSeconds(run, Date.now());
  const distance = distanceM === null ? 0 : metresToDisplay(distanceM, unit);
  const pace = pacePerUnit(seconds, distance);
  const speed = speedPerHour(seconds, distance);
  const unitLabel = t(`common.${distanceUnitKey(unit)}`);

  /*
   * Calories, estimated from how hard this kind of movement is at this speed and what the
   * person weighs. Speed in km/h whatever the reader's units: the physiology is metric, and
   * converting here keeps the estimate the same number for the same effort.
   */
  const speedKmh =
    speed === null ? null : unit === 'imperial' ? Math.round(speed * 1.609 * 10) / 10 : speed;
  const calories = caloriesBurned(
    cardioMet(cardioKind(exerciseKey), speedKmh),
    bodyWeightKg,
    seconds,
  );

  /** Saving the clock into the set is what makes the effort a record rather than a display. */
  const save = (next: CardioRun) => {
    setRun(next);
    onChangeDuration(elapsedSeconds(next, Date.now()));
  };

  const typedDistance = useRef<string | null>(null);

  return (
    <View style={s.panel}>
      <Text style={s.clock} accessibilityLiveRegion="polite">
        {formatDuration(seconds)}
      </Text>
      <Text style={s.clockLabel}>{t('workout.elapsed')}</Text>

      <View style={s.controls}>
        <Pressable
          onPress={() => {
            void hapticLight();
            const now = Date.now();
            save(running ? pauseRun(run, now) : startRun(now, run));
          }}
          accessibilityRole="button"
          style={({ pressed }) => [s.primary, running && s.primaryRunning, pressed && s.pressed]}
        >
          <Text style={[s.primaryText, running && s.primaryTextRunning]}>
            {running
              ? `⏸ ${t('cardio.pause')}`
              : seconds > 0
                ? `▶ ${t('cardio.resume')}`
                : `▶ ${t('cardio.start')}`}
          </Text>
        </Pressable>

        {/* Finishing writes the clock into the effort and ticks it off. Offered once there is
            something to finish — a done button over a clock at zero is a button that lies. */}
        {seconds > 0 || done ? (
          <Pressable
            onPress={() => {
              void hapticSuccess();
              if (running) save(pauseRun(run, Date.now()));
              else onChangeDuration(seconds);
              onToggleDone();
            }}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: done }}
            style={({ pressed }) => [s.finish, done && s.finishDone, pressed && s.pressed]}
          >
            <Text style={[s.finishText, done && s.finishTextDone]}>
              ✓ {done ? t('cardio.finished') : t('cardio.finish')}
            </Text>
          </Pressable>
        ) : null}
      </View>

      <View style={s.distanceRow}>
        <Text style={s.fieldLabel}>{t('workout.distance')}</Text>
        <View style={s.field}>
          <Pressable
            onPress={() => {
              void hapticLight();
              onChangeDistance(displayDistanceToMetres(Math.max(0, distance - 0.5), unit));
            }}
            accessibilityRole="button"
            accessibilityLabel="−"
            hitSlop={6}
            style={({ pressed }) => [s.step, pressed && s.pressed]}
          >
            <Text style={s.stepGlyph}>−</Text>
          </Pressable>
          <TextInput
            key={`${distanceM ?? 'empty'}-${unit}`}
            defaultValue={distanceM === null ? '' : String(distance)}
            onChangeText={(text) => {
              typedDistance.current = text;
            }}
            onEndEditing={(event) => {
              typedDistance.current = null;
              const typed = Number(event.nativeEvent.text.replace(',', '.'));
              if (!Number.isFinite(typed) || typed < 0) return;
              onChangeDistance(displayDistanceToMetres(typed, unit));
            }}
            keyboardType="numeric"
            inputMode="decimal"
            selectTextOnFocus
            placeholder="—"
            placeholderTextColor={colors.textFaint}
            style={s.input}
          />
          <Text style={s.unit}>{unitLabel}</Text>
          <Pressable
            onPress={() => {
              void hapticLight();
              onChangeDistance(displayDistanceToMetres(distance + 0.5, unit));
            }}
            accessibilityRole="button"
            accessibilityLabel="+"
            hitSlop={6}
            style={({ pressed }) => [s.step, pressed && s.pressed]}
          >
            <Text style={s.stepGlyph}>+</Text>
          </Pressable>
        </View>
      </View>

      {/* What the two numbers say together. Shown only once both exist, because a pace computed
          from a distance nobody has entered yet is a number pretending to be a measurement. */}
      {pace || speed || calories ? (
        <View style={s.stats}>
          {pace ? (
            <View style={s.stat}>
              <Text style={s.statValue}>{pace}</Text>
              <Text style={s.statLabel}>{t('cardio.pace', { unit: unitLabel })}</Text>
            </View>
          ) : null}
          {speed ? (
            <View style={s.stat}>
              <Text style={s.statValue}>{speed}</Text>
              <Text style={s.statLabel}>{t('cardio.speed', { unit: unitLabel })}</Text>
            </View>
          ) : null}
          {/* Called an estimate, because without a heart rate that is what it is. */}
          {calories ? (
            <View style={s.stat}>
              <Text style={s.statValue}>{calories}</Text>
              <Text style={s.statLabel}>{t('cardio.calories')}</Text>
            </View>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const createStyles = (colors: ColorPalette) =>
  StyleSheet.create<{
    panel: ViewStyle;
    clock: TextStyle;
    clockLabel: TextStyle;
    controls: ViewStyle;
    primary: ViewStyle;
    primaryRunning: ViewStyle;
    primaryText: TextStyle;
    primaryTextRunning: TextStyle;
    finish: ViewStyle;
    finishDone: ViewStyle;
    finishText: TextStyle;
    finishTextDone: TextStyle;
    distanceRow: ViewStyle;
    fieldLabel: TextStyle;
    field: ViewStyle;
    step: ViewStyle;
    stepGlyph: TextStyle;
    input: TextStyle;
    unit: TextStyle;
    stats: ViewStyle;
    stat: ViewStyle;
    statValue: TextStyle;
    statLabel: TextStyle;
    pressed: ViewStyle;
  }>({
    panel: {
      gap: 10,
      padding: 14,
      borderRadius: radius.md,
      backgroundColor: colors.surfaceRaised,
      borderWidth: 1,
      borderColor: colors.borderSubtle,
      alignItems: 'center',
    },
    clock: {
      color: colors.text,
      fontSize: 46,
      fontWeight: '700',
      letterSpacing: -1,
      fontVariant: ['tabular-nums'],
    },
    clockLabel: { color: colors.textFaint, fontSize: 12, marginTop: -6 },

    controls: { flexDirection: 'row', gap: 8, alignSelf: 'stretch' },
    primary: {
      flex: 1,
      minHeight: 48,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: radius.pill,
      backgroundColor: colors.accent,
    },
    primaryRunning: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.accent },
    primaryText: { color: colors.bg, fontSize: 15, fontWeight: '700' },
    primaryTextRunning: { color: colors.accent },
    finish: {
      flex: 1,
      minHeight: 48,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: radius.pill,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
    },
    finishDone: { borderColor: colors.accent, backgroundColor: colors.accentSoft },
    finishText: { color: colors.textSecondary, fontSize: 15, fontWeight: '600' },
    finishTextDone: { color: colors.accent },

    distanceRow: { alignSelf: 'stretch', gap: 6 },
    fieldLabel: { color: colors.textMuted, fontSize: 12, textAlign: 'auto' },
    field: {
      flexDirection: 'row',
      alignItems: 'center',
      height: 48,
      borderRadius: radius.sm,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
      overflow: 'hidden',
    },
    step: { width: 44, height: 48, alignItems: 'center', justifyContent: 'center' },
    stepGlyph: { color: colors.textSecondary, fontSize: 20 },
    input: {
      flex: 1,
      color: colors.text,
      fontSize: 22,
      fontWeight: '500',
      textAlign: 'center',
      padding: 0,
      fontVariant: ['tabular-nums'],
    },
    unit: { color: colors.textFaint, fontSize: 12, marginEnd: 4 },

    stats: { flexDirection: 'row', alignSelf: 'stretch', gap: 8 },
    stat: {
      flex: 1,
      alignItems: 'center',
      paddingVertical: 8,
      borderRadius: radius.sm,
      backgroundColor: colors.surface,
    },
    statValue: {
      color: colors.text,
      fontSize: 18,
      fontWeight: '700',
      fontVariant: ['tabular-nums'],
    },
    statLabel: { color: colors.textFaint, fontSize: 11, textAlign: 'center' },
    pressed: { opacity: 0.7 },
  });
