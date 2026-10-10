/**
 * One workout over time: the latest against the one before, month against month, and every
 * session of it.
 *
 * Opened from the progress tab, for one workout by its name (see `progress/workoutProgress.ts`
 * for what counts as the same workout and which number it is measured by).
 *
 * Three questions, in the order they are asked:
 *
 *  1. **Was the last one better than the one before?** The two side by side — the workout's
 *     number, the sets, the time — and then lift by lift: the best set of each exercise now
 *     and then, with an arrow.
 *  2. **Is this month better than last month?** A bar per month for the typical workout of
 *     that month, with how many there were. Typical, not total: five leg days move more weight
 *     than three whatever happened in each.
 *  3. **And over all of them?** Every session, newest first, each with its change from the one
 *     before it. Tapping one opens it.
 *
 * Read from the phone's own database each time the screen comes into view; nothing here is
 * stored, and nothing leaves the phone to draw it.
 */

import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { EXERCISE_BY_KEY } from '@fit/shared';

import { useCurrentUserId } from '../src/auth/CurrentUserProvider.js';
import { Card, EmptyState, Hint, ScreenHeader, SectionTitle } from '../src/components/ui.js';
import { ChangeChip, useMetricText } from '../src/components/WorkoutProgressList.js';
import { getExecutor } from '../src/db/provider.js';
import { listExerciseBests, listWorkoutPoints } from '../src/db/workoutProgress.js';
import {
  byMonth,
  exerciseChanges,
  groupByWorkout,
  latestComparison,
  minutesOf,
  sessionsWithChange,
  type ExerciseBest,
  type ExerciseChange,
  type WorkoutLine,
} from '../src/progress/workoutProgress.js';
import { useTheme } from '../src/ThemeProvider.js';
import { fontSize, fontWeight, radius, spacing, type ColorPalette } from '../src/theme.js';
import { useUnit } from '../src/UnitsProvider.js';
import { kgToDisplay, weightUnitKey } from '../src/units.js';

/** How tall the tallest month's bar is drawn. */
const BAR_HEIGHT = 110;

