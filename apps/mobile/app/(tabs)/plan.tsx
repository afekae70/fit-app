/**
 * The programme: a month at a glance, and the workouts it is built from.
 *
 * The calendar is the screen rather than a page behind it. "What does the month look like" and
 * "what workouts do I have" are the same question asked twice, and splitting them meant editing
 * a workout in one place and scheduling it in another, with a tap between them.
 *
 * Still deliberately separate from the Workouts tab. That tab answers "what am I doing right
 * now"; this one answers "what is the shape of the training". Merging those would put a
 * programme editor in front of someone standing at a rack trying to log a set.
 *
 * The workout list under the calendar does double duty: it is the legend for the coloured grid,
 * and it is where a workout is started, reordered, edited or deleted. One list, so the colour
 * beside a name is the colour that name wears on the calendar and nothing has to be cross
 * referenced.
 *
 * Everything here writes the same `scheduled_days` rows as the week editor, so a day committed
 * on this calendar drives the home card and outranks the rotation exactly as a weekly decision
 * does.
 */

import { router, useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useCurrentUserId } from '../../src/auth/CurrentUserProvider.js';
import { useActionSheet } from '../../src/components/ActionSheetProvider.js';
import { FadeSlideIn } from '../../src/components/motion.js';
import {
  Banner,
  Button,
  Card,
  EmptyState,
  Hint,
  ScreenHeader,
  SectionTitle,
  SkeletonScreen,
} from '../../src/components/ui.js';
import {
  addPlanDay,
  createPlan,
  deletePlan,
  duplicatePlanWeek,
  getActivePlan,
  getNextPlanDay,
  listPlanDayStatus,
  removePlanDay,
  reorderPlanDay,
  startSessionFromPlanDay,
  type PlanRow,
} from '../../src/db/plans.js';
import { getExecutor, newId } from '../../src/db/provider.js';
import {
  addMonths,
  addScheduledWorkout,
  clearScheduledDay,
  getRange,
  localDate,
  monthGrid,
  monthKey,
  removeScheduledWorkout,
  repeatWeekAcrossMonth,
  setScheduledDay,
  weekDates,
  weekStart,
} from '../../src/db/schedule.js';
import { getActiveSession } from '../../src/db/workouts.js';
import { hapticLight } from '../../src/haptics.js';
import { isRtlLanguage, type Language } from '../../src/i18n/index.js';
import { useTheme } from '../../src/ThemeProvider.js';
import { fontSize, fontWeight, radius, spacing, type ColorPalette } from '../../src/theme.js';

type DayStatus = {
  id: string;
  day_index: number;
  name: string | null;
  exercise_count: number;
  last_trained_at: string | null;
  session_count: number;
};

/**
 * The colours a workout can wear on the calendar, cycled in plan order.
 *
 * Palette tokens rather than hex, so they repaint with the theme. `danger` is left out: in this
 * app red means "this deletes something", and a leg day coloured like a delete button reads as
 * a warning.
 */
const HUES = ['accent', 'info', 'warning', 'protein', 'carbs', 'fat'] as const;

/** "3 days ago" in whole days — precise enough for deciding what to train, and language-free. */
function daysSince(iso: string, nowMs: number): number {
  return Math.max(0, Math.floor((nowMs - new Date(iso).getTime()) / 86_400_000));
}

