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

import { macroShares, type StripDay, type TodayWorkout, type WeekSummary } from '../../db/home.js';
import type { TargetsResult } from '../../db/metrics.js';
import { useTheme } from '../../ThemeProvider.js';
import { radius, type ColorPalette } from '../../theme.js';
import { useUnit } from '../../UnitsProvider.js';
import { formatBodyWeight, kgToDisplay, weightUnitKey } from '../../units.js';
import { WeightSparkline } from '../WeightSparkline.js';

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

/**
 * Bodyweight: the last number on the scale, which way it is going, and the trend line.
 *
 * The headline is the raw latest weigh-in while the line is the 7-day average — deliberately two
 * different numbers. People check this card against what the scale said this morning, so a
 * smoothed value in the headline would read as the app being wrong; smoothing belongs in the
 * line, and the caption under it says as much.
 */
export function WeightTrendCard({
  latestKg,
  ratePerWeek,
  points,
  onPress,
}: {
  latestKg: number | null;
  ratePerWeek: number | null;
  points: { date: Date; weightKg: number }[];
  onPress: () => void;
}) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const unit = useUnit();
  const s = useMemo(() => createStyles(colors), [colors]);

  // A rounding band, not a test against zero: a regression slope is never exactly flat, and
  // ±50 g a week is noise wearing a direction.
  const direction =
    ratePerWeek === null || Math.abs(ratePerWeek) < 0.05
      ? 'stable'
      : ratePerWeek > 0
        ? 'gaining'
        : 'losing';

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => [s.card, pressed && s.cardPressed]}
    >
      <View style={s.streakHeader}>
        <Text style={s.streakTitle}>{t('metrics.trendTitle')}</Text>
        {latestKg === null ? null : (
          <Text style={s.bigValue}>
            {formatBodyWeight(latestKg, unit)}
            <Text style={s.bigUnit}> {t(`common.${weightUnitKey(unit)}`)}</Text>
          </Text>
        )}
      </View>

      {latestKg === null ? (
        <Text style={s.streakFooter}>{t('metrics.noDataHint')}</Text>
      ) : (
        <>
          <View style={s.trendRow}>
            <Text style={s.trendLabel}>
              {direction === 'gaining'
                ? t('metrics.trendGaining')
                : direction === 'losing'
                  ? t('metrics.trendLosing')
                  : t('metrics.trendStable')}
            </Text>
            {/* No rate at all rather than a confident one drawn from a few readings —
                `getHomeNutrition` withholds it until the span is long enough to mean something. */}
            {ratePerWeek === null ? (
              <Text style={s.trendHint}>{t('metrics.unreliable')}</Text>
            ) : (
              <Text style={s.trendRate}>
                {ratePerWeek > 0 ? '+' : ''}
                {kgToDisplay(ratePerWeek, unit).toFixed(2)} {t(`common.${weightUnitKey(unit)}`)}{' '}
                {t('metrics.perWeek')}
              </Text>
            )}
          </View>

          {/* Renders nothing below two points, which is why the line above has to carry the card
              on its own after a single weigh-in. */}
          <WeightSparkline points={points} height={72} showRangePicker={false} />
        </>
      )}
    </Pressable>
  );
}

/* -------------------------------------------------------------------------- */

/**
 * The day's calories, and how they split across the three macros.
 *
 * Shares of the target, not progress toward it: there is no food log in the app, so these three
 * numbers ARE the plan, and a progress-shaped bar would imply an intake nothing here can know.
 * Same reasoning and the same bar as the nutrition screen.
 *
 * When the profile is missing a field the card says so rather than rendering a plausible number —
 * a calorie target computed from a guessed height is worse than no target at all.
 */