export default function WorkoutProgressScreen() {
  const { t, i18n } = useTranslation();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const userId = useCurrentUserId();
  const unit = useUnit();
  const metricText = useMetricText();
  const { name: key } = useLocalSearchParams<{ name: string }>();
  const isHebrew = i18n.language === 'he';

  const [line, setLine] = useState<WorkoutLine | null | undefined>(undefined);
  const [lifts, setLifts] = useState<ExerciseChange[]>([]);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      void (async () => {
        const db = await getExecutor();
        const found =
          groupByWorkout(await listWorkoutPoints(db, userId)).find((entry) => entry.key === key) ??
          null;
        if (cancelled) return;
        setLine(found);
        if (!found) return;

        const latest = found.sessions.at(-1)!;
        const previous = found.sessions.at(-2);
        const [now, then] = await Promise.all([
          listExerciseBests(db, userId, latest.id),
          previous
            ? listExerciseBests(db, userId, previous.id)
            : Promise.resolve<ExerciseBest[]>([]),
        ]);
        if (!cancelled) setLifts(exerciseChanges(now, then));
      })();
      return () => {
        cancelled = true;
      };
    }, [userId, key]),
  );

  const comparison = useMemo(() => (line ? latestComparison(line) : null), [line]);
  const months = useMemo(
    () => (line && comparison ? byMonth(line, comparison.metric) : []),
    [line, comparison],
  );
  const sessions = useMemo(
    () => (line && comparison ? sessionsWithChange(line, comparison.metric) : []),
    [line, comparison],
  );

  const day = (moment: string) =>
    new Date(moment).toLocaleDateString(i18n.language, { day: 'numeric', month: 'short' });
  const monthName = (month: string) =>
    new Date(`${month}-01T12:00:00`).toLocaleDateString(i18n.language, { month: 'short' });

  const weightLabel = t(`common.${weightUnitKey(unit)}`);
  /** A best set as it is said: "100 kg × 8", or just the reps for an exercise with no weight. */
  const setText = (best: ExerciseBest | null) => {
    if (!best) return '—';
    if (best.weightKg !== null && best.weightKg > 0) {
      return `${kgToDisplay(best.weightKg, unit)} ${weightLabel} × ${best.reps ?? 0}`;
    }
    return `× ${best.reps ?? 0}`;
  };

  const tallest = Math.max(1, ...months.map((month) => month.average));

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[
        styles.content,
        { paddingTop: spacing.lg, paddingBottom: insets.bottom + spacing.xxl },
      ]}
      showsVerticalScrollIndicator={false}
    >
      <ScreenHeader title={line?.name ?? t('progress.byWorkout')} />

      {line === null ? (
        <EmptyState
          emoji="📈"
          title={t('progress.workoutGone')}
          hint={t('progress.workoutGoneHint')}
        />
      ) : null}

      {line && comparison ? (
        <>
          {/* ------------------------------------------------ the last one and the one before */}
          <Card index={0} tone="accent">
            <SectionTitle>{t('progress.lastVsPrevious')}</SectionTitle>
            {comparison.previous ? (
              <>
                <View style={styles.headline}>
                  <Text style={styles.headlineValue}>
                    {metricText(comparison.latestValue, comparison.metric)}
                  </Text>
                  <ChangeChip change={comparison.change} />
                </View>
                <Text style={styles.headlineWas}>
                  {t('progress.previousWas', {
                    value: metricText(comparison.previousValue ?? 0, comparison.metric),
                    date: day(comparison.previous.startedAt),
                  })}
                </Text>

                <View style={styles.pairs}>
                  <Pair
                    label={t('history.sets')}
                    now={String(comparison.latest.sets)}
                    then={String(comparison.previous.sets)}
                  />
                  <Pair
                    label={t('progress.duration')}
                    now={`${minutesOf(comparison.latest)} ${t('history.minutes')}`}
                    then={`${minutesOf(comparison.previous)} ${t('history.minutes')}`}
                  />
                </View>
              </>
            ) : (
              <>
                <Text style={styles.headlineValue}>
                  {metricText(comparison.latestValue, comparison.metric)}
                </Text>
                <Hint>{t('progress.firstTime')}</Hint>
              </>
            )}
          </Card>

          {/* ------------------------------------------------------------------ lift by lift */}
          {lifts.length > 0 ? (
            <Card index={1}>
              <SectionTitle>{t('progress.liftByLift')}</SectionTitle>
              <Hint>{t('progress.liftByLiftHint')}</Hint>
              <View style={styles.lifts}>
                {lifts.map((lift) => {
                  const seed = EXERCISE_BY_KEY.get(lift.exerciseKey);
                  return (
                    <View key={lift.exerciseKey} style={styles.lift}>
                      <Text
                        style={[
                          styles.arrow,
                          lift.direction === 'up' && styles.arrowUp,
                          lift.direction === 'down' && styles.arrowDown,
                        ]}
                        accessibilityLabel={t(`progress.direction_${lift.direction}`)}
                      >
                        {lift.direction === 'up'
                          ? '▲'
                          : lift.direction === 'down'
                            ? '▼'
                            : lift.direction === 'new'
                              ? '＋'
                              : '＝'}
                      </Text>
                      <View style={styles.liftText}>
                        <Text style={styles.liftName} numberOfLines={1}>
                          {seed ? (isHebrew ? seed.nameHe : seed.nameEn) : lift.exerciseKey}
                        </Text>
                        <Text style={styles.liftSets}>
                          {setText(lift.latest)}
                          {lift.previous ? (
                            <Text style={styles.liftWas}>
                              {'  '}
                              {t('progress.was', { value: setText(lift.previous) })}
                            </Text>
                          ) : null}
                        </Text>
                      </View>
                    </View>
                  );
                })}
              </View>
            </Card>
          ) : null}

          {/* -------------------------------------------------------------- month by month */}
          <Card index={2}>
            <SectionTitle>{t('progress.monthByMonth')}</SectionTitle>
            <Hint>{t('progress.monthByMonthHint')}</Hint>
            <View style={styles.bars}>
              {months.map((month, index) => {
                const current = index === months.length - 1;
                return (
                  <View key={month.month} style={styles.barColumn}>
                    <ChangeChip change={month.change} />
                    <View style={styles.barTrack}>
                      <View
                        style={[
                          styles.bar,
                          current && styles.barCurrent,
                          { height: Math.max(4, (month.average / tallest) * BAR_HEIGHT) },
                        ]}
                      />
                    </View>
                    <Text style={[styles.barMonth, current && styles.barMonthCurrent]}>
                      {monthName(month.month)}
                    </Text>
                    <Text style={styles.barCount}>×{month.sessions}</Text>
                  </View>
                );
              })}
            </View>
            {months.length > 0 ? (
              <Text style={styles.monthLine}>
                {t('progress.monthSummary', {
                  month: monthName(months.at(-1)!.month),
                  value: metricText(months.at(-1)!.average, comparison.metric),
                  count: months.at(-1)!.sessions,
                })}
              </Text>
            ) : null}
          </Card>

          {/* ---------------------------------------------------------------- every session */}
          <Card index={3}>
            <SectionTitle>{t('progress.allSessions')}</SectionTitle>
            <View style={styles.sessions}>
              {sessions.map(({ session, value, change }) => (
                <Pressable
                  key={session.id}
                  onPress={() =>
                    router.push({ pathname: '/session/[id]', params: { id: session.id } })
                  }
                  accessibilityRole="button"
                  style={({ pressed }) => [styles.session, pressed && styles.pressed]}
                >
                  <Text style={styles.sessionDate}>
                    {new Date(session.startedAt).toLocaleDateString(i18n.language, {
                      weekday: 'short',
                      day: 'numeric',
                      month: 'short',
                    })}
                  </Text>
                  <Text style={styles.sessionValue}>{metricText(value, comparison.metric)}</Text>
                  <View style={styles.sessionChange}>
                    <ChangeChip change={change} />
                  </View>
                </Pressable>
              ))}
            </View>
          </Card>
        </>
      ) : null}
    </ScrollView>
  );
}

