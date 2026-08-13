/**
 * One day of the plan: a collapsed summary that expands into its exercise list.
 *
 * Collapsed by default and one-at-a-time, because a six-day plan fully expanded is a wall of
 * forty rows you have to scroll past to reach the day you actually came for. The summary line
 * carries the two things that decide which day to open — how much work it is, and how long
 * since you last did it.
 *
 * Reanimated drives the expansion rather than `LayoutAnimation`: the height change, the
 * chevron rotation and the rows sliding in are one continuous motion on the UI thread, so it
 * does not stutter while the screen is still reading the next day's exercises from SQLite.
 */

import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View, type TextStyle, type ViewStyle } from 'react-native';
import Animated, {
  FadeIn,
  FadeInDown,
  FadeOut,
  LinearTransition,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import type { PlanDayExerciseRow, PlanDayWithExercises } from '../db/plans.js';
import { useUnitSystem } from '../settings.js';
import { colors, fontSize, fontWeight, radius, spacing } from '../theme.js';
import { formatWeight, weightUnitKey } from '../units.js';

export interface PlanDayCardProps {
  day: PlanDayWithExercises;
  /** Position in the list — staggers the entrance so the days arrive in order, not at once. */
  index: number;
  expanded: boolean;
  /** Marks the day that has gone longest without being trained. */
  isNextUp: boolean;
  lastTrainedAt: string | null;
  exerciseLabel: (exerciseKey: string) => string;
  onToggle: () => void;
  onStart: () => void;
  onRename: () => void;
  onRemoveDay: () => void;
  onAddExercise: () => void;
  onEditTargets: (exercise: PlanDayExerciseRow) => void;
  onMove: (exercise: PlanDayExerciseRow, direction: 'up' | 'down') => void;
}

/** Whole days between two instants, floored — "2 days ago" until the third midnight passes. */
function daysSince(iso: string, now: number): number {
  return Math.floor((now - new Date(iso).getTime()) / 86_400_000);
}

export function PlanDayCard({
  day,
  index,
  expanded,
  isNextUp,
  lastTrainedAt,
  exerciseLabel,
  onToggle,
  onStart,
  onRename,
  onRemoveDay,
  onAddExercise,
  onEditTargets,
  onMove,
}: PlanDayCardProps) {
  const { t } = useTranslation();

  // A shared value rather than a React state animation: the rotation runs on the UI thread and
  // stays in step with the layout transition even when JS is busy loading the next day.
  const openness = useSharedValue(expanded ? 1 : 0);
  useEffect(() => {
    openness.value = withTiming(expanded ? 1 : 0, { duration: 200 });
  }, [expanded, openness]);

  const chevronStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${openness.value * 180}deg` }],
  }));

  const plannedSets = day.exercises.reduce(
    (total, exercise) => total + (exercise.target_sets ?? 0),
    0,
  );

  const lastTrainedLabel = (() => {
    if (!lastTrainedAt) return t('plan.neverTrained');
    const days = daysSince(lastTrainedAt, Date.now());
    if (days <= 0) return t('plan.today');
    if (days === 1) return t('plan.yesterday');
    return t('plan.daysAgo', { count: days });
  })();

  return (
    <Animated.View
      style={[styles.card, isNextUp && styles.cardNext]}
      entering={FadeInDown.delay(index * 60).duration(260)}
      exiting={FadeOut.duration(160)}
      layout={LinearTransition.springify().damping(18)}
    >
      <Pressable onPress={onToggle} accessibilityRole="button" style={styles.header}>
        <View style={styles.headerMain}>
          <View style={styles.headerTop}>
            <Text style={styles.dayIndex}>
              {t('plan.day')} {day.day_index}
            </Text>
            {isNextUp ? <Text style={styles.nextBadge}>{t('plan.nextUp')}</Text> : null}
          </View>
          <Text style={styles.dayName} numberOfLines={1}>
            {day.name ?? t('plan.unnamedDay')}
          </Text>
          <Text style={styles.dayMeta}>
            {day.exercises.length} {t('plan.exercises')}
            {plannedSets > 0 ? ` · ${plannedSets} ${t('plan.sets')}` : ''} · {lastTrainedLabel}
          </Text>
        </View>
        <Animated.Text style={[styles.chevron, chevronStyle]}>⌄</Animated.Text>
      </Pressable>

      {expanded ? (
        <Animated.View
          entering={FadeIn.duration(200)}
          exiting={FadeOut.duration(120)}
          layout={LinearTransition}
          style={styles.body}
        >
          {day.exercises.length === 0 ? (
            <View style={styles.emptyBlock}>
              <Text style={styles.emptyTitle}>{t('plan.noExercises')}</Text>
              <Text style={styles.emptyHint}>{t('plan.noExercisesHint')}</Text>
            </View>
          ) : (
            day.exercises.map((exercise, position) => (
              <PlanExerciseRow
                key={exercise.id}
                exercise={exercise}
                label={exerciseLabel(exercise.exercise_key)}
                isFirst={position === 0}
                isLast={position === day.exercises.length - 1}
                onPress={() => onEditTargets(exercise)}
                onMove={(direction) => onMove(exercise, direction)}
              />
            ))
          )}

          <Pressable onPress={onAddExercise} accessibilityRole="button" style={styles.addRow}>
            <Text style={styles.addRowText}>+ {t('plan.addExercise')}</Text>
          </Pressable>

          <View style={styles.footer}>
            <Pressable
              onPress={onStart}
              accessibilityRole="button"
              // Disabled by absence rather than a greyed-out control: a day with no exercises
              // has nothing to start, and a dead button invites tapping it to find out why.
              style={[styles.startButton, day.exercises.length === 0 && styles.startButtonMuted]}
              disabled={day.exercises.length === 0}
            >
              <Text
                style={[
                  styles.startButtonText,
                  day.exercises.length === 0 && styles.startButtonTextMuted,
                ]}
              >
                {t('plan.start')}
              </Text>
            </Pressable>

            <Pressable onPress={onRename} accessibilityRole="button" style={styles.footerAction}>
              <Text style={styles.footerActionText}>{t('plan.renameDay')}</Text>
            </Pressable>
            <Pressable onPress={onRemoveDay} accessibilityRole="button" style={styles.footerAction}>
              <Text style={styles.footerActionDanger}>{t('plan.removeDay')}</Text>
            </Pressable>
          </View>
        </Animated.View>
      ) : null}
    </Animated.View>
  );
}

/* -------------------------------------------------------------------------- */

/**
 * `4 × 8–12` beats "4 sets of 8 to 12 reps" at this size, and it is how the prescription is
 * written on every programme the user has ever been handed on paper.
 */
function formatPrescription(exercise: PlanDayExerciseRow, setsLabel: string): string | null {
  const { target_sets: sets, target_reps_min: min, target_reps_max: max } = exercise;
  const reps = min === null ? null : max === null || max === min ? `${min}` : `${min}–${max}`;

  if (sets === null && reps === null) return null;
  if (reps === null) return `${sets} ${setsLabel}`;
  if (sets === null) return `${reps}`;
  return `${sets} × ${reps}`;
}

function PlanExerciseRow({
  exercise,
  label,
  isFirst,
  isLast,
  onPress,
  onMove,
}: {
  exercise: PlanDayExerciseRow;
  label: string;
  isFirst: boolean;
  isLast: boolean;
  onPress: () => void;
  onMove: (direction: 'up' | 'down') => void;
}) {
  const { t } = useTranslation();
  const unitSystem = useUnitSystem();

  const prescription = formatPrescription(exercise, t('plan.sets'));
  const details = [
    prescription,
    exercise.target_load_kg !== null
      ? `${formatWeight(exercise.target_load_kg, unitSystem)} ${t(`common.${weightUnitKey(unitSystem)}`)}`
      : null,
    exercise.rest_seconds !== null
      ? `${t('plan.rest')} ${exercise.rest_seconds}${t('plan.restSeconds')}`
      : null,
    exercise.target_rpe !== null ? `RPE ${exercise.target_rpe}` : null,
  ].filter((part): part is string => part !== null);

  return (
    <Animated.View
      style={styles.exerciseRow}
      entering={FadeIn.duration(180)}
      exiting={FadeOut.duration(120)}
      layout={LinearTransition.springify().damping(20)}
    >
      <Pressable onPress={onPress} accessibilityRole="button" style={styles.exerciseMain}>
        <Text style={styles.exerciseName} numberOfLines={1}>
          {label}
        </Text>
        <Text style={styles.exerciseTargets}>
          {details.length > 0 ? details.join(' · ') : t('plan.noTarget')}
        </Text>
      </Pressable>

      {/* Arrows rather than drag-to-reorder: a long-press drag inside a scrolling list needs a
          gesture handler to disambiguate, and two taps move an exercise just as well. */}
      <View style={styles.reorder}>
        <Pressable
          onPress={() => onMove('up')}
          disabled={isFirst}
          accessibilityRole="button"
          accessibilityLabel={t('plan.moveUp')}
          style={styles.reorderButton}
        >
          <Text style={[styles.reorderText, isFirst && styles.reorderTextDisabled]}>↑</Text>
        </Pressable>
        <Pressable
          onPress={() => onMove('down')}
          disabled={isLast}
          accessibilityRole="button"
          accessibilityLabel={t('plan.moveDown')}
          style={styles.reorderButton}
        >
          <Text style={[styles.reorderText, isLast && styles.reorderTextDisabled]}>↓</Text>
        </Pressable>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create<{
  card: ViewStyle;
  cardNext: ViewStyle;
  header: ViewStyle;
  headerMain: ViewStyle;
  headerTop: ViewStyle;
  dayIndex: TextStyle;
  nextBadge: TextStyle;
  dayName: TextStyle;
  dayMeta: TextStyle;
  chevron: TextStyle;
  body: ViewStyle;
  emptyBlock: ViewStyle;
  emptyTitle: TextStyle;
  emptyHint: TextStyle;
  exerciseRow: ViewStyle;
  exerciseMain: ViewStyle;
  exerciseName: TextStyle;
  exerciseTargets: TextStyle;
  reorder: ViewStyle;
  reorderButton: ViewStyle;
  reorderText: TextStyle;
  reorderTextDisabled: TextStyle;
  addRow: ViewStyle;
  addRowText: TextStyle;
  footer: ViewStyle;
  startButton: ViewStyle;
  startButtonMuted: ViewStyle;
  startButtonText: TextStyle;
  startButtonTextMuted: TextStyle;
  footerAction: ViewStyle;
  footerActionText: TextStyle;
  footerActionDanger: TextStyle;
}>({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: spacing.md,
    overflow: 'hidden',
  },
  cardNext: { borderColor: colors.accentBorder },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.lg,
  },
  headerMain: { flex: 1, marginEnd: spacing.sm },
  headerTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  dayIndex: {
    color: colors.textMuted,
    fontSize: fontSize.xxs,
    fontWeight: fontWeight.medium,
    letterSpacing: 0.5,
    textAlign: 'auto',
  },
  nextBadge: {
    color: colors.accent,
    fontSize: fontSize.xxs,
    fontWeight: fontWeight.bold,
    backgroundColor: colors.accentSoft,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xxs,
    overflow: 'hidden',
  },
  dayName: {
    color: colors.text,
    fontSize: fontSize.lg,
    fontWeight: fontWeight.bold,
    marginTop: spacing.xxs,
    textAlign: 'auto',
  },
  dayMeta: {
    color: colors.textMuted,
    fontSize: fontSize.xs,
    marginTop: spacing.xxs,
    textAlign: 'auto',
  },
  chevron: { color: colors.textMuted, fontSize: fontSize.xl, lineHeight: 24 },

  body: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.lg,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: spacing.md,
  },

  emptyBlock: { paddingVertical: spacing.lg },
  emptyTitle: { color: colors.textSecondary, fontSize: fontSize.sm, textAlign: 'auto' },
  emptyHint: {
    color: colors.textMuted,
    fontSize: fontSize.xs,
    marginTop: spacing.xxs,
    textAlign: 'auto',
  },

  exerciseRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surfaceRaised,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.sm,
  },
  exerciseMain: { flex: 1, marginEnd: spacing.sm },
  exerciseName: {
    color: colors.text,
    fontSize: fontSize.sm,
    fontWeight: fontWeight.medium,
    textAlign: 'auto',
  },
  exerciseTargets: {
    color: colors.textMuted,
    fontSize: fontSize.xs,
    marginTop: spacing.xxs,
    textAlign: 'auto',
  },
  reorder: { flexDirection: 'row', gap: spacing.xs },
  reorderButton: {
    width: 30,
    height: 30,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceHigh,
  },
  reorderText: { color: colors.textSecondary, fontSize: fontSize.sm },
  reorderTextDisabled: { color: colors.textFaint },

  addRow: {
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderStyle: 'dashed',
    alignItems: 'center',
  },
  addRowText: { color: colors.textSecondary, fontSize: fontSize.sm, fontWeight: fontWeight.medium },

  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  startButton: {
    flex: 1,
    backgroundColor: colors.accentSoft,
    borderWidth: 1,
    borderColor: colors.accentBorder,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
  startButtonMuted: { backgroundColor: 'transparent', borderColor: colors.border },
  startButtonText: { color: colors.accent, fontSize: fontSize.sm, fontWeight: fontWeight.bold },
  startButtonTextMuted: { color: colors.textFaint },
  footerAction: { paddingVertical: spacing.sm, paddingHorizontal: spacing.sm },
  footerActionText: { color: colors.textMuted, fontSize: fontSize.xs },
  footerActionDanger: { color: colors.danger, fontSize: fontSize.xs },
});
