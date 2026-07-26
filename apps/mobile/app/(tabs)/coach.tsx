/**
 * Progression analysis across every exercise with enough history.
 *
 * Deliberately shipped before the AI coach: these numbers are computed in SQL and are exact,
 * and they are the same digest the Phase 5 coach will be handed. Building the analysis first
 * means the model reasons about verified figures instead of deriving its own — and the tab is
 * useful today, with no backend and no API key.
 */

import { EXERCISE_SEED, type ExerciseSeed } from '@fit/shared/catalog';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, StyleSheet, Text, View, type TextStyle, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Banner, Card, EmptyState, Hint, ScreenTitle } from '../../src/components/ui.js';
import { summariseAllProgress, type ExerciseProgressSummary } from '../../src/db/progression.js';
import { getExecutor } from '../../src/db/provider.js';
import { colors, fontSize, fontWeight, radius, spacing } from '../../src/theme.js';

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

const TREND_COLOR: Record<Trend, string> = {
  progressing: colors.accent,
  stalling: colors.warning,
  holding: colors.textSecondary,
};

export default function ProgressScreen() {
  const { t, i18n } = useTranslation();
  const insets = useSafeAreaInsets();
  const isHebrew = i18n.language === 'he';

  const [summaries, setSummaries] = useState<ExerciseProgressSummary[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    const db = await getExecutor();
    setSummaries(await summariseAllProgress(db));
    setLoading(false);
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  if (loading) {
    return (
      <View style={[styles.centered, { paddingTop: insets.top + spacing.xxl }]}>
        <Text style={styles.muted}>{t('common.loading')}</Text>
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[
        styles.content,
        { paddingTop: insets.top + spacing.lg, paddingBottom: insets.bottom + spacing.xxl },
      ]}
    >
      <ScreenTitle>{t('progress.title')}</ScreenTitle>

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

            return (
              <Card key={summary.exerciseKey}>
                <View style={styles.cardHeader}>
                  <Text style={styles.exerciseName}>{label}</Text>
                  <View style={[styles.badge, { borderColor: TREND_COLOR[trend] }]}>
                    <Text style={[styles.badgeText, { color: TREND_COLOR[trend] }]}>
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

const styles = StyleSheet.create<{
  screen: ViewStyle;
  content: ViewStyle;
  centered: ViewStyle;
  muted: TextStyle;
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
