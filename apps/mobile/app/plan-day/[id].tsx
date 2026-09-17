/**
 * Editing one day of the weekly plan: its name, its exercises, and the target for each.
 *
 * Everything here is a *prescription*. The numbers typed on this screen never touch a `sets`
 * row — they are what the next session will aim at, and the session is free to diverge. That is
 * why the fields are set count and a rep RANGE rather than a weight: the range is the decision
 * you make in advance, the weight is the one you make at the rack.
 */

import { EXERCISE_SEED, type ExerciseSeed } from '@fit/shared/catalog';
import { router, useLocalSearchParams, useNavigation } from 'expo-router';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useActionSheet } from '../../src/components/ActionSheetProvider.js';
import { Hint, SkeletonScreen } from '../../src/components/ui.js';
import {
  addPlanDayExercise,
  getPlanDay,
  removePlanDay,
  removePlanDayExercise,
  reorderPlanDayExercise,
  renamePlanDay,
  setPlanDayTiming,
  timingOf,
  updatePlanDayExercise,
  type PlanDayTiming,
  type PlanDayWithExercises,
} from '../../src/db/plans.js';
import { getExecutor, newId } from '../../src/db/provider.js';
import { DragReorderList } from '../../src/components/DragReorderList.js';
import { NumberField } from '../../src/components/workout/NumberField.js';
import { KeyboardSafe } from '../../src/components/KeyboardSafe.js';
import { TimingCard } from '../../src/components/workout/TimingCard.js';
import { useTheme } from '../../src/ThemeProvider.js';
import { fontSize, fontWeight, radius, spacing, type ColorPalette } from '../../src/theme.js';

const EXERCISE_BY_KEY = new Map<string, ExerciseSeed>(
  EXERCISE_SEED.map((exercise) => [exercise.nameEn, exercise]),
);

