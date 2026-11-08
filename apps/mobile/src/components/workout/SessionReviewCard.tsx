/**
 * A finished workout's summary, on its page: what got better than last time, what stayed the
 * same, and what went down — each exercise against the last time it was done, set by set.
 *
 * The reading is `reviewSession` in `@fit/shared/progress`, which the coach website uses too, so
 * the trainee and the coach see one verdict. This only lays it out: a count per verdict, then the
 * exercises grouped by verdict, each opening in place to its sets against the sets last time.
 * Nothing animates beyond the card's entrance (see CLAUDE.md on driver modes).
 */

import { EXERCISE_BY_KEY } from '@fit/shared/catalog';
import {
  SESSION_VERDICT_ORDER,
  topSet,
  type ExerciseSessionChange,
  type SessionReview,
  type SessionVerdict,
  type WorkingSet,
} from '@fit/shared/progress';
import { CaretDown, CaretUp } from 'phosphor-react-native';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View, type TextStyle, type ViewStyle } from 'react-native';

import { hapticLight } from '../../haptics.js';
import { useTheme } from '../../ThemeProvider.js';
import { fontSize, fontWeight, radius, spacing, type ColorPalette } from '../../theme.js';
import { Pressable } from '../Pressable.js';
import { Text } from '../Text.js';
import { Card, Hint, SectionTitle } from '../ui.js';
import { SetChangeMark, useSetText } from '../WorkoutProgressList.js';

/** Which colour each verdict is told in — always beside its words, never instead of them. */
function verdictColor(status: SessionVerdict, colors: ColorPalette): string {
  if (status === 'improved') return colors.accent;
  if (status === 'declined') return colors.warning;
  if (status === 'new') return colors.info;
  return colors.textSecondary;
}

/** The set a row shows: the heaviest, or without a weight the one with the most reps. */
function topOf(sets: readonly WorkingSet[]): WorkingSet | null {
  return (
    topSet(sets) ??
    sets.reduce<WorkingSet | null>(
      (best, set) => (!best || (set.reps ?? 0) > (best.reps ?? 0) ? set : best),
      null,
    )
  );
}

export function SessionReviewCard({ review }: { review: SessionReview }) {
  const { t, i18n } = useTranslation();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const setText = useSetText();
  const [open, setOpen] = useState<string | null>(null);
  const isHebrew = i18n.language === 'he';

  if (review.exercises.length === 0) return null;

  const name = (key: string) => {
    const seed = EXERCISE_BY_KEY.get(key);
    return seed ? (isHebrew ? seed.nameHe : seed.nameEn) : key;
  };
  const day = (iso: string) =>
    new Date(iso).toLocaleDateString(i18n.language, { day: 'numeric', month: 'short' });

  const row = (exercise: ExerciseSessionChange) => {
    const expanded = open === exercise.exerciseKey;
    const Caret = expanded ? CaretUp : CaretDown;
    const before = exercise.previous;
    return (
      <View key={exercise.exerciseKey} style={styles.row}>
        <Pressable
          onPress={() => {
            hapticLight();
            setOpen(expanded ? null : exercise.exerciseKey);
          }}
          accessibilityRole="button"
          accessibilityState={{ expanded }}
          style={styles.rowHead}
        >
          <View style={styles.rowText}>
            <Text style={styles.name} numberOfLines={1}>
              {name(exercise.exerciseKey)}
            </Text>
            <Text style={styles.sets} numberOfLines={1}>
              {setText(topOf(exercise.sets))}
              {before ? (
                <Text style={styles.was}>
                  {'  '}
                  {t('progress.was', { value: setText(topOf(before.sets)) })}
                </Text>
              ) : null}
            </Text>
            <Text style={styles.detail}>
              {before
                ? t('sessionReview.vsDate', { date: day(before.startedAt) })
                : t('sessionReview.firstTime')}
            </Text>
          </View>
          <Caret size={16} color={colors.textMuted} />
        </Pressable>

        {expanded ? (
          <View style={styles.body}>
            {(exercise.pairs.length > 0
              ? exercise.pairs
              : exercise.sets.map((set, i) => ({
                  position: i + 1,
                  now: set,
                  then: null,
                  change: 'added' as const,
                }))
            ).map((pair) => (
              <View key={pair.position} style={styles.setRow}>
                {before ? (
                  <SetChangeMark change={pair.change} />
                ) : (
                  <View style={styles.markSpace} />
                )}
                <Text style={styles.setLabel}>{t('progress.setN', { n: pair.position })}</Text>
                <View style={styles.setText}>
                  <Text style={[styles.setNow, !pair.now && styles.setMissing]}>
                    {pair.now ? setText(pair.now) : t('progress.setChange_dropped')}
                  </Text>
                  {pair.then ? (
                    <Text style={styles.setWas}>
                      {t('progress.was', { value: setText(pair.then) })}
                    </Text>
                  ) : null}
                </View>
              </View>
            ))}
          </View>
        ) : null}
      </View>
    );
  };

  return (
    <Card>
      <SectionTitle>{t('sessionReview.title')}</SectionTitle>
      <Hint>{t('sessionReview.hint')}</Hint>

      <View style={styles.chips}>
        {SESSION_VERDICT_ORDER.filter((status) => review.counts[status] > 0).map((status) => (
          <View key={status} style={[styles.chip, { borderColor: verdictColor(status, colors) }]}>
            <Text style={[styles.chipText, { color: verdictColor(status, colors) }]}>
              {t(`monthly.count_${status}`, { count: review.counts[status] })}
            </Text>
          </View>
        ))}
      </View>

      {SESSION_VERDICT_ORDER.filter((status) => review.counts[status] > 0).map((status) => (
        <View key={status} style={styles.group}>
          <Text style={[styles.groupTitle, { color: verdictColor(status, colors) }]}>
            {t(`sessionReview.group_${status}`)}
          </Text>
          {review.exercises.filter((exercise) => exercise.status === status).map(row)}
        </View>
      ))}
    </Card>
  );
}

