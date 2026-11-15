/**
 * One of a trainee's workouts, open for their coach to edit.
 *
 * The name, the exercises in their order, and for each one how many sets of how many reps.
 * Exercises come from the same catalogue the trainee's own picker uses, so what a coach
 * prescribes is something the trainee's app already knows how to show, log and track.
 *
 * ## Saved when Save is pressed, not as it is typed
 *
 * Everywhere else in the app a change is written the moment it is made, because it is written
 * to the phone's own database and costs nothing. This is somebody else's plan on a server: a
 * save is a request, it can fail, and half a workout sent while the coach was still moving
 * things around is half a workout on the trainee's phone at the start of their session. So the
 * edits are held here and go up together, as the whole workout it should now be.
 *
 * Leaving with changes unsaved asks first.
 *
 * ## The ids in the path
 *
 * The exercise picker hands its choice back by navigating to the screen that opened it, and it
 * finds that screen by its path. With the trainee, the group and the workout in the path
 * itself, the screen it returns to is this one — still holding the edits — whatever else the
 * picker puts in the parameters.
 */

import { EXERCISE_SEED, type ExerciseSeed } from '@fit/shared/catalog';
import { router, useLocalSearchParams, useNavigation } from 'expo-router';
import { useCallback, useEffect, useMemo, useReducer, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  View,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { Pressable } from '../../../../src/components/Pressable.js';
import { Text } from '../../../../src/components/Text.js';
import { ArrowDown, ArrowUp, Minus, Plus, Trash, X } from 'phosphor-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  dayEditorBusy,
  dayEditorDirty,
  dayEditorError,
  dayEditorReducer,
  INITIAL_DAY_EDITOR,
} from '../../../../src/coaching/dayEditorState.js';
import {
  addExercise,
  describeTargets,
  findDay,
  moveExercise,
  newExercise,
  NO_TIMING,
  removeExercise,
  replaceExercise,
  stepTarget,
  type CoachDay,
  type CoachExercise,
} from '../../../../src/coaching/planDocument.js';
import { coachingErrorKey, useCoachingApi } from '../../../../src/coaching/useCoachingApi.js';
import { useActionSheet } from '../../../../src/components/ActionSheetProvider.js';
import { BrandButton } from '../../../../src/components/BrandButton.js';
import { Field } from '../../../../src/components/Field.js';
import { KeyboardSafe } from '../../../../src/components/KeyboardSafe.js';
import { FadeSlideIn } from '../../../../src/components/motion.js';
import { LinkRow } from '../../../../src/components/settings/kit.js';
import { Banner, ScreenHeader } from '../../../../src/components/ui.js';
import { newId } from '../../../../src/db/provider.js';
import { hapticLight, hapticSuccess } from '../../../../src/haptics.js';
import { useTheme } from '../../../../src/ThemeProvider.js';
import {
  fontSize,
  fontWeight,
  radius,
  shadow,
  spacing,
  type ColorPalette,
} from '../../../../src/theme.js';

const EXERCISE_BY_KEY = new Map<string, ExerciseSeed>(
  EXERCISE_SEED.map((exercise) => [exercise.nameEn, exercise]),
);

