/**
 * Exercise Library — browse the catalogue, per the design handoff.
 *
 * Distinct from `exercise-picker.tsx`, which is the same catalogue presented as a modal that
 * returns a choice to an active workout. This is the reading version: no selection, no caller
 * waiting on it, and room for the progression footer that makes it worth opening on its own —
 * an estimated 1RM and how it has moved.
 */

import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  FlatList,
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
import { MagnifyingGlass } from 'phosphor-react-native';

import { EXERCISE_SEED, FILTERABLE_MUSCLES, type ExerciseSeed } from '@fit/shared';

import { useCurrentUserId } from '../../src/auth/CurrentUserProvider.js';
import { BackButton } from '../../src/components/ui.js';
import { useTheme } from '../../src/ThemeProvider.js';
import { radius, type ColorPalette } from '../../src/theme.js';
import { getExecutor } from '../../src/db/provider.js';
import { summariseAllProgress } from '../../src/db/progression.js';
import { useFocusEffect } from 'expo-router';

interface Progression {
  oneRepMax: number;
  /** Latest against best — how far the most recent session sits from the all-time high. */
  delta: number | null;
}

export default function LibraryScreen() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const userId = useCurrentUserId();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const [query, setQuery] = useState('');
  const [muscle, setMuscle] = useState<string | null>(null);
  const [progress, setProgress] = useState<Record<string, Progression>>({});

  useFocusEffect(
    useCallback(() => {
      void (async () => {
        const db = await getExecutor();
        const summaries = await summariseAllProgress(db, userId);
        const next: Record<string, Progression> = {};
        for (const s of summaries) {
          // Only exercises with a computable 1RM get a footer at all; a bodyweight or timed
          // movement has no estimate and should show nothing rather than a zero.
          if (s.bestE1rm === null) continue;
          next[s.exerciseKey] = {
            oneRepMax: s.bestE1rm,
            delta: s.latestE1rm === null ? null : s.latestE1rm - s.bestE1rm,
          };
        }
        setProgress(next);
      })();
    }, [userId]),
  );

  const results = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return EXERCISE_SEED.filter((e) => {
      if (muscle && e.primaryMuscle !== muscle) return false;
      if (!needle) return true;
      // Both names, because the catalogue is keyed in English and read in Hebrew — someone who
      // knows an exercise by either spelling should find it.
      return (
        e.nameHe.toLowerCase().includes(needle) || e.nameEn.toLowerCase().includes(needle)
      );
    });
  }, [query, muscle]);

  return (
    <View style={[styles.screen, { paddingTop: insets.top + 8 }]}>
      <View style={styles.titleRow}>
        <BackButton />
        <Text style={styles.title}>{t('library.title')}</Text>
      </View>

      <View style={styles.searchRow}>
        <MagnifyingGlass size={17} color={colors.textFaint} weight="regular" />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder={t('library.searchPlaceholder')}
          placeholderTextColor={colors.textFaint}
          style={styles.searchInput}
          returnKeyType="search"
        />
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.chipRow}
        style={styles.chipScroll}
      >
        {[null, ...FILTERABLE_MUSCLES].map((value) => {
          const selected = muscle === value;
          return (
            <Pressable
              key={value ?? 'all'}
              onPress={() => setMuscle(value)}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              style={[styles.chip, selected && styles.chipSelected]}
            >
              <Text style={[styles.chipText, selected && styles.chipTextSelected]}>
                {value ? t(`muscle.${value}`) : t('picker.allMuscles')}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>

      <FlatList
        data={results}
        keyExtractor={(item) => item.nameEn}
        contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + 90 }]}
        keyboardShouldPersistTaps="handled"
        ListEmptyComponent={<Text style={styles.empty}>{t('library.noResults')}</Text>}
        renderItem={({ item }) => (
          <ExerciseRow exercise={item} progression={progress[item.nameEn]} />
        )}
      />
    </View>
  );
}

