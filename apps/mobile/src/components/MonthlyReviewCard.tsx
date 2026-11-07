/**
 * The monthly review on the Progress screen: every exercise of a month, where it ended against
 * where it started, set by set — and for each one that is stuck, one thing to try.
 *
 * Opens on the last whole month (a new review is ready on the first of every month) and moves
 * back through every month with training, and forward to this month so far. The reading itself
 * is `progress/monthlyReview.ts`; this only lays it out.
 *
 * Each exercise is a row that opens in place: the sets against the sets, and the tip. Nothing
 * here animates beyond the card's own entrance, so there is no driver to mix (see CLAUDE.md).
 */

import { EXERCISE_SEED, type ExerciseSeed } from '@fit/shared/catalog';
import { router, useFocusEffect } from 'expo-router';
import { CaretDown, CaretLeft, CaretRight, CaretUp } from 'phosphor-react-native';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View, type TextStyle, type ViewStyle } from 'react-native';

import { useCurrentUserId } from '../auth/CurrentUserProvider.js';
import { listTrainingMonths, loadMonthHistory } from '../db/monthlyReview.js';
import { getExecutor } from '../db/provider.js';
import { hapticLight } from '../haptics.js';
import { isRtlLanguage, type Language } from '../i18n/index.js';
import {
  defaultMonth,
  nextWeightKg,
  reviewableMonths,
  reviewMonth,
  STATUS_ORDER,
  type ExerciseMonth,
  type MonthReview,
  type MonthStatus,
  monthOf,
  type Tip,
} from '../progress/monthlyReview.js';
import { topSet, type WorkingSet } from '../progress/setBySet.js';
import { useTheme } from '../ThemeProvider.js';
import { fontSize, fontWeight, radius, spacing, type ColorPalette } from '../theme.js';
import { kgToDisplay, weightUnitKey } from '../units.js';
import { useUnit } from '../UnitsProvider.js';
import { Pressable } from './Pressable.js';
import { Text } from './Text.js';
import { Banner, Card, Hint, SectionTitle } from './ui.js';
import { SetChangeMark, useSetText } from './WorkoutProgressList.js';

const EXERCISE_BY_KEY = new Map<string, ExerciseSeed>(
  EXERCISE_SEED.map((exercise) => [exercise.nameEn, exercise]),
);

/** Which colour each kind of month is told in. */
function statusColor(status: MonthStatus, colors: ColorPalette): string {
  if (status === 'progressing') return colors.accent;
  if (status === 'stuck') return colors.warning;
  if (status === 'declining') return colors.danger;
  if (status === 'new') return colors.info;
  return colors.textSecondary;
}

