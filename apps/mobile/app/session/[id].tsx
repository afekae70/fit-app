/**
 * Past-session detail: what was done, plus edit / rename / repeat / delete.
 *
 * Naming lives here rather than only in the finish flow because `Alert.prompt` is iOS-only —
 * this screen gives Android a real text field, so the template feature is not silently
 * unusable on half the platforms.
 *
 * Editing is behind an explicit toggle rather than always-on. Every field here writes straight
 * to SQLite on blur, so an always-editable history screen would turn a mistyped tap while
 * scrolling into a silent corruption of a workout logged weeks ago. Read is the default; edit
 * is a decision.
 */

import { EXERCISE_SEED, type ExerciseSeed } from '@fit/shared/catalog';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Alert,
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

import { useCurrentUserId } from '../../src/auth/CurrentUserProvider.js';
import { ExerciseCard, type PreviousSet } from '../../src/components/ExerciseCard.js';
import { SkeletonScreen } from '../../src/components/ui.js';
import { getExecutor, newId } from '../../src/db/provider.js';
import {
  addExerciseToSession,
  addSetCopyingPrevious,
  deleteSession,
  getActiveSession,
  getPreviousSessionSets,
  getSessionDetail,
  markSetDone,
  removeExerciseFromSession,
  removeSet,
  renameSession,
  repeatSession,
  updateSet,
  type SessionExerciseWithSets,
  type WorkoutSessionRow,
} from '../../src/db/workouts.js';
import { useTheme } from '../../src/ThemeProvider.js';
import { fontSize, radius, spacing, type ColorPalette } from '../../src/theme.js';

const EXERCISE_BY_KEY = new Map<string, ExerciseSeed>(
  EXERCISE_SEED.map((exercise) => [exercise.nameEn, exercise]),
);

