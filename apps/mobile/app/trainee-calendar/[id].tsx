/**
 * A trainee's calendar, in their coach's hands.
 *
 * A month at a time: every date shows what is planned for it, and tapping one sets it. What a
 * coach can put on a date is any workout the trainee already has — or any of the coach's own
 * saved workouts, which is the point of the screen. A coach has spent years building the
 * workouts in their own app; giving one to a trainee should be a tap, not retyping it.
 *
 * ## Giving a trainee one of the coach's own workouts
 *
 * Choosing one of the coach's own copies it into the trainee's plans first — into a group of
 * the same name as the coach's, made if the trainee has none — and then puts that copy on the
 * date. The copy is the trainee's from then on: theirs to open, log against and track, and
 * changing the coach's original later does not reach into it. If the trainee already has an
 * identical copy, that one is used, so the same leg day on four Tuesdays is one workout on
 * their plan screen and not four.
 *
 * ## What a date can hold
 *
 * The same three things the trainee's own calendar knows: nothing decided, a rest day, or one
 * or more workouts in order. Setting a date replaces what it held, unless a second workout is
 * being added to it. A change reaches the trainee's phone the next time it syncs, and from then
 * on shows on their home screen and in their reminders like a day they planned themselves.
 *
 * Nothing here is written to the coach's database. The coach's own workouts are only read.
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
import { CaretLeft, CaretRight } from 'phosphor-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useCurrentUserId } from '../../src/auth/CurrentUserProvider.js';
import type { CoachingError } from '../../src/coaching/api.js';
import {
  allDays,
  copyForTrainee,
  existingCopy,
  groupNamed,
  type CoachCalendar,
  type CoachPlan,
  type DayTiming,
  type OwnWorkout,
} from '../../src/coaching/planDocument.js';
import {
  dayOutcome,
  sessionsByDay,
  type CoachSession,
} from '../../src/coaching/sessionDocument.js';
import { coachingErrorKey, useCoachingApi } from '../../src/coaching/useCoachingApi.js';
import { useActionSheet } from '../../src/components/ActionSheetProvider.js';
import { FadeSlideIn } from '../../src/components/motion.js';
import { Banner, ScreenHeader } from '../../src/components/ui.js';
import { listPlanDayExercises, listUserPlanDays } from '../../src/db/plans.js';
import { getExecutor, newId } from '../../src/db/provider.js';
import {
  addMonths,
  localDate,
  monthGrid,
  monthKey,
  parseLocalDate,
} from '../../src/db/schedule.js';
import { hapticLight, hapticSuccess } from '../../src/haptics.js';
import { isRtlLanguage, type Language } from '../../src/i18n/index.js';
import { useTheme } from '../../src/ThemeProvider.js';
import {
  fontSize,
  fontWeight,
  radius,
  shadow,
  spacing,
  type ColorPalette,
} from '../../src/theme.js';

/** One of the coach's own workouts, as listed: which row it is, how to name it, how it is timed. */
interface OwnWorkoutChoice extends DayTiming {
  planDayId: string;
  groupName: string;
  name: string | null;
  number: number;
}

/** September 20th 2026 is a Sunday; the week from it gives weekday initials in any language. */
const A_SUNDAY = new Date(2026, 8, 20);

