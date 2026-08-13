/**
 * The Today screen's four blocks, per the design handoff: greeting, today's workout, the streak
 * strip, and this week in three numbers.
 *
 * Split out of the screen because the screen's job is loading data and choosing a state, and
 * these are the pixels. Every measurement here comes from the handoff — 44px day cells, 56px CTA,
 * 6px accent bar, 20px card padding — and is written as a literal rather than snapped to the
 * nearest spacing token, because the spec is the authority and rounding 27px type to `fontSize.xl`
 * would quietly redesign it.
 *
 * RTL throughout uses logical properties only. The one thing they do not cover is array order:
 * the day strip is chronological in the data and RTL layout reverses it on screen by itself.
 */

import { LinearGradient } from 'expo-linear-gradient';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Pressable,
  StyleSheet,
  Text,
  View,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

import type { StripDay, TodayWorkout, WeekSummary } from '../../db/home.js';
import { useTheme } from '../../ThemeProvider.js';
import { radius, type ColorPalette } from '../../theme.js';

/** Hebrew day initials, Sunday first — the order `Date#getDay` returns. */
const DAY_INITIALS = ['א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ש'] as const;

/* -------------------------------------------------------------------------- */

export function GreetingRow({
  greeting,
  date,
  initials,
  onPressAvatar,
}: {
  greeting: string;
  date: string;
  initials: string;
  onPressAvatar: () => void;
}) {
  const { colors } = useTheme();
  const s = useMemo(() => createStyles(colors), [colors]);

  return (
    <View style={s.greetingRow}>
      <View style={s.greetingText}>
        <Text style={s.greeting}>{greeting}</Text>
        <Text style={s.date}>{date}</Text>
      </View>
      <Pressable
        onPress={onPressAvatar}
        accessibilityRole="button"
        style={({ pressed }) => [s.avatar, pressed && s.avatarPressed]}
      >
        <Text style={s.avatarText}>{initials}</Text>
      </Pressable>
    </View>
  );
}

/* -------------------------------------------------------------------------- */

export function TodayWorkoutCard({
  workout,
  onStart,
}: {
  workout: TodayWorkout;
  onStart: () => void;
}) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const s = useMemo(() => createStyles(colors), [colors]);

  // Two names, then a count. The card answers "what am I doing today" at a glance; a full list
  // of eight exercises is the workout screen's job, not this one's.
  const shown = workout.exerciseNames.slice(0, 2);
  const overflow = workout.exerciseNames.length - shown.length;

  return (
    <View style={s.todayCard}>
      {/* The gradient is a wash from accentSoft to nothing over the top 70%, not a fill: the
          accent marks this as the live thing on screen without becoming a coloured block. */}
      <LinearGradient
        colors={[colors.accentSoft, 'transparent']}
        locations={[0, 0.7]}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />

      <View style={s.todayHeader}>
        <View style={s.todayHeaderText}>
          <Text style={s.kicker}>
            {t('home.todayKicker', { plan: workout.planName })}
          </Text>
          <Text style={s.workoutTitle}>{workout.dayName}</Text>
          <Text style={s.workoutMeta}>
            {t('home.workoutMeta', {
              exercises: workout.exerciseCount,
              sets: workout.setCount,
              minutes: workout.estimatedMinutes,
            })}
          </Text>
        </View>
        {/* Fades downward, so it reads as the card's own edge catching the light rather than a
            rule someone drew. Sits at the inline end, which RTL mirrors for free. */}
        <LinearGradient
          colors={[colors.accent, 'transparent']}
          style={s.accentBar}
          pointerEvents="none"
        />
      </View>

      {/* Stated once, plainly, and never as a debt to repay: the plan has already moved on, and
          the next line down is today's workout. Guilt is the fastest way to make someone stop
          opening an app they were using to build a habit. */}
      {workout.missedYesterday ? (
        <Text style={s.missed}>{t('home.missedYesterday', { day: workout.missedYesterday })}</Text>
      ) : null}

      <View style={s.pillRow}>
        {shown.map((name) => (
          <View key={name} style={s.pill}>
            <Text style={s.pillText} numberOfLines={1}>
              {name}
            </Text>
          </View>
        ))}
        {overflow > 0 ? (
          <View style={s.pill}>
            <Text style={s.pillText}>+{overflow}</Text>
          </View>
        ) : null}
      </View>

      <Pressable
        onPress={onStart}
        accessibilityRole="button"
        style={({ pressed }) => [s.cta, pressed && s.ctaPressed]}
      >
        <Text style={s.ctaGlyph}>▶</Text>
        <Text style={s.ctaLabel}>{t('home.startWorkout')}</Text>
      </Pressable>
    </View>
  );
}

