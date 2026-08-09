/**
 * Progression analysis across every exercise with enough history.
 *
 * A pushed screen reached from the Coach tab (see `(tabs)/coach.tsx`'s header), not a tab of
 * its own — the coach tab is the chat directly now, and this is the same digest the coach is
 * handed, one tap away rather than the tab itself.
 */

import { EXERCISE_SEED, type ExerciseSeed } from '@fit/shared/catalog';
import { router } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useCurrentUserId } from '../src/auth/CurrentUserProvider.js';
import {
  Banner,
  Card,
  EmptyState,
  Hint,
  ScreenTitle,
  SectionTitle,
  SkeletonScreen,
} from '../src/components/ui.js';
import {
  ConsistencyGrid,
  PersonalRecordList,
  WeeklyVolumeChart,
} from '../src/components/ProgressCharts.js';
import {
  consistencyHeat,
  personalRecords,
  summariseAllProgress,
  weeklyVolume,
  type ExerciseProgressSummary,
  type PersonalRecord,
  type TrainingDay,
  type WeeklyVolume,
} from '../src/db/progression.js';
import { getExecutor } from '../src/db/provider.js';
import { useTheme } from '../src/ThemeProvider.js';
import { fontSize, fontWeight, radius, spacing, type ColorPalette } from '../src/theme.js';

const EXERCISE_BY_KEY = new Map<string, ExerciseSeed>(
  EXERCISE_SEED.map((exercise) => [exercise.nameEn, exercise]),
);

type Trend = 'progressing' | 'stalling' | 'holding';

function classify(summary: ExerciseProgressSummary): Trend {
  if (summary.assessment.isStalling) return 'stalling';
  const delta = summary.assessment.e1rmDeltaKg ?? 0;
  // A 0.5 kg dead band: below that the difference is rounding on a single rep, not a real
  // strength change, and calling it progress would be flattering noise.
  return delta > 0.5 ? 'progressing' : 'holding';
}

function trendColor(trend: Trend, colors: ColorPalette): string {
  if (trend === 'progressing') return colors.accent;
  if (trend === 'stalling') return colors.warning;
  return colors.textSecondary;
}