export default function SessionDetailScreen() {
  const { t, i18n } = useTranslation();
  const insets = useSafeAreaInsets();
  const { id, addExercise } = useLocalSearchParams<{ id: string; addExercise?: string }>();
  const isHebrew = i18n.language === 'he';
  const userId = useCurrentUserId();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const [session, setSession] = useState<WorkoutSessionRow | null>(null);
  const [exercises, setExercises] = useState<SessionExerciseWithSets[]>([]);
  const [previous, setPrevious] = useState<Record<string, PreviousSet[] | null>>({});
  const [nameDraft, setNameDraft] = useState('');
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    const db = await getExecutor();
    const detail = await getSessionDetail(db, id);
    setSession(detail.session);
    setExercises(detail.exercises);
    setNameDraft(detail.session?.name ?? '');

    const nextPrevious: Record<string, PreviousSet[] | null> = {};
    for (const exercise of detail.exercises) {
      const sets = await getPreviousSessionSets(db, userId, exercise.exercise_key, id);
      nextPrevious[exercise.exercise_key] = sets.length > 0 ? sets : null;
    }
    setPrevious(nextPrevious);
    setLoading(false);
  }, [id, userId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Returning from the picker carries the chosen exercise in a param. The ref stops an
  // unrelated re-render from replaying it and adding the same exercise twice.
  const handledParam = useRef<string | null>(null);
  useEffect(() => {
    if (!addExercise || !id || handledParam.current === addExercise) return;
    handledParam.current = addExercise;
    void (async () => {
      const db = await getExecutor();
      const exerciseId = await addExerciseToSession(db, newId, id, addExercise);
      await addSetCopyingPrevious(db, newId, exerciseId);
      await load();
      setEditing(true);
      router.setParams({ addExercise: '' });
    })();
  }, [addExercise, id, load]);

  const toggleDone = useCallback(
    (setId: string, done: boolean) => {
      void (async () => {
        const db = await getExecutor();
        await markSetDone(db, setId, done);
        await load();
      })();
    },
    [load],
  );

  const patchSet = useCallback(
    (setId: string, patch: Record<string, number | boolean | null>) => {
      void (async () => {
        const db = await getExecutor();
        await updateSet(db, setId, patch);
        await load();
      })();
    },
    [load],
  );

  const addSetTo = useCallback(
    (sessionExerciseId: string) => {
      void (async () => {
        const db = await getExecutor();
        await addSetCopyingPrevious(db, newId, sessionExerciseId);
        await load();
      })();
    },
    [load],
  );

  const deleteSet = useCallback(
    (setId: string) => {
      void (async () => {
        const db = await getExecutor();
        await removeSet(db, setId);
        await load();
      })();
    },
    [load],
  );

  const dropExercise = useCallback(
    (sessionExerciseId: string) => {
      Alert.alert('', t('workout.confirmRemoveExercise'), [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('workout.removeExercise'),
          style: 'destructive',
          onPress: () => {
            void (async () => {
              const db = await getExecutor();
              await removeExerciseFromSession(db, sessionExerciseId);
              await load();
            })();
          },
        },
      ]);
    },
    [load, t],
  );

  const saveName = async () => {
    if (!id) return;
    const db = await getExecutor();
    await renameSession(db, userId, id, nameDraft);
    await load();
  };

  const repeat = () => {
    if (!id) return;
    void (async () => {
      const db = await getExecutor();

      // Repeating creates a new OPEN session, and only one can be active at a time —
      // silently starting a second would strand whichever was already in progress.
      const active = await getActiveSession(db, userId);
      if (active) {
        Alert.alert('', t('history.activeWarning'));
        return;
      }

      const created = await repeatSession(db, userId, newId, id);
      if (created) router.replace('/(tabs)/workouts');
    })();
  };

  const remove = () => {
    if (!id) return;
    Alert.alert('', t('history.confirmDelete'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('history.delete'),
        style: 'destructive',
        onPress: () => {
          void (async () => {
            const db = await getExecutor();
            await deleteSession(db, userId, id);
            router.back();
          })();
        },
      },
    ]);
  };

  if (loading) {
    return <SkeletonScreen paddingTop={insets.top + spacing.lg} />;
  }

  if (!session) {
    return (
      <View style={[styles.centered, { paddingTop: insets.top + spacing.xxl }]}>
        <Text style={styles.muted}>{t('common.error')}</Text>
        <Pressable onPress={() => router.back()} style={styles.secondaryButton}>
          <Text style={styles.secondaryButtonText}>{t('common.cancel')}</Text>
        </Pressable>
      </View>
    );
  }

  const totalSets = exercises.reduce(
    (sum, e) => sum + e.sets.filter((s) => s.is_warmup === 0).length,
    0,
  );
  const volume = exercises.reduce(
    (sum, e) =>
      sum +
      e.sets
        .filter((s) => s.is_warmup === 0)
        .reduce((v, s) => v + (s.weight_kg ?? 0) * (s.reps ?? 0), 0),
    0,
  );

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[
        styles.content,
        { paddingTop: insets.top + spacing.md, paddingBottom: insets.bottom + spacing.xxl },
      ]}
      keyboardShouldPersistTaps="handled"
    >
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} accessibilityRole="button" hitSlop={8}>
          <Text style={styles.back}>{isHebrew ? '›' : '‹'}</Text>
        </Pressable>
        <Text style={styles.date}>{new Date(session.started_at).toLocaleDateString()}</Text>
      </View>

      <View style={styles.nameRow}>
        <TextInput
          value={nameDraft}
          onChangeText={setNameDraft}
          onEndEditing={() => void saveName()}
          placeholder={t('history.namePlaceholder')}
          placeholderTextColor={colors.textMuted}
          style={styles.nameInput}
          returnKeyType="done"
        />
      </View>

      <View style={styles.statsRow}>
        <Text style={styles.stat}>
          {exercises.length} {t('history.exercises')}
        </Text>
        <Text style={styles.stat}>
          {totalSets} {t('history.sets')}
        </Text>
        {volume > 0 ? (
          <Text style={styles.stat}>
            {Math.round(volume).toLocaleString()} {t('common.kg')}
          </Text>
        ) : null}
      </View>

      <Pressable
        onPress={() => setEditing((current) => !current)}
        style={[styles.editButton, editing && styles.editButtonActive]}
        accessibilityRole="button"
      >
        <Text style={[styles.editButtonText, editing && styles.editButtonTextActive]}>
          {editing ? `✓ ${t('history.editDone')}` : `✎ ${t('history.edit')}`}
        </Text>
        {!editing ? <Text style={styles.repeatHint}>{t('history.editHint')}</Text> : null}
      </Pressable>

      {!editing ? (
        <Pressable onPress={repeat} style={styles.repeatButton} accessibilityRole="button">
          <Text style={styles.repeatButtonText}>↻ {t('history.repeat')}</Text>
          <Text style={styles.repeatHint}>{t('history.repeatHint')}</Text>
        </Pressable>
      ) : null}

      {editing
        ? exercises.map((exercise) => {
            const seed = EXERCISE_BY_KEY.get(exercise.exercise_key);
            if (!seed) return null;
            return (
              <ExerciseCard
                key={exercise.id}
                exercise={seed}
                sets={exercise.sets}
                previousSets={previous[exercise.exercise_key] ?? null}
                onAddSet={() => addSetTo(exercise.id)}
                onRemoveSet={deleteSet}
                onUpdateSet={patchSet}
                onToggleDone={toggleDone}
                onRemoveExercise={() => dropExercise(exercise.id)}
              />
            );
          })
        : exercises.map((exercise) => {
            const seed = EXERCISE_BY_KEY.get(exercise.exercise_key);
            const label = seed ? (isHebrew ? seed.nameHe : seed.nameEn) : exercise.exercise_key;
            return (
              <View key={exercise.id} style={styles.exerciseCard}>
                <Text style={styles.exerciseTitle}>{label}</Text>
                {exercise.sets.map((set) => (
                  <View key={set.id} style={styles.setLine}>
                    <Text style={styles.setIndex}>
                      {set.is_warmup === 1 ? t('workout.warmupShort') : set.set_index}
                    </Text>
                    <Text style={styles.setValue}>
                      {set.weight_kg !== null ? `${set.weight_kg} ${t('common.kg')}` : ''}
                      {set.weight_kg !== null && set.reps !== null ? ' × ' : ''}
                      {set.reps !== null ? `${set.reps}` : ''}
                      {set.duration_seconds !== null
                        ? `${set.duration_seconds} ${t('workout.seconds')}`
                        : ''}
                      {set.distance_m !== null ? `${set.distance_m} ${t('workout.meters')}` : ''}
                    </Text>
                  </View>
                ))}
              </View>
            );
          })}

      {editing ? (
        <Pressable
          onPress={() =>
            router.push({
              pathname: '/exercise-picker',
              params: { returnTo: `/session/${id}`, sessionId: id },
            })
          }
          style={styles.addExerciseButton}
          accessibilityRole="button"
        >
          <Text style={styles.addExerciseText}>+ {t('workout.addExercise')}</Text>
        </Pressable>
      ) : null}

      <Pressable onPress={remove} style={styles.deleteButton} accessibilityRole="button">
        <Text style={styles.deleteButtonText}>{t('history.delete')}</Text>
      </Pressable>
    </ScrollView>
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
    date: TextStyle;
    nameRow: ViewStyle;
    nameInput: TextStyle;
    statsRow: ViewStyle;
    stat: TextStyle;
    repeatButton: ViewStyle;
    repeatButtonText: TextStyle;
    repeatHint: TextStyle;
    editButton: ViewStyle;
    editButtonActive: ViewStyle;
    editButtonText: TextStyle;
    editButtonTextActive: TextStyle;
    addExerciseButton: ViewStyle;
    addExerciseText: TextStyle;
    exerciseCard: ViewStyle;
    exerciseTitle: TextStyle;
    setLine: ViewStyle;
    setIndex: TextStyle;
    setValue: TextStyle;
    deleteButton: ViewStyle;
    deleteButtonText: TextStyle;
    secondaryButton: ViewStyle;
    secondaryButtonText: TextStyle;
  }>({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { paddingHorizontal: spacing.lg },
  centered: { flex: 1, backgroundColor: colors.bg, alignItems: 'center' },
  muted: { color: colors.textMuted, fontSize: fontSize.sm },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  back: { color: colors.accent, fontSize: fontSize.xl, fontWeight: '700' },
  date: { color: colors.textMuted, fontSize: fontSize.sm },
  nameRow: { marginTop: spacing.md },
  nameInput: {
    color: colors.text,
    fontSize: fontSize.lg,
    fontWeight: '700',
    backgroundColor: colors.surfaceRaised,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    textAlign: 'auto',
  },
  statsRow: { flexDirection: 'row', gap: spacing.lg, marginTop: spacing.md },
  stat: { color: colors.textMuted, fontSize: fontSize.sm },
  repeatButton: {
    marginTop: spacing.lg,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.accent,
    backgroundColor: colors.accentSoft,
    alignItems: 'center',
  },
  repeatButtonText: { color: colors.accent, fontSize: fontSize.md, fontWeight: '700' },
  repeatHint: { color: colors.textMuted, fontSize: fontSize.xs, marginTop: 2, textAlign: 'center' },
  editButton: {
    marginTop: spacing.lg,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: 'center',
  },
  editButtonActive: { borderColor: colors.accent, backgroundColor: colors.accentSoft },
  editButtonText: { color: colors.textSecondary, fontSize: fontSize.md, fontWeight: '700' },
  editButtonTextActive: { color: colors.accent },
  addExerciseButton: {
    marginTop: spacing.md,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderStyle: 'dashed',
    alignItems: 'center',
  },
  addExerciseText: { color: colors.accent, fontSize: fontSize.sm, fontWeight: '700' },
  exerciseCard: {
    marginTop: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    padding: spacing.md,
  },
  exerciseTitle: {
    color: colors.text,
    fontSize: fontSize.md,
    fontWeight: '700',
    marginBottom: spacing.xs,
    textAlign: 'auto',
  },
  setLine: { flexDirection: 'row', alignItems: 'center', paddingVertical: 2, gap: spacing.md },
  setIndex: { color: colors.textMuted, fontSize: fontSize.xs, width: 24 },
  setValue: { color: colors.text, fontSize: fontSize.sm, textAlign: 'auto' },
  deleteButton: { marginTop: spacing.xl, padding: spacing.md, alignItems: 'center' },
  deleteButtonText: { color: colors.danger, fontSize: fontSize.sm },
  secondaryButton: { marginTop: spacing.lg, padding: spacing.md },
  secondaryButtonText: { color: colors.accent, fontSize: fontSize.md },
});
