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

import { Image } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Pressable,
  StyleSheet,
  Text,
  View,
  type TextStyle,
  type ImageStyle,
  type ViewStyle,
} from 'react-native';

import {
  macroShares,
  type StripDay,
  type TodayWorkout,
  type TrainedToday,
  type WeekSummary, type MonthWeeks } from '../../db/home.js';
import type { TargetsResult } from '../../db/metrics.js';
import { CountUp } from '../motion.js';
import { ProgressRing } from '../ProgressRing.js';
import { useTheme } from '../../ThemeProvider.js';
import { radius, shadow, type ColorPalette } from '../../theme.js';
import { useUnit } from '../../UnitsProvider.js';
import { formatBodyWeight, kgToDisplay, weightUnitKey } from '../../units.js';
import { WeightSparkline } from '../WeightSparkline.js';

/** Hebrew day initials, Sunday first — the order `Date#getDay` returns. */
const DAY_INITIALS = ['א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ש'] as const;

/* -------------------------------------------------------------------------- */

/**
 * The top of the home screen: the greeting, and the date in the size that makes it the heading.
 *
 * It used to carry a bubble of the reader's own initials, which was the only door to the profile
 * — and through it the only door to the coach and the nutrition screen. That is now in the menu,
 * and the mark and name that briefly stood in the bubble's place are in the masthead above,
 * where every other screen has them too.
 */
export function GreetingRow({
  greeting,
  date,
  name,
  avatarUri,
  onOpenProfile,
}: {
  greeting: string;
  date: string;
  /** Who is being greeted. Empty before anyone has signed in. */
  name?: string;
  /** The profile picture, when one has been chosen; initials otherwise. */
  avatarUri?: string | null;
  onOpenProfile?: () => void;
}) {
  const { colors } = useTheme();
  const s = useMemo(() => createStyles(colors), [colors]);
  const initials = (name ?? '').trim().slice(0, 2).toUpperCase();

  return (
    <View style={s.greetingRow}>
      <Pressable
        onPress={onOpenProfile}
        disabled={!onOpenProfile}
        accessibilityRole={onOpenProfile ? 'button' : undefined}
        style={({ pressed }) => [s.avatar, pressed && s.pressedSoft]}
      >
        {avatarUri ? (
          <Image source={{ uri: avatarUri }} style={s.avatarImage} />
        ) : (
          <Text style={s.avatarText}>{initials || '·'}</Text>
        )}
      </Pressable>

      <View style={s.greetingText}>
        <Text style={s.greeting}>{greeting}</Text>
        {name ? (
          <Text style={s.greetingName} numberOfLines={1}>
            {name}
          </Text>
        ) : null}
      </View>

      <View style={s.datePill}>
        <Text style={s.date} numberOfLines={1}>
          {date}
        </Text>
      </View>
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
          {/* Only said when there is more than one — "workout 1 of 1" is noise. */}
          {workout.slots > 1 ? (
            <Text style={s.workoutMeta}>
              {t('home.workoutSlot', { slot: workout.slot, slots: workout.slots })}
            </Text>
          ) : null}
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
        accessibilityLabel={t('home.startWorkout')}
        style={({ pressed }) => [s.cta, pressed && s.ctaPressed]}
      >
        <Text style={s.ctaGlyph}>▶</Text>
        <Text style={s.ctaLabel}>{t('home.startWorkout')}</Text>
      </Pressable>
    </View>
  );
}

/* -------------------------------------------------------------------------- */

/**
 * Today is a rest day, and that is the plan working rather than a gap in it.
 *
 * Deliberately without a button. The empty state this replaces offered "start an empty workout"
 * and "choose a plan", which on a scheduled rest day is an invitation to undo the schedule —
 * and the whole reason the app asks which days are training days is so that the answer holds
 * when motivation argues with it. Training is still reachable from the workout tab for anyone
 * who genuinely means to; it just is not being suggested.
 */
export function RestDayCard() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const s = useMemo(() => createStyles(colors), [colors]);

  return (
    <View style={s.restCard}>
      <Text style={s.restGlyph}>🌙</Text>
      <Text style={s.restTitle}>{t('home.restTitle')}</Text>
      <Text style={s.restBody}>{t('home.restBody')}</Text>
    </View>
  );
}

/* -------------------------------------------------------------------------- */

