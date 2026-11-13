/**
 * Water week by week: on how many days of the week the day's aim was reached.
 *
 * Asked for by the owner (2026-11-12): "how many times each week I reach my water goal". The
 * water card above it is one day; this is the habit. The reading is `food/waterWeek.ts`.
 *
 * Two parts:
 *  - **The week**: its seven days as dots — reached, short, nothing written down, or still to
 *    come — and the count of days reached out of the days that have happened.
 *  - **The weeks before**: one bar per week, the last eight, as tall as the days reached in it.
 *    Touching a bar shows that week's days above; the current week is shown until one is touched.
 *
 * Every dot says in words what it means (for a screen reader, and so colour is never the only
 * cue). Nothing here animates beyond ChartBar's own growth, so there is no driver to mix.
 */

import { useFocusEffect } from 'expo-router';
import { Check, Drop } from 'phosphor-react-native';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { useCurrentUserId } from '../auth/CurrentUserProvider.js';
import { listBodyMetrics } from '../db/metrics.js';
import { getExecutor } from '../db/provider.js';
import { localDate, parseLocalDate } from '../db/schedule.js';
import { listWaterByDay } from '../db/water.js';
import { litres } from '../food/water.js';
import { waterWeeks, waterWeeksFrom, type WaterDay, type WaterWeek } from '../food/waterWeek.js';
import { hapticLight } from '../haptics.js';
import { useTheme } from '../ThemeProvider.js';
import { fontSize, fontWeight, radius, shadow, spacing, type ColorPalette } from '../theme.js';
import { ChartBar } from './ChartBar.js';
import { Pressable } from './Pressable.js';
import { Text } from './Text.js';

const WEEKS = 8;
const BAR_HEIGHT = 72;