export default function PlanDayScreen() {
  const { confirm } = useActionSheet();
  const { t, i18n } = useTranslation();
  const insets = useSafeAreaInsets();
  const { id, addExercise } = useLocalSearchParams<{ id: string; addExercise?: string }>();
  const isHebrew = i18n.language === 'he';
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const navigation = useNavigation();
  const [day, setDay] = useState<PlanDayWithExercises | null>(null);
  const [nameDraft, setNameDraft] = useState('');
  const [loading, setLoading] = useState(true);

  /*
   * The name field is filled from the database once, when the day is opened — never again.
   *
   * `load` runs after every change on this screen: a set count, a reorder, an exercise added,
   * the timer switch. It used to reset the field each time, so a name typed and then followed by
   * any other tap was quietly put back to the old one before it had been saved.
   */
  const nameLoadedFor = useRef<string | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    const db = await getExecutor();
    const detail = await getPlanDay(db, id);
    setDay(detail);
    if (nameLoadedFor.current !== id) {
      nameLoadedFor.current = id;
      setNameDraft(detail?.name ?? '');
    }
    setLoading(false);
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  // The picker returns its choice as a param; the ref stops a re-render from replaying it.
  const handledParam = useRef<string | null>(null);
  useEffect(() => {
    if (!addExercise || !id || handledParam.current === addExercise) return;
    handledParam.current = addExercise;
    void (async () => {
      const db = await getExecutor();
      await addPlanDayExercise(db, newId, id, addExercise);
      await load();
      router.setParams({ addExercise: '' });
    })();
  }, [addExercise, id, load]);

  /*
   * The name is saved as it is typed, a moment after the last keystroke, and flushed at once
   * when the field loses focus or the screen is left.
   *
   * It used to be saved only when the field reported the end of editing. On Android that event
   * does not reliably arrive when the screen is closed with the keyboard still up — tap back
   * straight after typing and the new name was simply never written.
   *
   * The flush on leaving runs from `beforeRemove`, before the plan screen underneath regains
   * focus and reloads, so the list it shows already has the new name rather than the old one.
   */
  const pendingName = useRef<string | null>(null);
  const nameTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flushName = useCallback(() => {
    if (nameTimer.current) {
      clearTimeout(nameTimer.current);
      nameTimer.current = null;
    }
    const name = pendingName.current;
    if (name === null || !id) return;
    pendingName.current = null;
    void (async () => {
      const db = await getExecutor();
      await renamePlanDay(db, id, name);
    })();
  }, [id]);

  const changeName = (text: string) => {
    setNameDraft(text);
    pendingName.current = text;
    if (nameTimer.current) clearTimeout(nameTimer.current);
    nameTimer.current = setTimeout(flushName, 400);
  };

  useEffect(() => navigation.addListener('beforeRemove', flushName), [navigation, flushName]);
  useEffect(() => () => flushName(), [flushName]);

  const patch = (
    prescriptionId: string,
    field: 'targetSets' | 'targetRepsMin' | 'targetRepsMax',
    next: number | null,
  ) => {
    void (async () => {
      const db = await getExecutor();
      await updatePlanDayExercise(db, prescriptionId, { [field]: next });
      await load();
    })();
  };

  /**
   * Move an exercise to a new place in the day, by dragging its handle or holding the row.
   *
   * These were arrows, on the reasoning that a drag inside a vertical ScrollView loses a gesture
   * race against the scroll. `DragReorderList` does not enter that race — the handle takes the
   * touch outright and a long press waits out the ambiguity — and the active workout has used it
   * for exactly this since. Moving the sixth exercise to the top took five taps; it is one drag.
   */
  const move = (fromIndex: number, toIndex: number) => {
    const prescription = day?.exercises[fromIndex];
    if (!day || !prescription) return;
    void (async () => {
      const db = await getExecutor();
      await reorderPlanDayExercise(db, day.id, prescription.id, toIndex);
      await load();
    })();
  };

  /*
   * While a row is in the air the list must not scroll under it, and dragging toward either edge
   * should scroll the list along.
   *
   * The edges are measured in the window, not taken as 0 and the viewport height: the fixed
   * masthead sits above this screen, and the finger's position arrives in screen coordinates.
   * Treating the top of the screen as the top of the list put the upper scroll band under the
   * masthead, where a finger dragging a row could barely reach it.
   */
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

  const changeTiming = (next: PlanDayTiming | null) => {
    if (!id) return;
    void (async () => {
      const db = await getExecutor();
      await setPlanDayTiming(db, id, next);
      await load();
    })();
  };

  const removeExercise = (prescriptionId: string) => {
    void (async () => {
      const db = await getExecutor();
      await removePlanDayExercise(db, prescriptionId);
      await load();
    })();
  };

  const deleteDay = () => {
    if (!id) return;
    void (async () => {
      const ok = await confirm({
        message: t('plan.confirmDeleteDay'),
        confirmLabel: t('plan.deleteDay'),
      });
      if (!ok) return;
      const db = await getExecutor();
      await removePlanDay(db, id);
      router.back();
    })();
  };

  if (loading) {
    return <SkeletonScreen paddingTop={spacing.xxl} />;
  }

  const timing = day ? timingOf(day) : null;

  if (!day) {
    return (
      <View style={[styles.centered, { paddingTop: spacing.xxl }]}>
        <Text style={styles.muted}>{t('common.error')}</Text>
      </View>
    );
  }

  return (
    <KeyboardSafe>
      <ScrollView
        ref={scrollRef}
        scrollEnabled={!dragging}
        scrollEventThrottle={16}
        onScroll={(event) => {
          scrollY.current = event.nativeEvent.contentOffset.y;
        }}
        onLayout={() => {
          scrollRef.current?.getNativeScrollRef()?.measureInWindow((_x, top, _width, height) => {
            viewport.current = { top, height };
          });
        }}
        style={styles.screen}
        contentContainerStyle={[
          styles.content,
          { paddingTop: spacing.md, paddingBottom: insets.bottom + spacing.xxl },
        ]}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} accessibilityRole="button" hitSlop={8}>
            <Text style={styles.back}>{isHebrew ? '›' : '‹'}</Text>
          </Pressable>
          <Text style={styles.dayIndex}>
            {t('plan.day')} {day.day_index}
          </Text>
        </View>

        <TextInput
          value={nameDraft}
          onChangeText={changeName}
          onEndEditing={flushName}
          placeholder={t('plan.dayNamePlaceholder')}
          placeholderTextColor={colors.textMuted}
          style={styles.nameInput}
          returnKeyType="done"
        />

        <Hint>{t('plan.dayHint')}</Hint>

        <TimingCard timing={timing} exerciseCount={day.exercises.length} onChange={changeTiming} />

        {day.exercises.length === 0 ? (
          <Text style={styles.emptyText}>{t('plan.dayEmptyHint')}</Text>
        ) : (
          <>
            <View style={styles.columnHeader}>
              <Text style={[styles.columnLabel, styles.colName]}>{t('plan.exercise')}</Text>
              {timing ? null : (
                <>
                  <Text style={[styles.columnLabel, styles.colField]}>{t('plan.sets')}</Text>
                  <Text style={[styles.columnLabel, styles.colField]}>{t('plan.repsFrom')}</Text>
                  <Text style={[styles.columnLabel, styles.colField]}>{t('plan.repsTo')}</Text>
                </>
              )}
              <View style={styles.colActions} />
            </View>

            <DragReorderList
              data={day.exercises}
              keyExtractor={(prescription) => prescription.id}
              onReorder={move}
              onDragStateChange={setDragging}
              onDragMove={autoScroll}
              renderItem={(prescription, _position, dragHandle) => {
                const seed = EXERCISE_BY_KEY.get(prescription.exercise_key);
                const label = seed
                  ? isHebrew
                    ? seed.nameHe
                    : seed.nameEn
                  : prescription.exercise_key;

                return (
                  <View style={[styles.row, dragHandle.active && styles.rowDragging]}>
                    <Text style={[styles.exerciseName, styles.colName]} numberOfLines={2}>
                      {label}
                    </Text>

                    {timing ? null : (
                      <>
                        <NumberField
                          value={prescription.target_sets}
                          onCommit={(next) => patch(prescription.id, 'targetSets', next)}
                          placeholderTextColor={colors.textFaint}
                          style={[styles.input, styles.colField]}
                        />
                        <NumberField
                          value={prescription.target_reps_min}
                          onCommit={(next) => patch(prescription.id, 'targetRepsMin', next)}
                          placeholderTextColor={colors.textFaint}
                          style={[styles.input, styles.colField]}
                        />
                        <NumberField
                          value={prescription.target_reps_max}
                          onCommit={(next) => patch(prescription.id, 'targetRepsMax', next)}
                          placeholderTextColor={colors.textFaint}
                          style={[styles.input, styles.colField]}
                        />
                      </>
                    )}

                    {/* The handle. Arrows stay available to a screen reader through the actions below,
                      since a drag cannot be performed without sight. */}
                    <View
                      {...dragHandle.handlers}
                      style={styles.reorder}
                      accessibilityRole="adjustable"
                      accessibilityLabel={t('workout.dragExercise')}
                      accessibilityActions={[
                        ...(dragHandle.canMoveUp
                          ? [{ name: 'moveUp', label: t('plan.moveExerciseUp') }]
                          : []),
                        ...(dragHandle.canMoveDown
                          ? [{ name: 'moveDown', label: t('plan.moveExerciseDown') }]
                          : []),
                      ]}
                      onAccessibilityAction={(event) => {
                        if (event.nativeEvent.actionName === 'moveUp') dragHandle.moveUp();
                        if (event.nativeEvent.actionName === 'moveDown') dragHandle.moveDown();
                      }}
                    >
                      <Text style={[styles.moveText, dragHandle.active && styles.handleActive]}>
                        ⠿
                      </Text>
                    </View>

                    <Pressable
                      onPress={() => removeExercise(prescription.id)}
                      style={styles.colActions}
                      accessibilityRole="button"
                      accessibilityLabel={t('workout.removeExercise')}
                      hitSlop={8}
                    >
                      <Text style={styles.deleteText}>✕</Text>
                    </Pressable>
                  </View>
                );
              }}
            />
          </>
        )}

        <Pressable
          onPress={() =>
            router.push({
              pathname: '/exercise-picker',
              params: { returnTo: `/plan-day/${id}`, planDayId: id },
            })
          }
          style={styles.addButton}
          accessibilityRole="button"
        >
          <Text style={styles.addButtonText}>+ {t('workout.addExercise')}</Text>
        </Pressable>

        <Pressable onPress={deleteDay} style={styles.deleteDayButton} accessibilityRole="button">
          <Text style={styles.deleteDayText}>{t('plan.deleteDay')}</Text>
        </Pressable>
      </ScrollView>
    </KeyboardSafe>
  );
}

