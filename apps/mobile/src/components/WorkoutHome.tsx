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
import { fontSize, radius, shadow, spacing, type ColorPalette } from '../theme.js';
import { EmptyState, ScreenHeader } from './ui.js';

export interface WorkoutHomeProps {
  history: SessionSummaryRow[];
  period: HistoryPeriod;
  onChangePeriod: (period: HistoryPeriod) => void;
  onStartEmpty: () => void;
  onOpenSession: (sessionId: string) => void;
  /**
   * Hold a workout for what can be done to it — edited, or deleted.
   *
   * A tap opens it to be read, and reading is what a finished workout is mostly for; the two
   * things that change it are one press further in, where they cannot be hit by accident while
   * scrolling a list of them.
   */
  onSessionOptions?: (sessionId: string) => void;
  contentPadding: { paddingTop: number; paddingBottom: number };
  refreshing: boolean;
  onRefresh: () => void;
}

function Chip({ label, styles }: { label: string; styles: ReturnType<typeof createStyles> }) {
  return (
    <View style={styles.chip}>
      <Text style={styles.chipText}>{label}</Text>
    </View>
  );
}

/** Sessions in the order they came, cut into months — newest month first, as the list is. */
function groupByMonth(
  history: readonly SessionSummaryRow[],
): { month: string; label: string; sessions: SessionSummaryRow[] }[] {
  const groups: { month: string; label: string; sessions: SessionSummaryRow[] }[] = [];
  for (const session of history) {
    const date = new Date(session.started_at);
    const month = `${date.getFullYear()}-${date.getMonth()}`;
    const last = groups[groups.length - 1];
    if (last && last.month === month) {
      last.sessions.push(session);
      continue;
    }
    groups.push({
      month,
      label: date.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }),
      sessions: [session],
    });
  }
  return groups;
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
  onSessionOptions,
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
      <ScreenHeader title={t('tabs.workout')} />

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
          groupByMonth(history).map((group) => (
            <View key={group.month} style={styles.monthGroup}>
              {/* A month at a time: a flat list of forty workouts is a list nobody finds
                  anything in, and the month is how people remember training. */}
              <View style={styles.monthHeader}>
                <Text style={styles.monthName}>{group.label}</Text>
                <Text style={styles.monthCount}>
                  {t('history.count', { count: group.sessions.length })}
                </Text>
              </View>

              {group.sessions.map((session) => {
                const minutes = durationMinutes(session.started_at, session.ended_at);
                const open = session.ended_at === null;
                return (
                  <Pressable
                    key={session.id}
                    onPress={() => onOpenSession(session.id)}
                    onLongPress={onSessionOptions ? () => onSessionOptions(session.id) : undefined}
                    delayLongPress={320}
                    accessibilityRole="button"
                    style={({ pressed }) => [styles.card, pressed && styles.pressed]}
                  >
                    {/* The day, carried in its own block rather than in the sentence: a list is
                        scanned down this column, not read across. */}
                    <View style={[styles.day, open && styles.dayOpen]}>
                      <Text style={[styles.dayNumber, open && styles.dayOpenText]}>
                        {new Date(session.started_at).getDate()}
                      </Text>
                      <Text style={[styles.dayWeekday, open && styles.dayOpenText]}>
                        {new Date(session.started_at).toLocaleDateString(undefined, {
                          weekday: 'short',
                        })}
                      </Text>
                    </View>

                    <View style={styles.cardMain}>
                      <Text style={styles.cardName} numberOfLines={1}>
                        {session.name ?? t('history.unnamed')}
                      </Text>

                      <View style={styles.chips}>
                        {open ? (
                          <View style={[styles.chip, styles.chipLive]}>
                            <Text style={[styles.chipText, styles.chipLiveText]}>
                              {t('history.inProgress')}
                            </Text>
                          </View>
                        ) : null}
                        {minutes !== null ? (
                          <Chip label={`${minutes} ${t('history.minutes')}`} styles={styles} />
                        ) : null}
                        <Chip
                          label={`${session.exercise_count} ${t('history.exercises')}`}
                          styles={styles}
                        />
                        <Chip label={`${session.set_count} ${t('history.sets')}`} styles={styles} />
                        {session.volume_load > 0 ? (
                          <Chip
                            label={`${formatVolume(session.volume_load, unit)} ${t(
                              `common.${weightUnitKey(unit)}`,
                            )}`}
                            styles={styles}
                          />
                        ) : null}
                      </View>
                    </View>
                  </Pressable>
                );
              })}
            </View>
          ))
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
    monthGroup: ViewStyle;
    monthHeader: ViewStyle;
    monthName: TextStyle;
    monthCount: TextStyle;
    card: ViewStyle;
    day: ViewStyle;
    dayOpen: ViewStyle;
    dayNumber: TextStyle;
    dayWeekday: TextStyle;
    dayOpenText: TextStyle;
    cardMain: ViewStyle;
    cardName: TextStyle;
    chips: ViewStyle;
    chip: ViewStyle;
    chipText: TextStyle;
    chipLive: ViewStyle;
    chipLiveText: TextStyle;
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
  monthGroup: { marginTop: spacing.lg },
  monthHeader: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    marginBottom: spacing.xs,
  },
  monthName: { color: colors.textSecondary, fontSize: fontSize.sm, fontWeight: '700' },
  monthCount: { color: colors.textFaint, fontSize: fontSize.xxs },

  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    ...shadow(colors.shadow).card,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    marginTop: spacing.sm,
  },
  // The date as a block, the way a calendar writes it: the column the eye runs down.
  day: {
    width: 46,
    paddingVertical: 6,
    borderRadius: radius.md,
    backgroundColor: colors.accentSoft,
    alignItems: 'center',
  },
  dayOpen: { backgroundColor: colors.warningSoft },
  dayNumber: {
    color: colors.accent,
    fontSize: fontSize.lg,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  dayWeekday: { color: colors.accent, fontSize: 10, textTransform: 'uppercase' },
  dayOpenText: { color: colors.warning },

  cardMain: { flex: 1, gap: 6 },
  cardName: { color: colors.text, fontSize: fontSize.md, fontWeight: '700', textAlign: 'auto' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: {
    paddingVertical: 3,
    paddingHorizontal: 9,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceRaised,
  },
  chipText: { color: colors.textMuted, fontSize: fontSize.xxs, fontVariant: ['tabular-nums'] },
  // A session still running is the one thing in this list that is not history yet.
  chipLive: { backgroundColor: colors.warningSoft },
  chipLiveText: { color: colors.warning, fontWeight: '700' },
});