/** One measure of the workout, now and last time, one above the other. */
function Pair({ label, now, then }: { label: string; now: string; then: string }) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  return (
    <View style={styles.pair}>
      <Text style={styles.pairLabel}>{label}</Text>
      <Text style={styles.pairNow}>{now}</Text>
      <Text style={styles.pairThen}>{then}</Text>
    </View>
  );
}

const createStyles = (colors: ColorPalette) =>
  StyleSheet.create<{
    screen: ViewStyle;
    content: ViewStyle;
    headline: ViewStyle;
    headlineValue: TextStyle;
    headlineWas: TextStyle;
    pairs: ViewStyle;
    pair: ViewStyle;
    pairLabel: TextStyle;
    pairNow: TextStyle;
    pairThen: TextStyle;
    lifts: ViewStyle;
    lift: ViewStyle;
    arrow: TextStyle;
    arrowUp: TextStyle;
    arrowDown: TextStyle;
    liftText: ViewStyle;
    liftName: TextStyle;
    liftSets: TextStyle;
    liftWas: TextStyle;
    bars: ViewStyle;
    barColumn: ViewStyle;
    barTrack: ViewStyle;
    bar: ViewStyle;
    barCurrent: ViewStyle;
    barMonth: TextStyle;
    barMonthCurrent: TextStyle;
    barCount: TextStyle;
    monthLine: TextStyle;
    sessions: ViewStyle;
    session: ViewStyle;
    pressed: ViewStyle;
    sessionDate: TextStyle;
    sessionValue: TextStyle;
    sessionChange: ViewStyle;
  }>({
    screen: { flex: 1 },
    content: { paddingHorizontal: spacing.lg, gap: spacing.lg },

    headline: { flexDirection: 'row', alignItems: 'baseline', gap: spacing.md },
    headlineValue: {
      color: colors.text,
      fontSize: 34,
      fontWeight: fontWeight.bold,
      fontVariant: ['tabular-nums'],
      textAlign: 'auto',
    },
    headlineWas: { color: colors.textMuted, fontSize: fontSize.sm, textAlign: 'auto' },
    pairs: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.md },
    pair: {
      flex: 1,
      gap: spacing.xxs,
      padding: spacing.md,
      borderRadius: radius.md,
      backgroundColor: colors.surfaceRaised,
    },
    pairLabel: { color: colors.textMuted, fontSize: fontSize.xs, textAlign: 'auto' },
    pairNow: {
      color: colors.text,
      fontSize: fontSize.lg,
      fontWeight: fontWeight.bold,
      fontVariant: ['tabular-nums'],
      textAlign: 'auto',
    },
    pairThen: {
      color: colors.textFaint,
      fontSize: fontSize.sm,
      fontVariant: ['tabular-nums'],
      textAlign: 'auto',
    },

    lifts: { gap: spacing.md, marginTop: spacing.sm },
    lift: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
    arrow: { width: 18, textAlign: 'center', color: colors.textFaint, fontSize: fontSize.sm },
    arrowUp: { color: colors.accent },
    arrowDown: { color: colors.warning },
    liftText: { flex: 1, gap: spacing.xxs },
    liftName: { color: colors.text, fontSize: fontSize.md, textAlign: 'auto' },
    liftSets: {
      color: colors.text,
      fontSize: fontSize.sm,
      fontWeight: fontWeight.bold,
      fontVariant: ['tabular-nums'],
      textAlign: 'auto',
    },
    liftWas: { color: colors.textMuted, fontWeight: fontWeight.regular },

    // Bars grow from a shared floor, so every column ends its track at the bottom.
    bars: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.sm, marginTop: spacing.md },
    barColumn: { flex: 1, alignItems: 'center', gap: spacing.xxs },
    barTrack: { height: BAR_HEIGHT, justifyContent: 'flex-end', alignSelf: 'stretch' },
    bar: { borderRadius: radius.sm, backgroundColor: colors.accentBorder },
    barCurrent: { backgroundColor: colors.accent },
    barMonth: { color: colors.textMuted, fontSize: fontSize.xs },
    barMonthCurrent: { color: colors.text, fontWeight: fontWeight.bold },
    barCount: { color: colors.textFaint, fontSize: 10, fontVariant: ['tabular-nums'] },
    monthLine: {
      color: colors.textSecondary,
      fontSize: fontSize.sm,
      textAlign: 'auto',
      marginTop: spacing.md,
    },

    sessions: { gap: spacing.xs, marginTop: spacing.sm },
    session: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      minHeight: 44,
      paddingHorizontal: spacing.sm,
      borderRadius: radius.md,
    },
    pressed: { opacity: 0.6 },
    sessionDate: { flex: 1, color: colors.text, fontSize: fontSize.sm, textAlign: 'auto' },
    sessionValue: {
      color: colors.text,
      fontSize: fontSize.sm,
      fontWeight: fontWeight.medium,
      fontVariant: ['tabular-nums'],
    },
    sessionChange: { width: 56, alignItems: 'flex-end' },
  });
