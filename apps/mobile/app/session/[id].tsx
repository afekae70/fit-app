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
import { useUnit } from '../../src/UnitsProvider.js';
import {
  formatVolume,
  weightUnitKey,
} from '../../src/units.js';
import { sessionLoad } from '@fit/shared/calculations';
import { useActionSheet } from '../../src/components/ActionSheetProvider.js';
import { ExerciseCard, type PreviousSet } from '../../src/components/ExerciseCard.js';
import { SessionExerciseSummary } from '../../src/components/workout/SessionExerciseSummary.js';
import { KeyboardSafe } from '../../src/components/KeyboardSafe.js';
import {
  Card,
  MetricTile,
  ScreenHeader,
  SectionTitle,
  SkeletonScreen,
} from '../../src/components/ui.js';
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

/** Same span the active workout offers — below 6 a set is a warm-up, which has its own word. */
const RPE_CHOICES = [6, 7, 8, 9, 10] as const;

export default function SessionDetailScreen() {
  const { confirm, notify, ask } = useActionSheet();
  const { t, i18n } = useTranslation();
  const insets = useSafeAreaInsets();
  const { id, addExercise } = useLocalSearchParams<{ id: string; addExercise?: string }>();
  const isHebrew = i18n.language === 'he';
  const userId = useCurrentUserId();
  const unit = useUnit();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const [session, setSession] = useState<WorkoutSessionRow | null>(null);
  const [exercises, setExercises] = useState<SessionExerciseWithSets[]>([]);
  const [previous, setPrevious] = useState<Record<string, PreviousSet[] | null>>({});
  const [nameDraft, setNameDraft] = useState('');
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);

  /**
   * Minutes from the recorded start and end rather than a stored duration — there isn't one,
   * and deriving it keeps the number honest if either timestamp is ever corrected.
   */
  const sessionEffortLoad = useMemo(() => {
    if (!session?.started_at || !session.ended_at) return null;
    const minutes = (Date.parse(session.ended_at) - Date.parse(session.started_at)) / 60000;
    return sessionLoad(session.session_rpe, minutes);
  }, [session]);

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
      void (async () => {
        const ok = await confirm({
          message: t('workout.confirmRemoveExercise'),
          confirmLabel: t('workout.removeExercise'),
        });
        if (!ok) return;
        const db = await getExecutor();
        await removeExerciseFromSession(db, sessionExerciseId);
        await load();
      })();
    },
    [load, t, confirm],
  );

  /**
   * One set's menu, the same one the active workout offers.
   *
   * Editing a finished session is where a stray set actually gets noticed — you are reading the
   * workout back rather than living it — and it was the screen where deleting one was hardest to
   * reach.
   */
  const openSetOptions = useCallback(
    (setId: string) => {
      const set = exercises.flatMap((ex) => ex.sets).find((s) => s.id === setId);
      if (!set) return;

      void (async () => {
        const choice = await ask({
          title: `${t('workout.setNumber')} ${set.set_index}`,
          actions: [
            { label: t(set.is_warmup === 1 ? 'workout.markAsWorking' : 'workout.markAsWarmup') },
            { label: t('workout.rateEffort') },
            { label: t(set.to_failure === 1 ? 'workout.clearToFailure' : 'workout.markToFailure') },
            { label: t('workout.removeSet'), destructive: true },
          ],
        });

        if (choice === 0) patchSet(set.id, { isWarmup: set.is_warmup === 0 });
        else if (choice === 1) {
          const rated = await ask({
            title: t('workout.rateEffort'),
            message: t('workout.rateEffortHint'),
            actions: [
              ...RPE_CHOICES.map((value) => ({ label: t(`workout.rpe${value}`) })),
              { label: t('workout.rpeClear') },
            ],
          });
          if (rated === null) return;
          patchSet(set.id, { rpe: RPE_CHOICES[rated] ?? null });
        } else if (choice === 2) patchSet(set.id, { toFailure: set.to_failure === 0 });
        else if (choice === 3) deleteSet(set.id);
      })();
    },
    [exercises, ask, t, patchSet, deleteSet],
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
        await notify({ message: t('history.activeWarning') });
        return;
      }

      const created = await repeatSession(db, userId, newId, id);
      if (created) router.replace('/(tabs)/workouts');
    })();
  };

  const remove = () => {
    if (!id) return;
    void (async () => {
      const ok = await confirm({
        message: t('history.confirmDelete'),
        confirmLabel: t('history.delete'),
      });
      if (!ok) return;
      const db = await getExecutor();
      await deleteSession(db, userId, id);
      router.back();
    })();
  };

  if (loading) {
    return <SkeletonScreen paddingTop={spacing.lg} />;
  }

  if (!session) {
    return (
      <View style={[styles.centered, { paddingTop: spacing.xxl }]}>
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
  /** "Thursday, 17 September · 19:24 · 51 min" — placed, timed and measured in one line. */
  const started = new Date(session.started_at);
  const minutes = session.ended_at
    ? Math.max(1, Math.round((Date.parse(session.ended_at) - Date.parse(session.started_at)) / 60000))
    : null;
  const when = [
    started.toLocaleDateString(i18n.language, { weekday: 'long', day: 'numeric', month: 'long' }),
    started.toLocaleTimeString(i18n.language, { hour: '2-digit', minute: '2-digit' }),
    minutes === null ? null : `${minutes} ${t('history.minutes')}`,
  ]
    .filter(Boolean)
    .join(' · ');

  const volume = exercises.reduce(
    (sum, e) =>
      sum +
      e.sets
        .filter((s) => s.is_warmup === 0)
        .reduce((v, s) => v + (s.weight_kg ?? 0) * (s.reps ?? 0), 0),
    0,
  );

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
        <ScreenHeader title={t('history.sessionTitle')} back />

        {/* The workout at a glance: what it was called, when, and what it came to. The name is
            the heading rather than a field in a box — it is read far more often than it is
            changed, and tapping it is still enough to change it. */}
        <Card>
          <TextInput
            value={nameDraft}
            onChangeText={setNameDraft}
            onEndEditing={() => void saveName()}
            placeholder={t('history.namePlaceholder')}
            placeholderTextColor={colors.textMuted}
            style={styles.nameInput}
            returnKeyType="done"
          />
          <Text style={styles.when}>{when}</Text>

          <View style={styles.tiles}>
            <MetricTile value={String(exercises.length)} label={t('history.exercises')} />
            <MetricTile value={String(totalSets)} label={t('history.sets')} />
            {volume > 0 ? (
              <MetricTile
                value={`${formatVolume(volume, unit)} ${t(`common.${weightUnitKey(unit)}`)}`}
                label={t('history.volume')}
              />
            ) : null}
          </View>

          {/* The rating survives past the sheet that asked for it. A number collected once and
              never shown again is the pattern this app has been unpicking all week. */}
          {session.session_rpe !== null ? (
            <View style={styles.effortChip}>
              <Text style={styles.effortText}>
                {t(`workout.effort${session.session_rpe}`)}
                {sessionEffortLoad !== null ? ` · ${t('workout.load')} ${sessionEffortLoad}` : ''}
              </Text>
            </View>
          ) : null}
        </Card>

        {/* Side by side, and the same height: repeating and correcting are both things done to a
            finished workout, and neither is the headline the two stacked blocks made them. */}
        <View style={styles.actions}>
          {!editing ? (
            <Pressable
              onPress={repeat}
              style={({ pressed }) => [styles.action, styles.actionPrimary, pressed && styles.pressed]}
              accessibilityRole="button"
            >
              <Text style={styles.actionPrimaryText}>↻ {t('history.repeat')}</Text>
            </Pressable>
          ) : null}
          <Pressable
            onPress={() => setEditing((current) => !current)}
            style={({ pressed }) => [
              styles.action,
              editing && styles.actionPrimary,
              pressed && styles.pressed,
            ]}
            accessibilityRole="button"
          >
            <Text style={[styles.actionText, editing && styles.actionPrimaryText]}>
              {editing ? `✓ ${t('history.editDone')}` : `✎ ${t('history.edit')}`}
            </Text>
          </Pressable>
        </View>

        <SectionTitle>{t('history.exercises')}</SectionTitle>

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
                  onSetOptions={openSetOptions}
                  onUpdateSet={patchSet}
                  onToggleDone={toggleDone}
                  onRemoveExercise={() => dropExercise(exercise.id)}
                />
              );
            })
          : exercises.map((exercise) => {
              const seed = EXERCISE_BY_KEY.get(exercise.exercise_key);
              return (
                <SessionExerciseSummary
                  key={exercise.id}
                  seed={seed}
                  name={seed ? (isHebrew ? seed.nameHe : seed.nameEn) : exercise.exercise_key}
                  sets={exercise.sets}
                />
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
    nameInput: TextStyle;
    when: TextStyle;
    tiles: ViewStyle;
    effortChip: ViewStyle;
    effortText: TextStyle;
    actions: ViewStyle;
    action: ViewStyle;
    actionPrimary: ViewStyle;
    actionText: TextStyle;
    actionPrimaryText: TextStyle;
    pressed: ViewStyle;
    addExerciseButton: ViewStyle;
    addExerciseText: TextStyle;
    deleteButton: ViewStyle;
    deleteButtonText: TextStyle;
    secondaryButton: ViewStyle;
    secondaryButtonText: TextStyle;
  }>({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { paddingHorizontal: spacing.lg, gap: spacing.md },
  centered: { flex: 1, backgroundColor: colors.bg, alignItems: 'center' },
  muted: { color: colors.textMuted, fontSize: fontSize.sm },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  back: { color: colors.accent, fontSize: fontSize.xl, fontWeight: '700' },
  // The name is the heading of the card, and a field only once it is tapped: no box, no border,
  // the type size of a title. It is read every time this screen opens and edited almost never.
  nameInput: {
    color: colors.text,
    fontSize: fontSize.xl,
    fontWeight: '700',
    padding: 0,
    textAlign: 'auto',
  },
  when: { color: colors.textMuted, fontSize: fontSize.sm, marginTop: 2, textAlign: 'auto' },
  tiles: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
  effortChip: {
    alignSelf: 'flex-start',
    marginTop: spacing.sm,
    paddingVertical: spacing.xxs,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceRaised,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
  },
  effortText: { color: colors.textSecondary, fontSize: fontSize.xs, fontVariant: ['tabular-nums'] },
  actions: { flexDirection: 'row', gap: spacing.sm },
  action: {
    flex: 1,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: 'center',
  },
  actionPrimary: { borderColor: colors.accent, backgroundColor: colors.accentSoft },
  actionText: { color: colors.textSecondary, fontSize: fontSize.sm, fontWeight: '700' },
  actionPrimaryText: { color: colors.accent, fontSize: fontSize.sm, fontWeight: '700' },
  pressed: { opacity: 0.7 },
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
  deleteButton: { marginTop: spacing.xl, padding: spacing.md, alignItems: 'center' },
  deleteButtonText: { color: colors.danger, fontSize: fontSize.sm },
  secondaryButton: { marginTop: spacing.lg, padding: spacing.md },
  secondaryButtonText: { color: colors.accent, fontSize: fontSize.md },
});
