/**
 * Adding something to the food log.
 *
 * Three ways in, in the order of how little they ask of the person:
 *
 *  1. **Again.** The things they have logged before, at the top. One tap logs the same thing —
 *     most people eat the same breakfast most days, and asking for it to be found and measured
 *     again each morning is how a food log gets abandoned in its second week.
 *  2. **From the list.** A search over the built-in foods (`food/foods.ts`). Picking one asks
 *     only how much: a number of grams, or the food's own unit — eggs, slices, spoonfuls —
 *     where it has one. The calories and protein that amount comes to are shown as it is typed.
 *  3. **By hand.** A name and the numbers, for whatever is not on the list or comes with a
 *     label of its own. Only the calories are required.
 *
 * Every one of them writes the same kind of row and goes back to the day it was opened from.
 */

import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { MagnifyingGlass } from 'phosphor-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useCurrentUserId } from '../src/auth/CurrentUserProvider.js';
import { BrandButton } from '../src/components/BrandButton.js';
import { Field } from '../src/components/Field.js';
import { KeyboardSafe } from '../src/components/KeyboardSafe.js';
import { Button, Card, ScreenHeader, SectionTitle } from '../src/components/ui.js';
import {
  addFoodEntry,
  listRecentFoods,
  type FoodEntryInput,
  type FoodEntryRow,
} from '../src/db/food.js';
import { getExecutor, newId } from '../src/db/provider.js';
import { localDate } from '../src/db/schedule.js';
import {
  macrosFor,
  MAX_CALORIES,
  parseAmount,
  parseOptional,
  searchFoods,
} from '../src/food/foodMath.js';
import type { FoodSeed } from '../src/food/foods.js';
import { hapticLight, hapticSuccess } from '../src/haptics.js';
import { useTheme } from '../src/ThemeProvider.js';
import { fontSize, fontWeight, radius, spacing, type ColorPalette } from '../src/theme.js';

/** How many of the list are drawn before a search narrows it. The rest are a few letters away. */
const UNSEARCHED_LIMIT = 30;