/* -------------------------------------------------------------------------- */

export function StreakCard({
  days,
  streakWeeks,
  trainedThisWeek,
  targetPerWeek,
}: {
  days: readonly StripDay[];
  streakWeeks: number;
  trainedThisWeek: number;
  targetPerWeek: number;
}) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const s = useMemo(() => createStyles(colors), [colors]);

  return (
    <View style={s.card}>
      <View style={s.streakHeader}>
        <Text style={s.streakTitle}>{t('home.streakWeeks', { count: streakWeeks })}</Text>
        <Text style={s.streakCount}>
          {t('home.streakThisWeek', { done: trainedThisWeek, target: targetPerWeek })}
        </Text>
      </View>

      <View style={s.strip}>
        {days.map((day) => {
          const weekday = DAY_INITIALS[new Date(`${day.date}T00:00:00`).getDay()];
          return (
            <View key={day.date} style={s.stripItem}>
              <View
                style={[
                  s.dayCell,
                  day.state === 'trained' && s.dayCellTrained,
                  day.state === 'today' && s.dayCellToday,
                ]}
              >
                {/* A missed day is empty, never marked in red. The strip is there to be worth
                    continuing, and a row of failures is not something anyone opens twice. */}
                <Text style={s.dayMark}>
                  {day.state === 'trained' ? '✓' : day.state === 'today' ? '•' : ''}
                </Text>
              </View>
              <Text style={s.dayLabel}>{weekday}</Text>
            </View>
          );
        })}
      </View>

      <Text style={s.streakFooter}>{t('home.streakInvite')}</Text>
    </View>
  );
}

/* -------------------------------------------------------------------------- */

export function WeekSummaryRow({ summary }: { summary: WeekSummary }) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const s = useMemo(() => createStyles(colors), [colors]);

  return (
    <View style={s.summaryRow}>
      <Stat value={String(summary.workouts)} label={t('home.statWorkouts')} />
      <Stat value={String(summary.volumeTonnes)} unit="t" label={t('home.statVolume')} />
      <Stat value={String(summary.personalRecords)} label={t('home.statPrs')} />
    </View>
  );
}

function Stat({ value, unit, label }: { value: string; unit?: string; label: string }) {
  const { colors } = useTheme();
  const s = useMemo(() => createStyles(colors), [colors]);
  return (
    <View style={s.statCard}>
      <Text style={s.statValue}>
        {value}
        {unit ? <Text style={s.statUnit}>{unit}</Text> : null}
      </Text>
      <Text style={s.statLabel}>{label}</Text>
    </View>
  );
}

/* -------------------------------------------------------------------------- */