export function WaterWeekCard({
  refreshKey = 0,
}: {
  /** Bumped when water is added elsewhere on the screen, to read the weeks again. */
  refreshKey?: number;
}) {
  const { t, i18n } = useTranslation();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const userId = useCurrentUserId();

  const [weeks, setWeeks] = useState<WaterWeek[] | null>(null);
  /** The week whose days are shown, by position; null is the current week. */
  const [chosen, setChosen] = useState<number | null>(null);

  const load = useCallback(async () => {
    const db = await getExecutor();
    const today = localDate(new Date());
    const [daily, weighings] = await Promise.all([
      listWaterByDay(db, userId, waterWeeksFrom(today, WEEKS), today),
      listBodyMetrics(db, userId, 400),
    ]);
    setWeeks(waterWeeks(daily, weighings, today, WEEKS));
  }, [userId]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  useEffect(() => {
    if (refreshKey > 0) void load();
  }, [refreshKey, load]);

  if (!weeks || weeks.length === 0) return null;

  const shownIndex = chosen !== null && chosen < weeks.length ? chosen : weeks.length - 1;
  const week = weeks[shownIndex]!;
  const isCurrent = shownIndex === weeks.length - 1;

  const shortDate = (day: string) =>
    parseLocalDate(day).toLocaleDateString(i18n.language, { day: 'numeric', month: 'numeric' });
  const weekday = (day: string) =>
    parseLocalDate(day).toLocaleDateString(i18n.language, { weekday: 'narrow' });
  const longDay = (day: string) =>
    parseLocalDate(day).toLocaleDateString(i18n.language, {
      weekday: 'long',
      day: 'numeric',
      month: 'short',
    });

  const dayLabel = (d: WaterDay) => {
    const args = { day: longDay(d.day), drunk: litres(d.ml), goal: litres(d.goalMl) };
    if (d.future) return t('waterWeek.dayFuture', args);
    if (d.reached) return t('waterWeek.dayReached', args);
    if (!d.logged) return t('waterWeek.dayNone', args);
    return t('waterWeek.dayShort', args);
  };

  const weekLine = (w: WaterWeek, index: number) =>
    t(index === weeks.length - 1 ? 'waterWeek.thisWeekLine' : 'waterWeek.weekLine', {
      date: shortDate(w.start),
      reached: w.reached,
      counted: w.counted,
    });

  return (
    <View style={styles.card}>
      <View style={styles.titleRow}>
        <Drop size={18} color={colors.info} weight="fill" />
        <Text style={styles.title}>
          {isCurrent ? t('waterWeek.title') : t('waterWeek.titleOf', { date: shortDate(week.start) })}
        </Text>
      </View>

      <Text style={styles.amount} accessibilityLabel={weekLine(week, shownIndex)}>
        {week.reached}
        <Text style={styles.amountOf}> / {week.counted}</Text>
        <Text style={styles.amountUnit}> {t('waterWeek.daysAtGoal')}</Text>
      </Text>

      {/* The week's seven days, Sunday first; the row mirrors itself in Hebrew. */}
      <View style={styles.days}>
        {week.days.map((d) => (
          <View key={d.day} style={styles.day} accessible accessibilityLabel={dayLabel(d)}>
            <View
              style={[
                styles.dot,
                d.reached && { backgroundColor: colors.info, borderColor: colors.info },
                !d.reached && d.logged && !d.future && { borderColor: colors.info },
                d.future && styles.dotFuture,
              ]}
            >
              {d.reached ? (
                <Check size={14} color={colors.bg} weight="bold" />
              ) : d.logged && !d.future ? (
                // Short of the aim: how far it got, as a fill from the bottom of the dot.
                <View
                  style={[
                    styles.dotPart,
                    { height: `${Math.round(Math.min(1, d.ml / d.goalMl) * 100)}%` },
                  ]}
                />
              ) : null}
            </View>
            <Text style={[styles.dayName, d.future && styles.dayNameFuture]}>{weekday(d.day)}</Text>
          </View>
        ))}
      </View>

      <Text style={styles.sectionLabel}>{t('waterWeek.weeksTitle')}</Text>
      <View style={styles.bars}>
        {weeks.map((w, index) => {
          const selected = index === shownIndex;
          return (
            <Pressable
              key={w.start}
              onPress={() => {
                hapticLight();
                setChosen(index === weeks.length - 1 ? null : index);
              }}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              accessibilityLabel={weekLine(w, index)}
              style={styles.barColumn}
            >
              <Text style={[styles.barCount, selected && styles.barCountSelected]}>{w.reached}</Text>
              <View style={styles.barTrack}>
                <ChartBar
                  index={index}
                  muted={!selected}
                  corner={radius.sm}
                  height={Math.max(3, (w.reached / 7) * BAR_HEIGHT)}
                />
              </View>
              <Text style={[styles.barDate, selected && styles.barDateSelected]} numberOfLines={1}>
                {index === weeks.length - 1 ? t('waterWeek.thisWeek') : shortDate(w.start)}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <Text style={styles.note}>{t('waterWeek.hint')}</Text>
    </View>
  );
}

const createStyles = (colors: ColorPalette) =>
  StyleSheet.create({
    card: {
      backgroundColor: colors.surface,
      borderRadius: radius.xl,
      padding: spacing.lg,
      gap: spacing.sm,
      ...shadow(colors.shadow).card,
    },
    titleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
    title: { color: colors.textSecondary, fontSize: fontSize.sm, fontWeight: fontWeight.bold },
    amount: {
      color: colors.text,
      fontSize: 30,
      fontWeight: fontWeight.bold,
      fontVariant: ['tabular-nums'],
      textAlign: 'auto',
    },
    amountOf: { color: colors.textMuted, fontSize: fontSize.lg, fontWeight: fontWeight.medium },
    amountUnit: { color: colors.textSecondary, fontSize: fontSize.sm, fontWeight: fontWeight.medium },
    days: { flexDirection: 'row', justifyContent: 'space-between', marginTop: spacing.xs },
    day: { alignItems: 'center', gap: spacing.xxs, flex: 1 },
    dot: {
      width: 30,
      height: 30,
      borderRadius: 15,
      borderWidth: 2,
      borderColor: colors.border,
      alignItems: 'center',
      justifyContent: 'center',
      overflow: 'hidden',
    },
    dotFuture: { borderStyle: 'dashed', opacity: 0.5 },
    dotPart: {
      position: 'absolute',
      bottom: 0,
      start: 0,
      end: 0,
      backgroundColor: colors.info,
      opacity: 0.35,
    },
    dayName: { color: colors.textSecondary, fontSize: fontSize.xs, fontWeight: fontWeight.medium },
    dayNameFuture: { color: colors.textMuted },
    sectionLabel: {
      color: colors.textMuted,
      fontSize: fontSize.xs,
      fontWeight: fontWeight.bold,
      marginTop: spacing.md,
      textAlign: 'auto',
    },
    // Bars grow from a shared floor, so every column ends its track at the bottom.
    bars: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.xs },
    barColumn: { flex: 1, alignItems: 'center', gap: spacing.xxs, minHeight: 44 },
    barTrack: { height: BAR_HEIGHT, justifyContent: 'flex-end', alignSelf: 'stretch' },
    barCount: { color: colors.textMuted, fontSize: fontSize.xs, fontVariant: ['tabular-nums'] },
    barCountSelected: { color: colors.text, fontWeight: fontWeight.bold },
    barDate: { color: colors.textMuted, fontSize: 10, fontVariant: ['tabular-nums'] },
    barDateSelected: { color: colors.text, fontWeight: fontWeight.bold },
    note: { color: colors.textMuted, fontSize: fontSize.xs, lineHeight: 18, textAlign: 'auto' },
  });
