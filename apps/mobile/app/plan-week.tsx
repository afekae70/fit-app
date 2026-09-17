/**
 * The weekly ritual: commit the coming week, one weekday at a time.
 *
 * Opens on the *next* week rather than the current one, because the point of the screen is
 * Saturday evening — deciding what the week ahead looks like while it is still ahead. The
 * current week is reachable with the toggle, since a mid-week change is a real thing that
 * happens and refusing it would send the user to edit rows they cannot see.
 *
 * Every tap writes through immediately, like the rest of this app. There is no Save button
 * because there is nothing to lose: the screen is a view of `scheduled_days`, and leaving it
 * half-finished leaves a half-finished week, which is exactly what the user chose.
 *
 * A day is one of three things, and the difference matters: a workout, a rest the user picked,
 * or undecided. Undecided hands the date back to the rotation in home.ts — so clearing a day is
 * not the same as resting it, and the chips say so.
 */

import { useFocusEffect } from 'expo-router';
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

import { useCurrentUserId } from '../src/auth/CurrentUserProvider.js';
import { FadeSlideIn } from '../src/components/motion.js';
import {
  Banner,
  Card,
  EmptyState,
  Hint,
  ScreenHeader,
  SkeletonScreen,
} from '../src/components/ui.js';
import { getActivePlan, listPlanDays } from '../src/db/plans.js';
import { getExecutor, newId } from '../src/db/provider.js';
import {
  addScheduledWorkout,
  clearScheduledDay,
  getWeek,
  localDate,
  nextWeekStart,
  removeScheduledWorkout,
  seedWeekFromPrevious,
  setScheduledDay,
  weekDates,
  weekStart,
  type ScheduledDay,
} from '../src/db/schedule.js';
import { useTheme } from '../src/ThemeProvider.js';
import { fontSize, fontWeight, radius, spacing, type ColorPalette } from '../src/theme.js';

interface PlanDayOption {
  id: string;
  label: string;
}

