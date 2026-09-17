/**
 * Turn a plan day into a timed workout, and set how long each exercise and each rest lasts.
 *
 * Steppers rather than text fields. The values that matter come in fives — 30, 45, 50, 60 — and a
 * tap is faster and harder to get wrong than a keyboard, which on this screen would also cover
 * the list of exercises the timing is being set for.
 *
 * The total is shown as the numbers change, because "is this a fifteen-minute workout or a
 * twenty-five-minute one" is the actual question behind picking 40 or 50 seconds.
 */

import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Pressable,
  StyleSheet,
  Switch,
  Text,
  View,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

import type { PlanDayTiming } from '../../db/plans.js';
import { useTheme } from '../../ThemeProvider.js';
import { fontSize, fontWeight, radius, spacing, type ColorPalette } from '../../theme.js';
import { formatRemaining } from '../../workout/derived.js';
import {
  buildPhases,
  clampSeconds,
  DEFAULT_REST_SECONDS,
  DEFAULT_WORK_SECONDS,
  type PhaseKind,
} from '../../workout/interval.js';

const STEP = 5;

export function TimingCard({
  timing,
  exerciseCount,
  onChange,
}: {
  timing: PlanDayTiming | null;
  exerciseCount: number;
  onChange: (next: PlanDayTiming | null) => void;
}) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const s = useMemo(() => createStyles(colors), [colors]);

  const total = timing
    ? buildPhases(exerciseCount, timing.workSeconds, timing.restSeconds).reduce(
        (sum, phase) => sum + phase.seconds,
        0,
      )
    : 0;

  const step = (kind: PhaseKind, delta: number) => {
    if (!timing) return;
    const key = kind === 'work' ? 'workSeconds' : 'restSeconds';
    const next = clampSeconds(timing[key] + delta, kind);
    if (next !== timing[key]) onChange({ ...timing, [key]: next });
  };

  const stepper = (kind: PhaseKind, value: number) => {
    const floor = kind === 'work' ? clampSeconds(0, 'work') : 0;
    return (
      <View style={s.stepperRow}>
        <Text style={s.stepperLabel}>
          {kind === 'work' ? t('interval.work') : t('interval.rest')}
        </Text>
        <View style={s.stepper}>
          <Pressable
            onPress={() => step(kind, -STEP)}
            disabled={value <= floor}
            accessibilityRole="button"
            accessibilityLabel={`${kind === 'work' ? t('interval.work') : t('interval.rest')} ${t('interval.less')}`}
            hitSlop={6}
            style={({ pressed }) => [
              s.stepButton,
              value <= floor && s.stepButtonOff,
              pressed && s.pressed,
            ]}
          >
            <Text style={s.stepGlyph}>−</Text>
          </Pressable>
          <Text style={s.value}>{t('interval.seconds', { count: value })}</Text>
          <Pressable
            onPress={() => step(kind, STEP)}
            accessibilityRole="button"
            accessibilityLabel={`${kind === 'work' ? t('interval.work') : t('interval.rest')} ${t('interval.more')}`}
            hitSlop={6}
            style={({ pressed }) => [s.stepButton, pressed && s.pressed]}
          >
            <Text style={s.stepGlyph}>+</Text>
          </Pressable>
        </View>
      </View>
    );
  };

  return (
    <View style={[s.card, timing && s.cardOn]}>
      <View style={s.headerRow}>
        <Text style={s.title}>⏱ {t('interval.title')}</Text>
        <Switch
          value={timing !== null}
          onValueChange={(on) =>
            onChange(
              on ? { workSeconds: DEFAULT_WORK_SECONDS, restSeconds: DEFAULT_REST_SECONDS } : null,
            )
          }
          trackColor={{ false: colors.surfaceRaised, true: colors.accent }}
          thumbColor={colors.text}
          accessibilityLabel={t('interval.title')}
        />
      </View>

      <Text style={s.hint}>{t('interval.toggleHint')}</Text>

      {timing ? (
        <>
          {stepper('work', timing.workSeconds)}
          {stepper('rest', timing.restSeconds)}
          {exerciseCount > 0 ? (
            <Text style={s.total}>
              {t('interval.summary', {
                count: exerciseCount,
                work: t('interval.seconds', { count: timing.workSeconds }),
                rest: t('interval.seconds', { count: timing.restSeconds }),
              })}
              {'\n'}
              {t('interval.total', { time: formatRemaining(total) })}
            </Text>
          ) : null}
        </>
      ) : null}
    </View>
  );
}

const createStyles = (colors: ColorPalette) =>
  StyleSheet.create<{
    card: ViewStyle;
    cardOn: ViewStyle;
    headerRow: ViewStyle;
    title: TextStyle;
    hint: TextStyle;
    stepperRow: ViewStyle;
    stepperLabel: TextStyle;
    stepper: ViewStyle;
    stepButton: ViewStyle;
    stepButtonOff: ViewStyle;
    stepGlyph: TextStyle;
    value: TextStyle;
    total: TextStyle;
    pressed: ViewStyle;
  }>({
    card: {
      backgroundColor: colors.surface,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: colors.borderSubtle,
      padding: spacing.md,
      gap: spacing.sm,
      marginTop: spacing.md,
    },
    cardOn: { borderColor: colors.accentBorder },
    headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    title: {
      color: colors.text,
      fontSize: fontSize.md,
      fontWeight: fontWeight.bold,
      textAlign: 'auto',
    },
    hint: { color: colors.textMuted, fontSize: fontSize.xs, textAlign: 'auto' },
    stepperRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    stepperLabel: {
      color: colors.textSecondary,
      fontSize: fontSize.md,
      fontWeight: fontWeight.medium,
    },
    stepper: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
    stepButton: {
      width: 40,
      height: 40,
      borderRadius: radius.pill,
      backgroundColor: colors.surfaceRaised,
      borderWidth: 1,
      borderColor: colors.border,
      alignItems: 'center',
      justifyContent: 'center',
    },
    stepButtonOff: { opacity: 0.35 },
    stepGlyph: { color: colors.text, fontSize: fontSize.lg, fontWeight: fontWeight.bold },
    value: {
      color: colors.text,
      fontSize: fontSize.lg,
      fontWeight: fontWeight.bold,
      minWidth: 72,
      textAlign: 'center',
      fontVariant: ['tabular-nums'],
    },
    total: {
      color: colors.accent,
      fontSize: fontSize.sm,
      textAlign: 'auto',
      marginTop: spacing.xs,
    },
    pressed: { opacity: 0.7 },
  });