export function MonthlyReviewCard({
  index,
  refreshKey = 0,
}: {
  index?: number;
  /** Bumped by the screen's pull-to-refresh, to read the month again. */
  refreshKey?: number;
}) {
  const { t, i18n } = useTranslation();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const userId = useCurrentUserId();
  const unit = useUnit();
  const setText = useSetText();
  const rtl = isRtlLanguage(i18n.language as Language);
  const isHebrew = i18n.language === 'he';

  const [months, setMonths] = useState<string[] | null>(null);
  const [month, setMonth] = useState<string | null>(null);
  const [review, setReview] = useState<MonthReview | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  // Bumped on every read of the months, so the month shown is read again with them.
  const [version, setVersion] = useState(0);

  // Which months there are. On focus — a workout finished elsewhere can change this month, or
  // add it — and on the screen's pull-to-refresh.
  const loadMonths = useCallback(async () => {
    const db = await getExecutor();
    const trained = await listTrainingMonths(db, userId);
    const today = new Date();
    setMonths(reviewableMonths(trained, today));
    setMonth((chosen) => chosen ?? defaultMonth(trained, today));
    setVersion((v) => v + 1);
  }, [userId]);

  useFocusEffect(
    useCallback(() => {
      void loadMonths();
    }, [loadMonths]),
  );

  useEffect(() => {
    if (refreshKey > 0) void loadMonths();
  }, [refreshKey, loadMonths]);

  useEffect(() => {
    if (!month || version === 0) return;
    let live = true;
    void (async () => {
      const db = await getExecutor();
      const history = await loadMonthHistory(db, userId, month);
      if (live) setReview(reviewMonth(history, month));
    })();
    return () => {
      live = false;
    };
  }, [month, userId, version]);

  const weight = useCallback(
    (kg: number) => `${kgToDisplay(kg, unit)} ${t(`common.${weightUnitKey(unit)}`)}`,
    [t, unit],
  );

  const tipText = useCallback(
    (tip: Tip): string => {
      switch (tip.kind) {
        case 'fadingSets':
          return t('monthly.tip_fadingSets', { first: tip.firstReps, last: tip.lastReps });
        case 'lighter':
          return t('monthly.tip_lighter', { from: weight(tip.fromKg), to: weight(tip.toKg) });
        case 'fewerSets':
          return t('monthly.tip_fewerSets', { from: tip.from, to: tip.to });
        case 'lowFrequency':
          return t('monthly.tip_lowFrequency', { count: tip.sessions });
        case 'longPlateau':
          return t('monthly.tip_longPlateau', { count: tip.sessions });
        case 'addRep':
          return t('monthly.tip_addRep', {
            target: tip.targetReps,
            next: weight(nextWeightKg(tip.weightKg, unit)),
          });
        case 'addRepBodyweight':
          return t('monthly.tip_addRepBodyweight', { target: tip.targetReps });
      }
    },
    [t, unit, weight],
  );

  if (!months || !month) return null;

  const position = months.indexOf(month);
  const earlier = position > 0 ? months[position - 1] : undefined;
  const later = position >= 0 && position < months.length - 1 ? months[position + 1] : undefined;
  const [year, monthIndex] = month.split('-').map(Number) as [number, number];
  const monthName = new Date(year, monthIndex - 1, 1).toLocaleDateString(i18n.language, {
    month: 'long',
    year: 'numeric',
  });
  const isCurrent = month === monthOf(new Date());
  const Back = rtl ? CaretRight : CaretLeft;
  const Forward = rtl ? CaretLeft : CaretRight;

  const move = (to: string | undefined) => {
    if (!to) return;
    hapticLight();
    setOpen(null);
    setMonth(to);
  };

  const day = (iso: string) =>
    new Date(iso).toLocaleDateString(i18n.language, { day: 'numeric', month: 'short' });

  const gainText = (exercise: ExerciseMonth): string | null => {
    const gain = exercise.gain;
    if (!gain) return null;
    const parts: string[] = [];
    if (gain.weightKg > 0) parts.push(t('monthly.gainWeight', { value: weight(gain.weightKg) }));
    if (gain.reps > 0) parts.push(t('monthly.gainReps', { count: gain.reps }));
    if (gain.sets > 0) parts.push(t('monthly.gainSets', { count: gain.sets }));
    return parts.length > 0 ? parts.join(' · ') : null;
  };

  const shown = review?.month === month ? review : null;

  return (
    <Card index={index}>
      <SectionTitle>{t('monthly.title')}</SectionTitle>
      <Hint>{t('monthly.hint')}</Hint>

      <View style={styles.monthRow}>
        <Pressable
          onPress={() => move(earlier)}
          disabled={!earlier}
          accessibilityRole="button"
          accessibilityLabel={t('monthly.previousMonth')}
          hitSlop={8}
          style={[styles.arrow, !earlier && styles.arrowOff]}
        >
          <Back size={20} color={colors.text} weight="bold" />
        </Pressable>
        <Text style={styles.monthName}>
          {isCurrent ? t('monthly.monthSoFar', { month: monthName }) : monthName}
        </Text>
        <Pressable
          onPress={() => move(later)}
          disabled={!later}
          accessibilityRole="button"
          accessibilityLabel={t('monthly.nextMonth')}
          hitSlop={8}
          style={[styles.arrow, !later && styles.arrowOff]}
        >
          <Forward size={20} color={colors.text} weight="bold" />
        </Pressable>
      </View>

      {!shown ? null : shown.exercises.length === 0 ? (
        <Text style={styles.empty}>
          {months.length <= 1 && isCurrent ? t('monthly.noData') : t('monthly.empty')}
        </Text>
      ) : (
        <>
          <Text style={styles.totals}>
            {t('monthly.totals', { count: shown.totals.sessions, sets: shown.totals.sets })}
            {'\n'}
            {shown.previous.sessions > 0
              ? t('monthly.previous', {
                  count: shown.previous.sessions,
                  sets: shown.previous.sets,
                })
              : t('monthly.previousNone')}
          </Text>

          <View style={styles.chips}>
            {(['progressing', 'stuck', 'declining'] as const)
              .filter((status) => shown.counts[status] > 0)
              .map((status) => (
                <View
                  key={status}
                  style={[styles.chip, { borderColor: statusColor(status, colors) }]}
                >
                  <Text style={[styles.chipText, { color: statusColor(status, colors) }]}>
                    {t(`monthly.chip_${status}`, { count: shown.counts[status] })}
                  </Text>
                </View>
              ))}
          </View>

          {STATUS_ORDER.filter((status) => shown.counts[status] > 0).map((status) => (
            <View key={status} style={styles.group}>
              <Text style={[styles.groupTitle, { color: statusColor(status, colors) }]}>
                {t(`monthly.group_${status}`)}
              </Text>
              {shown.exercises
                .filter((exercise) => exercise.status === status)
                .map((exercise) => {
                  const seed = EXERCISE_BY_KEY.get(exercise.exerciseKey);
                  const name = seed
                    ? isHebrew
                      ? seed.nameHe
                      : seed.nameEn
                    : exercise.exerciseKey;
                  const expanded = open === exercise.exerciseKey;
                  const Caret = expanded ? CaretUp : CaretDown;
                  const now = exercise.to.sets;
                  const then = exercise.from?.sets ?? null;
                  const detail =
                    status === 'progressing'
                      ? gainText(exercise)
                      : status === 'stuck'
                        ? t('monthly.flat', { count: exercise.flat })
                        : t('monthly.sessions', { count: exercise.sessions });
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
                            {name}
                          </Text>
                          <Text style={styles.sets} numberOfLines={1}>
                            {setText(topOf(now))}
                            {then ? (
                              <Text style={styles.was}>
                                {'  '}
                                {t('progress.was', { value: setText(topOf(then)) })}
                              </Text>
                            ) : null}
                          </Text>
                          {detail ? <Text style={styles.detail}>{detail}</Text> : null}
                        </View>
                        <Caret size={16} color={colors.textMuted} />
                      </Pressable>

                      {expanded ? (
                        <View style={styles.body}>
                          {exercise.from ? (
                            <Text style={styles.compare}>
                              {t('monthly.compareDates', {
                                to: day(exercise.to.startedAt),
                                from: day(exercise.from.startedAt),
                              })}
                            </Text>
                          ) : null}
                          {(exercise.pairs.length > 0
                            ? exercise.pairs
                            : now.map((set, i) => ({
                                position: i + 1,
                                now: set,
                                then: null,
                                change: 'added' as const,
                              }))
                          ).map((pair) => (
                            <View key={pair.position} style={styles.setRow}>
                              {exercise.from ? (
                                <SetChangeMark change={pair.change} />
                              ) : (
                                <View style={styles.markSpace} />
                              )}
                              <Text style={styles.setLabel}>
                                {t('progress.setN', { n: pair.position })}
                              </Text>
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
                          {exercise.tip ? (
                            <Banner tone="warning">{tipText(exercise.tip)}</Banner>
                          ) : null}
                          <Pressable
                            onPress={() =>
                              router.push({
                                pathname: '/exercise/[key]',
                                params: { key: exercise.exerciseKey },
                              })
                            }
                            accessibilityRole="link"
                            style={styles.link}
                          >
                            <Text style={styles.linkText}>{t('monthly.openExercise')}</Text>
                          </Pressable>
                        </View>
                      ) : null}
                    </View>
                  );
                })}
            </View>
          ))}
        </>
      )}
    </Card>
  );
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

const createStyles = (colors: ColorPalette) =>
  StyleSheet.create<{
    monthRow: ViewStyle;
    arrow: ViewStyle;
    arrowOff: ViewStyle;
    monthName: TextStyle;
    empty: TextStyle;
    totals: TextStyle;
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
    compare: TextStyle;
    setRow: ViewStyle;
    markSpace: ViewStyle;
    setLabel: TextStyle;
    setText: ViewStyle;
    setNow: TextStyle;
    setMissing: TextStyle;
    setWas: TextStyle;
    link: ViewStyle;
    linkText: TextStyle;
  }>({
    monthRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginTop: spacing.md,
      gap: spacing.sm,
    },
    arrow: {
      width: 44,
      height: 44,
      borderRadius: radius.pill,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.surfaceRaised,
    },
    arrowOff: { opacity: 0.3 },
    monthName: {
      flex: 1,
      color: colors.text,
      fontSize: fontSize.lg,
      fontWeight: fontWeight.bold,
      textAlign: 'center',
    },
    empty: {
      color: colors.textMuted,
      fontSize: fontSize.sm,
      marginTop: spacing.lg,
      textAlign: 'center',
    },
    totals: {
      color: colors.textSecondary,
      fontSize: fontSize.sm,
      lineHeight: 20,
      marginTop: spacing.md,
      textAlign: 'center',
    },
    chips: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      justifyContent: 'center',
      gap: spacing.sm,
      marginTop: spacing.md,
    },
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
    row: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border,
    },
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
    compare: { color: colors.textMuted, fontSize: fontSize.xs, textAlign: 'auto' },
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
    link: { alignSelf: 'flex-start', paddingVertical: spacing.sm, minHeight: 44 },
    linkText: { color: colors.accent, fontSize: fontSize.sm, fontWeight: fontWeight.bold },
  });
