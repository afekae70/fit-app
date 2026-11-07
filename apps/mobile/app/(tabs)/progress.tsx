/**
 * Progression analysis across every exercise with enough history.
 *
 * A pushed screen reached from the Coach tab (see `(tabs)/coach.tsx`'s header), not a tab of
 * its own — the coach tab is the chat directly now.
 *
 * Every exercise is read by the monthly review at the top (`MonthlyReviewCard`): by sets,
 * weight and reps, where it is progressing and where it is stuck. It replaced a list of cards
 * that labelled each exercise by its estimated one-rep max, which could call a lift stalling
 * on the same screen the review called it progressing. The estimate is still what the AI
 * coach is handed (`coach/payload.ts`).
 */

import { setsPerMuscle, untrainedMuscles, type MuscleWork } from '@fit/shared/calculations';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { RefreshControl, ScrollView, StyleSheet, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useCurrentUserId } from '../../src/auth/CurrentUserProvider.js';
import { Card, Hint, ScreenHeader, SectionTitle, SkeletonScreen } from '../../src/components/ui.js';
import { MonthlyReviewCard } from '../../src/components/MonthlyReviewCard.js';
import { WeeklyReviewCard } from '../../src/components/WeeklyReviewCard.js';
import {
  ConsistencyGrid,
  PersonalRecordList,
  WeeklySetsChart,
} from '../../src/components/ProgressCharts.js';
import { WorkoutProgressList } from '../../src/components/WorkoutProgressList.js';
import {
  consistencyHeat,
  personalRecords,
  setCountsSince,
  weeklySets,
  type PersonalRecord,
  type TrainingDay,
  type WeeklySets,
} from '../../src/db/progression.js';
import { MuscleVolumeCard } from '../../src/components/MuscleVolumeCard.js';
import { getExecutor } from '../../src/db/provider.js';
import { listSessionSets, listWorkoutPoints } from '../../src/db/workoutProgress.js';
import { exerciseSetChanges, workoutTally, type Tally } from '../../src/progress/setBySet.js';
import {
  groupByWorkout,
  metricOf,
  setsOf,
  type WorkoutLine,
} from '../../src/progress/workoutProgress.js';
import { useTheme } from '../../src/ThemeProvider.js';
import { spacing, type ColorPalette } from '../../src/theme.js';

export default function ProgressScreen() {
  const { t, i18n } = useTranslation();
  const insets = useSafeAreaInsets();
  const isHebrew = i18n.language === 'he';
  const userId = useCurrentUserId();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const [weekly, setWeekly] = useState<WeeklySets[]>([]);
  const [heat, setHeat] = useState<TrainingDay[]>([]);
  const [records, setRecords] = useState<PersonalRecord[]>([]);
  // Every named workout as a line of its sessions. See progress/workoutProgress.ts.
  const [workouts, setWorkouts] = useState<WorkoutLine[]>([]);
  // Per workout: its latest session's sets against the one before. Lifting workouts only.
  const [tallies, setTallies] = useState<ReadonlyMap<string, Tally | null>>(new Map());
  const [muscles, setMuscles] = useState<MuscleWork[]>([]);
  const [loading, setLoading] = useState(true);
  // Bumped by pull-to-refresh, for the monthly review, which reads its own month.
  const [refreshKey, setRefreshKey] = useState(0);

  const reload = useCallback(async () => {
    const db = await getExecutor();

    const lines = groupByWorkout(await listWorkoutPoints(db, userId));
    const lifting = lines.filter((line) => metricOf(line) === 'strength');
    const bySession = await listSessionSets(
      db,
      userId,
      lifting.flatMap((line) => line.sessions.slice(-2).map((session) => session.id)),
    );
    setTallies(
      new Map(
        lifting.map((line) => {
          const latest = line.sessions.at(-1)!;
          const previous = line.sessions.at(-2);
          return [
            line.key,
            previous
              ? workoutTally(
                  exerciseSetChanges(setsOf(bySession, latest.id), setsOf(bySession, previous.id)),
                )
              : null,
          ];
        }),
      ),
    );
    setWorkouts(lines);
    setWeekly(await weeklySets(db, userId));
    setHeat(await consistencyHeat(db, userId));

    // Seven days back from now, not "since Monday". A calendar week makes the card almost empty
    // every Monday morning and near-complete every Sunday night, which says more about the day
    // it is read on than about the training.
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    setMuscles(setsPerMuscle(await setCountsSince(db, userId, weekAgo)));
    setRecords(await personalRecords(db, userId));
    setLoading(false);
  }, [userId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const [refreshing, setRefreshing] = useState(false);
  const handleRefresh = useCallback(() => {
    setRefreshing(true);
    setRefreshKey((key) => key + 1);
    void reload().finally(() => setRefreshing(false));
  }, [reload]);

  if (loading) {
    return <SkeletonScreen paddingTop={spacing.xxl} />;
  }

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[
        styles.content,
        { paddingTop: spacing.lg, paddingBottom: insets.bottom + spacing.xxl },
      ]}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={handleRefresh}
          tintColor={colors.accent}
        />
      }
    >
      <ScreenHeader title={t('progress.title')} />

      {/* First: every exercise of the month, where it is progressing and where it is stuck,
          and what to try for the stuck ones. Asked for as the heart of this screen. */}
      <MonthlyReviewCard index={0} refreshKey={refreshKey} />

      {/* Then the question asked on the way out of the gym: was today's
          leg day better than the last one? Everything below it is about training as a whole. */}
      {workouts.length > 0 ? (
        <Card index={0}>
          <SectionTitle>{t('progress.byWorkout')}</SectionTitle>
          <Hint>{t('progress.byWorkoutHint')}</Hint>
          <WorkoutProgressList lines={workouts} tallies={tallies} />
        </Card>
      ) : null}

      {/* Above the charts it is, in effect, a reading of. Draws nothing when there is neither
          a review to show nor a way to ask for one. */}
      <WeeklyReviewCard />

      {weekly.some((w) => w.sets > 0) ? (
        <>
          <Card index={0}>
            <SectionTitle>{t('progress.weeklySets')}</SectionTitle>
            <WeeklySetsChart weeks={weekly} />
          </Card>

          <Card index={1}>
            <SectionTitle>{t('progress.consistency')}</SectionTitle>
            <Hint>{t('progress.consistencyHint')}</Hint>
            <ConsistencyGrid days={heat} />
          </Card>

          {muscles.length > 0 ? (
            <Card index={2}>
              <SectionTitle>{t('progress.byMuscle')}</SectionTitle>
              <Hint>{t('progress.byMuscleHint')}</Hint>
              <MuscleVolumeCard worked={muscles} untrained={untrainedMuscles(muscles)} />
            </Card>
          ) : null}

          {records.length > 0 ? (
            <Card index={2}>
              <SectionTitle>{t('progress.records')}</SectionTitle>
              <PersonalRecordList records={records} isHebrew={isHebrew} />
            </Card>
          ) : null}
        </>
      ) : null}
    </ScrollView>
  );
}

const createStyles = (colors: ColorPalette) =>
  StyleSheet.create<{ screen: ViewStyle; content: ViewStyle }>({
    screen: { flex: 1, backgroundColor: colors.bg },
    content: { paddingHorizontal: spacing.lg },
  });
