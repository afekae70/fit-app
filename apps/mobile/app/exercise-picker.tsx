/**
 * Exercise picker, presented as a modal over the active workout.
 *
 * Reads the catalogue straight from `@fit/shared` — it ships in the bundle, so searching works
 * with no network and no prior sync. The chosen exercise is returned to the caller through the
 * router's params rather than a callback, since expo-router screens cannot pass functions.
 *
 * The caller supplies `returnTo`, so the same picker serves the active workout, editing a past
 * session, and building a plan day. It defaults to the active workout, which is where the
 * overwhelming majority of picks happen.
 */

import { EXERCISE_SEED, FILTERABLE_MUSCLES, type ExerciseSeed } from '@fit/shared/catalog';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useCurrentUserId } from '../src/auth/CurrentUserProvider.js';
import { useUnit } from '../src/UnitsProvider.js';
import { kgToDisplay, weightUnitKey } from '../src/units.js';
import { ExerciseVisual } from '../src/components/ExerciseVisual.js';
import { getExecutor } from '../src/db/provider.js';
import { summariseAllProgress } from '../src/db/progression.js';
import { listRecentExerciseKeys } from '../src/db/workouts.js';
import { useTheme } from '../src/ThemeProvider.js';
import { fontSize, radius, spacing, type ColorPalette } from '../src/theme.js';

const EXERCISE_BY_KEY = new Map<string, ExerciseSeed>(
  EXERCISE_SEED.map((exercise) => [exercise.nameEn, exercise]),
);


