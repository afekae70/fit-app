/**
 * The workouts tab when nothing is in progress: start a workout, or look back through history.
 *
 * History is filtered by period — the last week, month, half year, year, or all of it. An
 * unfiltered list capped at the latest fifty answered "what did I do recently" and nothing else;
 * a period answers "how much did I train this month", and the count at the top of the list says
 * it without having to scroll and add up.
 *
 * Repeating a saved workout used to sit above history as its own section. It was taken out: the
 * plan is where a workout is started from now, and a second way in, listing the same workouts
 * again, was one more thing between the Start button and the history.
 */

import { useMemo } from 'react';
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

import type { SessionSummaryRow } from '../db/workouts.js';
import { HISTORY_PERIODS, type HistoryPeriod } from '../workout/historyPeriod.js';
import { useTheme } from '../ThemeProvider.js';
import { useUnit } from '../UnitsProvider.js';
import { formatVolume, weightUnitKey } from '../units.js';
import { fontSize, radius, spacing, type ColorPalette } from '../theme.js';
import { EmptyState, ScreenHeader } from './ui.js';

export interface WorkoutHomeProps {
  history: SessionSummaryRow[];
  period: HistoryPeriod;
  onChangePeriod: (period: HistoryPeriod) => void;
  onStartEmpty: () => void;
  onOpenSession: (sessionId: string) => void;
  contentPadding: { paddingTop: number; paddingBottom: number };
  refreshing: boolean;
  onRefresh: () => void;
}

function formatDate(iso: string, withYear: boolean): string {
  // The year only once the list can span more than one: "12 Mar" is ambiguous in a year of
  // history and noise in a week of it.
  return new Date(iso).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    ...(withYear ? { year: 'numeric' as const } : {}),
  });
}

function durationMinutes(startedAt: string, endedAt: string | null): number | null {
  if (!endedAt) return null;
  return Math.max(
    0,
    Math.round((new Date(endedAt).getTime() - new Date(startedAt).getTime()) / 60000),
  );
}

export function WorkoutHome({
  history,
  period,
  onChangePeriod,
  onStartEmpty,
  onOpenSession,
  contentPadding,
  refreshing,
  onRefresh,
}: WorkoutHomeProps) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const unit = useUnit();
  const styles = useMemo(() => createStyles(colors), [colors]);

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[styles.content, contentPadding]}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} />
      }
    >
      <ScreenHeader title={t('tabs.workout')} back />

      <Pressable onPress={onStartEmpty} style={styles.primaryButton} accessibilityRole="button">
        <Text style={styles.primaryButtonText}>{t('workout.startButton')}</Text>
      </Pressable>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>{t('history.title')}</Text>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.periodRow}
        >
          {HISTORY_PERIODS.map((option) => {
            const on = option === period;
            return (
              <Pressable
                key={option}
                onPress={() => onChangePeriod(option)}
                accessibilityRole="button"
                accessibilityState={{ selected: on }}
                style={({ pressed }) => [
                  styles.periodChip,
                  on && styles.periodChipOn,
                  pressed && styles.pressed,
                ]}
              >
                <Text style={[styles.periodText, on && styles.periodTextOn]}>
                  {t(`history.period.${option}`)}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>

        {history.length > 0 ? (
          <Text style={styles.sectionHint}>{t('history.count', { count: history.length })}</Text>
        ) : null}

        {history.length === 0 ? (
          period === 'all' ? (
            <EmptyState emoji="🏋️" title={t('history.empty')} hint={t('history.emptyHint')} />
          ) : (
            // Not the first-run message: there is history, just none in this window, and saying
            // "no workouts yet" here would read as history lost.
            <EmptyState emoji="🗓️" title={t('history.emptyPeriod')} hint={t('history.emptyPeriodHint')} />
          )
        ) : (
          history.map((session) => {
            const minutes = durationMinutes(session.started_at, session.ended_at);
            return (
              <Pressable
                key={session.id}
                onPress={() => onOpenSession(session.id)}
                style={styles.historyRow}
                accessibilityRole="button"
              >
                <View style={styles.rowMain}>
                  <Text style={styles.historyName}>
                    {session.name ?? t('history.unnamed')}
                  </Text>
                  <Text style={styles.rowMeta}>
                    {formatDate(session.started_at, period === 'halfYear' || period === 'year' || period === 'all')}
                    {session.ended_at === null ? ` · ${t('history.inProgress')}` : ''}
                    {minutes !== null ? ` · ${minutes} ${t('history.minutes')}` : ''}
                  </Text>
                  <Text style={styles.rowStats}>
                    {session.exercise_count} {t('history.exercises')} · {session.set_count}{' '}
                    {t('history.sets')}
                    {session.volume_load > 0
                      ? ` · ${formatVolume(session.volume_load, unit)} ${t(`common.${weightUnitKey(unit)}`)}`
                      : ''}
                  </Text>
                </View>
              </Pressable>
            );
          })
        )}
      </View>
    </ScrollView>
  );
}

const createStyles = (colors: ColorPalette) =>
  StyleSheet.create<{
    screen: ViewStyle;
    content: ViewStyle;
    primaryButton: ViewStyle;
    primaryButtonText: TextStyle;
    section: ViewStyle;
    sectionTitle: TextStyle;
    sectionHint: TextStyle;
    periodRow: ViewStyle;
    periodChip: ViewStyle;
    periodChipOn: ViewStyle;
    periodText: TextStyle;
    periodTextOn: TextStyle;
    pressed: ViewStyle;
    historyRow: ViewStyle;
    historyName: TextStyle;
    rowMain: ViewStyle;
    rowMeta: TextStyle;
    rowStats: TextStyle;
  }>({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { paddingHorizontal: spacing.lg },
  primaryButton: {
    backgroundColor: colors.accentSoft,
    borderWidth: 1,
    borderColor: colors.accent,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
  primaryButtonText: { color: colors.accent, fontSize: fontSize.md, fontWeight: '700' },
  section: { marginTop: spacing.xl },
  sectionTitle: {
    color: colors.text,
    fontSize: fontSize.md,
    fontWeight: '700',
    textAlign: 'auto',
  },
  sectionHint: {
    color: colors.textMuted,
    fontSize: fontSize.xs,
    marginTop: 2,
    marginBottom: spacing.sm,
    textAlign: 'auto',
  },
  periodRow: { gap: spacing.xs, paddingVertical: spacing.sm },
  periodChip: {
    paddingVertical: 6,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceRaised,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
  },
  periodChipOn: { backgroundColor: colors.accentSoft, borderColor: colors.accentBorder },
  periodText: { color: colors.textMuted, fontSize: fontSize.sm },
  periodTextOn: { color: colors.accent, fontWeight: '700' },
  pressed: { opacity: 0.7 },
  historyRow: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    borderRadius: radius.md,
    padding: spacing.md,
    marginTop: spacing.sm,
  },
  historyName: { color: colors.text, fontSize: fontSize.md, fontWeight: '700', textAlign: 'auto' },
  rowMain: { flex: 1 },
  rowMeta: { color: colors.textMuted, fontSize: fontSize.xs, marginTop: 2, textAlign: 'auto' },
  rowStats: { color: colors.textMuted, fontSize: fontSize.xs, marginTop: 4, textAlign: 'auto' },
});
