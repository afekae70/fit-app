/**
 * One workout over time: the latest against the one before, month against month, and every
 * session of it.
 *
 * Opened from the progress tab, for one workout by its name (see `progress/workoutProgress.ts`
 * for what counts as the same workout and how it is measured).
 *
 * A lifting workout is read by its sets — the weight and reps of each, and how many — and never
 * by weight x reps added up (see `progress/setBySet.ts`). Three questions, in the order asked:
 *
 *  1. **Was the last one better than the one before?** How many sets got better, stayed and got
 *     worse; the sets, reps and time side by side; and then set by set: every working set of
 *     every exercise beside the same set last time, with an arrow.
 *  2. **Did I progress this month?** A bar per month for the sets that got better in it, each
 *     against the session before, with how many sessions there were.
 *  3. **And over all of them?** Every session, newest first, each with how its sets stood
 *     against the one before it. Tapping one opens it.
 *
 * A run or a timed workout keeps its one number — the distance or the time — and its change.
 *
 * Read from the phone's own database each time the screen comes into view; nothing here is
 * stored, and nothing leaves the phone to draw it.
 */

import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, StyleSheet, View, type TextStyle, type ViewStyle } from 'react-native';
import { Pressable } from '../src/components/Pressable.js';
import { Text } from '../src/components/Text.js';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { EXERCISE_BY_KEY } from '@fit/shared';

import { useCurrentUserId } from '../src/auth/CurrentUserProvider.js';
import { Card, EmptyState, Hint, ScreenHeader, SectionTitle } from '../src/components/ui.js';
import {
  ChangeChip,
  SetChangeMark,
  TallyChip,
  useMetricText,
  useSetText,
} from '../src/components/WorkoutProgressList.js';
import { getExecutor } from '../src/db/provider.js';
import { listSessionSets, listWorkoutPoints } from '../src/db/workoutProgress.js';
import {
  exerciseSetChanges,
  improved,
  totalReps,
  workoutTally,
  type ExerciseSets,
} from '../src/progress/setBySet.js';
import {
  byMonth,
  groupByWorkout,
  latestComparison,
  minutesOf,
  monthTallies,
  sessionsWithChange,
  setsOf,
  talliesAlongLine,
  type WorkoutLine,
} from '../src/progress/workoutProgress.js';
import { useTheme } from '../src/ThemeProvider.js';
import { fontSize, fontWeight, radius, spacing, type ColorPalette } from '../src/theme.js';
import { ChartBar } from '../src/components/ChartBar.js';
import { ChartLineUp } from 'phosphor-react-native';

/** How tall the tallest month's bar is drawn. */
const BAR_HEIGHT = 110;