export default function TraineeCalendarScreen() {
  const { t, i18n } = useTranslation();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { id, name } = useLocalSearchParams<{ id: string; name?: string }>();
  const api = useCoachingApi();
  const coachId = useCurrentUserId();
  const { ask } = useActionSheet();

  const today = localDate(new Date());
  const [month, setMonth] = useState(() => monthKey(today));
  const [plans, setPlans] = useState<CoachPlan[] | null>(null);
  const [calendar, setCalendar] = useState<CoachCalendar | null>(null);
  // The days the trainee trained, for the marks on the grid. Null until known — and it stays
  // null on a server that cannot say (0012 not run), where the calendar simply has no marks.
  const [trained, setTrained] = useState<ReadonlyMap<string, readonly CoachSession[]> | null>(null);
  const [mine, setMine] = useState<OwnWorkoutChoice[]>([]);
  const [error, setError] = useState<CoachingError | null>(null);
  // The date being written, so that only its own cell shows it.
  const [saving, setSaving] = useState<string | null>(null);

  const grid = useMemo(() => monthGrid(month), [month]);
  const first = grid[0]?.[0]?.date ?? `${month}-01`;
  const last = grid[grid.length - 1]?.[6]?.date ?? `${month}-28`;

  const load = useCallback(async () => {
    if (!api || !id) return;
    // The month on screen, including the days it borrows from its neighbours.
    const [planList, schedule] = await Promise.all([api.plans(id), api.schedule(id, first, last)]);
    if (!planList.ok) {
      setError(planList.error);
      return;
    }
    if (!schedule.ok) {
      setError(schedule.error);
      return;
    }
    setPlans(planList.value);
    setCalendar(schedule.value);
    setError(null);

    // After the calendar is on screen, and never in its way: what was done is extra, and a
    // failure to fetch it is not a failure of the calendar.
    const until = parseLocalDate(last);
    until.setDate(until.getDate() + 1);
    const done = await api.sessions(id, parseLocalDate(first).toISOString(), until.toISOString());
    setTrained(done.ok ? sessionsByDay(done.value) : null);
  }, [api, id, first, last]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  // The coach's own workouts: read from this phone's own database, never sent anywhere until
  // one is chosen.
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      void (async () => {
        const db = await getExecutor();
        const rows = await listUserPlanDays(db, coachId);
        if (cancelled) return;
        const counts = new Map<string, number>();
        setMine(
          rows.map((row) => {
            const number = (counts.get(row.plan_id) ?? 0) + 1;
            counts.set(row.plan_id, number);
            return {
              planDayId: row.id,
              groupName: row.plan_name,
              name: row.name,
              number,
              workSeconds: row.work_seconds ?? null,
              restSeconds: row.rest_seconds ?? null,
              rounds: row.rounds ?? null,
            };
          }),
        );
      })();
      return () => {
        cancelled = true;
      };
    }, [coachId]),
  );

  const theirs = useMemo(() => allDays(plans ?? []), [plans]);
  const nameOf = useCallback(
    (planDayId: string) => {
      const found = theirs.find((entry) => entry.day.id === planDayId);
      if (!found) return t('coaching.unknownWorkout');
      return found.day.name ?? t('coaching.workoutNumber', { number: found.number });
    },
    [theirs, t],
  );

  /** Write one date and read the month again, whatever happened. */
  const write = async (date: string, planDayIds: readonly string[], rest: boolean) => {
    if (!api || !id) return;
    const result = await api.setSchedule(id, date, planDayIds, rest);
    if (result.ok) hapticSuccess();
    else setError(result.error);
  };

  /**
   * Make sure the trainee has this workout of the coach's, and say which of theirs it is.
   *
   * Reads the coach's workout from this phone, then either finds the identical copy the trainee
   * already has or writes a new one — making the group first if they have none of that name.
   */
  const handOver = async (choice: OwnWorkoutChoice): Promise<string | null> => {
    if (!api || !id) return null;
    const db = await getExecutor();
    const exercises = await listPlanDayExercises(db, choice.planDayId);
    const source: OwnWorkout = {
      groupName: choice.groupName,
      name: choice.name ?? t('coaching.workoutNumber', { number: choice.number }),
      workSeconds: choice.workSeconds,
      restSeconds: choice.restSeconds,
      rounds: choice.rounds,
      exercises: exercises.map((exercise) => ({
        exerciseKey: exercise.exercise_key,
        targetSets: exercise.target_sets,
        targetRepsMin: exercise.target_reps_min,
        targetRepsMax: exercise.target_reps_max,
        notes: exercise.notes,
      })),
    };

    // Read fresh, not from what the screen loaded: the trainee may have changed their plans
    // since, and matching against a stale list is how a duplicate gets made.
    const current = await api.plans(id);
    if (!current.ok) {
      setError(current.error);
      return null;
    }
    const already = existingCopy(current.value, source);
    if (already) return already.dayId;

    let planId = groupNamed(current.value, source.groupName)?.id ?? null;
    if (!planId) {
      planId = newId();
      const made = await api.savePlan(id, planId, source.groupName);
      if (!made.ok) {
        setError(made.error);
        return null;
      }
    }
    const copy = copyForTrainee(source, newId);
    const saved = await api.saveDay(id, planId, copy);
    if (!saved.ok) {
      setError(saved.error);
      return null;
    }
    return copy.id;
  };

  const pickFor = async (date: string) => {
    if (!api || !id || saving) return;
    const held = calendar?.get(date);
    const workouts = Array.isArray(held) ? held : [];
    const title = parseLocalDate(date).toLocaleDateString(i18n.language, {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
    });

    // A date that already holds something is asked what to do with it first. Going straight
    // to the list would make "replace" the only thing a tap can mean, and a trainee with
    // weights in the morning and abs at night would lose one of them to it.
    let adding = false;
    if (held !== undefined) {
      const actions: { label: string; destructive?: boolean }[] = [
        { label: t('coaching.dayReplace') },
      ];
      if (workouts.length > 0) actions.push({ label: t('coaching.dayAddAnother') });
      const restIndex = held === null ? -1 : actions.push({ label: t('coaching.dayRest') }) - 1;
      const clearIndex = actions.push({ label: t('coaching.dayClear'), destructive: true }) - 1;

      const choice = await ask({
        title,
        message:
          held === null
            ? t('coaching.dayRest')
            : workouts.map((planDayId) => nameOf(planDayId)).join(' · '),
        actions,
      });
      if (choice === null) return;
      if (choice === restIndex || choice === clearIndex) {
        setSaving(date);
        await write(date, [], choice === restIndex);
        await load();
        setSaving(null);
        return;
      }
      adding = workouts.length > 0 && choice === 1;
    }

    // Theirs first, then the coach's own, then rest — one list, searchable, because a coach
    // with years of workouts is not going to scroll for the one they want.
    const options = [
      ...theirs.map((entry) => ({
        label: `${entry.planName} · ${entry.day.name ?? t('coaching.workoutNumber', { number: entry.number })}`,
      })),
      ...mine.map((entry) => ({
        label: `${t('coaching.fromMine')} · ${entry.groupName} · ${entry.name ?? t('coaching.workoutNumber', { number: entry.number })}`,
      })),
      ...(adding ? [] : [{ label: t('coaching.dayRest') }]),
    ];
    const picked = await ask({
      title,
      message: theirs.length + mine.length === 0 ? t('coaching.noWorkoutsToAssign') : undefined,
      actions: options,
      searchPlaceholder: t('coaching.searchWorkout'),
    });
    if (picked === null) return;

    setSaving(date);
    setError(null);
    let planDayId: string | null = null;
    let rest = false;
    if (picked < theirs.length) {
      planDayId = theirs[picked]?.day.id ?? null;
    } else if (picked < theirs.length + mine.length) {
      const choice = mine[picked - theirs.length];
      planDayId = choice ? await handOver(choice) : null;
      if (planDayId === null) {
        // Handing it over failed and said why; the date is left as it was.
        await load();
        setSaving(null);
        return;
      }
    } else {
      rest = true;
    }

    if (rest || planDayId === null) await write(date, [], true);
    else await write(date, adding ? [...workouts, planDayId] : [planDayId], false);
    await load();
    setSaving(null);
  };

  const rtl = isRtlLanguage(i18n.language as Language);
  // "Earlier" is towards the start of the row, which is the right-hand side in Hebrew.
  const Earlier = rtl ? CaretRight : CaretLeft;
  const Later = rtl ? CaretLeft : CaretRight;
  const monthTitle = parseLocalDate(`${month}-01`).toLocaleDateString(i18n.language, {
    month: 'long',
    year: 'numeric',
  });
  const weekdays = Array.from({ length: 7 }, (_, weekday) =>
    new Date(
      A_SUNDAY.getFullYear(),
      A_SUNDAY.getMonth(),
      A_SUNDAY.getDate() + weekday,
    ).toLocaleDateString(i18n.language, { weekday: 'narrow' }),
  );

  const step = (delta: number) => {
    hapticLight();
    // The old month's dates must not be shown under the new month's name while it loads.
    setCalendar(null);
    setMonth((current) => addMonths(current, delta));
  };

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
      <Text style={styles.lead}>{t('coaching.calendarLead')}</Text>

      {error ? <Banner tone="warning">{t(coachingErrorKey(error))}</Banner> : null}

      <FadeSlideIn style={styles.card}>
        <View style={styles.monthRow}>
          <Pressable
            onPress={() => step(-1)}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel={t('coaching.previousMonth')}
            style={({ pressed }) => [styles.monthButton, pressed && styles.pressed]}
          >
            <Earlier size={18} color={colors.accent} weight="bold" />
          </Pressable>
          <Text style={styles.monthTitle}>{monthTitle}</Text>
          <Pressable
            onPress={() => step(1)}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel={t('coaching.nextMonth')}
            style={({ pressed }) => [styles.monthButton, pressed && styles.pressed]}
          >
            <Later size={18} color={colors.accent} weight="bold" />
          </Pressable>
        </View>

        <View style={styles.week}>
          {weekdays.map((weekday, index) => (
            <Text key={index} style={styles.weekday}>
              {weekday}
            </Text>
          ))}
        </View>

        {calendar === null && !error ? (
          <View style={styles.loading}>
            <ActivityIndicator color={colors.accent} />
          </View>
        ) : (
          grid.map((row) => (
            <View key={row[0]?.date} style={styles.week}>
              {row.map((cell) => {
                const held = calendar?.get(cell.date);
                const workouts = Array.isArray(held) ? held : [];
                const label =
                  held === null
                    ? t('coaching.restShort')
                    : workouts.length > 0
                      ? nameOf(workouts[0]!)
                      : '';
                const outcome = trained
                  ? dayOutcome({
                      date: cell.date,
                      today,
                      planned: held,
                      trained: (trained.get(cell.date)?.length ?? 0) > 0,
                    })
                  : null;
                const mark =
                  outcome === 'done' || outcome === 'missed' || outcome === 'extra'
                    ? outcome
                    : null;
                return (
                  <Pressable
                    key={cell.date}
                    onPress={() => void pickFor(cell.date)}
                    disabled={saving !== null}
                    accessibilityRole="button"
                    accessibilityLabel={[cell.date, label, mark ? t(`coaching.mark_${mark}`) : null]
                      .filter(Boolean)
                      .join(' ')}
                    style={({ pressed }) => [
                      styles.cell,
                      !cell.inMonth && styles.cellOutside,
                      workouts.length > 0 && styles.cellPlanned,
                      cell.date === today && styles.cellToday,
                      pressed && styles.pressed,
                    ]}
                  >
                    {saving === cell.date ? (
                      <ActivityIndicator size="small" color={colors.accent} />
                    ) : (
                      <>
                        <Text
                          style={[styles.dayNumber, workouts.length > 0 && styles.dayNumberPlanned]}
                        >
                          {Number(cell.date.slice(8))}
                        </Text>
                        <Text
                          style={[styles.dayLabel, workouts.length > 0 && styles.dayLabelPlanned]}
                          numberOfLines={1}
                        >
                          {label}
                        </Text>
                        {workouts.length > 1 ? (
                          <Text style={styles.more}>+{workouts.length - 1}</Text>
                        ) : null}
                        {mark === 'done' ? <Text style={styles.markDone}>✓</Text> : null}
                        {mark === 'missed' ? <View style={styles.markMissed} /> : null}
                        {mark === 'extra' ? <View style={styles.markExtra} /> : null}
                      </>
                    )}
                  </Pressable>
                );
              })}
            </View>
          ))
        )}

        {/* What the three marks mean, once there are marks to explain. */}
        {trained ? (
          <View style={styles.legend}>
            <View style={styles.legendItem}>
              <Text style={styles.legendDone}>✓</Text>
              <Text style={styles.legendText}>{t('coaching.mark_done')}</Text>
            </View>
            <View style={styles.legendItem}>
              <View style={styles.legendMissed} />
              <Text style={styles.legendText}>{t('coaching.mark_missed')}</Text>
            </View>
            <View style={styles.legendItem}>
              <View style={styles.legendExtra} />
              <Text style={styles.legendText}>{t('coaching.mark_extra')}</Text>
            </View>
          </View>
        ) : null}
      </FadeSlideIn>
    </ScrollView>
  );
}

