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

import { EXERCISE_SEED, type ExerciseSeed } from '@fit/shared/catalog';
import { router, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
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

import { colors, fontSize, radius, spacing } from '../src/theme.js';

/** Muscle groups offered as quick filters, ordered by how often they head a session. */
const FILTER_MUSCLES = [
  'chest',
  'lats',
  'mid_back',
  'quads',
  'hamstrings',
  'glutes',
  'front_delts',
  'side_delts',
  'biceps',
  'triceps',
  'core',
  'calves',
  'cardio',
] as const;

export default function ExercisePickerScreen() {
  const { t, i18n } = useTranslation();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{
    sessionId?: string;
    returnTo?: string;
    planDayId?: string;
  }>();
  const isHebrew = i18n.language === 'he';

  const [query, setQuery] = useState('');
  const [muscle, setMuscle] = useState<string | null>(null);

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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- returnTo is a runtime
      // string, so it cannot satisfy expo-router's generated union of literal route types.
      pathname: (params.returnTo ?? '/(tabs)/workouts') as any,
      params: {
        sessionId: params.sessionId ?? '',
        planDayId: params.planDayId ?? '',
        addExercise: exercise.nameEn,
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
    <View style={[styles.screen, { paddingTop: insets.top + spacing.md }]}>
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
        data={[null, ...FILTER_MUSCLES]}
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

      <FlatList
        data={results}
        keyExtractor={(e) => e.nameEn}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingBottom: insets.bottom + spacing.xxl }}
        ListEmptyComponent={<Text style={styles.empty}>{t('picker.noResults')}</Text>}
        renderItem={({ item }) => (
          <Pressable onPress={() => choose(item)} style={styles.row} accessibilityRole="button">
            <View style={styles.rowMain}>
              <Text style={styles.rowTitle}>{label(item)}</Text>
              <Text style={styles.rowSub}>
                {t(`muscle.${item.primaryMuscle}`)}
                {item.isUnilateral ? ' · ⇄' : ''}
              </Text>
            </View>
            <Text style={styles.rowChevron}>{isHebrew ? '‹' : '›'}</Text>
          </Pressable>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create<{
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
  row: ViewStyle;
  rowMain: ViewStyle;
  rowTitle: TextStyle;
  rowSub: TextStyle;
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
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  rowMain: { flex: 1 },
  rowTitle: { color: colors.text, fontSize: fontSize.md, textAlign: 'auto' },
  rowSub: { color: colors.textMuted, fontSize: fontSize.xs, marginTop: 2, textAlign: 'auto' },
  rowChevron: { color: colors.textMuted, fontSize: fontSize.lg },
  empty: {
    color: colors.textMuted,
    fontSize: fontSize.sm,
    textAlign: 'center',
    paddingVertical: spacing.xxl,
  },
});
