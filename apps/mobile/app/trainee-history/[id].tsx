/**
 * What a trainee has actually done, as their coach sees it.
 *
 * The other half of coaching. The plan and calendar screens are where a coach says what should
 * happen; this is where they find out whether it did: the week so far against what was planned
 * for it, and below that every finished workout of the last two months, newest first. A
 * workout opens to its exercises and the sets that were done, drawn by the same component the
 * trainee's own history uses, so the two of them are looking at the same picture when they
 * talk about it.
 *
 * Read-only, and read fresh each time the screen comes into view. Nothing here is saved on the
 * coach's phone, and there is nothing on this screen that changes anything of the trainee's.
 *
 * What is shown is what the server sends (`coach_get_sessions`, 0012): sets, weights, times.
 * Not the trainee's body weight and not their notes — see `sessionDocument.ts`.
 */

import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { CaretDown, CaretUp } from 'phosphor-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { EXERCISE_BY_KEY } from '@fit/shared';

import type { CoachingError } from '../../src/coaching/api.js';
import { allDays, type CoachCalendar, type CoachPlan } from '../../src/coaching/planDocument.js';
import {
  localDay,
  sessionMinutes,
  sessionsByDay,
  sessionVolumeKg,
  tally,
  weekOf,
  workingSetCount,
  type CoachSession,
} from '../../src/coaching/sessionDocument.js';
import { coachingErrorKey, useCoachingApi } from '../../src/coaching/useCoachingApi.js';
import { FadeSlideIn } from '../../src/components/motion.js';
import { Banner, EmptyState, ScreenHeader } from '../../src/components/ui.js';
import { SessionExerciseSummary } from '../../src/components/workout/SessionExerciseSummary.js';
import { hapticLight } from '../../src/haptics.js';
import { useTheme } from '../../src/ThemeProvider.js';
import {
  fontSize,
  fontWeight,
  radius,
  shadow,
  spacing,
  type ColorPalette,
} from '../../src/theme.js';
import { useUnit } from '../../src/UnitsProvider.js';
import { formatVolume, weightUnitKey } from '../../src/units.js';

/** How far back the list goes. Two months is a training block, and one request's worth. */
const DAYS_BACK = 56;

