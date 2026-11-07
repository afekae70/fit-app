/**
 * The monthly review on the Progress screen: every exercise of a month judged once for the whole
 * month — improved even slightly, no change, or stuck / declined — told by part of the body and
 * exercise by exercise, with one thing to try where it did not improve.
 *
 * Opens on the last whole month (a new review is ready on the first of every month) and moves
 * back through every month with training, and forward to this month so far. The reading itself
 * is `@fit/shared/progress` (`monthlyReview.ts`, `bodyAreas.ts`) — the coach website reads the
 * same — and this only lays it out.
 *
 * Two ways to narrow the list, one at a time. The shortcuts (the owner asked for "shortcuts to
 * the ones I improved, the ones with no change, and the ones where I am stuck or declined", and
 * then that a tap on one "shows only the exercises I improved in") replace the body-area
 * overview with just the exercises of that verdict, grouped by area, with the tip already open
 * for each one that did not improve. Without a shortcut, a tap on a body area narrows the list
 * to that area. Each exercise is a row that opens in place: its best sets of the month
 * against the sets before, and the tip. Nothing here animates beyond the card's own entrance, so
 * there is no driver to mix (see CLAUDE.md).
 *
 * The list scrolls inside the card (asked for: "a sub-scroll in the monthly progress part"). The
 * month, the totals and the shortcuts stay where they are; what is below them sits in a box about
 * half the screen tall with its own scroll, so the charts further down the screen are not behind
 * every exercise of the month. `nestedScrollEnabled` is what lets it scroll inside the screen's
 * own ScrollView on Android.
 */

import { EXERCISE_BY_KEY } from '@fit/shared/catalog';
import {
  areaOfExercise,
  BODY_AREAS,
  defaultMonth,
  monthOf,
  nextWeightKg,
  reviewableMonths,
  reviewByArea,
  reviewMonth,
  STATUS_ORDER,
  topSet,
  type AreaMonth,
  type AreaStatus,
  type BodyArea,
  type ExerciseMonth,
  type MonthReview,
  type MonthStatus,
  type Tip,
  type WorkingSet,
} from '@fit/shared/progress';
import { router, useFocusEffect } from 'expo-router';
import { CaretDown, CaretLeft, CaretRight, CaretUp, Check } from 'phosphor-react-native';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

import { useCurrentUserId } from '../auth/CurrentUserProvider.js';
import { listTrainingMonths, loadMonthHistory } from '../db/monthlyReview.js';
import { getExecutor } from '../db/provider.js';
import { hapticLight } from '../haptics.js';
import { isRtlLanguage, type Language } from '../i18n/index.js';
import { useTheme } from '../ThemeProvider.js';
import { fontSize, fontWeight, radius, spacing, type ColorPalette } from '../theme.js';
import { kgToDisplay, weightUnitKey } from '../units.js';
import { useUnit } from '../UnitsProvider.js';
import { Pressable } from './Pressable.js';
import { Text } from './Text.js';
import { Banner, Card, Hint, SectionTitle } from './ui.js';
import { SetChangeMark, useSetText } from './WorkoutProgressList.js';

/** The shortcuts, in the owner's order. "New" joins them only in a month that has one. */
const SHORTCUTS: readonly MonthStatus[] = ['improved', 'same', 'declined', 'new'];

/** Which colour each verdict is told in — always beside its words, never instead of them. */
function statusColor(status: AreaStatus, colors: ColorPalette): string {
  if (status === 'improved') return colors.accent;
  if (status === 'declined') return colors.warning;
  if (status === 'new') return colors.info;
  if (status === 'skipped') return colors.textMuted;
  return colors.textSecondary;
}