export default function PlanWeekScreen() {
  const { t, i18n } = useTranslation();
  const insets = useSafeAreaInsets();
  const userId = useCurrentUserId();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const [start, setStart] = useState(() => nextWeekStart(localDate(new Date())));
  const [week, setWeek] = useState<ScheduledDay[]>([]);
  const [options, setOptions] = useState<PlanDayOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [seeded, setSeeded] = useState(false);

  const load = useCallback(
    async (forStart: string) => {
      const db = await getExecutor();
      const plan = await getActivePlan(db, userId);

      if (plan) {
        const days = await listPlanDays(db, plan.id);
        setOptions(
          days.map((day) => ({
            id: day.id,
            label: day.name?.trim() || `${t('plan.day')} ${day.day_index}`,
          })),
        );

        // Pre-filled from the last planned week, so the ritual is a confirmation rather than a
        // blank form every Saturday. Only fills days nobody has decided for this week.
        const copied = await seedWeekFromPrevious(db, userId, newId, forStart);
        setSeeded(copied);
      } else {
        setOptions([]);
      }

      setWeek(await getWeek(db, userId, forStart));
      setLoading(false);
    },
    [userId, t],
  );

  useFocusEffect(
    useCallback(() => {
      void load(start);
    }, [load, start]),
  );

  const choose = (date: string, planDayId: string | null) => {
    void (async () => {
      const db = await getExecutor();
      await setScheduledDay(db, userId, newId, date, planDayId);
      setWeek(await getWeek(db, userId, start));
    })();
  };

  /**
   * A workout chip toggles. Tapping a second workout on a day that already has one adds it
   * beside the first rather than replacing it — two sessions on one day is a plan, and the
   * chips already say which are on. Tapping one that is on takes it off.
   */
  const toggle = (date: string, planDayId: string, on: boolean) => {
    void (async () => {
      const db = await getExecutor();
      if (on) await removeScheduledWorkout(db, userId, newId, date, planDayId);
      else await addScheduledWorkout(db, userId, newId, date, planDayId);
      setWeek(await getWeek(db, userId, start));
    })();
  };

  const clear = (date: string) => {
    void (async () => {
      const db = await getExecutor();
      await clearScheduledDay(db, userId, date);
      setWeek(await getWeek(db, userId, start));
    })();
  };

  const switchTo = (next: string) => {
    setStart(next);
    setLoading(true);
    void load(next);
  };

  const today = localDate(new Date());
  const thisWeek = weekStart(today);
  const comingWeek = nextWeekStart(today);

  /**
   * The date span of a week, e.g. "16–22 באוג׳".
   *
   * On a Saturday the two weeks are one day apart and both contain a "Saturday" row — the label
   * alone is genuinely ambiguous, and picking the wrong one silently schedules a workout seven
   * days from the one you meant. The range is what disambiguates it.
   */
  const rangeLabel = (start: string) => {
    const days = weekDates(start);
    const fmt = (d: string, withMonth: boolean) =>
      new Date(`${d}T00:00:00`).toLocaleDateString(i18n.language, {
        day: 'numeric',
        ...(withMonth ? { month: 'short' } : {}),
      });
    return `${fmt(days[0] ?? start, false)}–${fmt(days[6] ?? start, true)}`;
  };

  if (loading) return <SkeletonScreen paddingTop={spacing.xxl} />;

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[
        styles.content,
        { paddingTop: spacing.lg, paddingBottom: insets.bottom + spacing.xxl },
      ]}
    >
      <ScreenHeader title={t('week.title')} back />

      <View style={styles.weekToggle}>
        <Pressable
          onPress={() => switchTo(comingWeek)}
          style={[styles.toggleChip, start === comingWeek && styles.toggleChipOn]}
          accessibilityRole="button"
        >
          <Text style={[styles.toggleText, start === comingWeek && styles.toggleTextOn]}>
            {t('week.next')}
          </Text>
          <Text style={styles.toggleRange}>{rangeLabel(comingWeek)}</Text>
        </Pressable>
        <Pressable
          onPress={() => switchTo(thisWeek)}
          style={[styles.toggleChip, start === thisWeek && styles.toggleChipOn]}
          accessibilityRole="button"
        >
          <Text style={[styles.toggleText, start === thisWeek && styles.toggleTextOn]}>
            {t('week.current')}
          </Text>
          <Text style={styles.toggleRange}>{rangeLabel(thisWeek)}</Text>
        </Pressable>
      </View>

      {options.length === 0 ? (
        <EmptyState emoji="🗓️" title={t('week.noPlan')} hint={t('week.noPlanHint')} />
      ) : (
        <>
          <Hint>{t('week.hint')}</Hint>
          {seeded ? <Banner tone="info">{t('week.seeded')}</Banner> : null}

          {week.map((day, index) => (
            <FadeSlideIn key={day.date} index={index}>
              <Card>
                <View style={styles.dayHeader}>
                  <Text style={[styles.dayName, day.date === today && styles.dayNameToday]}>
                    {new Date(`${day.date}T00:00:00`).toLocaleDateString(i18n.language, {
                      weekday: 'long',
                    })}
                  </Text>
                  <View style={styles.dayMeta}>
                    {day.date === today ? (
                      <Text style={styles.todayBadge}>{t('week.today')}</Text>
                    ) : null}
                    <Text style={styles.dayDate}>
                      {new Date(`${day.date}T00:00:00`).toLocaleDateString(i18n.language, {
                        day: 'numeric',
                        month: 'short',
                      })}
                    </Text>
                  </View>
                </View>

                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.chipRow}
                >
                  {options.map((option) => {
                    const on = day.planDayIds.includes(option.id);
                    return (
                      <Pressable
                        key={option.id}
                        onPress={() => toggle(day.date, option.id, on)}
                        style={[styles.chip, on && styles.chipOn]}
                        accessibilityRole="button"
                        accessibilityState={{ selected: on }}
                      >
                        <Text style={[styles.chipText, on && styles.chipTextOn]}>
                          {option.label}
                        </Text>
                      </Pressable>
                    );
                  })}

                  {/* A chosen rest is a decision, and reads differently from an empty day. */}
                  <Pressable
                    onPress={() => choose(day.date, null)}
                    style={[
                      styles.chip,
                      day.planned && day.planDayIds.length === 0 && styles.chipRest,
                    ]}
                    accessibilityRole="button"
                  >
                    <Text
                      style={[
                        styles.chipText,
                        day.planned && day.planDayIds.length === 0 && styles.chipTextRest,
                      ]}
                    >
                      {t('week.rest')}
                    </Text>
                  </Pressable>

                  {day.planned ? (
                    <Pressable
                      onPress={() => clear(day.date)}
                      style={styles.chip}
                      accessibilityRole="button"
                    >
                      <Text style={styles.chipClear}>{t('week.clear')}</Text>
                    </Pressable>
                  ) : null}
                </ScrollView>

                {!day.planned ? <Text style={styles.undecided}>{t('week.undecided')}</Text> : null}
              </Card>
            </FadeSlideIn>
          ))}
        </>
      )}
    </ScrollView>
  );
}