export default function FoodAddScreen() {
  const { t, i18n } = useTranslation();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const userId = useCurrentUserId();
  const params = useLocalSearchParams<{ date?: string }>();
  const date = /^\d{4}-\d{2}-\d{2}$/.test(params.date ?? '') ? params.date! : localDate(new Date());
  const isHebrew = i18n.language === 'he';

  const [query, setQuery] = useState('');
  const [recent, setRecent] = useState<FoodEntryRow[]>([]);
  const [picked, setPicked] = useState<FoodSeed | null>(null);
  const [gramsRaw, setGramsRaw] = useState('');
  const [byHand, setByHand] = useState(false);
  const [name, setName] = useState('');
  const [caloriesRaw, setCaloriesRaw] = useState('');
  const [proteinRaw, setProteinRaw] = useState('');
  const [carbsRaw, setCarbsRaw] = useState('');
  const [fatRaw, setFatRaw] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const rows = await listRecentFoods(await getExecutor(), userId, 8);
      if (!cancelled) setRecent(rows);
    })();
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const matches = useMemo(() => {
    const found = searchFoods(query);
    return query.trim() === '' ? found.slice(0, UNSEARCHED_LIMIT) : found;
  }, [query]);

  const log = (entry: Omit<FoodEntryInput, 'eatenOn'>) => {
    if (saving) return;
    setSaving(true);
    void (async () => {
      const id = await addFoodEntry(await getExecutor(), userId, newId, {
        ...entry,
        eatenOn: date,
      });
      if (id) {
        hapticSuccess();
        router.back();
      } else {
        setSaving(false);
      }
    })();
  };

  const pick = (food: FoodSeed) => {
    hapticLight();
    setPicked(food);
    setByHand(false);
    setGramsRaw(String(food.serving?.grams ?? 100));
  };

  const grams = parseAmount(gramsRaw);
  const preview = picked && grams !== null ? macrosFor(picked, grams) : null;

  const calories = parseAmount(caloriesRaw, MAX_CALORIES);
  const protein = parseOptional(proteinRaw, 2000);
  const carbs = parseOptional(carbsRaw, 2000);
  const fat = parseOptional(fatRaw, 2000);
  const handReady =
    name.trim() !== '' &&
    calories !== null &&
    protein !== undefined &&
    carbs !== undefined &&
    fat !== undefined;

  const foodName = (food: FoodSeed) => (isHebrew ? food.he : food.en);

  return (
    <KeyboardSafe>
      <ScrollView
        style={styles.screen}
        contentContainerStyle={[
          styles.content,
          { paddingTop: spacing.lg, paddingBottom: insets.bottom + spacing.xxl },
        ]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <ScreenHeader title={t('food.addTitle')} />

        {/* How much of the food that was picked. Above the search, so it is not under the
            keyboard that the search just raised. */}
        {picked ? (
          <Card tone="accent">
            <SectionTitle>{foodName(picked)}</SectionTitle>
            {picked.serving ? (
              <View style={styles.servings}>
                {[1, 2, 3].map((count) => {
                  const amount = String(picked.serving!.grams * count);
                  const on = gramsRaw === amount;
                  return (
                    <Pressable
                      key={count}
                      onPress={() => {
                        hapticLight();
                        setGramsRaw(amount);
                      }}
                      accessibilityRole="button"
                      accessibilityState={{ selected: on }}
                      style={[styles.serving, on && styles.servingOn]}
                    >
                      <Text style={[styles.servingText, on && styles.servingTextOn]}>
                        {count} × {isHebrew ? picked.serving!.he : picked.serving!.en}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            ) : null}
            <Field
              value={gramsRaw}
              onChangeText={setGramsRaw}
              keyboardType="decimal-pad"
              placeholder={t('food.gramsPlaceholder')}
              trailing={<Text style={styles.unit}>{t('common.grams')}</Text>}
              selectTextOnFocus
            />
            <Text style={styles.preview}>
              {preview
                ? t('food.preview', { calories: preview.calories, protein: preview.proteinG })
                : t('food.enterAmount')}
            </Text>
            <BrandButton
              label={t('food.addThis')}
              disabled={!preview}
              busy={saving}
              onPress={() =>
                preview &&
                grams !== null &&
                log({
                  name: foodName(picked),
                  foodKey: picked.key,
                  grams,
                  calories: preview.calories,
                  proteinG: preview.proteinG,
                  carbsG: preview.carbsG,
                  fatG: preview.fatG,
                })
              }
            />
          </Card>
        ) : null}

        <Field
          icon={MagnifyingGlass}
          value={query}
          onChangeText={setQuery}
          placeholder={t('food.searchPlaceholder')}
          returnKeyType="search"
          autoCorrect={false}
        />

        {query.trim() === '' && recent.length > 0 ? (
          <Card>
            <SectionTitle>{t('food.recent')}</SectionTitle>
            {recent.map((entry) => (
              <Pressable
                key={entry.id}
                onPress={() =>
                  log({
                    name: entry.name,
                    foodKey: entry.food_key,
                    grams: entry.grams,
                    calories: entry.calories,
                    proteinG: entry.protein_g,
                    carbsG: entry.carbs_g,
                    fatG: entry.fat_g,
                  })
                }
                disabled={saving}
                accessibilityRole="button"
                style={({ pressed }) => [styles.row, pressed && styles.pressed]}
              >
                <View style={styles.rowText}>
                  <Text style={styles.rowName} numberOfLines={1}>
                    {entry.name}
                  </Text>
                  {entry.grams !== null ? (
                    <Text style={styles.rowMeta}>
                      {Math.round(entry.grams)} {t('common.grams')}
                    </Text>
                  ) : null}
                </View>
                <Text style={styles.rowCalories}>
                  {Math.round(entry.calories)} {t('common.kcal')}
                </Text>
              </Pressable>
            ))}
          </Card>
        ) : null}

        <Card>
          <SectionTitle>{t('food.list')}</SectionTitle>
          {matches.length === 0 ? <Text style={styles.none}>{t('food.noMatch')}</Text> : null}
          {matches.map((food) => (
            <Pressable
              key={food.key}
              onPress={() => pick(food)}
              accessibilityRole="button"
              style={({ pressed }) => [
                styles.row,
                picked?.key === food.key && styles.rowPicked,
                pressed && styles.pressed,
              ]}
            >
              <View style={styles.rowText}>
                <Text style={styles.rowName} numberOfLines={1}>
                  {foodName(food)}
                </Text>
              </View>
              <Text style={styles.rowCalories}>
                {food.kcal} {t('food.per100')}
              </Text>
            </Pressable>
          ))}
        </Card>

        {byHand ? (
          <Card>
            <SectionTitle>{t('food.byHand')}</SectionTitle>
            <View style={styles.hand}>
              <Field value={name} onChangeText={setName} placeholder={t('food.namePlaceholder')} />
              <Field
                value={caloriesRaw}
                onChangeText={setCaloriesRaw}
                keyboardType="decimal-pad"
                placeholder={t('food.caloriesPlaceholder')}
                trailing={<Text style={styles.unit}>{t('common.kcal')}</Text>}
              />
              <View style={styles.macroFields}>
                <View style={styles.macroField}>
                  <Field
                    value={proteinRaw}
                    onChangeText={setProteinRaw}
                    keyboardType="decimal-pad"
                    placeholder={t('targets.protein')}
                  />
                </View>
                <View style={styles.macroField}>
                  <Field
                    value={carbsRaw}
                    onChangeText={setCarbsRaw}
                    keyboardType="decimal-pad"
                    placeholder={t('targets.carbs')}
                  />
                </View>
                <View style={styles.macroField}>
                  <Field
                    value={fatRaw}
                    onChangeText={setFatRaw}
                    keyboardType="decimal-pad"
                    placeholder={t('targets.fat')}
                  />
                </View>
              </View>
              <Text style={styles.none}>{t('food.byHandHint')}</Text>
              <BrandButton
                label={t('food.addThis')}
                disabled={!handReady}
                busy={saving}
                onPress={() =>
                  handReady &&
                  calories !== null &&
                  log({ name, calories, proteinG: protein, carbsG: carbs, fatG: fat })
                }
              />
            </View>
          </Card>
        ) : (
          <Button
            label={t('food.byHand')}
            variant="secondary"
            onPress={() => {
              setByHand(true);
              setPicked(null);
              // What was searched for is very likely what it is called.
              if (name === '') setName(query.trim());
            }}
          />
        )}
      </ScrollView>
    </KeyboardSafe>
  );
}

const createStyles = (colors: ColorPalette) =>
  StyleSheet.create<{
    screen: ViewStyle;
    content: ViewStyle;
    servings: ViewStyle;
    serving: ViewStyle;
    servingOn: ViewStyle;
    servingText: TextStyle;
    servingTextOn: TextStyle;
    unit: TextStyle;
    preview: TextStyle;
    row: ViewStyle;
    rowPicked: ViewStyle;
    rowText: ViewStyle;
    rowName: TextStyle;
    rowMeta: TextStyle;
    rowCalories: TextStyle;
    pressed: ViewStyle;
    none: TextStyle;
    hand: ViewStyle;
    macroFields: ViewStyle;
    macroField: ViewStyle;
  }>({
    screen: { flex: 1 },
    content: { paddingHorizontal: spacing.lg, gap: spacing.lg },

    servings: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.md },
    serving: {
      paddingVertical: spacing.sm,
      paddingHorizontal: spacing.md,
      borderRadius: radius.pill,
      backgroundColor: colors.surfaceRaised,
    },
    servingOn: { backgroundColor: colors.accent },
    servingText: {
      color: colors.textSecondary,
      fontSize: fontSize.sm,
      fontWeight: fontWeight.medium,
    },
    servingTextOn: { color: colors.bg, fontWeight: fontWeight.bold },
    unit: { color: colors.textMuted, fontSize: fontSize.sm },
    preview: {
      color: colors.text,
      fontSize: fontSize.md,
      fontWeight: fontWeight.bold,
      textAlign: 'auto',
      marginVertical: spacing.md,
    },

    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      minHeight: 48,
      paddingVertical: spacing.sm,
      paddingHorizontal: spacing.sm,
      borderRadius: radius.md,
    },
    rowPicked: { backgroundColor: colors.accentSoft },
    rowText: { flex: 1, gap: spacing.xxs },
    rowName: { color: colors.text, fontSize: fontSize.md, textAlign: 'auto' },
    rowMeta: { color: colors.textMuted, fontSize: fontSize.xs, textAlign: 'auto' },
    rowCalories: { color: colors.textMuted, fontSize: fontSize.sm, fontVariant: ['tabular-nums'] },
    pressed: { opacity: 0.6 },
    none: { color: colors.textMuted, fontSize: fontSize.sm, textAlign: 'auto' },

    hand: { gap: spacing.md },
    macroFields: { flexDirection: 'row', gap: spacing.sm },
    macroField: { flex: 1 },
  });