export function NutritionCard({
  targets,
  onPress,
}: {
  targets: TargetsResult;
  onPress: () => void;
}) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const s = useMemo(() => createStyles(colors), [colors]);

  if (!targets.ok) {
    return (
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        style={({ pressed }) => [s.card, pressed && s.cardPressed]}
      >
        <Text style={s.streakTitle}>{t('targets.calorieTarget')}</Text>
        <Text style={s.streakFooter}>{t('home.nutritionMissing')}</Text>
      </Pressable>
    );
  }

  const { calorieTarget, proteinG, carbsG, fatG, clampedToBmr } = targets.targets;
  const shares = macroShares({ proteinG, carbsG, fatG });

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => [s.card, pressed && s.cardPressed]}
    >
      <View style={s.streakHeader}>
        <Text style={s.streakTitle}>{t('targets.calorieTarget')}</Text>
        <Text style={s.bigValue}>
          {calorieTarget}
          <Text style={s.bigUnit}> {t('common.kcal')}</Text>
        </Text>
      </View>

      {/* Surfaced only when it bites. A deficit below BMR is the one place this arithmetic can
          hand back something actively harmful, so it is never shown silently. */}
      {clampedToBmr ? <Text style={s.clamped}>{t('targets.clampedWarning')}</Text> : null}

      <MacroBar
        label={t('targets.protein')}
        grams={proteinG}
        share={shares.protein}
        color={colors.protein}
      />
      <MacroBar
        label={t('targets.carbs')}
        grams={carbsG}
        share={shares.carbs}
        color={colors.carbs}
      />
      <MacroBar label={t('targets.fat')} grams={fatG} share={shares.fat} color={colors.fat} />
    </Pressable>
  );
}

function MacroBar({
  label,
  grams,
  share,
  color,
}: {
  label: string;
  grams: number;
  share: number;
  color: string;
}) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const s = useMemo(() => createStyles(colors), [colors]);

  return (
    <View style={s.macroBlock}>
      <View style={s.macroHeader}>
        <Text style={s.macroLabel}>{label}</Text>
        <Text style={s.macroValue}>
          {grams}
          {t('common.grams')} · {Math.round(share * 100)}%
        </Text>
      </View>
      <View style={s.macroTrack}>
        <View
          style={[s.macroFill, { width: `${Math.round(share * 100)}%`, backgroundColor: color }]}
        />
      </View>
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
    cardPressed: ViewStyle;
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
    bigValue: TextStyle;
    bigUnit: TextStyle;
    trendRow: ViewStyle;
    trendLabel: TextStyle;
    trendRate: TextStyle;
    trendHint: TextStyle;
    clamped: TextStyle;
    macroBlock: ViewStyle;
    macroHeader: ViewStyle;
    macroLabel: TextStyle;
    macroValue: TextStyle;
    macroTrack: ViewStyle;
    macroFill: ViewStyle;
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
    // The same restraint as the workout CTA: a press is confirmed by a hair of scale, never by
    // the accent flooding a card that is otherwise quiet.
    cardPressed: { transform: [{ scale: 0.99 }] },
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

    /* weight and nutrition ------------------------------------------------- */
    // Tabular figures: a weight ticking 82.4 → 82.1 should not shuffle sideways under the eye.
    bigValue: {
      color: colors.text,
      fontSize: 22,
      fontWeight: '500',
      textAlign: 'auto',
      fontVariant: ['tabular-nums'],
    },
    bigUnit: { color: colors.textFaint, fontSize: 12, fontWeight: '400' },
    trendRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 },
    trendLabel: { color: colors.textMuted, fontSize: 13, textAlign: 'auto' },
    trendRate: { color: colors.accent, fontSize: 13, textAlign: 'auto', fontVariant: ['tabular-nums'] },
    trendHint: { color: colors.textFaint, fontSize: 11, flexShrink: 1, textAlign: 'auto' },
    clamped: { color: colors.warning, fontSize: 12, lineHeight: 18, textAlign: 'auto' },

    macroBlock: { gap: 6 },
    macroHeader: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 },
    macroLabel: { color: colors.textMuted, fontSize: 13, textAlign: 'auto' },
    macroValue: { color: colors.textFaint, fontSize: 12, fontVariant: ['tabular-nums'] },
    macroTrack: {
      height: 6,
      borderRadius: 3,
      backgroundColor: colors.surfaceRaised,
      overflow: 'hidden',
    },
    macroFill: { height: '100%', borderRadius: 3 },
  });
