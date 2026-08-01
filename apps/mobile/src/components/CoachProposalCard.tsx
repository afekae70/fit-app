/**
 * Cards rendered inline in the coach chat when the model proposes a structured plan or menu
 * (see `apps/api/src/ai/claude-provider.ts` and `packages/shared/src/schemas/aiPlan.ts`).
 *
 * Neither card writes anything on its own. `WorkoutPlanCard`'s Apply button is the only path
 * that touches `plans`/`plan_days`/`plan_day_exercises` — wired by the caller in
 * `app/(tabs)/coach.tsx` — matching the rest of the app's rule that AI output is held for review,
 * never materialised silently. `NutritionMenuCard` has no apply action at all: a menu is a
 * suggestion read against targets already computed elsewhere, not a table of its own.
 */

import { EXERCISE_SEED, type ExerciseSeed } from '@fit/shared/catalog';
import type { AiNutritionMenu, AiWorkoutPlan } from '@fit/shared/schemas';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, View, type TextStyle, type ViewStyle } from 'react-native';

import { hapticMedium } from '../haptics.js';
import { useTheme } from '../ThemeProvider.js';
import { fontSize, fontWeight, lineHeight, spacing, type ColorPalette } from '../theme.js';
import { Banner, Button, Card, Divider } from './ui.js';

const EXERCISE_BY_KEY = new Map<string, ExerciseSeed>(
  EXERCISE_SEED.map((exercise) => [exercise.nameEn, exercise]),
);

export function WorkoutPlanCard({
  plan,
  applied,
  applying,
  onApply,
}: {
  plan: AiWorkoutPlan;
  applied: boolean;
  applying: boolean;
  onApply: () => void;
}) {
  const { t, i18n } = useTranslation();
  const isHebrew = i18n.language === 'he';
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  return (
    <Card tone="accent" style={styles.card}>
      <Text style={styles.title}>{plan.planName}</Text>
      <Text style={styles.rationale}>{plan.rationale}</Text>

      {plan.days.map((day, dayIndex) => (
        <View key={`${day.name}-${dayIndex}`} style={styles.section}>
          <Text style={styles.sectionName}>{day.name}</Text>
          {day.exercises.map((exercise, exerciseIndex) => {
            const seed = EXERCISE_BY_KEY.get(exercise.exerciseKey);
            const label = seed ? (isHebrew ? seed.nameHe : seed.nameEn) : exercise.exerciseKey;
            return (
              <View key={`${exercise.exerciseKey}-${exerciseIndex}`} style={styles.row}>
                <Text style={styles.rowName} numberOfLines={2}>
                  {label}
                </Text>
                <Text style={styles.rowTargets}>
                  {exercise.targetSets}×{exercise.targetRepsMin}-{exercise.targetRepsMax}
                </Text>
              </View>
            );
          })}
        </View>
      ))}

      <Divider />

      {applied ? (
        <Banner tone="success">{t('coach.planApplied')}</Banner>
      ) : (
        <Button
          label={applying ? t('coach.planApplying') : t('coach.planApply')}
          onPress={() => {
            hapticMedium();
            onApply();
          }}
          variant="primary"
        />
      )}
    </Card>
  );
}

export function NutritionMenuCard({ menu }: { menu: AiNutritionMenu }) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  return (
    <Card style={styles.card}>
      <Text style={styles.rationale}>{menu.summary}</Text>

      {menu.meals.map((meal, mealIndex) => (
        <View key={`${meal.name}-${mealIndex}`} style={styles.section}>
          <Text style={styles.sectionName}>{meal.name}</Text>
          {meal.items.map((item, itemIndex) => (
            <View key={`${item.name}-${itemIndex}`} style={styles.row}>
              <Text style={styles.rowName} numberOfLines={2}>
                {item.name}
                {item.grams !== null ? ` — ${item.grams}g` : ''}
              </Text>
              <Text style={styles.rowTargets}>{item.kcal} kcal</Text>
            </View>
          ))}
        </View>
      ))}

      <Divider />

      <Text style={styles.totals}>
        {t('coach.nutritionTotals')}: {menu.totalKcal} kcal · P {menu.totalProteinG}g · C{' '}
        {menu.totalCarbsG}g · F {menu.totalFatG}g
      </Text>
    </Card>
  );
}

const createStyles = (colors: ColorPalette) =>
  StyleSheet.create<{
    card: ViewStyle;
    title: TextStyle;
    rationale: TextStyle;
    section: ViewStyle;
    sectionName: TextStyle;
    row: ViewStyle;
    rowName: TextStyle;
    rowTargets: TextStyle;
    totals: TextStyle;
  }>({
  card: { maxWidth: '100%', marginBottom: 0 },
  title: {
    color: colors.text,
    fontSize: fontSize.md,
    fontWeight: fontWeight.bold,
    marginBottom: spacing.xs,
    textAlign: 'auto',
  },
  rationale: {
    color: colors.textSecondary,
    fontSize: fontSize.sm,
    lineHeight: lineHeight.tight,
    marginBottom: spacing.sm,
    textAlign: 'auto',
  },
  section: { marginTop: spacing.sm },
  sectionName: {
    color: colors.textMuted,
    fontSize: fontSize.xs,
    fontWeight: fontWeight.bold,
    textTransform: 'uppercase',
    marginBottom: spacing.xxs,
    textAlign: 'auto',
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.xxs,
    gap: spacing.sm,
  },
  rowName: { flex: 1, color: colors.text, fontSize: fontSize.sm, textAlign: 'auto' },
  rowTargets: { color: colors.textMuted, fontSize: fontSize.xs, fontWeight: fontWeight.medium },
  totals: {
    color: colors.textSecondary,
    fontSize: fontSize.xs,
    fontWeight: fontWeight.medium,
    textAlign: 'auto',
  },
  });