export default function ExercisePickerScreen() {
  const { t, i18n } = useTranslation();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{
    sessionId?: string;
    returnTo?: string;
    planDayId?: string;
    swapExerciseId?: string;
  }>();
  const isHebrew = i18n.language === 'he';
  const userId = useCurrentUserId();
  const unit = useUnit();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const [query, setQuery] = useState('');
  const [muscle, setMuscle] = useState<string | null>(null);
  const [recentKeys, setRecentKeys] = useState<string[]>([]);
  /**
   * Estimated 1RM per exercise, loaded once for the whole screen rather than per row.
   * `summariseAllProgress` walks every logged exercise; running it inside a row renderer would
   * re-run it on every scroll frame and stall the list.
   */
  const [oneRepMax, setOneRepMax] = useState<Map<string, { latest: number; delta: number | null }>>(
    new Map(),
  );

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const db = await getExecutor();
      const keys = await listRecentExerciseKeys(db, userId);
      if (!cancelled) setRecentKeys(keys);

      const summaries = await summariseAllProgress(db, userId, { minSessions: 1 });
      if (cancelled) return;
      setOneRepMax(
        new Map(
          summaries
            .filter((s) => s.latestE1rm !== null)
            .map((s) => [
              s.exerciseKey,
              { latest: s.latestE1rm as number, delta: s.assessment.e1rmDeltaKg },
            ]),
        ),
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const recentExercises = useMemo(
    () => recentKeys.map((key) => EXERCISE_BY_KEY.get(key)).filter((e): e is ExerciseSeed => !!e),
    [recentKeys],
  );

  // Hidden the moment a search or filter narrows the list — "recently used" is a shortcut for
  // the unfiltered browse state, not another thing to reconcile against active filters.
  const showRecents = query.trim() === '' && muscle === null && recentExercises.length > 0;

  const results = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return EXERCISE_SEED.filter((exercise) => {
      if (muscle && exercise.primaryMuscle !== muscle) return false;
      if (!needle) return true;
      // Match either language, so a Hebrew UI can still find an exercise by its English name
      // (common when the user knows the lift by its gym-floor name).
      return (
        exercise.nameEn.toLowerCase().includes(needle) ||
        exercise.nameHe.toLowerCase().includes(needle)
      );
    });
  }, [query, muscle]);

  const label = (exercise: ExerciseSeed) => (isHebrew ? exercise.nameHe : exercise.nameEn);

  const choose = (exercise: ExerciseSeed) => {
    // exercise_key is always the English name — the stable catalogue key, independent of UI
    // language. Storing the localised name would break history when the language changes.
    const target = {
      // `returnTo` is a runtime string, so it cannot satisfy expo-router's generated union of
      // literal route types. The disable has to sit on the line the cast is on -- the previous
      // one was above a continuation comment and therefore suppressed nothing.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment
      pathname: (params.returnTo ?? '/(tabs)/workouts') as any,
      params: {
        sessionId: params.sessionId ?? '',
        planDayId: params.planDayId ?? '',
        addExercise: exercise.nameEn,
        // Passed straight back through. When set, the caller replaces that exercise rather
        // than appending — the picker itself stays a list of names and decides nothing.
        swapExerciseId: params.swapExerciseId ?? '',
      },
    };

    // `dismissTo`, not `replace`. The caller is still on the stack below this modal, so
    // replacing would leave two copies of it — and Back would land on the older one, which
    // never reloaded and so appears to have lost the exercise just added. `dismissTo` pops
    // back to the existing screen instead of stacking a second.
    if (params.returnTo) {
      router.dismissTo(target);
    } else {
      router.replace(target);
    }
  };

  return (
    <View style={[styles.screen, { paddingTop: spacing.md }]}>
      <View style={styles.header}>
        <Text style={styles.title}>{t('picker.title')}</Text>
        <Pressable onPress={() => router.back()} style={styles.closeButton} accessibilityRole="button">
          <Text style={styles.closeText}>✕</Text>
        </Pressable>
      </View>

      <TextInput
        value={query}
        onChangeText={setQuery}
        placeholder={t('picker.search')}
        placeholderTextColor={colors.textMuted}
        style={styles.search}
        autoCorrect={false}
        clearButtonMode="while-editing"
      />

      <FlatList
        horizontal
        showsHorizontalScrollIndicator={false}
        data={[null, ...FILTERABLE_MUSCLES]}
        keyExtractor={(m) => m ?? 'all'}
        contentContainerStyle={styles.filterRow}
        renderItem={({ item }) => {
          const active = muscle === item;
          return (
            <Pressable
              onPress={() => setMuscle(item)}
              style={[styles.chip, active && styles.chipActive]}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
            >
              <Text style={[styles.chipText, active && styles.chipTextActive]}>
                {item === null ? t('picker.allMuscles') : t(`muscle.${item}`)}
              </Text>
            </Pressable>
          );
        }}
      />

      {showRecents ? (
        <View style={styles.recentsBlock}>
          <Text style={styles.recentsTitle}>{t('picker.recentlyUsed')}</Text>
          <FlatList
            horizontal
            showsHorizontalScrollIndicator={false}
            data={recentExercises}
            keyExtractor={(e) => e.nameEn}
            contentContainerStyle={styles.filterRow}
            renderItem={({ item }) => (
              <Pressable
                onPress={() => choose(item)}
                style={styles.recentChip}
                accessibilityRole="button"
              >
                <Text style={styles.recentChipText}>{label(item)}</Text>
              </Pressable>
            )}
          />
        </View>
      ) : null}

      <FlatList
        data={results}
        keyExtractor={(e) => e.nameEn}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingBottom: insets.bottom + spacing.xxl }}
        ListEmptyComponent={<Text style={styles.empty}>{t('picker.noResults')}</Text>}
        renderItem={({ item }) => (
          <Pressable onPress={() => choose(item)} style={styles.row} accessibilityRole="button">
            <View style={styles.rowThumb}>
              <ExerciseVisual exercise={item} height={56} />
            </View>
            <View style={styles.rowMain}>
              <Text style={styles.rowTitle}>{label(item)}</Text>
              <Text style={styles.rowSub}>
                {t(`muscle.${item.primaryMuscle}`)}
                {item.isUnilateral ? ' · ⇄' : ''}
              </Text>
              {(() => {
                const best = oneRepMax.get(item.nameEn);
                if (!best) return null;
                const delta = best.delta;
                return (
                  <View style={styles.rowStats}>
                    <Text style={styles.rowE1rm}>
                      {Math.round(kgToDisplay(best.latest, unit))}{' '}
                      {t(`common.${weightUnitKey(unit)}`)}
                    </Text>
                    <Text style={styles.rowE1rmLabel}>{t('progress.estimated1rm')}</Text>
                    {delta !== null && Math.abs(delta) >= 0.5 ? (
                      <Text style={[styles.rowDelta, delta < 0 && styles.rowDeltaDown]}>
                        {delta > 0 ? '+' : ''}
                        {delta.toFixed(1)}
                      </Text>
                    ) : null}
                  </View>
                );
              })()}
            </View>
            <Text style={styles.rowChevron}>{isHebrew ? '‹' : '›'}</Text>
          </Pressable>
        )}
      />
    </View>
  );
}