export default function PlanScreen() {
  const { ask, confirm, notify } = useActionSheet();
  const { t, i18n } = useTranslation();
  const insets = useSafeAreaInsets();
  const userId = useCurrentUserId();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const [plan, setPlan] = useState<PlanRow | null>(null);
  const [days, setDays] = useState<DayStatus[]>([]);
  const [nextDayId, setNextDayId] = useState<string | null>(null);
  const [nameDraft, setNameDraft] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const today = localDate(new Date());
  const [month, setMonth] = useState(() => monthKey(today));
  const [decisions, setDecisions] = useState<Map<string, string[] | null>>(new Map());

  const grid = useMemo(() => monthGrid(month), [month]);
  const rtl = isRtlLanguage(i18n.language as Language);

  const reload = useCallback(
    async (forMonth: string) => {
      const db = await getExecutor();
      const active = await getActivePlan(db, userId);
      setPlan(active);

      if (active) {
        setDays(await listPlanDayStatus(db, userId, active.id));
        setNextDayId((await getNextPlanDay(db, userId, active.id))?.id ?? null);
      } else {
        setDays([]);
        setNextDayId(null);
      }

      // The whole grid, borrowed days included, so a decision on the 31st of last month still
      // shows in the first row rather than as a blank that contradicts the week editor.
      const rows = monthGrid(forMonth);
      const lastRow = rows[rows.length - 1];
      const first = rows[0]?.[0]?.date ?? `${forMonth}-01`;
      const last = lastRow?.[lastRow.length - 1]?.date ?? `${forMonth}-28`;
      setDecisions(await getRange(db, userId, first, last));
      setLoading(false);
    },
    [userId],
  );

  // useFocusEffect rather than useEffect: editing a workout happens on another screen, and
  // coming back must show the new exercise counts rather than a stale snapshot.
  useFocusEffect(
    useCallback(() => {
      void reload(month);
    }, [reload, month]),
  );

  const handleRefresh = useCallback(() => {
    setRefreshing(true);
    void reload(month).finally(() => setRefreshing(false));
  }, [reload, month]);

  const switchTo = (next: string) => {
    void hapticLight();
    setMonth(next);
    void reload(next);
  };

  const labelFor = useCallback(
    (day: DayStatus) => day.name?.trim() || `${t('plan.day')} ${day.day_index}`,
    [t],
  );

  const longDate = (date: string) =>
    new Date(`${date}T00:00:00`).toLocaleDateString(i18n.language, {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
    });

  /* ---------------------------------------------------------------- calendar */

  /**
   * Decide what a date holds.
   *
   * On an empty or resting day a workout is simply chosen, as before. Once a day has a workout,
   * the same sheet offers to add another beside it or take one off — so a second session is one
   * more tap on the day already planned, not a separate mode to find.
   */
  const chooseFor = useCallback(
    (date: string) => {
      void (async () => {
        const decision = decisions.get(date);
        const decided = decisions.has(date);
        const onDay = Array.isArray(decision) ? decision : [];
        const onDayTypes = onDay
          .map((id) => days.find((day) => day.id === id))
          .filter((day): day is DayStatus => day !== undefined);

        type Step =
          | { kind: 'set'; id: string }
          | { kind: 'add'; id: string }
          | { kind: 'remove'; id: string }
          | { kind: 'rest' }
          | { kind: 'clear' };
        const steps: { label: string; step: Step }[] = [];

        if (onDayTypes.length === 0) {
          for (const day of days) steps.push({ label: labelFor(day), step: { kind: 'set', id: day.id } });
        } else {
          for (const day of onDayTypes) {
            steps.push({
              label: t('month.removeWorkout', { name: labelFor(day) }),
              step: { kind: 'remove', id: day.id },
            });
          }
          for (const day of days.filter((d) => !onDay.includes(d.id))) {
            steps.push({
              label: t('month.addWorkout', { name: labelFor(day) }),
              step: { kind: 'add', id: day.id },
            });
          }
        }
        if (decision !== null) steps.push({ label: t('week.rest'), step: { kind: 'rest' } });
        // Offered only when there is something to clear. On an undecided day it would be a
        // button that changes nothing, which reads as broken.
        if (decided) steps.push({ label: t('week.clear'), step: { kind: 'clear' } });

        const choice = await ask({
          title: longDate(date),
          message:
            onDayTypes.length > 0
              ? t('month.onThisDay', { names: onDayTypes.map((day) => labelFor(day)).join(' · ') })
              : undefined,
          actions: steps.map((entry) => ({ label: entry.label })),
        });
        const picked = choice === null ? undefined : steps[choice]?.step;
        if (!picked) return;

        const db = await getExecutor();
        if (picked.kind === 'set') await setScheduledDay(db, userId, newId, date, picked.id);
        else if (picked.kind === 'add') await addScheduledWorkout(db, userId, newId, date, picked.id);
        else if (picked.kind === 'remove')
          await removeScheduledWorkout(db, userId, newId, date, picked.id);
        else if (picked.kind === 'rest') await setScheduledDay(db, userId, newId, date, null);
        else await clearScheduledDay(db, userId, date);

        void hapticLight();
        await reload(month);
      })();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- longDate only reads i18n.language
    [decisions, days, ask, t, i18n.language, userId, reload, month, labelFor],
  );

  const repeat = useCallback(() => {
    void hapticLight();
    void (async () => {
      const db = await getExecutor();
      const written = await repeatWeekAcrossMonth(db, userId, newId, month, localDate(new Date()));
      await reload(month);
      // Always says what happened. A fill that found nothing to copy and stayed silent would be
      // indistinguishable from a button that does not work.
      await notify({
        message: written > 0 ? t('month.repeated', { count: written }) : t('month.nothingToRepeat'),
      });
    })();
  }, [userId, month, reload, notify, t]);

  /* ---------------------------------------------------------------- workouts */

  /**
   * Reorder with buttons rather than a drag. A drag inside a vertical ScrollView has to win a
   * gesture race against the scroll to start, and the loser is always the user — either the list
   * will not scroll or the day will not pick up. Two arrows do the same job with no ambiguity.
   */
  const move = useCallback(
    (dayId: string, delta: number) => {
      if (!plan) return;
      const from = days.findIndex((d) => d.id === dayId);
      if (from < 0) return;
      void (async () => {
        const db = await getExecutor();
        await reorderPlanDay(db, plan.id, dayId, from + delta);
        await reload(month);
      })();
    },
    [plan, days, reload, month],
  );

  const duplicate = useCallback(() => {
    if (!plan) return;
    void (async () => {
      const db = await getExecutor();
      await duplicatePlanWeek(db, newId, plan.id);
      await reload(month);
    })();
  }, [plan, reload, month]);

  const create = () => {
    const name = nameDraft.trim();
    if (!name) return;
    void (async () => {
      const db = await getExecutor();
      await createPlan(db, userId, newId, name);
      setNameDraft('');
      await reload(month);
    })();
  };

  const addDay = () => {
    if (!plan) return;
    void (async () => {
      const db = await getExecutor();
      const dayId = await addPlanDay(db, newId, plan.id, null);
      await reload(month);
      // Straight into the editor: a workout with no exercises is not yet a workout, and naming
      // it is the first thing anybody wants to do.
      router.push({ pathname: '/plan-day/[id]', params: { id: dayId } });
    })();
  };

  /** Edit or delete one workout. Renaming lives in the editor, where its exercises are too. */
  const openDayOptions = useCallback(
    (day: DayStatus) => {
      void (async () => {
        const choice = await ask({
          title: labelFor(day),
          actions: [{ label: t('common.edit') }, { label: t('plan.deleteDay'), destructive: true }],
        });
        if (choice === 0) {
          router.push({ pathname: '/plan-day/[id]', params: { id: day.id } });
          return;
        }
        if (choice !== 1) return;

        const ok = await confirm({
          message: t('plan.confirmDeleteDay'),
          confirmLabel: t('plan.deleteDay'),
        });
        if (!ok) return;
        const db = await getExecutor();
        await removePlanDay(db, day.id);
        await reload(month);
      })();
    },
    [ask, confirm, t, labelFor, reload, month],
  );

  const removeThisPlan = () => {
    if (!plan) return;
    void (async () => {
      const ok = await confirm({
        message: t('plan.confirmDeletePlan'),
        confirmLabel: t('plan.deletePlan'),
      });
      if (!ok) return;
      const db = await getExecutor();
      await deletePlan(db, userId, plan.id);
      await reload(month);
    })();
  };

  const start = (planDayId: string) => {
    void (async () => {
      const db = await getExecutor();

      // Only one session can be open at a time; starting a second would strand the first.
      const active = await getActiveSession(db, userId);
      if (active) {
        await notify({ message: t('history.activeWarning') });
        return;
      }

      const sessionId = await startSessionFromPlanDay(db, userId, newId, planDayId);
      if (sessionId) router.replace('/(tabs)/workouts');
    })();
  };

  if (loading) {
    return <SkeletonScreen paddingTop={spacing.xxl} />;
  }

  const nowMs = Date.now();
  const hueById = new Map(days.map((day, index) => [day.id, HUES[index % HUES.length] ?? 'accent']));
  const labelById = new Map(days.map((day) => [day.id, labelFor(day)]));

  const monthTitle = new Date(`${month}-01T00:00:00`).toLocaleDateString(i18n.language, {
    month: 'long',
    year: 'numeric',
  });
  const weekdayNames = weekDates(weekStart(today)).map((date) =>
    new Date(`${date}T00:00:00`).toLocaleDateString(i18n.language, { weekday: 'narrow' }),
  );

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[
        styles.content,
        { paddingTop: spacing.lg, paddingBottom: insets.bottom + spacing.xxl },
      ]}
      keyboardShouldPersistTaps="handled"
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={colors.accent} />
      }
    >
      <ScreenHeader title={t('plan.title')} back />

      {!plan ? (
        <>
          <EmptyState emoji="🗓️" title={t('plan.empty')} hint={t('plan.emptyHint')} />
          <Card>
            <TextInput
              value={nameDraft}
              onChangeText={setNameDraft}
              placeholder={t('plan.namePlaceholder')}
              placeholderTextColor={colors.textMuted}
              style={styles.input}
              returnKeyType="done"
              onSubmitEditing={create}
            />
            <View style={styles.spacer} />
            <Button label={t('plan.create')} onPress={create} />
          </Card>
        </>
      ) : (
        <>
          <Card>
            <SectionTitle>{t('month.title')}</SectionTitle>

            {/* Previous first: in a right-to-left row it sits on the right, which is where the
                past is when a Hebrew reader moves through months. The glyphs flip with it. */}
            <View style={styles.monthNav}>
              <Pressable
                onPress={() => switchTo(addMonths(month, -1))}
                accessibilityRole="button"
                accessibilityLabel={t('month.prev')}
                hitSlop={8}
                style={({ pressed }) => [styles.navButton, pressed && styles.pressed]}
              >
                <Text style={styles.navGlyph}>{rtl ? '›' : '‹'}</Text>
              </Pressable>

              <Pressable
                onPress={() => switchTo(monthKey(today))}
                disabled={month === monthKey(today)}
                accessibilityRole="button"
                style={styles.monthTitleWrap}
              >
                <Text style={styles.monthTitle}>{monthTitle}</Text>
                {month !== monthKey(today) ? (
                  <Text style={styles.backToToday}>{t('week.today')}</Text>
                ) : null}
              </Pressable>

              <Pressable
                onPress={() => switchTo(addMonths(month, 1))}
                accessibilityRole="button"
                accessibilityLabel={t('month.next')}
                hitSlop={8}
                style={({ pressed }) => [styles.navButton, pressed && styles.pressed]}
              >
                <Text style={styles.navGlyph}>{rtl ? '‹' : '›'}</Text>
              </Pressable>
            </View>

            <View style={styles.row}>
              {weekdayNames.map((name, index) => (
                <Text key={index} style={styles.weekday}>
                  {name}
                </Text>
              ))}
            </View>

            <View style={styles.grid}>
              {grid.map((week) => (
                <View key={week[0]?.date} style={styles.row}>
                  {week.map((cell) => {
                    const decided = decisions.has(cell.date);
                    const decision = decisions.get(cell.date);
                    const workouts = (Array.isArray(decision) ? decision : []).filter((id) =>
                      labelById.has(id),
                    );
                    const labels = workouts.map((id) => labelById.get(id) ?? '');
                    const isToday = cell.date === today;
                    // Two tags fit a cell. A third day of training on one date is rare enough to
                    // be a count rather than a squeeze.
                    const shown = workouts.length > 2 ? workouts.slice(0, 1) : workouts;
                    const hidden = workouts.length - shown.length;

                    return (
                      <Pressable
                        key={cell.date}
                        onPress={() => chooseFor(cell.date)}
                        // Borrowed days belong to the neighbouring months and are edited there;
                        // tapping one here would change a month nobody is looking at.
                        disabled={!cell.inMonth}
                        accessibilityRole="button"
                        accessibilityLabel={`${longDate(cell.date)}: ${
                          labels.length > 0
                            ? labels.join(', ')
                            : decided
                              ? t('week.rest')
                              : t('week.undecided')
                        }`}
                        style={({ pressed }) => [
                          styles.cell,
                          !cell.inMonth && styles.cellOutside,
                          cell.inMonth && cell.date < today && styles.cellPast,
                          isToday && styles.cellToday,
                          pressed && styles.pressed,
                        ]}
                      >
                        <Text style={[styles.cellNumber, isToday && styles.cellNumberToday]}>
                          {Number(cell.date.slice(8))}
                        </Text>

                        {cell.inMonth && workouts.length > 0 ? (
                          <>
                            {shown.map((id) => (
                              <View
                                key={id}
                                style={[
                                  styles.tag,
                                  { backgroundColor: colors[hueById.get(id) ?? 'accent'] },
                                ]}
                              >
                                <Text style={styles.tagText} numberOfLines={1}>
                                  {labelById.get(id)}
                                </Text>
                              </View>
                            ))}
                            {hidden > 0 ? (
                              <Text style={styles.rest} numberOfLines={1}>
                                +{hidden}
                              </Text>
                            ) : null}
                          </>
                        ) : cell.inMonth && decided && decision === null ? (
                          <Text style={styles.rest} numberOfLines={1}>
                            {t('week.rest')}
                          </Text>
                        ) : null}
                      </Pressable>
                    );
                  })}
                </View>
              ))}
            </View>

            <Hint>{t('month.hint')}</Hint>
          </Card>

          {days.length > 0 ? (
            <Card>
              <SectionTitle>{t('month.repeat')}</SectionTitle>
              <Hint>{t('month.repeatHint')}</Hint>
              <Pressable
                onPress={repeat}
                accessibilityRole="button"
                style={({ pressed }) => [styles.fillButton, pressed && styles.pressed]}
              >
                <Text style={styles.fillButtonText}>{t('month.repeat')}</Text>
              </Pressable>
            </Card>
          ) : null}

          <Text style={styles.planName}>{plan.name}</Text>

          {days.length === 0 ? (
            <EmptyState emoji="➕" title={t('plan.noDays')} hint={t('plan.noDaysHint')} />
          ) : (
            days.map((day, index) => {
              const isNext = day.id === nextDayId;
              const label = labelFor(day);
              return (
                <FadeSlideIn key={day.id} index={index}>
                  <Pressable
                    onPress={() => router.push({ pathname: '/plan-day/[id]', params: { id: day.id } })}
                    style={[styles.dayCard, isNext && styles.dayCardNext]}
                    accessibilityRole="button"
                  >
                    <View style={styles.dayHeader}>
                      {/* The same colour this workout wears on the calendar, so the grid needs
                          no separate key. */}
                      <View
                        style={[
                          styles.dayDot,
                          { backgroundColor: colors[hueById.get(day.id) ?? 'accent'] },
                        ]}
                      />
                      <View style={styles.dayHeaderMain}>
                        <Text style={styles.dayName}>{label}</Text>
                        <Text style={styles.dayMeta}>
                          {t('plan.exercises', { count: day.exercise_count })}
                          {day.last_trained_at
                            ? ` · ${t('plan.trained')} ${daysSince(day.last_trained_at, nowMs)} ${t('plan.daysAgo')}`
                            : ` · ${t('plan.neverTrained')}`}
                        </Text>
                      </View>

                      {isNext ? (
                        <View style={styles.nextBadge}>
                          <Text style={styles.nextBadgeText}>{t('plan.next')}</Text>
                        </View>
                      ) : null}

                      <View style={styles.reorder}>
                        <Pressable
                          onPress={() => move(day.id, -1)}
                          disabled={index === 0}
                          style={[styles.moveBtn, index === 0 && styles.moveBtnOff]}
                          accessibilityRole="button"
                          accessibilityLabel={t('plan.moveUp')}
                          hitSlop={6}
                        >
                          <Text style={styles.moveText}>↑</Text>
                        </Pressable>
                        <Pressable
                          onPress={() => move(day.id, 1)}
                          disabled={index === days.length - 1}
                          style={[styles.moveBtn, index === days.length - 1 && styles.moveBtnOff]}
                          accessibilityRole="button"
                          accessibilityLabel={t('plan.moveDown')}
                          hitSlop={6}
                        >
                          <Text style={styles.moveText}>↓</Text>
                        </Pressable>
                        <Pressable
                          onPress={() => openDayOptions(day)}
                          style={styles.moveBtn}
                          accessibilityRole="button"
                          accessibilityLabel={t('workout.exerciseOptions')}
                          hitSlop={6}
                        >
                          <Text style={styles.moveText}>⋯</Text>
                        </Pressable>
                      </View>
                    </View>

                    {day.exercise_count > 0 ? (
                      <Pressable
                        onPress={() => start(day.id)}
                        style={styles.startButton}
                        accessibilityRole="button"
                      >
                        <Text style={styles.startButtonText}>▶ {t('plan.startDay')}</Text>
                      </Pressable>
                    ) : (
                      <Text style={styles.emptyDayHint}>{t('plan.dayEmptyHint')}</Text>
                    )}
                  </Pressable>
                </FadeSlideIn>
              );
            })
          )}

          <Pressable onPress={addDay} style={styles.addDayButton} accessibilityRole="button">
            <Text style={styles.addDayText}>+ {t('plan.addDay')}</Text>
          </Pressable>

          {days.length > 0 ? (
            <Pressable onPress={duplicate} style={styles.addDayButton} accessibilityRole="button">
              <Text style={styles.addDayText}>⧉ {t('plan.duplicateWeek')}</Text>
            </Pressable>
          ) : null}

          {/* The week editor stays: committing the coming week one weekday at a time is a
              different ritual from painting a month, and both write the same rows. */}
          <Pressable
            onPress={() => router.push('/plan-week')}
            style={styles.addDayButton}
            accessibilityRole="button"
          >
            <Text style={styles.addDayText}>🗓️ {t('week.planNext')}</Text>
          </Pressable>

          <Banner tone="info">{t('plan.prescriptionNote')}</Banner>

          <Pressable onPress={removeThisPlan} style={styles.deleteButton} accessibilityRole="button">
            <Text style={styles.deleteButtonText}>{t('plan.deletePlan')}</Text>
          </Pressable>
        </>
      )}
    </ScrollView>
  );
}