export default function TraineeDayScreen() {
  const { t, i18n } = useTranslation();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const navigation = useNavigation();
  const { confirm } = useActionSheet();
  const api = useCoachingApi();
  const params = useLocalSearchParams<{
    trainee: string;
    plan: string;
    day: string;
    addExercise?: string;
  }>();
  const { trainee, plan, day: dayId, addExercise: picked } = params;
  const isHebrew = i18n.language === 'he';

  // Loading, unreachable, or editing with what the server has, the draft and the save or delete
  // in flight: one value, see dayEditorState.ts.
  const [state, dispatch] = useReducer(dayEditorReducer, INITIAL_DAY_EDITOR);
  // What the server had when this was opened; null for a workout that does not exist yet.
  const saved = state.kind === 'editing' ? state.saved : null;
  const draft = state.kind === 'editing' ? state.draft : null;
  const error = dayEditorError(state);
  /** Saving or deleting: every control is held still for both. */
  const saving = dayEditorBusy(state);
  const deleting = state.kind === 'editing' && state.work.kind === 'deleting';
  const setDraft = (next: CoachDay) => dispatch({ type: 'EDITED', edit: () => next });

  // Read once, when the screen opens. Reading it again on every focus would throw away the
  // edits each time the exercise picker closed.
  useEffect(() => {
    if (!api || !trainee || !plan || !dayId) return;
    let cancelled = false;
    void (async () => {
      const result = await api.plans(trainee);
      if (cancelled) return;
      if (!result.ok) {
        dispatch({ type: 'LOAD_FAILED', error: result.error });
        return;
      }
      const found = findDay(result.value, plan, dayId);
      dispatch({
        type: 'LOADED',
        saved: found?.day ?? null,
        blank: { id: dayId, name: null, ...NO_TIMING, exercises: [] },
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [api, trainee, plan, dayId]);

  // The picker returns its choice as a param. The ref stops a re-render from adding it twice;
  // clearing it when the param is cleared is what lets the same exercise be added again.
  const handled = useRef<string | null>(null);
  useEffect(() => {
    if (!picked) {
      handled.current = null;
      return;
    }
    if (!draft || handled.current === picked) return;
    handled.current = picked;
    const added = newExercise(newId(), picked);
    dispatch({ type: 'EDITED', edit: (current) => addExercise(current, added) });
    router.setParams({ addExercise: '' });
  }, [picked, draft]);

  const isNew = saved === null;
  const dirty = dayEditorDirty(state);

  /*
   * Leaving with unsaved changes asks first.
   *
   * In a ref because the listener is attached once and must read the value as it is when
   * someone actually tries to leave, not as it was when the screen opened.
   */
  const unsaved = useRef(false);
  unsaved.current = dirty && !saving;
  useEffect(() => {
    return navigation.addListener('beforeRemove', (event) => {
      if (!unsaved.current) return;
      event.preventDefault();
      void (async () => {
        const leave = await confirm({
          title: t('coaching.unsavedTitle'),
          message: t('coaching.unsavedBody'),
          confirmLabel: t('coaching.discard'),
        });
        if (leave) {
          unsaved.current = false;
          navigation.dispatch(event.data.action);
        }
      })();
    });
  }, [navigation, confirm, t]);

  const save = async () => {
    if (!api || !draft || !trainee || !plan || saving) return;
    dispatch({ type: 'SAVE_STARTED' });
    const result = await api.saveDay(trainee, plan, draft);
    if (!result.ok) {
      dispatch({ type: 'WORK_FAILED', error: result.error });
      return;
    }
    hapticSuccess();
    // Marked clean before leaving, or the listener above would ask about changes just saved.
    unsaved.current = false;
    dispatch({ type: 'SAVED' });
    router.back();
  };

  const removeDay = async () => {
    if (!api || !trainee || !dayId || isNew || saving) return;
    const sure = await confirm({
      title: t('coaching.deleteWorkoutTitle'),
      message: t('coaching.deleteWorkoutBody'),
      confirmLabel: t('coaching.deleteWorkout'),
    });
    if (!sure) return;
    dispatch({ type: 'DELETE_STARTED' });
    const result = await api.deleteDay(trainee, dayId);
    if (!result.ok) {
      dispatch({ type: 'WORK_FAILED', error: result.error });
      return;
    }
    unsaved.current = false;
    router.back();
  };

  const change = useCallback(
    (next: CoachExercise) =>
      dispatch({ type: 'EDITED', edit: (current) => replaceExercise(current, next) }),
    [],
  );

  const exerciseName = (key: string) => {
    const known = EXERCISE_BY_KEY.get(key);
    // A key the catalogue does not have is shown as it is rather than hidden: it is still an
    // exercise on this person's plan, and the coach should be able to see and remove it.
    return known ? (isHebrew ? known.nameHe : known.nameEn) : key;
  };

  return (
    <KeyboardSafe>
      <ScrollView
        style={styles.screen}
        contentContainerStyle={[
          styles.content,
          { paddingTop: spacing.lg, paddingBottom: spacing.xl },
        ]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <ScreenHeader title={isNew ? t('coaching.newWorkout') : t('coaching.editWorkout')} />

        {error ? <Banner tone="warning">{t(coachingErrorKey(error))}</Banner> : null}

        {state.kind === 'loading' ? (
          <View style={styles.loading}>
            <ActivityIndicator color={colors.accent} />
          </View>
        ) : null}

        {draft ? (
          <>
            <Field
              value={draft.name ?? ''}
              onChangeText={(name) => setDraft({ ...draft, name })}
              placeholder={t('coaching.workoutNamePlaceholder')}
              editable={!saving}
              returnKeyType="done"
            />

            {draft.exercises.length === 0 ? (
              <Text style={styles.empty}>{t('coaching.noExercises')}</Text>
            ) : null}

            {draft.exercises.map((exercise, index) => (
              <FadeSlideIn key={exercise.id} style={styles.card}>
                <View style={styles.cardHead}>
                  <View style={styles.cardTitle}>
                    <Text style={styles.exerciseName}>{exerciseName(exercise.exerciseKey)}</Text>
                    <Text style={styles.exerciseSummary}>{describeTargets(exercise)}</Text>
                  </View>
                  <IconButton
                    icon={ArrowUp}
                    label={t('coaching.moveUp')}
                    disabled={index === 0 || saving}
                    onPress={() => setDraft(moveExercise(draft, exercise.id, -1))}
                  />
                  <IconButton
                    icon={ArrowDown}
                    label={t('coaching.moveDown')}
                    disabled={index === draft.exercises.length - 1 || saving}
                    onPress={() => setDraft(moveExercise(draft, exercise.id, 1))}
                  />
                  <IconButton
                    icon={X}
                    label={t('coaching.removeExercise')}
                    danger
                    disabled={saving}
                    onPress={() => setDraft(removeExercise(draft, exercise.id))}
                  />
                </View>

                <View style={styles.steppers}>
                  <Stepper
                    label={t('coaching.sets')}
                    value={exercise.targetSets}
                    disabled={saving}
                    onStep={(by) => change(stepTarget(exercise, 'sets', by))}
                  />
                  <Stepper
                    label={t('coaching.repsFrom')}
                    value={exercise.targetRepsMin}
                    disabled={saving}
                    onStep={(by) => change(stepTarget(exercise, 'repsMin', by))}
                  />
                  <Stepper
                    label={t('coaching.repsTo')}
                    value={exercise.targetRepsMax}
                    disabled={saving}
                    onStep={(by) => change(stepTarget(exercise, 'repsMax', by))}
                  />
                </View>

                {/* A line from the coach about this exercise: how to do it, what to watch. The
                    trainee sees it on the workout, under the exercise's name. */}
                <Field
                  value={exercise.notes ?? ''}
                  onChangeText={(notes) => change({ ...exercise, notes })}
                  placeholder={t('coaching.exerciseNotePlaceholder')}
                  editable={!saving}
                  maxLength={200}
                  multiline
                />
              </FadeSlideIn>
            ))}

            <LinkRow
              icon={Plus}
              label={t('coaching.addExercise')}
              disabled={saving}
              onPress={() =>
                router.push({
                  pathname: '/exercise-picker',
                  params: { returnTo: `/trainee-day/${trainee}/${plan}/${dayId}` },
                })
              }
            />

            {isNew ? null : (
              <LinkRow
                icon={Trash}
                tone="danger"
                label={t('coaching.deleteWorkout')}
                disabled={saving}
                onPress={() => void removeDay()}
                chevron={false}
              />
            )}
          </>
        ) : null}
      </ScrollView>

      {draft ? (
        <View style={[styles.footer, { paddingBottom: insets.bottom + spacing.md }]}>
          <BrandButton
            label={t('coaching.saveWorkout')}
            onPress={() => void save()}
            disabled={!dirty || deleting}
            busy={saving && !deleting}
          />
        </View>
      ) : null}
    </KeyboardSafe>
  );
}

/** A small round button with only a picture on it, named for a screen reader. */
function IconButton({
  icon: IconComponent,
  label,
  onPress,
  disabled = false,
  danger = false,
}: {
  icon: typeof ArrowUp;
  label: string;
  onPress: () => void;
  disabled?: boolean;
  danger?: boolean;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  return (
    <Pressable
      onPress={() => {
        hapticLight();
        onPress();
      }}
      disabled={disabled}
      hitSlop={6}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      style={({ pressed }) => [styles.iconButton, (pressed || disabled) && styles.dim]}
    >
      <IconComponent
        size={16}
        color={danger ? colors.danger : colors.textSecondary}
        weight="bold"
      />
    </Pressable>
  );
}

/** One of an exercise's three numbers, with a minus on one side and a plus on the other. */
function Stepper({
  label,
  value,
  onStep,
  disabled,
}: {
  label: string;
  value: number | null;
  onStep: (by: -1 | 1) => void;
  disabled: boolean;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const step = (by: -1 | 1) => () => {
    hapticLight();
    onStep(by);
  };
  return (
    <View style={styles.stepper}>
      <Text style={styles.stepperLabel}>{label}</Text>
      {/* Minus on the left and plus on the right in every language, like the ruler in setup:
          a number line does not turn around because the words do. */}
      <View style={styles.stepperRow}>
        <Pressable
          onPress={step(-1)}
          disabled={disabled}
          hitSlop={6}
          accessibilityRole="button"
          accessibilityLabel={`${label} −`}
          style={({ pressed }) => [styles.stepButton, pressed && styles.dim]}
        >
          <Minus size={14} color={colors.accent} weight="bold" />
        </Pressable>
        <Text style={styles.stepperValue}>{value ?? '–'}</Text>
        <Pressable
          onPress={step(1)}
          disabled={disabled}
          hitSlop={6}
          accessibilityRole="button"
          accessibilityLabel={`${label} +`}
          style={({ pressed }) => [styles.stepButton, pressed && styles.dim]}
        >
          <Plus size={14} color={colors.accent} weight="bold" />
        </Pressable>
      </View>
    </View>
  );
}

const createStyles = (colors: ColorPalette) =>
  StyleSheet.create<{
    screen: ViewStyle;
    content: ViewStyle;
    loading: ViewStyle;
    empty: TextStyle;
    card: ViewStyle;
    cardHead: ViewStyle;
    cardTitle: ViewStyle;
    exerciseName: TextStyle;
    exerciseSummary: TextStyle;
    iconButton: ViewStyle;
    dim: ViewStyle;
    steppers: ViewStyle;
    stepper: ViewStyle;
    stepperLabel: TextStyle;
    stepperRow: ViewStyle;
    stepButton: ViewStyle;
    stepperValue: TextStyle;
    footer: ViewStyle;
  }>({
    screen: { flex: 1 },
    content: { paddingHorizontal: spacing.lg, gap: spacing.lg },
    loading: { paddingVertical: spacing.xxl, alignItems: 'center' },
    empty: {
      color: colors.textMuted,
      fontSize: fontSize.sm,
      textAlign: 'center',
      paddingVertical: spacing.lg,
    },

    card: {
      backgroundColor: colors.surface,
      borderRadius: radius.xl,
      padding: spacing.lg,
      gap: spacing.lg,
      ...shadow(colors.shadow).card,
    },
    cardHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
    cardTitle: { flex: 1, gap: spacing.xxs },
    exerciseName: {
      color: colors.text,
      fontSize: fontSize.md,
      fontWeight: fontWeight.bold,
      textAlign: 'auto',
    },
    exerciseSummary: {
      color: colors.textMuted,
      fontSize: fontSize.xs,
      textAlign: 'auto',
      fontVariant: ['tabular-nums'],
    },
    iconButton: {
      width: 34,
      height: 34,
      borderRadius: radius.pill,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.surfaceRaised,
    },
    dim: { opacity: 0.4 },

    steppers: { flexDirection: 'row', gap: spacing.sm },
    stepper: {
      flex: 1,
      alignItems: 'center',
      gap: spacing.xs,
      paddingVertical: spacing.sm,
      borderRadius: radius.md,
      backgroundColor: colors.surfaceRaised,
    },
    stepperLabel: { color: colors.textMuted, fontSize: fontSize.xxs },
    stepperRow: { direction: 'ltr', flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
    stepButton: {
      width: 30,
      height: 30,
      borderRadius: radius.pill,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.accentSoft,
    },
    stepperValue: {
      minWidth: 30,
      color: colors.text,
      fontSize: fontSize.lg,
      fontWeight: fontWeight.bold,
      textAlign: 'center',
      fontVariant: ['tabular-nums'],
    },

    footer: {
      paddingHorizontal: spacing.lg,
      paddingTop: spacing.md,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border,
      backgroundColor: colors.glass,
    },
  });
