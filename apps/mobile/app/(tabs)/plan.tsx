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

import { EXERCISE_SEED } from '@fit/shared/catalog';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useRef, useState } from 'react';
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
import { DragReorderList, type DragHandleProps } from '../../src/components/DragReorderList.js';
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
  copyPlanDayToPlan,
  createPlan,
  deletePlan,
  getActivePlan,
  getNextPlanDay,
  listPlanDayStatus,
  listPlans,
  movePlanDayToPlan,
  removePlanDay,
  renamePlan,
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
import { syncWorkoutReminders } from '../../src/reminders/sync.js';
import { hapticLight } from '../../src/haptics.js';
import { isRtlLanguage, type Language } from '../../src/i18n/index.js';
import { useTheme } from '../../src/ThemeProvider.js';
import { fontSize, fontWeight, radius, spacing, type ColorPalette } from '../../src/theme.js';

type DayStatus = {
  id: string;
  day_index: number;
  name: string | null;
  exercise_count: number;
  exercise_keys: string | null;
  work_seconds: number | null;
  rest_seconds: number | null;
  last_trained_at: string | null;
  session_count: number;
};

/** Exercise names by catalogue key, for the line that says what a day actually contains. */
const EXERCISE_BY_KEY = new Map(EXERCISE_SEED.map((exercise) => [exercise.nameEn, exercise]));