export function StreakCard({
  days,
  monthWeeks,
}: {
  days: readonly StripDay[];
  /** Full weeks in the month the current week belongs to, and this week's own progress. */
  monthWeeks: MonthWeeks;
}) {
  const { t, i18n } = useTranslation();
  // Named rather than "this month": for the first days of a month that fall in a week begun in
  // the month before, the tally is still that earlier month's, and "this month" would be wrong.
  const monthName = new Date(`${monthWeeks.month}-01T00:00:00`).toLocaleDateString(i18n.language, {
    month: 'long',
  });
  const { colors } = useTheme();
  const s = useMemo(() => createStyles(colors), [colors]);

  return (
    <View style={s.card}>
      <View style={s.streakHeader}>
        {/* The week as a ring: how much of the target is behind you, in one glance. */}
        <ProgressRing
          fraction={
            monthWeeks.thisWeek.target > 0
              ? monthWeeks.thisWeek.trained / monthWeeks.thisWeek.target
              : 0
          }
          size={78}
          thickness={9}
        >
          <Text style={s.ringValue}>
            {monthWeeks.thisWeek.trained}
            <Text style={s.ringTarget}>/{monthWeeks.thisWeek.target}</Text>
          </Text>
        </ProgressRing>

        <View style={s.streakHeaderText}>
          <Text style={s.streakCount}>
            {t('home.streakThisWeek', {
              done: monthWeeks.thisWeek.trained,
              target: monthWeeks.thisWeek.target,
            })}
          </Text>
          <Text style={s.streakTitle}>
            {t('home.monthWeeks', {
              month: monthName,
              done: monthWeeks.completed,
              total: monthWeeks.weeks,
            })}
          </Text>
        </View>
      </View>

      <View style={s.strip}>
        {days.map((day) => {
          const weekday = DAY_INITIALS[new Date(`${day.date}T00:00:00`).getDay()];
          return (
            <View key={day.date} style={s.stripItem}>
              {/* A column per day: the track is the week, the fill is what was trained. A missed
                  day is simply an empty track, never marked in red — a row of failures is not
                  something anyone opens twice. */}
              <View style={[s.dayTrack, day.isToday && s.dayTrackToday]}>
                {day.trained ? <View style={s.dayFill} /> : null}
              </View>
              <Text style={[s.dayLabel, day.isToday && s.dayLabelToday]}>{weekday}</Text>
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
      <Stat value={summary.workouts} label={t('home.statWorkouts')} tone="sun" />
      <Stat value={summary.volumeTonnes} decimals={1} unit="t" label={t('home.statVolume')} tone="coral" />
      <Stat value={summary.personalRecords} label={t('home.statPrs')} />
    </View>
  );
}

/**
 * One of the week's numbers.
 *
 * Two of the three sit on colour. Not decoration: three identical white tiles are three things
 * of equal weight, and the eye has to read all of them to find the one it came for. The warm
 * pair are the numbers that move every session; the plain one is the rarer event.
 */
function Stat({
  value,
  unit,
  label,
  decimals = 0,
  tone = 'plain',
}: {
  value: number;
  unit?: string;
  label: string;
  decimals?: number;
  tone?: 'plain' | 'sun' | 'coral';
}) {
  const { colors } = useTheme();
  const s = useMemo(() => createStyles(colors), [colors]);
  return (
    <View style={[s.statCard, tone === 'sun' && s.statSun, tone === 'coral' && s.statCoral]}>
      <View style={s.statValueRow}>
        <CountUp value={value} decimals={decimals} style={s.statValue} />
        {unit ? <Text style={s.statUnit}>{unit}</Text> : null}
      </View>
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
  readings,
  onPress,
}: {
  latestKg: number | null;
  ratePerWeek: number | null;
  points: { date: Date; weightKg: number }[];
  /** The weigh-ins the trend is an average of — the dots, so the big number above is on the chart. */
  readings: { date: Date; weightKg: number }[];
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
          <WeightSparkline
            points={points}
            readings={readings}
            height={104}
            showRangePicker={false}
          />
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
    dayTrack: ViewStyle;
    dayTrackToday: ViewStyle;
    dayFill: ViewStyle;
    dayLabelToday: TextStyle;
    streakHeaderText: ViewStyle;
    ringValue: TextStyle;
    ringTarget: TextStyle;
    statValueRow: ViewStyle;
    statSun: ViewStyle;
    statCoral: ViewStyle;
    greetingName: TextStyle;
    avatar: ViewStyle;
    avatarImage: ImageStyle;
    avatarText: TextStyle;
    datePill: ViewStyle;
    pressedSoft: ViewStyle;
    greetingText: ViewStyle;
    greeting: TextStyle;
    date: TextStyle;

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
    doneCard: ViewStyle;
    doneHeader: ViewStyle;
    doneMark: TextStyle;
    doneTitle: TextStyle;
    doneName: TextStyle;
    doneStats: TextStyle;
    doneLink: ViewStyle;
    doneLinkText: TextStyle;
    doneSecondary: ViewStyle;
    doneSecondaryText: TextStyle;
    restCard: ViewStyle;
    restGlyph: TextStyle;
    restTitle: TextStyle;
    restBody: TextStyle;
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
    greetingRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    greetingText: { flex: 1, gap: 1 },
    greetingName: { color: colors.text, fontSize: 17, fontWeight: '700', textAlign: 'auto' },
    avatar: {
      width: 46,
      height: 46,
      borderRadius: radius.pill,
      backgroundColor: colors.accentSoft,
      alignItems: 'center',
      justifyContent: 'center',
      overflow: 'hidden',
    },
    avatarImage: { width: 46, height: 46 },
    avatarText: { color: colors.accent, fontSize: 16, fontWeight: '700' },
    datePill: {
      paddingVertical: 6,
      paddingHorizontal: 12,
      borderRadius: radius.pill,
      backgroundColor: colors.surface,
      ...shadow(colors.shadow).card,
    },
    pressedSoft: { opacity: 0.75 },
    // A column per day, filled from the bottom — the same shape the charts elsewhere use.
    dayTrack: {
      width: 12,
      height: 54,
      borderRadius: radius.pill,
      backgroundColor: colors.surfaceRaised,
      justifyContent: 'flex-end',
      overflow: 'hidden',
    },
    dayTrackToday: { borderWidth: 2, borderColor: colors.accentBorder },
    dayFill: { height: '100%', borderRadius: radius.pill, backgroundColor: colors.accent },
    dayLabelToday: { color: colors.accent, fontWeight: '700' },
    statValueRow: { flexDirection: 'row', alignItems: 'baseline', gap: 1 },
    statSun: { backgroundColor: colors.tileSun },
    statCoral: { backgroundColor: colors.tileCoral },
    greeting: { color: colors.textMuted, fontSize: 13, lineHeight: 16, textAlign: 'auto' },
    date: { color: colors.text, fontSize: 24, fontWeight: '500', letterSpacing: -0.5, textAlign: 'auto' },


    /* today's workout ----------------------------------------------------- */
    todayCard: {
      backgroundColor: colors.surface,
      borderRadius: radius.xl,
      padding: 20,
      gap: 16,
      overflow: 'hidden',
      ...shadow(colors.shadow).hero,
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

    // The full width of the card, filled, with the words inside it: on the screen's one
    // primary action there is nothing to be gained by making the target smaller than the card.
    cta: {
      minHeight: 56,
      borderRadius: radius.pill,
      backgroundColor: colors.accent,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 10,
      ...shadow(colors.shadow).card,
    },
    // The whole button shrinks a hair rather than changing colour: the press is confirmed without
    // the accent flooding, which is the one thing the palette is not allowed to do.
    ctaPressed: { transform: [{ scale: 0.985 }] },
    ctaGlyph: { color: colors.bg, fontSize: 14 },
    ctaLabel: { color: colors.bg, fontSize: 17, fontWeight: '700' },

    /* streak -------------------------------------------------------------- */
    card: {
      backgroundColor: colors.surface,
      borderRadius: radius.xl,
      ...shadow(colors.shadow).card,
      paddingVertical: 18,
      paddingHorizontal: 20,
      gap: 14,
    },
    // The same restraint as the workout CTA: a press is confirmed by a hair of scale, never by
    // the accent flooding a card that is otherwise quiet.
    cardPressed: { transform: [{ scale: 0.99 }] },

    /* rest day ------------------------------------------------------------ */
    // Quieter than the workout card on purpose: no accent border, no gradient, nothing that
    // reads as the live thing on screen. Today the live thing is not training.
    doneCard: {
      borderWidth: 1,
      borderColor: colors.accentBorder,
      backgroundColor: colors.surface,
      borderRadius: radius.lg,
      padding: 20,
    },
    doneHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    doneMark: { color: colors.accent, fontSize: 18, fontWeight: '800' },
    doneTitle: { color: colors.accent, fontSize: 13, fontWeight: '700', textAlign: 'auto' },
    doneName: {
      color: colors.text,
      fontSize: 20,
      fontWeight: '700',
      marginTop: 6,
      textAlign: 'auto',
    },
    doneStats: {
      color: colors.textMuted,
      fontSize: 13,
      marginTop: 4,
      textAlign: 'auto',
      fontVariant: ['tabular-nums'],
    },
    doneLink: {
      marginTop: 14,
      paddingVertical: 12,
      borderRadius: radius.sm,
      backgroundColor: colors.accentSoft,
      borderWidth: 1,
      borderColor: colors.accentBorder,
      alignItems: 'center',
    },
    doneLinkText: { color: colors.accent, fontSize: 15, fontWeight: '700' },
    doneSecondary: { marginTop: 8, paddingVertical: 8, alignItems: 'center' },
    doneSecondaryText: { color: colors.textFaint, fontSize: 13 },
    restCard: {
      backgroundColor: colors.surface,
      borderRadius: radius.xl,
      ...shadow(colors.shadow).card,
      paddingVertical: 28,
      paddingHorizontal: 20,
      alignItems: 'center',
      gap: 8,
    },
    restGlyph: { fontSize: 30 },
    restTitle: { color: colors.text, fontSize: 20, fontWeight: '500', textAlign: 'center' },
    restBody: {
      color: colors.textMuted,
      fontSize: 13,
      lineHeight: 20,
      textAlign: 'center',
      maxWidth: 300,
    },
    streakHeader: { flexDirection: 'row', alignItems: 'center', gap: 14 },
    streakHeaderText: { flex: 1, gap: 4 },
    ringValue: { color: colors.text, fontSize: 22, fontWeight: '700', fontVariant: ['tabular-nums'] },
    ringTarget: { color: colors.textFaint, fontSize: 13, fontWeight: '500' },
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
      backgroundColor: colors.surface,
      borderRadius: radius.lg,
      paddingVertical: 16,
      paddingHorizontal: 12,
      gap: 4,
      ...shadow(colors.shadow).card,
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

/**
 * Today's training, already done.
 *
 * The card this replaces went on offering to start a workout that had just been finished — the
 * home screen computed which workout today calls for and never asked whether it had happened.
 * The rotation had the same blind spot from the other side: training today leaves the position
 * on today's slot, which is correct, and the screen read it as "still to do".
 *
 * It reports rather than congratulates. The numbers are the point; a session still running says
 * so instead of claiming a finish that has not happened.
 */
export function TrainedTodayCard({
  trained,
  onOpen,
  onStartAnother,
}: {
  trained: TrainedToday;
  onOpen: () => void;
  onStartAnother: () => void;
}) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const s = useMemo(() => createStyles(colors), [colors]);
  const unit = useUnit();

  return (
    <View style={s.doneCard}>
      <View style={s.doneHeader}>
        <Text style={s.doneMark}>✓</Text>
        <Text style={s.doneTitle}>
          {trained.finished ? t('home.trainedToday') : t('home.trainingNow')}
        </Text>
      </View>

      <Text style={s.doneName}>{trained.name ?? t('history.unnamed')}</Text>

      <Text style={s.doneStats}>
        {trained.setCount} {t('common.sets')}
        {trained.volumeKg > 0
          ? ` · ${kgToDisplay(trained.volumeKg, unit)} ${t(`common.${weightUnitKey(unit)}`)}`
          : ''}
        {trained.minutes !== null ? ` · ${trained.minutes} ${t('home.minutes')}` : ''}
      </Text>

      <Pressable
        onPress={onOpen}
        accessibilityRole="button"
        style={({ pressed }) => [s.doneLink, pressed && { opacity: 0.7 }]}
      >
        <Text style={s.doneLinkText}>
          {trained.finished ? t('home.viewWorkout') : t('home.resumeWorkout')}
        </Text>
      </Pressable>

      {/* Training twice in a day is a real thing and refusing it would be the app overruling the
          user — but it is the quiet option, not the one the card leads with. */}
      {trained.finished ? (
        <Pressable
          onPress={onStartAnother}
          accessibilityRole="button"
          style={({ pressed }) => [s.doneSecondary, pressed && { opacity: 0.7 }]}
        >
          <Text style={s.doneSecondaryText}>{t('home.startAnother')}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}