const createStyles = (colors: ColorPalette) =>
  StyleSheet.create<{
    screen: ViewStyle;
    content: ViewStyle;
    weekToggle: ViewStyle;
    toggleChip: ViewStyle;
    toggleChipOn: ViewStyle;
    toggleText: TextStyle;
    toggleTextOn: TextStyle;
    toggleRange: TextStyle;
    dayHeader: ViewStyle;
    dayName: TextStyle;
    dayNameToday: TextStyle;
    dayMeta: ViewStyle;
    todayBadge: TextStyle;
    dayDate: TextStyle;
    chipRow: ViewStyle;
    chip: ViewStyle;
    chipOn: ViewStyle;
    chipRest: ViewStyle;
    chipText: TextStyle;
    chipTextOn: TextStyle;
    chipTextRest: TextStyle;
    chipClear: TextStyle;
    undecided: TextStyle;
  }>({
    screen: { flex: 1 },
    content: { paddingHorizontal: spacing.lg },

    weekToggle: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.lg },
    toggleChip: {
      paddingVertical: spacing.sm,
      paddingHorizontal: spacing.lg,
      borderRadius: radius.pill,
      borderWidth: 1,
      borderColor: colors.border,
    },
    toggleChipOn: { borderColor: colors.accentBorder, backgroundColor: colors.accentSoft },
    toggleText: { color: colors.textMuted, fontSize: fontSize.sm },
    toggleTextOn: { color: colors.accent, fontWeight: fontWeight.bold },
    toggleRange: { color: colors.textFaint, fontSize: fontSize.xxs, marginTop: 2, textAlign: 'center' },

    dayHeader: {
      flexDirection: 'row',
      alignItems: 'baseline',
      justifyContent: 'space-between',
      marginBottom: spacing.sm,
    },
    dayName: { color: colors.text, fontSize: fontSize.md, fontWeight: fontWeight.bold, textAlign: 'auto' },
    dayNameToday: { color: colors.accent },
    dayMeta: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
    todayBadge: {
      color: colors.accent,
      fontSize: fontSize.xxs,
      fontWeight: fontWeight.bold,
      backgroundColor: colors.accentSoft,
      borderRadius: radius.pill,
      paddingHorizontal: spacing.sm,
      paddingVertical: spacing.xxs,
      overflow: 'hidden',
    },
    dayDate: { color: colors.textMuted, fontSize: fontSize.xs },

    chipRow: { gap: spacing.sm, paddingVertical: spacing.xxs },
    chip: {
      paddingVertical: spacing.sm,
      paddingHorizontal: spacing.md,
      borderRadius: radius.pill,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surfaceRaised,
    },
    chipOn: { borderColor: colors.accentBorder, backgroundColor: colors.accentSoft },
    chipRest: { borderColor: colors.borderStrong, backgroundColor: colors.surfaceHigh },
    chipText: { color: colors.textMuted, fontSize: fontSize.sm },
    chipTextOn: { color: colors.accent, fontWeight: fontWeight.bold },
    chipTextRest: { color: colors.textSecondary, fontWeight: fontWeight.bold },
    chipClear: { color: colors.danger, fontSize: fontSize.sm },

    undecided: {
      color: colors.textFaint,
      fontSize: fontSize.xs,
      marginTop: spacing.sm,
      textAlign: 'auto',
    },
  });