const createStyles = (colors: ColorPalette) =>
  StyleSheet.create<{
    greetingRow: ViewStyle;
    greetingText: ViewStyle;
    greeting: TextStyle;
    date: TextStyle;
    avatar: ViewStyle;
    avatarPressed: ViewStyle;
    avatarText: TextStyle;
    todayCard: ViewStyle;
    todayHeader: ViewStyle;
    todayHeaderText: ViewStyle;
    kicker: TextStyle;
    workoutTitle: TextStyle;
    workoutMeta: TextStyle;
    accentBar: ViewStyle;
    missed: TextStyle;
    pillRow: ViewStyle;
    pill: ViewStyle;
    pillText: TextStyle;
    cta: ViewStyle;
    ctaPressed: ViewStyle;
    ctaGlyph: TextStyle;
    ctaLabel: TextStyle;
    card: ViewStyle;
    streakHeader: ViewStyle;
    streakTitle: TextStyle;
    streakCount: TextStyle;
    strip: ViewStyle;
    stripItem: ViewStyle;
    dayCell: ViewStyle;
    dayCellTrained: ViewStyle;
    dayCellToday: ViewStyle;
    dayMark: TextStyle;
    dayLabel: TextStyle;
    streakFooter: TextStyle;
    summaryRow: ViewStyle;
    statCard: ViewStyle;
    statValue: TextStyle;
    statUnit: TextStyle;
    statLabel: TextStyle;
  }>({
    /* greeting ------------------------------------------------------------ */
    greetingRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
    greetingText: { flex: 1, gap: 2 },
    greeting: { color: colors.textMuted, fontSize: 13, lineHeight: 16, textAlign: 'auto' },
    date: { color: colors.text, fontSize: 24, fontWeight: '500', letterSpacing: -0.5, textAlign: 'auto' },
    avatar: {
      width: 44,
      height: 44,
      borderRadius: radius.pill,
      borderWidth: 1,
      borderColor: colors.borderStrong,
      backgroundColor: colors.surfaceRaised,
      alignItems: 'center',
      justifyContent: 'center',
    },
    avatarPressed: { borderColor: colors.accentBorder },
    avatarText: { color: colors.text, fontSize: 14, fontWeight: '500' },

    /* today's workout ----------------------------------------------------- */
    todayCard: {
      borderWidth: 1,
      borderColor: colors.accentBorder,
      backgroundColor: colors.surface,
      borderRadius: radius.lg,
      padding: 20,
      gap: 16,
      overflow: 'hidden',
    },
    todayHeader: { flexDirection: 'row', alignItems: 'stretch', justifyContent: 'space-between', gap: 12 },
    todayHeaderText: { flex: 1, gap: 4 },
    kicker: {
      color: colors.accent,
      fontSize: 11,
      fontWeight: '700',
      letterSpacing: 1.3,
      textAlign: 'auto',
    },
    workoutTitle: {
      color: colors.text,
      fontSize: 27,
      lineHeight: 31,
      fontWeight: '500',
      letterSpacing: -0.5,
      textAlign: 'auto',
    },
    workoutMeta: { color: colors.textMuted, fontSize: 13, lineHeight: 20, textAlign: 'auto' },
    accentBar: { width: 6, borderRadius: 3 },

    missed: { color: colors.textFaint, fontSize: 12, textAlign: 'auto' },
    pillRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    pill: {
      paddingVertical: 6,
      paddingHorizontal: 11,
      borderRadius: radius.pill,
      borderWidth: 1,
      borderColor: colors.borderStrong,
    },
    pillText: { color: colors.textMuted, fontSize: 12 },

    cta: {
      minHeight: 56,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: colors.accent,
      backgroundColor: colors.accentSoft,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 9,
    },
    // The whole button shrinks a hair rather than changing colour: the press is confirmed without
    // the accent flooding, which is the one thing the palette is not allowed to do.
    ctaPressed: { transform: [{ scale: 0.985 }] },
    ctaGlyph: { color: colors.accent, fontSize: 13 },
    ctaLabel: { color: colors.accent, fontSize: 17, fontWeight: '500' },

    /* streak -------------------------------------------------------------- */
    card: {
      borderWidth: 1,
      borderColor: colors.borderSubtle,
      backgroundColor: colors.surface,
      borderRadius: radius.lg,
      paddingVertical: 18,
      paddingHorizontal: 20,
      gap: 14,
    },
    streakHeader: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 },
    streakTitle: { color: colors.text, fontSize: 15, fontWeight: '500', textAlign: 'auto' },
    streakCount: { color: colors.textFaint, fontSize: 12, textAlign: 'auto' },

    strip: { flexDirection: 'row', gap: 6 },
    stripItem: { flex: 1, alignItems: 'center', gap: 7 },
    dayCell: {
      width: '100%',
      height: 44,
      borderRadius: radius.sm,
      borderWidth: 1,
      borderColor: colors.border,
      alignItems: 'center',
      justifyContent: 'center',
    },
    dayCellTrained: { borderColor: colors.accentBorder, backgroundColor: colors.accentSoft },
    dayCellToday: { borderColor: colors.accent },
    dayMark: { color: colors.accent, fontSize: 12, fontWeight: '500' },
    dayLabel: { color: colors.textFaint, fontSize: 11 },
    streakFooter: { color: colors.textMuted, fontSize: 12, lineHeight: 18, textAlign: 'auto' },

    /* week summary -------------------------------------------------------- */
    summaryRow: { flexDirection: 'row', gap: 10 },
    statCard: {
      flex: 1,
      borderWidth: 1,
      borderColor: colors.borderSubtle,
      backgroundColor: colors.surface,
      borderRadius: radius.lg,
      paddingVertical: 14,
      paddingHorizontal: 12,
      gap: 4,
    },
    statValue: {
      color: colors.text,
      fontSize: 22,
      lineHeight: 24,
      fontWeight: '500',
      textAlign: 'auto',
      fontVariant: ['tabular-nums'],
    },
    statUnit: { color: colors.textFaint, fontSize: 12 },
    statLabel: { color: colors.textFaint, fontSize: 11, lineHeight: 14, textAlign: 'auto' },
  });