function ExerciseRow({
  exercise,
  progression,
}: {
  exercise: ExerciseSeed;
  progression: Progression | undefined;
}) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <Text style={styles.name}>{exercise.nameHe}</Text>
        <View style={styles.equipmentTag}>
          <Text style={styles.equipmentText}>{t(`equipment.${exercise.equipmentSlug}`)}</Text>
        </View>
      </View>

      <View style={styles.muscleTags}>
        <View style={[styles.muscleTag, styles.muscleTagPrimary]}>
          <Text style={styles.muscleTagPrimaryText}>{t(`muscle.${exercise.primaryMuscle}`)}</Text>
        </View>
        {(exercise.secondaryMuscles ?? []).map((m) => (
          <View key={m} style={styles.muscleTag}>
            <Text style={styles.muscleTagText}>{t(`muscle.${m}`)}</Text>
          </View>
        ))}
      </View>

      {/* The footer only appears once there is history to show. An exercise you have never done
          has no 1RM, and printing "0" beside it would read as a score rather than as silence. */}
      {progression ? (
        <>
          <View style={styles.divider} />
          <View style={styles.progressRow}>
            <Text style={styles.progressLabel}>{t('library.estimatedOneRm')}</Text>
            <View style={styles.progressValues}>
              <Text style={styles.progressValue}>{Math.round(progression.oneRepMax)}</Text>
              {progression.delta !== null && progression.delta !== 0 ? (
                <Text style={styles.progressDelta}>
                  {progression.delta > 0 ? '+' : ''}
                  {progression.delta.toFixed(1)}
                </Text>
              ) : null}
            </View>
          </View>
        </>
      ) : null}
    </View>
  );
}

const createStyles = (colors: ColorPalette) =>
  StyleSheet.create<{
    screen: ViewStyle;
    titleRow: ViewStyle;
    title: TextStyle;
    searchRow: ViewStyle;
    searchInput: TextStyle;
    chipScroll: ViewStyle;
    chipRow: ViewStyle;
    chip: ViewStyle;
    chipSelected: ViewStyle;
    chipText: TextStyle;
    chipTextSelected: TextStyle;
    list: ViewStyle;
    empty: TextStyle;
    card: ViewStyle;
    cardHeader: ViewStyle;
    name: TextStyle;
    equipmentTag: ViewStyle;
    equipmentText: TextStyle;
    muscleTags: ViewStyle;
    muscleTag: ViewStyle;
    muscleTagPrimary: ViewStyle;
    muscleTagText: TextStyle;
    muscleTagPrimaryText: TextStyle;
    divider: ViewStyle;
    progressRow: ViewStyle;
    progressLabel: TextStyle;
    progressValues: ViewStyle;
    progressValue: TextStyle;
    progressDelta: TextStyle;
  }>({
    screen: { flex: 1, paddingHorizontal: 20 },
    titleRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    title: {
      color: colors.text,
      fontSize: 24,
      fontWeight: '500',
      letterSpacing: -0.5,
      marginBottom: 14,
      textAlign: 'auto',
    },

    searchRow: {
      height: 50,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      paddingHorizontal: 14,
      borderRadius: radius.sm,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.bg,
    },
    searchInput: { flex: 1, color: colors.text, fontSize: 15, textAlign: 'auto', padding: 0 },

    chipScroll: { flexGrow: 0, marginTop: 12 },
    chipRow: { gap: 8, paddingVertical: 2 },
    chip: {
      minHeight: 32,
      justifyContent: 'center',
      paddingHorizontal: 12,
      borderRadius: radius.pill,
      borderWidth: 1,
      borderColor: colors.borderStrong,
    },
    chipSelected: { borderColor: colors.accent, backgroundColor: colors.accentSoft },
    chipText: { color: colors.textMuted, fontSize: 12 },
    chipTextSelected: { color: colors.accent },

    list: { paddingTop: 14, gap: 14 },
    empty: { color: colors.textMuted, fontSize: 14, textAlign: 'center', paddingVertical: 40 },

    card: {
      borderWidth: 1,
      borderColor: colors.borderSubtle,
      backgroundColor: colors.surface,
      borderRadius: radius.lg,
      padding: 16,
      gap: 10,
    },
    cardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
    name: { flex: 1, color: colors.text, fontSize: 16, fontWeight: '500', textAlign: 'auto' },
    equipmentTag: {
      paddingVertical: 4,
      paddingHorizontal: 9,
      borderRadius: radius.pill,
      borderWidth: 1,
      borderColor: colors.borderStrong,
    },
    equipmentText: { color: colors.textFaint, fontSize: 11 },

    muscleTags: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
    muscleTag: {
      paddingVertical: 3,
      paddingHorizontal: 8,
      borderRadius: 4,
      borderWidth: 1,
      borderColor: colors.border,
    },
    muscleTagPrimary: { borderColor: colors.accentBorder },
    muscleTagText: { color: colors.textFaint, fontSize: 11 },
    muscleTagPrimaryText: { color: colors.accent, fontSize: 11 },

    divider: { height: 1, backgroundColor: colors.borderSubtle, marginTop: 2 },
    progressRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    progressLabel: { color: colors.textFaint, fontSize: 11 },
    progressValues: { flexDirection: 'row', alignItems: 'baseline', gap: 6 },
    progressValue: {
      color: colors.text,
      fontSize: 20,
      fontWeight: '500',
      fontVariant: ['tabular-nums'],
    },
    progressDelta: { color: colors.accent, fontSize: 13, fontVariant: ['tabular-nums'] },
  });
