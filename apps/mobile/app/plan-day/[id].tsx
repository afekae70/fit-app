/**
 * Editing one day of the weekly plan: its name, its exercises, and the target for each.
 *
 * Everything here is a *prescription*. The numbers typed on this screen never touch a `sets`
 * row — they are what the next session will aim at, and the session is free to diverge. That is
 * why the fields are set count and a rep RANGE rather than a weight: the range is the decision
 * you make in advance, the weight is the one you make at the rack.
 */

import { EXERCISE_SEED, type ExerciseSeed } from '@fit/shared/catalog';
import { router, useLocalSearchParams } from 'expo-router';

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
import { KeyboardSafe } from '../../src/components/KeyboardSafe.js';
import { TimingCard } from '../../src/components/workout/TimingCard.js';
import { useTheme } from '../../src/ThemeProvider.js';
import { fontSize, fontWeight, radius, spacing, type ColorPalette } from '../../src/theme.js';

const EXERCISE_BY_KEY = new Map<string, ExerciseSeed>(
  EXERCISE_SEED.map((exercise) => [exercise.nameEn, exercise]),
);

/** Empty means "no target", which is a real state — not zero. */
function parseTarget(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === '') return null;
  const value = Number(trimmed);
  return Number.isInteger(value) && value > 0 ? value : null;
}

export default function PlanDayScreen() {
  const { confirm } = useActionSheet();
  const { t, i18n } = useTranslation();
  const insets = useSafeAreaInsets();
  const { id, addExercise } = useLocalSearchParams<{ id: string; addExercise?: string }>();
  const isHebrew = i18n.language === 'he';
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const [day, setDay] = useState<PlanDayWithExercises | null>(null);
  const [nameDraft, setNameDraft] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!id) return;
    const db = await getExecutor();
    const detail = await getPlanDay(db, id);
    setDay(detail);
    setNameDraft(detail?.name ?? '');
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

  const saveName = async () => {
    if (!id) return;
    const db = await getExecutor();
    await renamePlanDay(db, id, nameDraft);
    await load();
  };

  const patch = (
    prescriptionId: string,
    field: 'targetSets' | 'targetRepsMin' | 'targetRepsMax',
    raw: string,
  ) => {
    void (async () => {
      const db = await getExecutor();
      await updatePlanDayExercise(db, prescriptionId, { [field]: parseTarget(raw) });
      await load();
    })();
  };

  /**
   * Nudge an exercise up or down the day.
   *
   * Arrows rather than drag, matching how the plan's days are reordered and for the reason
   * written there: a drag inside a vertical ScrollView has to win a gesture race against the
   * scroll, and the loser is always the user.
   */
  const move = (prescriptionId: string, delta: number) => {
    if (!day) return;
    const from = day.exercises.findIndex((e) => e.id === prescriptionId);
    if (from < 0) return;
    void (async () => {
      const db = await getExecutor();
      await reorderPlanDayExercise(db, day.id, prescriptionId, from + delta);
      await load();
    })();
  };

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
          onChangeText={setNameDraft}
          onEndEditing={() => void saveName()}
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

            {day.exercises.map((prescription, position) => {
              const seed = EXERCISE_BY_KEY.get(prescription.exercise_key);
              const label = seed
                ? isHebrew
                  ? seed.nameHe
                  : seed.nameEn
                : prescription.exercise_key;

              return (
                <View key={prescription.id} style={styles.row}>
                  <Text style={[styles.exerciseName, styles.colName]} numberOfLines={2}>
                    {label}
                  </Text>

                  {timing ? null : (
                    <>
                      <TextInput
                        defaultValue={
                          prescription.target_sets === null ? '' : String(prescription.target_sets)
                        }
                        onEndEditing={(e) =>
                          patch(prescription.id, 'targetSets', e.nativeEvent.text)
                        }
                        keyboardType="number-pad"
                        inputMode="numeric"
                        style={[styles.input, styles.colField]}
                        selectTextOnFocus
                        placeholder="—"
                        placeholderTextColor={colors.textFaint}
                      />
                      <TextInput
                        defaultValue={
                          prescription.target_reps_min === null
                            ? ''
                            : String(prescription.target_reps_min)
                        }
                        onEndEditing={(e) =>
                          patch(prescription.id, 'targetRepsMin', e.nativeEvent.text)
                        }
                        keyboardType="number-pad"
                        inputMode="numeric"
                        style={[styles.input, styles.colField]}
                        selectTextOnFocus
                        placeholder="—"
                        placeholderTextColor={colors.textFaint}
                      />
                      <TextInput
                        defaultValue={
                          prescription.target_reps_max === null
                            ? ''
                            : String(prescription.target_reps_max)
                        }
                        onEndEditing={(e) =>
                          patch(prescription.id, 'targetRepsMax', e.nativeEvent.text)
                        }
                        keyboardType="number-pad"
                        inputMode="numeric"
                        style={[styles.input, styles.colField]}
                        selectTextOnFocus
                        placeholder="—"
                        placeholderTextColor={colors.textFaint}
                      />
                    </>
                  )}

                  <View style={styles.reorder}>
                    <Pressable
                      onPress={() => move(prescription.id, -1)}
                      disabled={position === 0}
                      accessibilityRole="button"
                      accessibilityLabel={t('plan.moveExerciseUp')}
                      hitSlop={6}
                    >
                      <Text style={[styles.moveText, position === 0 && styles.moveTextOff]}>↑</Text>
                    </Pressable>
                    <Pressable
                      onPress={() => move(prescription.id, 1)}
                      disabled={position === day.exercises.length - 1}
                      accessibilityRole="button"
                      accessibilityLabel={t('plan.moveExerciseDown')}
                      hitSlop={6}
                    >
                      <Text
                        style={[
                          styles.moveText,
                          position === day.exercises.length - 1 && styles.moveTextOff,
                        ]}
                      >
                        ↓
                      </Text>
                    </Pressable>
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
            })}
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
    moveText: TextStyle;
    moveTextOff: TextStyle;
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
    moveText: { color: colors.textSecondary, fontSize: fontSize.sm },
    moveTextOff: { color: colors.textFaint },
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