export default function ProgressScreen() {
  const { t, i18n } = useTranslation();
  const insets = useSafeAreaInsets();
  const isHebrew = i18n.language === 'he';
  const userId = useCurrentUserId();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const [summaries, setSummaries] = useState<ExerciseProgressSummary[]>([]);
  const [volume, setVolume] = useState<WeeklyVolume[]>([]);
  const [heat, setHeat] = useState<TrainingDay[]>([]);
  const [records, setRecords] = useState<PersonalRecord[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    const db = await getExecutor();
    setSummaries(await summariseAllProgress(db, userId));
    setVolume(await weeklyVolume(db, userId));
    setHeat(await consistencyHeat(db, userId));
    setRecords(await personalRecords(db, userId));
    setLoading(false);
  }, [userId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const [refreshing, setRefreshing] = useState(false);
  const handleRefresh = useCallback(() => {
    setRefreshing(true);
    void reload().finally(() => setRefreshing(false));
  }, [reload]);

  if (loading) {
    return <SkeletonScreen paddingTop={insets.top + spacing.xxl} />;
  }

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[
        styles.content,
        { paddingTop: insets.top + spacing.lg, paddingBottom: insets.bottom + spacing.xxl },
      ]}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={colors.accent} />
      }
    >
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} accessibilityRole="button" hitSlop={8}>
          <Text style={styles.back}>{isHebrew ? '›' : '‹'}</Text>
        </Pressable>
        <ScreenTitle>{t('progress.title')}</ScreenTitle>
      </View>

      {volume.some((w) => w.volumeKg > 0) ? (
        <>
          <Card>
            <SectionTitle>{t('progress.weeklyVolume')}</SectionTitle>
            <WeeklyVolumeChart weeks={volume} />
          </Card>

          <Card>
            <SectionTitle>{t('progress.consistency')}</SectionTitle>
            <Hint>{t('progress.consistencyHint')}</Hint>
            <ConsistencyGrid days={heat} />
          </Card>

          {records.length > 0 ? (
            <Card>
              <SectionTitle>{t('progress.records')}</SectionTitle>
              <PersonalRecordList records={records} isHebrew={isHebrew} />
            </Card>
          ) : null}
        </>
      ) : null}

      {summaries.length === 0 ? (
        <EmptyState emoji="📈" title={t('progress.empty')} hint={t('progress.emptyHint')} />
      ) : (
        <>
          <Hint>{t('progress.subtitle')}</Hint>

          {summaries.map((summary) => {
            const trend = classify(summary);
            const seed = EXERCISE_BY_KEY.get(summary.exerciseKey);
            const label = seed ? (isHebrew ? seed.nameHe : seed.nameEn) : summary.exerciseKey;
            const delta = summary.assessment.e1rmDeltaKg ?? 0;
            const volumeSlope = summary.assessment.volumeSlopePerSession;
            const trendTint = trendColor(trend, colors);

            return (
              <Card key={summary.exerciseKey}>
                <View style={styles.cardHeader}>
                  <Text style={styles.exerciseName}>{label}</Text>
                  <View style={[styles.badge, { borderColor: trendTint }]}>
                    <Text style={[styles.badgeText, { color: trendTint }]}>
                      {t(`progress.${trend}`)}
                    </Text>
                  </View>
                </View>

                <View style={styles.figures}>
                  <View style={styles.figure}>
                    <Text style={styles.figureValue}>
                      {summary.latestE1rm === null ? '—' : summary.latestE1rm.toFixed(1)}
                    </Text>
                    <Text style={styles.figureLabel}>
                      {t('progress.current')} · {t('progress.estimated1rm')}
                    </Text>
                  </View>
                  <View style={styles.figure}>
                    <Text style={styles.figureValue}>
                      {summary.bestE1rm === null ? '—' : summary.bestE1rm.toFixed(1)}
                    </Text>
                    <Text style={styles.figureLabel}>{t('progress.best')}</Text>
                  </View>
                  <View style={styles.figure}>
                    <Text
                      style={[
                        styles.figureValue,
                        {
                          color:
                            delta > 0.5
                              ? colors.accent
                              : delta < -0.5
                                ? colors.danger
                                : colors.text,
                        },
                      ]}
                    >
                      {delta > 0 ? '+' : ''}
                      {delta.toFixed(1)}
                    </Text>
                    <Text style={styles.figureLabel}>{t('progress.change')}</Text>
                  </View>
                </View>

                <Text style={styles.meta}>
                  {summary.sessionCount} {t('progress.sessions')}
                  {volumeSlope !== null
                    ? ` · ${t('progress.volumeTrend')} ${volumeSlope > 0 ? '+' : ''}${Math.round(
                        volumeSlope,
                      )} ${t('progress.perSession')}`
                    : ''}
                </Text>

                {trend === 'stalling' ? (
                  <Banner tone="warning">
                    {summary.assessment.sessionsSinceBest} {t('progress.sinceBest')} ·{' '}
                    {t('progress.stallingHint')}
                  </Banner>
                ) : null}
              </Card>
            );
          })}

          <Banner tone="info">{t('progress.aiNote')}</Banner>
        </>
      )}
    </ScrollView>
  );
}

const createStyles = (colors: ColorPalette) =>
  StyleSheet.create<{
    screen: ViewStyle;
    content: ViewStyle;
    centered: ViewStyle;
    muted: TextStyle;
    header: ViewStyle;
    back: TextStyle;
    cardHeader: ViewStyle;
    exerciseName: TextStyle;
    badge: ViewStyle;
    badgeText: TextStyle;
    figures: ViewStyle;
    figure: ViewStyle;
    figureValue: TextStyle;
    figureLabel: TextStyle;
    meta: TextStyle;
  }>({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { paddingHorizontal: spacing.lg },
  centered: { flex: 1, backgroundColor: colors.bg, alignItems: 'center' },
  muted: { color: colors.textMuted, fontSize: fontSize.sm },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginBottom: spacing.lg },
  back: { color: colors.accent, fontSize: fontSize.xl, fontWeight: fontWeight.bold },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
    gap: spacing.sm,
  },
  exerciseName: {
    flex: 1,
    color: colors.text,
    fontSize: fontSize.md,
    fontWeight: fontWeight.bold,
    textAlign: 'auto',
  },
  badge: {
    paddingVertical: spacing.xxs,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.pill,
    borderWidth: 1,
  },
  badgeText: { fontSize: fontSize.xxs, fontWeight: fontWeight.bold },
  figures: { flexDirection: 'row', gap: spacing.md },
  figure: { flex: 1 },
  figureValue: { color: colors.text, fontSize: fontSize.xl, fontWeight: fontWeight.bold },
  figureLabel: {
    color: colors.textMuted,
    fontSize: fontSize.xxs,
    marginTop: spacing.xxs,
    textAlign: 'auto',
  },
  meta: { color: colors.textMuted, fontSize: fontSize.xs, marginTop: spacing.md, textAlign: 'auto' },
});