const createStyles = (colors: ColorPalette) =>
  StyleSheet.create<{
    chips: ViewStyle;
    chip: ViewStyle;
    chipText: TextStyle;
    group: ViewStyle;
    groupTitle: TextStyle;
    row: ViewStyle;
    rowHead: ViewStyle;
    rowText: ViewStyle;
    name: TextStyle;
    sets: TextStyle;
    was: TextStyle;
    detail: TextStyle;
    body: ViewStyle;
    setRow: ViewStyle;
    markSpace: ViewStyle;
    setLabel: TextStyle;
    setText: ViewStyle;
    setNow: TextStyle;
    setMissing: TextStyle;
    setWas: TextStyle;
  }>({
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.md },
    chip: {
      paddingVertical: spacing.xs,
      paddingHorizontal: spacing.md,
      borderRadius: radius.pill,
      borderWidth: 1,
    },
    chipText: { fontSize: fontSize.xs, fontWeight: fontWeight.bold },
    group: { marginTop: spacing.lg },
    groupTitle: {
      fontSize: fontSize.sm,
      fontWeight: fontWeight.bold,
      marginBottom: spacing.xs,
      textAlign: 'auto',
    },
    row: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
    rowHead: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      paddingVertical: spacing.md,
      minHeight: 44,
    },
    rowText: { flex: 1, gap: 2 },
    name: {
      color: colors.text,
      fontSize: fontSize.md,
      fontWeight: fontWeight.bold,
      textAlign: 'auto',
    },
    sets: {
      color: colors.text,
      fontSize: fontSize.sm,
      fontVariant: ['tabular-nums'],
      textAlign: 'auto',
    },
    was: { color: colors.textMuted, fontSize: fontSize.xs },
    detail: { color: colors.textMuted, fontSize: fontSize.xs, textAlign: 'auto' },
    body: { paddingBottom: spacing.md, gap: spacing.xs },
    setRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 32 },
    markSpace: { width: 18 },
    setLabel: {
      width: 44,
      color: colors.textMuted,
      fontSize: fontSize.xs,
      fontVariant: ['tabular-nums'],
      textAlign: 'auto',
    },
    setText: { flex: 1 },
    setNow: {
      color: colors.text,
      fontSize: fontSize.sm,
      fontWeight: fontWeight.bold,
      fontVariant: ['tabular-nums'],
      textAlign: 'auto',
    },
    setMissing: { color: colors.textMuted, fontWeight: fontWeight.regular },
    setWas: {
      color: colors.textMuted,
      fontSize: fontSize.xs,
      fontVariant: ['tabular-nums'],
      textAlign: 'auto',
    },
  });