export default function TraineeHistoryScreen() {
  const { t, i18n } = useTranslation();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const unit = useUnit();
  const { id, name } = useLocalSearchParams<{ id: string; name?: string }>();
  const api = useCoachingApi();
  const isHebrew = i18n.language === 'he';

  const [sessions, setSessions] = useState<CoachSession[] | null>(null);
  const [calendar, setCalendar] = useState<CoachCalendar | null>(null);
  const [plans, setPlans] = useState<CoachPlan[]>([]);
  const [error, setError] = useState<CoachingError | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  const today = localDay(new Date());
  const week = useMemo(() => weekOf(today), [today]);

  const load = useCallback(async () => {
    if (!api || !id) return;
    const until = new Date();
    until.setDate(until.getDate() + 1);
    const since = new Date();
    since.setDate(since.getDate() - DAYS_BACK);
    since.setHours(0, 0, 0, 0);

    const [done, schedule, planList] = await Promise.all([
      api.sessions(id, since.toISOString(), until.toISOString()),
      api.schedule(id, week[0]!, week[6]!),
      api.plans(id),
    ]);
    if (!done.ok) {
      setError(done.error);
      return;
    }
    setSessions(done.value);
    setError(null);
    // The two below only add to what is shown: the week's score, and a name for a workout
    // that has none of its own. Without them the list is still the list.
    setCalendar(schedule.ok ? schedule.value : null);
    setPlans(planList.ok ? planList.value : []);
  }, [api, id, week]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const dayNames = useMemo(
    () => new Map(allDays(plans).map((entry) => [entry.day.id, entry.day.name])),
    [plans],
  );
  const score = useMemo(
    () => (sessions && calendar ? tally(week, calendar, sessionsByDay(sessions), today) : null),
    [sessions, calendar, week, today],
  );
  const weightLabel = t(`common.${weightUnitKey(unit)}`);

  /** What to call a workout: the trainee's own name for it, else the plan's, else just that. */
  const titleOf = (session: CoachSession) =>
    session.name ??
    (session.planDayId ? dayNames.get(session.planDayId) : null) ??
    t('coaching.historyUnnamed');

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[
        styles.content,
        { paddingTop: spacing.lg, paddingBottom: insets.bottom + spacing.xxl },
      ]}
      showsVerticalScrollIndicator={false}
    >
      <ScreenHeader title={name ?? t('coaching.trainee')} />
      <Text style={styles.lead}>{t('coaching.historyLead')}</Text>

      {error ? (
        <Banner tone={error === 'not_available' || error === 'offline' ? 'info' : 'warning'}>
          {t(error === 'not_available' ? 'coaching.historyNotAvailable' : coachingErrorKey(error))}
        </Banner>
      ) : null}

      {sessions === null && !error ? (
        <View style={styles.loading}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : null}

      {score ? (
        <FadeSlideIn style={styles.week}>
          <Text style={styles.weekCaption}>{t('coaching.historyThisWeek')}</Text>
          {score.planned > 0 ? (
            <>
              <Text style={styles.weekScore}>
                {score.done}
                <Text style={styles.weekOutOf}> / {score.planned}</Text>
              </Text>
              <Text style={styles.weekDetail}>{t('coaching.historyPlannedDone')}</Text>
            </>
          ) : (
            <Text style={styles.weekDetail}>{t('coaching.historyNothingPlanned')}</Text>
          )}
          {score.missed > 0 ? (
            <Text style={styles.weekMissed}>
              {t('coaching.historyMissed', { count: score.missed })}
            </Text>
          ) : null}
          {score.extra > 0 ? (
            <Text style={styles.weekDetail}>
              {t('coaching.historyExtra', { count: score.extra })}
            </Text>
          ) : null}
        </FadeSlideIn>
      ) : null}

      {sessions?.length === 0 ? (
        <EmptyState
          emoji="🏋️"
          title={t('coaching.historyEmpty')}
          hint={t('coaching.historyEmptyHint')}
        />
      ) : null}

      {sessions?.map((session, index) => {
        const expanded = open === session.id;
        const minutes = sessionMinutes(session);
        const sets = workingSetCount(session);
        const volume = sessionVolumeKg(session);
        const when = new Date(session.startedAt).toLocaleDateString(i18n.language, {
          weekday: 'long',
          day: 'numeric',
          month: 'numeric',
        });
        const Caret = expanded ? CaretUp : CaretDown;
        return (
          <FadeSlideIn key={session.id} index={Math.min(index, 6)} style={styles.card}>
            <Pressable
              onPress={() => {
                hapticLight();
                setOpen(expanded ? null : session.id);
              }}
              accessibilityRole="button"
              accessibilityState={{ expanded }}
              style={({ pressed }) => [styles.head, pressed && styles.pressed]}
            >
              <View style={styles.headText}>
                <Text style={styles.when}>{when}</Text>
                <Text style={styles.title}>{titleOf(session)}</Text>
                <Text style={styles.meta}>
                  {[
                    minutes !== null ? t('coaching.historyMinutes', { count: minutes }) : null,
                    t('coaching.historySets', { count: sets }),
                    volume > 0 ? `${formatVolume(volume, unit)} ${weightLabel}` : null,
                    session.rpe !== null ? t('coaching.historyEffort', { rpe: session.rpe }) : null,
                    // A mark that there is something to read inside, without it being read here.
                    session.note ? '💬' : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </Text>
              </View>
              <Caret size={18} color={colors.textFaint} />
            </Pressable>

            {expanded ? (
              <View style={styles.exercises}>
                {session.note ? (
                  <View style={styles.note}>
                    <Text style={styles.noteCaption}>{t('coaching.historyNote')}</Text>
                    <Text style={styles.noteText}>{session.note}</Text>
                  </View>
                ) : null}
                {session.exercises.map((exercise, position) => {
                  const seed = exercise.exerciseKey
                    ? EXERCISE_BY_KEY.get(exercise.exerciseKey)
                    : undefined;
                  return (
                    <SessionExerciseSummary
                      key={position}
                      seed={seed}
                      name={
                        seed
                          ? isHebrew
                            ? seed.nameHe
                            : seed.nameEn
                          : (exercise.exerciseKey ?? t('coaching.historyUnnamedExercise'))
                      }
                      sets={exercise.sets}
                    />
                  );
                })}
                {session.exercises.length === 0 ? (
                  <Text style={styles.meta}>{t('coaching.historyNoSets')}</Text>
                ) : null}
              </View>
            ) : null}
          </FadeSlideIn>
        );
      })}
    </ScrollView>
  );
}

const createStyles = (colors: ColorPalette) =>
  StyleSheet.create<{
    screen: ViewStyle;
    content: ViewStyle;
    lead: TextStyle;
    loading: ViewStyle;
    week: ViewStyle;
    weekCaption: TextStyle;
    weekScore: TextStyle;
    weekOutOf: TextStyle;
    weekDetail: TextStyle;
    weekMissed: TextStyle;
    card: ViewStyle;
    head: ViewStyle;
    headText: ViewStyle;
    pressed: ViewStyle;
    when: TextStyle;
    title: TextStyle;
    meta: TextStyle;
    exercises: ViewStyle;
    note: ViewStyle;
    noteCaption: TextStyle;
    noteText: TextStyle;
  }>({
    screen: { flex: 1 },
    content: { paddingHorizontal: spacing.lg, gap: spacing.lg },
    lead: { color: colors.textMuted, fontSize: fontSize.sm, lineHeight: 20, textAlign: 'auto' },
    loading: { paddingVertical: spacing.xxl, alignItems: 'center' },

    week: {
      backgroundColor: colors.surface,
      borderRadius: radius.xl,
      padding: spacing.lg,
      gap: spacing.xxs,
      borderWidth: 1,
      borderColor: colors.accentBorder,
      ...shadow(colors.shadow).card,
    },
    weekCaption: {
      color: colors.accent,
      fontSize: fontSize.sm,
      fontWeight: fontWeight.bold,
      textAlign: 'auto',
    },
    weekScore: {
      color: colors.text,
      fontSize: 40,
      fontWeight: fontWeight.bold,
      fontVariant: ['tabular-nums'],
      textAlign: 'auto',
    },
    weekOutOf: { color: colors.textMuted, fontSize: fontSize.xl, fontWeight: fontWeight.medium },
    weekDetail: { color: colors.textMuted, fontSize: fontSize.sm, textAlign: 'auto' },
    weekMissed: { color: colors.danger, fontSize: fontSize.sm, textAlign: 'auto' },

    card: {
      backgroundColor: colors.surface,
      borderRadius: radius.xl,
      padding: spacing.lg,
      gap: spacing.md,
      ...shadow(colors.shadow).card,
    },
    head: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
    headText: { flex: 1, gap: spacing.xxs },
    pressed: { opacity: 0.6 },
    when: {
      color: colors.accent,
      fontSize: fontSize.xs,
      fontWeight: fontWeight.bold,
      textAlign: 'auto',
    },
    title: {
      color: colors.text,
      fontSize: fontSize.lg,
      fontWeight: fontWeight.bold,
      textAlign: 'auto',
    },
    meta: { color: colors.textMuted, fontSize: fontSize.sm, textAlign: 'auto' },
    exercises: { gap: spacing.md },
    note: {
      gap: spacing.xxs,
      padding: spacing.md,
      borderRadius: radius.md,
      backgroundColor: colors.accentSoft,
      borderWidth: 1,
      borderColor: colors.accentBorder,
    },
    noteCaption: {
      color: colors.accent,
      fontSize: fontSize.xs,
      fontWeight: fontWeight.bold,
      textAlign: 'auto',
    },
    noteText: { color: colors.text, fontSize: fontSize.sm, lineHeight: 20, textAlign: 'auto' },
  });