/** The unit separator the plan-day query joins its exercise keys with. */
const KEY_SEPARATOR = '\u001f';

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

  // Every plan the user has, each shown as a group under its own title. The calendar schedules
  // workouts from all of them, so `days` is every group's workouts in screen order.
  const [groups, setGroups] = useState<{ plan: PlanRow; days: DayStatus[] }[]>([]);
  const days = useMemo(() => groups.flatMap((group) => group.days), [groups]);
  const [nextDayId, setNextDayId] = useState<string | null>(null);
  const [nameDraft, setNameDraft] = useState('');
  const [creating, setCreating] = useState(false);
  const [renaming, setRenaming] = useState<{ id: string; draft: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const today = localDate(new Date());
  const [month, setMonth] = useState(() => monthKey(today));
  const [decisions, setDecisions] = useState<Map<string, string[] | null>>(new Map());

  const grid = useMemo(() => monthGrid(month), [month]);
  const rtl = isRtlLanguage(i18n.language as Language);
  const isHebrew = i18n.language === 'he';

  const reload = useCallback(
    async (forMonth: string) => {
      const db = await getExecutor();
      // Oldest first, so a group keeps its place as others are added below it.
      const plans = (await listPlans(db, userId)).sort(
        (a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id),
      );
      const loaded = [];
      for (const each of plans) {
        loaded.push({ plan: each, days: await listPlanDayStatus(db, userId, each.id) });
      }
      setGroups(loaded);

      // "Next up" belongs to the rotation, which only the active plan drives.
      const active = await getActivePlan(db, userId);
      setNextDayId(active ? ((await getNextPlanDay(db, userId, active.id))?.id ?? null) : null);

      // The whole grid, borrowed days included, so a decision on the 31st of last month still
      // shows in the first row rather than as a blank that contradicts the week editor.
      const rows = monthGrid(forMonth);
      const lastRow = rows[rows.length - 1];
      const first = rows[0]?.[0]?.date ?? `${forMonth}-01`;
      const last = lastRow?.[lastRow.length - 1]?.date ?? `${forMonth}-28`;
      setDecisions(await getRange(db, userId, first, last));
      setLoading(false);

      // The calendar is what the workout-day reminders are made of, so they follow every change
      // to it. Not awaited: a reminder being re-laid must never hold the calendar up.
      void syncWorkoutReminders(db, userId, {
        title: t('settings.workoutReminderNotification'),
        channel: t('settings.workoutReminderTitle'),
      });
    },
    [userId, t],
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

  /**
   * A workout's name in the calendar sheet. With more than one group, the group's title goes
   * with it — two groups can each have a "יום 1", and the sheet lists them side by side.
   */
  const choiceLabel = useCallback(
    (day: DayStatus) => {
      if (groups.length < 2) return labelFor(day);
      const group = groups.find((g) => g.days.some((d) => d.id === day.id));
      return group ? `${labelFor(day)} · ${group.plan.name}` : labelFor(day);
    },
    [groups, labelFor],
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
          for (const day of days)
            steps.push({ label: choiceLabel(day), step: { kind: 'set', id: day.id } });
        } else {
          for (const day of onDayTypes) {
            steps.push({
              label: t('month.removeWorkout', { name: choiceLabel(day) }),
              step: { kind: 'remove', id: day.id },
            });
          }
          for (const day of days.filter((d) => !onDay.includes(d.id))) {
            steps.push({
              label: t('month.addWorkout', { name: choiceLabel(day) }),
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
          searchPlaceholder: t('month.searchPlaceholder'),
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
        else if (picked.kind === 'add')
          await addScheduledWorkout(db, userId, newId, date, picked.id);
        else if (picked.kind === 'remove')
          await removeScheduledWorkout(db, userId, newId, date, picked.id);
        else if (picked.kind === 'rest') await setScheduledDay(db, userId, newId, date, null);
        else await clearScheduledDay(db, userId, date);

        void hapticLight();
        await reload(month);
      })();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- longDate only reads i18n.language
    [decisions, days, ask, t, i18n.language, userId, reload, month, labelFor, choiceLabel],
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
   * Reorder by dragging, as the exercises inside a day are reordered.
   *
   * These were two arrows per card, on the reasoning that a drag inside a vertical ScrollView
   * loses a gesture race against the scroll. `DragReorderList` does not enter that race — the
   * handle takes the touch outright, and a long press waits the ambiguity out — and a card with
   * fewer controls on it is the point of this screen.
   */
  const move = useCallback(
    (planId: string, planDays: DayStatus[], fromIndex: number, toIndex: number) => {
      const day = planDays[fromIndex];
      if (!day) return;
      void (async () => {
        const db = await getExecutor();
        await reorderPlanDay(db, planId, day.id, toIndex);
        await reload(month);
      })();
    },
    [reload, month],
  );

  /* While a card is in the air the page must not scroll under it, and dragging toward an edge
     should carry the list along. Measured in the window, since the masthead sits above this
     screen and the finger arrives in screen coordinates. */
  const [dragging, setDragging] = useState(false);
  const scrollRef = useRef<ScrollView | null>(null);
  const scrollY = useRef(0);
  const viewport = useRef({ top: 0, height: 0 });

  const autoScroll = useCallback((screenY: number) => {
    const { top, height } = viewport.current;
    if (height <= 0) return;
    const EDGE = 110;
    const MAX_STEP = 11;
    const fromTop = screenY - top - EDGE;
    const fromBottom = screenY - (top + height - EDGE);
    let step = 0;
    if (fromTop < 0) step = Math.max(-MAX_STEP, (fromTop / EDGE) * MAX_STEP);
    else if (fromBottom > 0) step = Math.min(MAX_STEP, (fromBottom / EDGE) * MAX_STEP);
    if (step === 0) return;
    scrollY.current = Math.max(0, scrollY.current + step);
    scrollRef.current?.scrollTo({ y: scrollY.current, animated: false });
  }, []);

  const create = () => {
    const name = nameDraft.trim();
    if (!name) return;
    void (async () => {
      const db = await getExecutor();
      await createPlan(db, userId, newId, name);
      setNameDraft('');
      setCreating(false);
      await reload(month);
    })();
  };

  const saveRename = () => {
    const current = renaming;
    const name = current?.draft.trim();
    setRenaming(null);
    if (!current || !name) return;
    void (async () => {
      const db = await getExecutor();
      await renamePlan(db, userId, current.id, name);
      await reload(month);
    })();
  };

  const addDay = (planId: string) => {
    void (async () => {
      const db = await getExecutor();
      const dayId = await addPlanDay(db, newId, planId, null);
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

  /**
   * Bring a workout from another group into this one: moved (the same workout, with its calendar
   * days and history) or copied (a separate one to change freely).
   */
  const addExisting = (target: PlanRow) => {
    void (async () => {
      const others = groups
        .filter((group) => group.plan.id !== target.id)
        .flatMap((group) => group.days.map((day) => ({ day, group: group.plan })));
      if (others.length === 0) return;

      const picked = await ask({
        title: t('plan.addExistingTo', { name: target.name }),
        searchPlaceholder: t('month.searchPlaceholder'),
        actions: others.map(({ day, group }) => ({ label: `${labelFor(day)} · ${group.name}` })),
      });
      const choice = picked === null ? undefined : others[picked];
      if (!choice) return;

      const how = await ask({
        title: labelFor(choice.day),
        actions: [
          { label: t('plan.copyHere', { name: target.name }) },
          { label: t('plan.moveHere', { name: target.name }) },
        ],
      });
      if (how !== 0 && how !== 1) return;

      const db = await getExecutor();
      if (how === 0) await copyPlanDayToPlan(db, newId, choice.day.id, target.id);
      else await movePlanDayToPlan(db, choice.day.id, target.id);
      void hapticLight();
      await reload(month);
    })();
  };

  /** Rename or delete a whole group. */
  const openGroupOptions = (group: PlanRow) => {
    void (async () => {
      const choice = await ask({
        title: group.name,
        actions: [
          { label: t('plan.renameGroup') },
          { label: t('plan.deletePlan'), destructive: true },
        ],
      });
      if (choice === 0) {
        setRenaming({ id: group.id, draft: group.name });
        return;
      }
      if (choice !== 1) return;
      const ok = await confirm({
        message: t('plan.confirmDeletePlan'),
        confirmLabel: t('plan.deletePlan'),
      });
      if (!ok) return;
      const db = await getExecutor();
      await deletePlan(db, userId, group.id);
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
  const hueById = new Map(
    days.map((day, index) => [day.id, HUES[index % HUES.length] ?? 'accent']),
  );
  const labelById = new Map(days.map((day) => [day.id, labelFor(day)]));

  /** One workout's card, the same in every group. */
  const renderDay = (
    day: DayStatus,
    index: number,
    dragHandle: DragHandleProps,
  ) => {
    const isNext = day.id === nextDayId;
    const hue = colors[hueById.get(day.id) ?? 'accent'];
    const names = (day.exercise_keys ?? '')
      .split(KEY_SEPARATOR)
      .filter(Boolean)
      .map(
        (key) =>
          (isHebrew
            ? EXERCISE_BY_KEY.get(key)?.nameHe
            : EXERCISE_BY_KEY.get(key)?.nameEn) ?? key,
      );
    const shown = names.slice(0, 3);
    const hidden = names.length - shown.length;

    return (
      <FadeSlideIn index={index}>
        <Pressable
          onPress={() =>
            router.push({ pathname: '/plan-day/[id]', params: { id: day.id } })
          }
          // The colour this workout wears on the calendar, as the card's own edge: the
          // grid above needs no separate key, and the list reads as the same thing.
          style={[
            styles.dayCard,
            { borderStartColor: hue },
            isNext && styles.dayCardNext,
            dragHandle.active && styles.dayCardDragging,
          ]}
          accessibilityRole="button"
        >
          <View style={styles.dayHeader}>
            <Text style={styles.dayName} numberOfLines={1}>
              {labelFor(day)}
            </Text>
            {isNext ? (
              <View style={styles.nextBadge}>
                <Text style={styles.nextBadgeText}>{t('plan.next')}</Text>
              </View>
            ) : null}
            <View
              {...dragHandle.handlers}
              style={styles.handle}
              accessibilityRole="adjustable"
              accessibilityLabel={t('plan.dragDay')}
              accessibilityActions={[
                ...(dragHandle.canMoveUp
                  ? [{ name: 'moveUp', label: t('plan.moveUp') }]
                  : []),
                ...(dragHandle.canMoveDown
                  ? [{ name: 'moveDown', label: t('plan.moveDown') }]
                  : []),
              ]}
              onAccessibilityAction={(event) => {
                if (event.nativeEvent.actionName === 'moveUp') dragHandle.moveUp();
                if (event.nativeEvent.actionName === 'moveDown') dragHandle.moveDown();
              }}
            >
              <Text
                style={[styles.handleGlyph, dragHandle.active && styles.handleActive]}
              >
                ⠿
              </Text>
            </View>
          </View>

          {/* What the day is made of, in the order it is trained. Three names and a
            count: a plan is recognised by its first exercises, not by a number. */}
          {shown.length > 0 ? (
            <Text style={styles.preview} numberOfLines={1}>
              {shown.join(' · ')}
              {hidden > 0 ? ` · +${hidden}` : ''}
            </Text>
          ) : (
            <Text style={styles.emptyDayHint}>{t('plan.dayEmptyHint')}</Text>
          )}

          <View style={styles.chips}>
            <View style={styles.chip}>
              <Text style={styles.chipText}>
                {t('plan.exercises', { count: day.exercise_count })}
              </Text>
            </View>
            {day.work_seconds ? (
              <View style={[styles.chip, styles.chipAccent]}>
                <Text style={[styles.chipText, styles.chipTextAccent]}>
                  ⏱ {day.work_seconds}/{day.rest_seconds ?? 0}
                </Text>
              </View>
            ) : null}
            <View style={styles.chip}>
              <Text style={styles.chipText}>
                {day.last_trained_at
                  ? `${t('plan.trained')} ${daysSince(day.last_trained_at, nowMs)} ${t('plan.daysAgo')}`
                  : t('plan.neverTrained')}
              </Text>
            </View>
          </View>

          {day.exercise_count > 0 ? (
            <View style={styles.dayActions}>
              <Pressable
                onPress={() => start(day.id)}
                style={({ pressed }) => [styles.startButton, pressed && styles.pressed]}
                accessibilityRole="button"
              >
                <Text style={styles.startButtonText}>▶ {t('plan.startDay')}</Text>
              </Pressable>
              <Pressable
                onPress={() => openDayOptions(day)}
                style={({ pressed }) => [
                  styles.optionsButton,
                  pressed && styles.pressed,
                ]}
                accessibilityRole="button"
                accessibilityLabel={t('workout.exerciseOptions')}
              >
                <Text style={styles.optionsGlyph}>⋯</Text>
              </Pressable>
            </View>
          ) : (
            <Pressable
              onPress={() => openDayOptions(day)}
              style={({ pressed }) => [styles.optionsWide, pressed && styles.pressed]}
              accessibilityRole="button"
              accessibilityLabel={t('workout.exerciseOptions')}
            >
              <Text style={styles.optionsGlyph}>⋯</Text>
            </Pressable>
          )}
        </Pressable>
      </FadeSlideIn>
    );
  };

  const monthTitle = new Date(`${month}-01T00:00:00`).toLocaleDateString(i18n.language, {
    month: 'long',
    year: 'numeric',
  });
  const weekdayNames = weekDates(weekStart(today)).map((date) =>
    new Date(`${date}T00:00:00`).toLocaleDateString(i18n.language, { weekday: 'narrow' }),
  );

  return (
    <ScrollView
      ref={scrollRef}
      scrollEnabled={!dragging}
      scrollEventThrottle={16}
      onScroll={(event) => {
        scrollY.current = event.nativeEvent.contentOffset.y;
      }}
      onLayout={() => {
        scrollRef.current
          ?.getNativeScrollRef()
          ?.measureInWindow((_x: number, top: number, _width: number, height: number) => {
            viewport.current = { top, height };
          });
      }}
      style={styles.screen}
      contentContainerStyle={[
        styles.content,
        { paddingTop: spacing.lg, paddingBottom: insets.bottom + spacing.xxl },
      ]}
      keyboardShouldPersistTaps="handled"
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={handleRefresh}
          tintColor={colors.accent}
        />
      }
    >
      <ScreenHeader title={t('plan.title')} />

      {groups.length === 0 ? (
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

          {groups.map((group) => (
            <View key={group.plan.id} style={styles.group}>
              {renaming?.id === group.plan.id ? (
                <View style={styles.groupHeader}>
                  <TextInput
                    value={renaming.draft}
                    onChangeText={(draft) => setRenaming({ id: group.plan.id, draft })}
                    onSubmitEditing={saveRename}
                    onBlur={saveRename}
                    autoFocus
                    selectTextOnFocus
                    returnKeyType="done"
                    placeholder={t('plan.namePlaceholder')}
                    placeholderTextColor={colors.textMuted}
                    style={[styles.input, styles.groupInput]}
                  />
                </View>
              ) : (
                <View style={styles.groupHeader}>
                  <Text style={styles.planName} numberOfLines={1}>
                    {group.plan.name}
                  </Text>
                  <Text style={styles.groupCount}>
                    {t('plan.workoutCount', { count: group.days.length })}
                  </Text>
                  <Pressable
                    onPress={() => openGroupOptions(group.plan)}
                    hitSlop={8}
                    style={({ pressed }) => [styles.groupOptions, pressed && styles.pressed]}
                    accessibilityRole="button"
                    accessibilityLabel={t('plan.groupOptions')}
                  >
                    <Text style={styles.optionsGlyph}>⋯</Text>
                  </Pressable>
                </View>
              )}

              {group.days.length === 0 ? (
                <Text style={styles.emptyDayHint}>{t('plan.noDaysHint')}</Text>
              ) : (
                <DragReorderList
                  data={group.days}
                  keyExtractor={(day) => day.id}
                  onReorder={(from, to) => move(group.plan.id, group.days, from, to)}
                  onDragStateChange={setDragging}
                  onDragMove={autoScroll}
                  renderItem={renderDay}
                />
              )}

              <View style={styles.groupActions}>
                <Pressable
                  onPress={() => addDay(group.plan.id)}
                  style={[styles.addDayButton, styles.groupAction]}
                  accessibilityRole="button"
                >
                  <Text style={styles.addDayText}>+ {t('plan.addDay')}</Text>
                </Pressable>
                {days.length > group.days.length ? (
                  <Pressable
                    onPress={() => addExisting(group.plan)}
                    style={[styles.addDayButton, styles.groupAction]}
                    accessibilityRole="button"
                  >
                    <Text style={styles.addDayText}>⇄ {t('plan.addExisting')}</Text>
                  </Pressable>
                ) : null}
              </View>
            </View>
          ))}

          {/* As many groups as wanted, each under a title of the user's own. */}
          {creating ? (
            <Card>
              <SectionTitle>{t('plan.newGroup')}</SectionTitle>
              <TextInput
                value={nameDraft}
                onChangeText={setNameDraft}
                placeholder={t('plan.namePlaceholder')}
                placeholderTextColor={colors.textMuted}
                style={styles.input}
                autoFocus
                returnKeyType="done"
                onSubmitEditing={create}
              />
              <View style={styles.spacer} />
              <Button label={t('plan.create')} onPress={create} />
              <Pressable
                onPress={() => {
                  setCreating(false);
                  setNameDraft('');
                }}
                style={styles.cancelCreate}
                accessibilityRole="button"
              >
                <Text style={styles.cancelCreateText}>{t('common.cancel')}</Text>
              </Pressable>
            </Card>
          ) : (
            <Pressable
              onPress={() => setCreating(true)}
              style={[styles.addDayButton, styles.newGroupButton]}
              accessibilityRole="button"
            >
              <Text style={styles.addDayText}>＋ {t('plan.newGroup')}</Text>
            </Pressable>
          )}

          <Banner tone="info">{t('plan.prescriptionNote')}</Banner>

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
    dayCardDragging: ViewStyle;
    handle: ViewStyle;
    handleGlyph: TextStyle;
    handleActive: TextStyle;
    preview: TextStyle;
    chips: ViewStyle;
    chip: ViewStyle;
    chipAccent: ViewStyle;
    chipText: TextStyle;
    chipTextAccent: TextStyle;
    dayActions: ViewStyle;
    optionsButton: ViewStyle;
    optionsWide: ViewStyle;
    optionsGlyph: TextStyle;
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
    group: ViewStyle;
    groupHeader: ViewStyle;
    groupInput: TextStyle;
    groupCount: TextStyle;
    groupOptions: ViewStyle;
    newGroupButton: ViewStyle;
    groupActions: ViewStyle;
    groupAction: ViewStyle;
    cancelCreate: ViewStyle;
    cancelCreateText: TextStyle;
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
      flexShrink: 1,
      textAlign: 'auto',
    },
    dayCard: {
      backgroundColor: colors.surface,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: colors.borderSubtle,
      // The workout's colour as the card's leading edge — the same colour it wears on the
      // calendar above, so the list is the grid's key rather than a second thing to learn.
      borderStartWidth: 4,
      padding: spacing.md,
      gap: spacing.sm,
      marginBottom: spacing.sm,
    },
    dayCardNext: { backgroundColor: colors.accentSoft },
    dayCardDragging: { borderColor: colors.accentBorder },
    handle: { width: 32, alignItems: 'center', justifyContent: 'center' },
    handleGlyph: { color: colors.textFaint, fontSize: fontSize.lg, lineHeight: 24 },
    handleActive: { color: colors.accent },
    preview: { color: colors.textSecondary, fontSize: fontSize.sm, textAlign: 'auto' },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
    chip: {
      paddingVertical: 3,
      paddingHorizontal: spacing.sm,
      borderRadius: radius.pill,
      backgroundColor: colors.surfaceRaised,
      borderWidth: 1,
      borderColor: colors.borderSubtle,
    },
    chipAccent: { backgroundColor: colors.accentSoft, borderColor: colors.accentBorder },
    chipText: { color: colors.textMuted, fontSize: fontSize.xxs },
    chipTextAccent: { color: colors.accent, fontVariant: ['tabular-nums'] },
    dayActions: { flexDirection: 'row', gap: spacing.sm, alignItems: 'stretch' },
    optionsButton: {
      width: 48,
      borderRadius: radius.sm,
      borderWidth: 1,
      borderColor: colors.border,
      alignItems: 'center',
      justifyContent: 'center',
    },
    optionsWide: {
      paddingVertical: spacing.sm,
      borderRadius: radius.sm,
      borderWidth: 1,
      borderColor: colors.border,
      alignItems: 'center',
    },
    optionsGlyph: { color: colors.textMuted, fontSize: fontSize.md },
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
      flex: 1,
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
    group: { gap: spacing.md, marginTop: spacing.sm },
    groupHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
    groupInput: { flex: 1 },
    groupCount: { color: colors.textMuted, fontSize: fontSize.sm, flexShrink: 0 },
    groupOptions: {
      marginStart: 'auto',
      width: 40,
      height: 36,
      borderRadius: radius.sm,
      borderWidth: 1,
      borderColor: colors.border,
      alignItems: 'center',
      justifyContent: 'center',
    },
    newGroupButton: { marginTop: spacing.md, borderColor: colors.accent },
    groupActions: { flexDirection: 'row', gap: spacing.sm },
    groupAction: { flex: 1 },
    cancelCreate: { marginTop: spacing.sm, padding: spacing.sm, alignItems: 'center' },
    cancelCreateText: { color: colors.textMuted, fontSize: fontSize.sm },
    pressed: { opacity: 0.7 },
  });