const createStyles = (colors: ColorPalette) =>
  StyleSheet.create<{
    screen: ViewStyle;
    content: ViewStyle;
    lead: TextStyle;
    card: ViewStyle;
    monthRow: ViewStyle;
    monthButton: ViewStyle;
    monthTitle: TextStyle;
    week: ViewStyle;
    weekday: TextStyle;
    loading: ViewStyle;
    cell: ViewStyle;
    cellOutside: ViewStyle;
    cellPlanned: ViewStyle;
    cellToday: ViewStyle;
    dayNumber: TextStyle;
    dayNumberPlanned: TextStyle;
    dayLabel: TextStyle;
    dayLabelPlanned: TextStyle;
    more: TextStyle;
    markDone: TextStyle;
    markMissed: ViewStyle;
    markExtra: ViewStyle;
    legend: ViewStyle;
    legendItem: ViewStyle;
    legendDone: TextStyle;
    legendMissed: ViewStyle;
    legendExtra: ViewStyle;
    legendText: TextStyle;
    pressed: ViewStyle;
  }>({
    screen: { flex: 1 },
    content: { paddingHorizontal: spacing.lg, gap: spacing.lg },
    lead: { color: colors.textMuted, fontSize: fontSize.sm, lineHeight: 20, textAlign: 'auto' },

    card: {
      backgroundColor: colors.surface,
      borderRadius: radius.xl,
      padding: spacing.md,
      gap: spacing.sm,
      ...shadow(colors.shadow).card,
    },
    monthRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: spacing.xs,
      paddingBottom: spacing.sm,
    },
    monthButton: {
      width: 38,
      height: 38,
      borderRadius: radius.pill,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.accentSoft,
    },
    monthTitle: { color: colors.text, fontSize: fontSize.lg, fontWeight: fontWeight.bold },

    // Seven equal columns. The row follows the layout's direction, so the week starts on the
    // right in Hebrew, as a Hebrew calendar does.
    week: { flexDirection: 'row', gap: spacing.xs },
    weekday: {
      flex: 1,
      textAlign: 'center',
      color: colors.textFaint,
      fontSize: fontSize.xs,
      paddingBottom: spacing.xs,
    },
    loading: { paddingVertical: spacing.xxxl, alignItems: 'center' },

    cell: {
      flex: 1,
      height: 62,
      borderRadius: radius.sm,
      alignItems: 'center',
      justifyContent: 'center',
      gap: spacing.xxs,
      paddingHorizontal: spacing.xxs,
      backgroundColor: colors.surfaceRaised,
      borderWidth: 1.5,
      borderColor: 'transparent',
    },
    cellOutside: { opacity: 0.4 },
    cellPlanned: { backgroundColor: colors.accentSoft },
    cellToday: { borderColor: colors.accent },
    dayNumber: {
      color: colors.textSecondary,
      fontSize: fontSize.sm,
      fontWeight: fontWeight.medium,
      fontVariant: ['tabular-nums'],
    },
    dayNumberPlanned: { color: colors.accent, fontWeight: fontWeight.bold },
    dayLabel: { color: colors.textFaint, fontSize: 9, textAlign: 'center' },
    dayLabelPlanned: { color: colors.accent },
    more: {
      position: 'absolute',
      top: 3,
      end: 4,
      color: colors.accent,
      fontSize: 9,
      fontWeight: fontWeight.bold,
    },
    // In the corner opposite the "+1", so a day with two workouts that was done shows both.
    markDone: {
      position: 'absolute',
      top: 1,
      start: 4,
      color: colors.accent,
      fontSize: 11,
      fontWeight: fontWeight.bold,
    },
    markMissed: {
      position: 'absolute',
      top: 5,
      start: 5,
      width: 7,
      height: 7,
      borderRadius: 4,
      borderWidth: 1.5,
      borderColor: colors.danger,
    },
    markExtra: {
      position: 'absolute',
      top: 5,
      start: 5,
      width: 7,
      height: 7,
      borderRadius: 4,
      backgroundColor: colors.warning,
    },
    legend: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      justifyContent: 'center',
      gap: spacing.lg,
      marginTop: spacing.md,
    },
    legendItem: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
    legendDone: { color: colors.accent, fontSize: 12, fontWeight: fontWeight.bold },
    legendMissed: {
      width: 8,
      height: 8,
      borderRadius: 4,
      borderWidth: 1.5,
      borderColor: colors.danger,
    },
    legendExtra: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.warning },
    legendText: { color: colors.textMuted, fontSize: fontSize.xs },
    pressed: { opacity: 0.55 },
  });