const createStyles = (colors: ColorPalette) =>
  StyleSheet.create<{
    screen: ViewStyle;
    content: ViewStyle;
    input: TextStyle;
    spacer: ViewStyle;
    monthNav: ViewStyle;
    navButton: ViewStyle;
    navGlyph: TextStyle;
    monthTitleWrap: ViewStyle;
    monthTitle: TextStyle;
    backToToday: TextStyle;
    grid: ViewStyle;
    row: ViewStyle;
    weekday: TextStyle;
    cell: ViewStyle;
    cellOutside: ViewStyle;
    cellPast: ViewStyle;
    cellToday: ViewStyle;
    cellNumber: TextStyle;
    cellNumberToday: TextStyle;
    tag: ViewStyle;
    tagText: TextStyle;
    rest: TextStyle;
    fillButton: ViewStyle;
    fillButtonText: TextStyle;
    planName: TextStyle;
    dayCard: ViewStyle;
    dayCardNext: ViewStyle;
    dayHeader: ViewStyle;
    dayDot: ViewStyle;
    dayHeaderMain: ViewStyle;
    dayName: TextStyle;
    dayMeta: TextStyle;
    reorder: ViewStyle;
    moveBtn: ViewStyle;
    moveBtnOff: ViewStyle;
    moveText: TextStyle;
    nextBadge: ViewStyle;
    nextBadgeText: TextStyle;
    startButton: ViewStyle;
    startButtonText: TextStyle;
    emptyDayHint: TextStyle;
    addDayButton: ViewStyle;
    addDayText: TextStyle;
    deleteButton: ViewStyle;
    deleteButtonText: TextStyle;
    pressed: ViewStyle;
  }>({
    screen: { flex: 1, backgroundColor: colors.bg },
    content: { paddingHorizontal: spacing.lg, gap: spacing.md },
    input: {
      color: colors.text,
      fontSize: fontSize.md,
      backgroundColor: colors.surfaceRaised,
      borderRadius: radius.sm,
      borderWidth: 1,
      borderColor: colors.border,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      textAlign: 'auto',
    },
    spacer: { height: spacing.md },

    monthNav: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginVertical: spacing.md,
    },
    navButton: {
      width: 40,
      height: 40,
      borderRadius: radius.pill,
      backgroundColor: colors.surfaceRaised,
      alignItems: 'center',
      justifyContent: 'center',
    },
    navGlyph: { color: colors.text, fontSize: 24, lineHeight: 26 },
    monthTitleWrap: { alignItems: 'center', flex: 1 },
    monthTitle: { color: colors.text, fontSize: fontSize.lg, fontWeight: fontWeight.bold },
    backToToday: { color: colors.accent, fontSize: fontSize.xs, marginTop: 2 },

    grid: { gap: 4, marginTop: 4 },
    row: { flexDirection: 'row', gap: 4 },
    weekday: {
      flex: 1,
      textAlign: 'center',
      color: colors.textFaint,
      fontSize: fontSize.xs,
      fontWeight: fontWeight.medium,
    },
    cell: {
      flex: 1,
      minHeight: 66,
      borderRadius: radius.sm,
      backgroundColor: colors.surfaceRaised,
      paddingVertical: 4,
      paddingHorizontal: 2,
      alignItems: 'center',
      gap: 3,
      borderWidth: 1,
      borderColor: 'transparent',
    },
    // Borrowed days stay visible so the grid reads as whole weeks, but faint and inert.
    cellOutside: { backgroundColor: 'transparent', opacity: 0.35 },
    // The past stays editable — correcting a plan is allowed — but should not compete with the
    // days still ahead for attention.
    cellPast: { opacity: 0.6 },
    cellToday: { borderColor: colors.accent },
    cellNumber: {
      color: colors.textSecondary,
      fontSize: fontSize.xs,
      fontVariant: ['tabular-nums'],
    },
    cellNumberToday: { color: colors.accent, fontWeight: fontWeight.bold },
    tag: { alignSelf: 'stretch', borderRadius: 4, paddingHorizontal: 2, paddingVertical: 1 },
    // The background's own colour as text on a hue: dark on the light hues of the dark theme,
    // light on the deeper hues of the light theme, readable both ways without a per-hue table.
    tagText: { color: colors.bg, fontSize: 9, fontWeight: fontWeight.bold, textAlign: 'center' },
    rest: { color: colors.textFaint, fontSize: 9, textAlign: 'center' },

    fillButton: {
      marginTop: spacing.sm,
      paddingVertical: spacing.md,
      borderRadius: radius.sm,
      backgroundColor: colors.accentSoft,
      borderWidth: 1,
      borderColor: colors.accentBorder,
      alignItems: 'center',
    },
    fillButtonText: { color: colors.accent, fontSize: fontSize.sm, fontWeight: fontWeight.bold },

    planName: {
      color: colors.text,
      fontSize: fontSize.lg,
      fontWeight: fontWeight.bold,
      marginTop: spacing.sm,
      textAlign: 'auto',
    },
    dayCard: {
      backgroundColor: colors.surface,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: colors.borderSubtle,
      padding: spacing.md,
    },
    dayCardNext: { borderColor: colors.accentBorder, backgroundColor: colors.accentSoft },
    dayHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
    dayDot: { width: 10, height: 10, borderRadius: radius.pill, marginTop: 5 },
    dayHeaderMain: { flex: 1 },
    dayName: {
      color: colors.text,
      fontSize: fontSize.md,
      fontWeight: fontWeight.bold,
      textAlign: 'auto',
    },
    dayMeta: { color: colors.textMuted, fontSize: fontSize.xs, marginTop: 2, textAlign: 'auto' },
    reorder: { flexDirection: 'row', gap: spacing.xs },
    moveBtn: {
      width: 30,
      height: 30,
      borderRadius: radius.sm,
      borderWidth: 1,
      borderColor: colors.border,
      alignItems: 'center',
      justifyContent: 'center',
    },
    moveBtnOff: { opacity: 0.3 },
    moveText: { color: colors.textMuted, fontSize: fontSize.sm },
    nextBadge: {
      paddingVertical: spacing.xxs,
      paddingHorizontal: spacing.sm,
      borderRadius: radius.pill,
      borderWidth: 1,
      borderColor: colors.accent,
    },
    nextBadgeText: { color: colors.accent, fontSize: fontSize.xxs, fontWeight: fontWeight.bold },
    startButton: {
      marginTop: spacing.md,
      paddingVertical: spacing.sm,
      borderRadius: radius.sm,
      backgroundColor: colors.accent,
      alignItems: 'center',
    },
    startButtonText: { color: colors.bg, fontSize: fontSize.sm, fontWeight: fontWeight.bold },
    emptyDayHint: {
      color: colors.textFaint,
      fontSize: fontSize.xs,
      marginTop: spacing.sm,
      textAlign: 'auto',
    },
    addDayButton: {
      paddingVertical: spacing.md,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.border,
      borderStyle: 'dashed',
      alignItems: 'center',
    },
    addDayText: { color: colors.accent, fontSize: fontSize.sm, fontWeight: fontWeight.bold },
    deleteButton: { marginTop: spacing.xl, padding: spacing.md, alignItems: 'center' },
    deleteButtonText: { color: colors.danger, fontSize: fontSize.sm },
    pressed: { opacity: 0.7 },
  });