const createStyles = (colors: ColorPalette) =>
  StyleSheet.create<{
    screen: ViewStyle;
    content: ViewStyle;
    centered: ViewStyle;
    muted: TextStyle;
    header: ViewStyle;
    back: TextStyle;
    dayIndex: TextStyle;
    nameInput: TextStyle;
    emptyText: TextStyle;
    columnHeader: ViewStyle;
    columnLabel: TextStyle;
    colName: TextStyle;
    colField: TextStyle;
    colActions: ViewStyle;
    row: ViewStyle;
    exerciseName: TextStyle;
    input: TextStyle;
    reorder: ViewStyle;
    rowDragging: ViewStyle;
    moveText: TextStyle;
    handleActive: TextStyle;
    deleteText: TextStyle;
    addButton: ViewStyle;
    addButtonText: TextStyle;
    deleteDayButton: ViewStyle;
    deleteDayText: TextStyle;
  }>({
    screen: { flex: 1, backgroundColor: colors.bg },
    content: { paddingHorizontal: spacing.lg },
    centered: { flex: 1, backgroundColor: colors.bg, alignItems: 'center' },
    muted: { color: colors.textMuted, fontSize: fontSize.sm },
    header: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
    back: { color: colors.accent, fontSize: fontSize.xl, fontWeight: fontWeight.bold },
    dayIndex: { color: colors.textMuted, fontSize: fontSize.sm },
    nameInput: {
      color: colors.text,
      fontSize: fontSize.lg,
      fontWeight: fontWeight.bold,
      backgroundColor: colors.surfaceRaised,
      borderRadius: radius.sm,
      borderWidth: 1,
      borderColor: colors.border,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      marginTop: spacing.md,
      marginBottom: spacing.sm,
      textAlign: 'auto',
    },
    emptyText: {
      color: colors.textFaint,
      fontSize: fontSize.sm,
      marginVertical: spacing.lg,
      textAlign: 'auto',
    },
    columnHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.xs,
      marginTop: spacing.md,
      marginBottom: spacing.xs,
    },
    columnLabel: { color: colors.textMuted, fontSize: fontSize.xxs, textAlign: 'center' },
    colName: { flex: 3, textAlign: 'auto' },
    colField: { flex: 1 },
    colActions: { width: 28, alignItems: 'center' },
    row: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginBottom: spacing.xs },
    exerciseName: { color: colors.text, fontSize: fontSize.sm },
    input: {
      height: 40,
      backgroundColor: colors.surfaceRaised,
      borderRadius: radius.sm,
      borderWidth: 1,
      borderColor: colors.border,
      color: colors.text,
      fontSize: fontSize.sm,
      textAlign: 'center',
    },
    reorder: { flexDirection: 'row', gap: 6, alignItems: 'center' },
    // Big enough to take a thumb: this is what starts a drag, not a decoration beside one.
    moveText: { color: colors.textSecondary, fontSize: fontSize.xl, lineHeight: 26 },
    handleActive: { color: colors.accent },
    rowDragging: {
      backgroundColor: colors.surfaceRaised,
      borderRadius: radius.sm,
      borderWidth: 1,
      borderColor: colors.accentBorder,
    },
    deleteText: { color: colors.textMuted, fontSize: fontSize.sm },
    addButton: {
      marginTop: spacing.md,
      paddingVertical: spacing.md,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.border,
      borderStyle: 'dashed',
      alignItems: 'center',
    },
    addButtonText: { color: colors.accent, fontSize: fontSize.sm, fontWeight: fontWeight.bold },
    deleteDayButton: { marginTop: spacing.xl, padding: spacing.md, alignItems: 'center' },
    deleteDayText: { color: colors.danger, fontSize: fontSize.sm },
  });