const createStyles = (colors: ColorPalette) =>
  StyleSheet.create<{
    screen: ViewStyle;
    header: ViewStyle;
    title: TextStyle;
    closeButton: ViewStyle;
    closeText: TextStyle;
    search: TextStyle;
    filterRow: ViewStyle;
    chip: ViewStyle;
    chipActive: ViewStyle;
    chipText: TextStyle;
    chipTextActive: TextStyle;
    recentsBlock: ViewStyle;
    recentsTitle: TextStyle;
    recentChip: ViewStyle;
    recentChipText: TextStyle;
    row: ViewStyle;
    rowThumb: ViewStyle;
    rowMain: ViewStyle;
    rowTitle: TextStyle;
    rowSub: TextStyle;
    rowStats: ViewStyle;
    rowE1rm: TextStyle;
    rowE1rmLabel: TextStyle;
    rowDelta: TextStyle;
    rowDeltaDown: TextStyle;
    rowChevron: TextStyle;
    empty: TextStyle;
  }>({
  screen: { flex: 1, backgroundColor: colors.bg, paddingHorizontal: spacing.lg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
  },
  title: { color: colors.text, fontSize: fontSize.lg, fontWeight: '700' },
  closeButton: {
    width: 36,
    height: 36,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceRaised,
  },
  closeText: { color: colors.textMuted, fontSize: fontSize.md },
  search: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    color: colors.text,
    fontSize: fontSize.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    textAlign: 'auto',
  },
  filterRow: { gap: spacing.sm, paddingVertical: spacing.md },
  chip: {
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceRaised,
    height: 34,
    justifyContent: 'center',
  },
  chipActive: { backgroundColor: colors.accentSoft, borderColor: colors.accent },
  chipText: { color: colors.textMuted, fontSize: fontSize.sm },
  chipTextActive: { color: colors.accent, fontWeight: '700' },
  recentsBlock: { marginBottom: spacing.sm },
  recentsTitle: {
    color: colors.textMuted,
    fontSize: fontSize.xs,
    fontWeight: '700',
    textTransform: 'uppercase',
    textAlign: 'auto',
  },
  recentChip: {
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.accentBorder,
    backgroundColor: colors.accentSoft,
    height: 34,
    justifyContent: 'center',
  },
  recentChipText: { color: colors.accent, fontSize: fontSize.sm, fontWeight: '600' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  rowThumb: { width: 64, marginEnd: spacing.md },
  rowMain: { flex: 1 },
  rowTitle: { color: colors.text, fontSize: fontSize.md, textAlign: 'auto' },
  rowSub: { color: colors.textMuted, fontSize: fontSize.xs, marginTop: 2, textAlign: 'auto' },
  rowStats: { flexDirection: 'row', alignItems: 'baseline', gap: spacing.xs, marginTop: 3 },
  rowE1rm: { color: colors.accent, fontSize: fontSize.sm, fontWeight: '700' },
  rowE1rmLabel: { color: colors.textFaint, fontSize: fontSize.xxs },
  rowDelta: { color: colors.accent, fontSize: fontSize.xxs, fontWeight: '700' },
  rowDeltaDown: { color: colors.textMuted },
  rowChevron: { color: colors.textMuted, fontSize: fontSize.lg },
  empty: {
    color: colors.textMuted,
    fontSize: fontSize.sm,
    textAlign: 'center',
    paddingVertical: spacing.xxl,
  },
});