interface Shown {
  review: MonthReview;
  areas: AreaMonth[];
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
  const [shown, setShown] = useState<Shown | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const { height: screenHeight } = useWindowDimensions();
  // The list's own scroll, put back to the top whenever what it lists changes.
  const inner = useRef<ScrollView>(null);
  const toTop = () => inner.current?.scrollTo({ y: 0, animated: false });
  const [statusFilter, setStatusFilter] = useState<MonthStatus | null>(null);
  const [areaFilter, setAreaFilter] = useState<BodyArea | null>(null);
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
      const review = reviewMonth(history, month);
      if (live) setShown({ review, areas: reviewByArea(review, history) });
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
        case 'twoMonths':
          return t('monthly.tip_twoMonths');
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
    toTop();
    hapticLight();
    setOpen(null);
    setMonth(to);
  };

  const day = (iso: string) =>
    new Date(iso).toLocaleDateString(i18n.language, { day: 'numeric', month: 'short' });

  const exerciseName = (key: string) => {
    const seed = EXERCISE_BY_KEY.get(key);
    return seed ? (isHebrew ? seed.nameHe : seed.nameEn) : key;
  };

  const gainText = (exercise: ExerciseMonth): string | null => {
    const gain = exercise.gain;
    if (!gain) return null;
    const parts: string[] = [];
    if (gain.weightKg > 0) parts.push(t('monthly.gainWeight', { value: weight(gain.weightKg) }));
    if (gain.reps > 0) parts.push(t('monthly.gainReps', { count: gain.reps }));
    if (gain.sets > 0) parts.push(t('monthly.gainSets', { count: gain.sets }));
    return parts.length > 0 ? parts.join(' · ') : null;
  };

  const countsText = (counts: Readonly<Record<MonthStatus, number>>) =>
    STATUS_ORDER.filter((status) => counts[status] > 0)
      .map((status) => t(`monthly.count_${status}`, { count: counts[status] }))
      .join(' · ');

  const toggleStatus = (status: MonthStatus) => {
    hapticLight();
    toTop();
    setOpen(null);
    setAreaFilter(null);
    setStatusFilter((current) => (current === status ? null : status));
  };
  const toggleArea = (area: BodyArea) => {
    hapticLight();
    toTop();
    setOpen(null);
    setStatusFilter(null);
    setAreaFilter((current) => (current === area ? null : area));
  };
  const clearFilters = () => {
    hapticLight();
    toTop();
    setOpen(null);
    setStatusFilter(null);
    setAreaFilter(null);
  };

  const current = shown?.review.month === month ? shown : null;
  const review = current?.review ?? null;
  const visible = (review?.exercises ?? []).filter(
    (exercise) =>
      (statusFilter === null || exercise.status === statusFilter) &&
      (areaFilter === null || areaOfExercise(exercise.exerciseKey) === areaFilter),
  );

  /** One exercise's row. `tipOpen` shows its tip without a tap, as a shortcut's list does. */
  const renderExercise = (exercise: ExerciseMonth, tipOpen: boolean) => {
    const expanded = open === exercise.exerciseKey;
    const Caret = expanded ? CaretUp : CaretDown;
    const best = exercise.best.map((b) => b.set);
    const then = exercise.from?.sets ?? null;
    const detail =
      exercise.status === 'improved'
        ? (gainText(exercise) ?? t('monthly.sessions', { count: exercise.sessions }))
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
              {exerciseName(exercise.exerciseKey)}
            </Text>
            <Text style={styles.sets} numberOfLines={1}>
              {setText(topOf(best))}
              {then ? (
                <Text style={styles.was}>
                  {'  '}
                  {t('progress.was', { value: setText(topOf(then)) })}
                </Text>
              ) : null}
            </Text>
            <Text style={styles.detail}>
              {t(`bodyArea.${areaOfExercise(exercise.exerciseKey)}`)} · {detail}
            </Text>
          </View>
          <Caret size={16} color={colors.textMuted} />
        </Pressable>

        {tipOpen && !expanded && exercise.tip ? (
          <View style={styles.tipInline}>
            <Banner tone="warning">{tipText(exercise.tip)}</Banner>
          </View>
        ) : null}

        {expanded ? (
          <View style={styles.body}>
            {exercise.from ? (
              <Text style={styles.compare}>
                {t(exercise.fromBeforeMonth ? 'monthly.compareBest' : 'monthly.compareBestFirst', {
                  from: day(exercise.from.startedAt),
                })}
              </Text>
            ) : null}
            {(exercise.pairs.length > 0
              ? exercise.pairs
              : best.map((set, i) => ({
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
            {exercise.tip ? <Banner tone="warning">{tipText(exercise.tip)}</Banner> : null}
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
  };

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

      {!current || !review ? null : review.exercises.length === 0 ? (
        <Text style={styles.empty}>
          {months.length <= 1 && isCurrent ? t('monthly.noData') : t('monthly.empty')}
        </Text>
      ) : (
        <>
          <Text style={styles.totals}>
            {t('monthly.totals', { count: review.totals.sessions, sets: review.totals.sets })}
            {'\n'}
            {review.previous.sessions > 0
              ? t('monthly.previous', {
                  count: review.previous.sessions,
                  sets: review.previous.sets,
                })
              : t('monthly.previousNone')}
          </Text>

          {/* The shortcuts: each says how many it holds, and a second tap shows all again. */}
          <Text style={styles.label}>{t('monthly.shortcutsLabel')}</Text>
          <View style={styles.shortcuts}>
            {SHORTCUTS.filter((status) => status !== 'new' || review.counts.new > 0).map(
              (status) => {
                const selected = statusFilter === status;
                const count = review.counts[status];
                const tone = statusColor(status, colors);
                return (
                  <Pressable
                    key={status}
                    onPress={() => toggleStatus(status)}
                    disabled={count === 0 && !selected}
                    accessibilityRole="button"
                    accessibilityState={{ selected, disabled: count === 0 && !selected }}
                    style={[
                      styles.shortcut,
                      { borderColor: selected ? tone : colors.border },
                      selected && { backgroundColor: colors.surfaceRaised },
                      count === 0 && !selected && styles.shortcutOff,
                    ]}
                  >
                    <Text style={[styles.shortcutCount, { color: tone }]}>{count}</Text>
                    <Text style={styles.shortcutText} numberOfLines={2}>
                      {t(`monthly.shortcut_${status}`)}
                    </Text>
                  </Pressable>
                );
              },
            )}
          </View>

          <ScrollView
            ref={inner}
            style={[styles.inner, { maxHeight: Math.round(screenHeight * 0.55) }]}
            nestedScrollEnabled
            persistentScrollbar
            keyboardShouldPersistTaps="handled"
          >
            {statusFilter ? (
              // A shortcut: only its exercises, grouped by body area.
              <View style={styles.filtered}>
                <View style={styles.filterRow}>
                  <Text style={[styles.filterTitle, { color: statusColor(statusFilter, colors) }]}>
                    {t(`monthly.shortcut_${statusFilter}`)} ·{' '}
                    {t('monthly.exerciseCount', { count: visible.length })}
                  </Text>
                  <Pressable
                    onPress={clearFilters}
                    accessibilityRole="button"
                    hitSlop={8}
                    style={styles.link}
                  >
                    <Text style={styles.linkText}>{t('monthly.clearFilter')}</Text>
                  </Pressable>
                </View>
                <Text style={styles.detail}>{t(`monthly.statusHint_${statusFilter}`)}</Text>

                {visible.length === 0 ? (
                  <Text style={styles.empty}>{t('monthly.filteredEmpty')}</Text>
                ) : null}

                {BODY_AREAS.filter((area) =>
                  visible.some((exercise) => areaOfExercise(exercise.exerciseKey) === area),
                ).map((area) => {
                  const inArea = visible.filter(
                    (exercise) => areaOfExercise(exercise.exerciseKey) === area,
                  );
                  return (
                    <View key={area} style={styles.group}>
                      <Text style={[styles.groupTitle, { color: colors.textSecondary }]}>
                        {t(`bodyArea.${area}`)} · {inArea.length}
                      </Text>
                      {inArea.map((exercise) =>
                        renderExercise(exercise, statusFilter !== 'improved'),
                      )}
                    </View>
                  );
                })}
              </View>
            ) : (
              <>
                {/* By body area: the month at a glance, one line per area. A tap narrows the list. */}
                <Text style={styles.groupHeading}>{t('monthly.areasTitle')}</Text>
                {current.areas.map((area) => {
                  const selected = areaFilter === area.area;
                  const tone = statusColor(area.status, colors);
                  const skipped = area.status === 'skipped';
                  const counts = skipped ? '' : countsText(area.counts);
                  const sets = [
                    area.sets > 0 ? t('monthly.areaSets', { count: area.sets }) : null,
                    area.previousSets > 0
                      ? t('monthly.areaSetsBefore', { count: area.previousSets })
                      : null,
                  ]
                    .filter(Boolean)
                    .join(' · ');
                  return (
                    <Pressable
                      key={area.area}
                      onPress={() => toggleArea(area.area)}
                      disabled={skipped}
                      accessibilityRole="button"
                      accessibilityState={{ selected, disabled: skipped }}
                      style={[
                        styles.areaRow,
                        selected && {
                          borderColor: colors.accentBorder,
                          backgroundColor: colors.surfaceRaised,
                        },
                      ]}
                    >
                      <View style={[styles.areaDot, { backgroundColor: tone }]} />
                      <View style={styles.rowText}>
                        <View style={styles.areaHead}>
                          <Text style={styles.name} numberOfLines={1}>
                            {t(`bodyArea.${area.area}`)}
                          </Text>
                          <Text style={[styles.areaStatus, { color: tone }]}>
                            {t(`monthly.areaStatus_${area.status}`)}
                          </Text>
                        </View>
                        {counts ? <Text style={styles.detail}>{counts}</Text> : null}
                        {sets ? <Text style={styles.detail}>{sets}</Text> : null}
                      </View>
                      {selected ? <Check size={16} color={colors.accent} weight="bold" /> : null}
                    </Pressable>
                  );
                })}

                {areaFilter ? (
                  <View style={styles.filterRow}>
                    <Text style={styles.filterText}>
                      {t('monthly.showing', { what: t(`bodyArea.${areaFilter}`) })}
                    </Text>
                    <Pressable
                      onPress={clearFilters}
                      accessibilityRole="button"
                      hitSlop={8}
                      style={styles.link}
                    >
                      <Text style={styles.linkText}>{t('monthly.clearFilter')}</Text>
                    </Pressable>
                  </View>
                ) : null}

                {visible.length === 0 ? (
                  <Text style={styles.empty}>{t('monthly.filteredEmpty')}</Text>
                ) : null}

                {STATUS_ORDER.filter((status) => visible.some((e) => e.status === status)).map(
                  (status) => (
                    <View key={status} style={styles.group}>
                      <Text style={[styles.groupTitle, { color: statusColor(status, colors) }]}>
                        {t(`monthly.group_${status}`)}
                      </Text>
                      {visible
                        .filter((exercise) => exercise.status === status)
                        .map((exercise) => renderExercise(exercise, false))}
                    </View>
                  ),
                )}
              </>
            )}
          </ScrollView>
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
    label: TextStyle;
    shortcuts: ViewStyle;
    shortcut: ViewStyle;
    shortcutOff: ViewStyle;
    shortcutCount: TextStyle;
    shortcutText: TextStyle;
    groupHeading: TextStyle;
    areaRow: ViewStyle;
    areaDot: ViewStyle;
    areaHead: ViewStyle;
    areaStatus: TextStyle;
    filterRow: ViewStyle;
    filterText: TextStyle;
    filtered: ViewStyle;
    inner: ViewStyle;
    filterTitle: TextStyle;
    tipInline: ViewStyle;
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
    label: {
      color: colors.textMuted,
      fontSize: fontSize.xs,
      fontWeight: fontWeight.bold,
      marginTop: spacing.lg,
      textAlign: 'auto',
    },
    shortcuts: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xs },
    shortcut: {
      flex: 1,
      minHeight: 64,
      paddingVertical: spacing.sm,
      paddingHorizontal: spacing.xs,
      borderRadius: radius.md,
      borderWidth: 1,
      alignItems: 'center',
      justifyContent: 'center',
      gap: 2,
    },
    shortcutOff: { opacity: 0.45 },
    shortcutCount: {
      fontSize: fontSize.lg,
      fontWeight: fontWeight.bold,
      fontVariant: ['tabular-nums'],
    },
    shortcutText: {
      color: colors.textSecondary,
      fontSize: fontSize.xs,
      fontWeight: fontWeight.bold,
      textAlign: 'center',
    },
    groupHeading: {
      color: colors.text,
      fontSize: fontSize.md,
      fontWeight: fontWeight.bold,
      marginTop: spacing.lg,
      marginBottom: spacing.xs,
      textAlign: 'auto',
    },
    areaRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      minHeight: 52,
      paddingVertical: spacing.sm,
      paddingHorizontal: spacing.sm,
      marginBottom: spacing.xs,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.borderSubtle,
    },
    areaDot: { width: 10, height: 10, borderRadius: 5 },
    areaHead: {
      flexDirection: 'row',
      alignItems: 'baseline',
      justifyContent: 'space-between',
      gap: spacing.sm,
    },
    areaStatus: { fontSize: fontSize.sm, fontWeight: fontWeight.bold },
    filterRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: spacing.sm,
      marginTop: spacing.md,
    },
    filterText: { flex: 1, color: colors.textSecondary, fontSize: fontSize.sm, textAlign: 'auto' },
    filtered: { marginTop: spacing.md },
    // A hairline above and below, so the box reads as a window onto a longer list.
    inner: {
      marginTop: spacing.md,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
    },
    filterTitle: { flex: 1, fontSize: fontSize.md, fontWeight: fontWeight.bold, textAlign: 'auto' },
    tipInline: { paddingBottom: spacing.md },
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