export default function WorkoutProgressScreen() {
  const { t, i18n } = useTranslation();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const userId = useCurrentUserId();
  const metricText = useMetricText();
  const setText = useSetText();
  const { name: key } = useLocalSearchParams<{ name: string }>();
  const isHebrew = i18n.language === 'he';

  const [line, setLine] = useState<WorkoutLine | null | undefined>(undefined);
  /** Every session's working sets, by id. Only fetched for a lifting workout. */
  const [sets, setSets] = useState<ReadonlyMap<string, ExerciseSets[]>>(new Map());
  /** The month whose bar was touched, by position; null reads the latest. */
  const [chosenMonth, setChosenMonth] = useState<number | null>(null);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      void (async () => {
        const db = await getExecutor();
        const found =
          groupByWorkout(await listWorkoutPoints(db, userId)).find((entry) => entry.key === key) ??
          null;
        const bySession =
          found && latestComparison(found).metric === 'strength'
            ? await listSessionSets(
                db,
                userId,
                found.sessions.map((session) => session.id),
              )
            : new Map<string, ExerciseSets[]>();
        if (cancelled) return;
        setSets(bySession);
        setLine(found);
      })();
      return () => {
        cancelled = true;
      };
    }, [userId, key]),
  );

  const comparison = useMemo(() => (line ? latestComparison(line) : null), [line]);
  const strength = comparison?.metric === 'strength';

  // A lifting workout: the latest against the one before, set by set.
  const changes = useMemo(
    () =>
      strength && comparison?.previous
        ? exerciseSetChanges(
            setsOf(sets, comparison.latest.id),
            setsOf(sets, comparison.previous.id),
          )
        : [],
    [strength, comparison, sets],
  );
  const headTally = useMemo(() => workoutTally(changes), [changes]);
  // And every session against the one before it, for the months and the list.
  const along = useMemo(
    () =>
      line && strength
        ? talliesAlongLine(line, (latestId, previousId) =>
            workoutTally(exerciseSetChanges(setsOf(sets, latestId), setsOf(sets, previousId))),
          )
        : [],
    [line, strength, sets],
  );
  const strengthMonths = useMemo(() => monthTallies(along), [along]);
  const valueMonths = useMemo(
    () => (line && comparison && !strength ? byMonth(line, comparison.metric) : []),
    [line, comparison, strength],
  );
  const sessions = useMemo(
    () => (line && comparison && !strength ? sessionsWithChange(line, comparison.metric) : []),
    [line, comparison, strength],
  );

  const day = (moment: string) =>
    new Date(moment).toLocaleDateString(i18n.language, { day: 'numeric', month: 'short' });
  const monthName = (month: string) =>
    new Date(`${month}-01T12:00:00`).toLocaleDateString(i18n.language, { month: 'short' });

  const repsOf = (sessionId: string) => totalReps(setsOf(sets, sessionId));

  // One bar per month either way: the sets that got better in it, or the typical distance or
  // time. Drawn by the same chart below.
  const months = strength
    ? strengthMonths.map((month) => ({
        month: month.month,
        sessions: month.sessions,
        height: month.improved,
        line: t('progress.monthImproved', {
          month: monthName(month.month),
          improved: month.improved,
          worse: month.worse,
          count: month.sessions,
        }),
        chip: <TallyChip tally={month.tally} />,
      }))
    : valueMonths.map((month) => ({
        month: month.month,
        sessions: month.sessions,
        height: month.average,
        line: comparison
          ? t('progress.monthSummary', {
              month: monthName(month.month),
              value: metricText(month.average, comparison.metric),
              count: month.sessions,
            })
          : '',
        chip: <ChangeChip change={month.change} />,
      }));
  const tallest = Math.max(1, ...months.map((month) => month.height));
  // Which month the summary line reads. A month that is no longer there falls back to the
  // latest, as does choosing nothing.
  const shownMonth =
    chosenMonth !== null && chosenMonth < months.length ? chosenMonth : months.length - 1;

  // Newest first, each with how it stood against the one before it.
  const rows = strength
    ? [...along].reverse().map(({ session, tally }) => ({
        session,
        value: metricText(session.sets, 'strength'),
        chip: <TallyChip tally={tally} />,
      }))
    : sessions.map(({ session, value, change }) => ({
        session,
        value: comparison ? metricText(value, comparison.metric) : '',
        chip: <ChangeChip change={change} />,
      }));

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
          icon={ChartLineUp}
          title={t('progress.workoutGone')}
          hint={t('progress.workoutGoneHint')}
        />
      ) : null}

      {line && comparison ? (
        <>
          {/* ------------------------------------------------ the last one and the one before */}
          <Card index={0} tone="accent">
            <SectionTitle>{t('progress.lastVsPrevious')}</SectionTitle>
            {comparison.previous && strength ? (
              <>
                <View style={styles.headline}>
                  <Text style={styles.headlineValue}>{improved(headTally)}</Text>
                  <Text style={styles.headlineUnit}>
                    {t('progress.setsImproved', { count: improved(headTally) })}
                  </Text>
                </View>
                <Text style={styles.headlineWas}>
                  {t('progress.tallyLine', {
                    same: headTally.same,
                    down: headTally.down + headTally.dropped,
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
                    label={t('progress.reps')}
                    now={String(repsOf(comparison.latest.id))}
                    then={String(repsOf(comparison.previous.id))}
                  />
                  <Pair
                    label={t('progress.duration')}
                    now={`${minutesOf(comparison.latest)} ${t('history.minutes')}`}
                    then={`${minutesOf(comparison.previous)} ${t('history.minutes')}`}
                  />
                </View>
              </>
            ) : comparison.previous ? (
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

          {/* -------------------------------------------------------------------- set by set */}
          {changes.length > 0 ? (
            <Card index={1}>
              <SectionTitle>{t('progress.setBySet')}</SectionTitle>
              <Hint>{t('progress.setBySetHint')}</Hint>
              <View style={styles.lifts}>
                {changes.map((change) => {
                  const seed = EXERCISE_BY_KEY.get(change.exerciseKey);
                  const isNew = change.verdict === 'new';
                  return (
                    <View key={change.exerciseKey} style={styles.lift}>
                      <View style={styles.liftHeader}>
                        <Text style={styles.liftName} numberOfLines={1}>
                          {seed ? (isHebrew ? seed.nameHe : seed.nameEn) : change.exerciseKey}
                        </Text>
                        {isNew ? (
                          <Text style={styles.liftNew}>{t('progress.direction_new')}</Text>
                        ) : (
                          <TallyChip tally={change.tally} />
                        )}
                      </View>
                      {change.pairs.map((pair) => (
                        <View key={pair.position} style={styles.setRow}>
                          {isNew ? (
                            <View style={styles.markSpace} />
                          ) : (
                            <SetChangeMark change={pair.change} />
                          )}
                          <Text style={styles.setLabel}>
                            {t('progress.setN', { n: pair.position })}
                          </Text>
                          <View style={styles.setText}>
                            <Text style={[styles.liftSets, !pair.now && styles.setMissing]}>
                              {pair.now ? setText(pair.now) : t('progress.setChange_dropped')}
                            </Text>
                            {pair.then ? (
                              <Text style={styles.liftWas}>
                                {t('progress.was', { value: setText(pair.then) })}
                              </Text>
                            ) : null}
                          </View>
                        </View>
                      ))}
                    </View>
                  );
                })}
              </View>
            </Card>
          ) : null}

          {/* -------------------------------------------------------------- month by month */}
          <Card index={2}>
            <SectionTitle>{t('progress.monthByMonth')}</SectionTitle>
            <Hint>{t(strength ? 'progress.monthImprovedHint' : 'progress.monthByMonthHint')}</Hint>
            <View style={styles.bars}>
              {months.map((month, index) => {
                // The month the line underneath is about: the latest, until one is touched.
                const current = index === shownMonth;
                return (
                  <Pressable
                    key={month.month}
                    onPress={() => setChosenMonth(index === months.length - 1 ? null : index)}
                    accessibilityRole="button"
                    accessibilityState={{ selected: current }}
                    accessibilityLabel={month.line}
                    style={styles.barColumn}
                  >
                    {month.chip}
                    <View style={styles.barTrack}>
                      <ChartBar
                        index={index}
                        muted={!current}
                        corner={radius.sm}
                        height={Math.max(4, (month.height / tallest) * BAR_HEIGHT)}
                      />
                    </View>
                    <Text style={[styles.barMonth, current && styles.barMonthCurrent]}>
                      {monthName(month.month)}
                    </Text>
                    <Text style={styles.barCount}>×{month.sessions}</Text>
                  </Pressable>
                );
              })}
            </View>
            {months[shownMonth] ? (
              <Text style={styles.monthLine}>{months[shownMonth].line}</Text>
            ) : null}
          </Card>

          {/* ---------------------------------------------------------------- every session */}
          <Card index={3}>
            <SectionTitle>{t('progress.allSessions')}</SectionTitle>
            <View style={styles.sessions}>
              {rows.map(({ session, value, chip }) => (
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
                  <Text style={styles.sessionValue}>{value}</Text>
                  <View style={styles.sessionChange}>{chip}</View>
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
    headlineUnit: TextStyle;
    headlineWas: TextStyle;
    pairs: ViewStyle;
    pair: ViewStyle;
    pairLabel: TextStyle;
    pairNow: TextStyle;
    pairThen: TextStyle;
    lifts: ViewStyle;
    lift: ViewStyle;
    liftHeader: ViewStyle;
    liftName: TextStyle;
    liftNew: TextStyle;
    setRow: ViewStyle;
    markSpace: ViewStyle;
    setLabel: TextStyle;
    setText: ViewStyle;
    liftSets: TextStyle;
    setMissing: TextStyle;
    liftWas: TextStyle;
    bars: ViewStyle;
    barColumn: ViewStyle;
    barTrack: ViewStyle;
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
    headlineUnit: {
      flexShrink: 1,
      color: colors.text,
      fontSize: fontSize.md,
      fontWeight: fontWeight.medium,
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
      color: colors.textMuted,
      fontSize: fontSize.sm,
      fontVariant: ['tabular-nums'],
      textAlign: 'auto',
    },

    lifts: { gap: spacing.lg, marginTop: spacing.sm },
    lift: { gap: spacing.xs },
    liftHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
    liftName: {
      flex: 1,
      color: colors.text,
      fontSize: fontSize.md,
      fontWeight: fontWeight.bold,
      textAlign: 'auto',
    },
    liftNew: { color: colors.accent, fontSize: fontSize.xs, fontWeight: fontWeight.bold },
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
    liftSets: {
      color: colors.text,
      fontSize: fontSize.sm,
      fontWeight: fontWeight.bold,
      fontVariant: ['tabular-nums'],
      textAlign: 'auto',
    },
    setMissing: { color: colors.textMuted, fontWeight: fontWeight.regular },
    liftWas: {
      color: colors.textMuted,
      fontSize: fontSize.xs,
      fontVariant: ['tabular-nums'],
      textAlign: 'auto',
    },

    // Bars grow from a shared floor, so every column ends its track at the bottom.
    bars: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.sm, marginTop: spacing.md },
    barColumn: { flex: 1, alignItems: 'center', gap: spacing.xxs },
    barTrack: { height: BAR_HEIGHT, justifyContent: 'flex-end', alignSelf: 'stretch' },
    barMonth: { color: colors.textMuted, fontSize: fontSize.xs },
    barMonthCurrent: { color: colors.text, fontWeight: fontWeight.bold },
    barCount: { color: colors.textMuted, fontSize: 10, fontVariant: ['tabular-nums'] },
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
