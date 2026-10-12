/**
 * The food log for one day: what was eaten, and how that stands against the day's targets.
 *
 * The nutrition screen has always said how much to eat. This is the other half — what was
 * eaten — and the two only mean something side by side, so the top of the screen is the
 * comparison: calories against the target as one big number and a bar, then protein,
 * carbohydrate and fat as three smaller ones. Under it, the day's entries.
 *
 * ## Days
 *
 * Today by default, with a step back to earlier days: people log last night's dinner the next
 * morning. Never forward past today; a food log is a record, not a plan.
 *
 * ## What the numbers are
 *
 * The targets are worked out, as everywhere else, from the profile and the latest weight —
 * nothing here stores them. Without a complete profile there are none, and the screen shows
 * what was eaten on its own and says where to fill the profile in.
 *
 * A total can have gaps: something logged by hand with calories only has no protein to add.
 * The protein figure is then a floor, and is marked as one.
 *
 * ## Meals worth keeping
 *
 * Most days repeat. Entries of the day can be kept together as a named meal, and a kept meal
 * is logged again with one tap — onto whichever day is open, as ordinary entries that can be
 * swiped away one at a time. Keeping is done here rather than on the screens that add food,
 * so that it works the same for something typed, picked from the list, scanned from a
 * barcode or photographed: by the time it is on the day, it is just an entry.
 *
 * ## Water
 *
 * Under the food, for the same day (`WaterCard`).
 */

import { router, useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, StyleSheet, View, type TextStyle, type ViewStyle } from 'react-native';
import { Pressable } from '../src/components/Pressable.js';
import { Text } from '../src/components/Text.js';
import {
  BookmarkSimple,
  CaretLeft,
  CaretRight,
  CheckCircle,
  CircleIcon,
  ForkKnife,
} from 'phosphor-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useCurrentUserId } from '../src/auth/CurrentUserProvider.js';
import { BrandButton } from '../src/components/BrandButton.js';
import { Field } from '../src/components/Field.js';
import { KeyboardSafe } from '../src/components/KeyboardSafe.js';
import { FadeSlideIn } from '../src/components/motion.js';
import { SwipeableRow } from '../src/components/SwipeableRow.js';
import { useFieldAboveKeyboard } from '../src/components/useFieldAboveKeyboard.js';
import {
  Button,
  Card,
  EmptyState,
  Hint,
  ScreenHeader,
  SectionTitle,
} from '../src/components/ui.js';
import { WaterCard } from '../src/components/WaterCard.js';
import { deleteFoodEntry, listFoodEntries, type FoodEntryRow } from '../src/db/food.js';
import {
  computeTargets,
  getLatestWeight,
  getProfile,
  type ComputedTargets,
} from '../src/db/metrics.js';
import { getExecutor, newId } from '../src/db/provider.js';
import {
  deleteSavedMeal,
  listSavedMeals,
  logSavedMeal,
  MAX_MEAL_NAME,
  mealCalories,
  saveMeal,
  type SavedMeal,
} from '../src/db/savedMeals.js';
import { localDate, parseLocalDate } from '../src/db/schedule.js';
import { progressTowards, sumDay } from '../src/food/foodMath.js';
import { hapticLight, hapticSuccess } from '../src/haptics.js';
import { isRtlLanguage, type Language } from '../src/i18n/index.js';
import { useTheme } from '../src/ThemeProvider.js';
import { fontSize, fontWeight, radius, shadow, spacing, type ColorPalette } from '../src/theme.js';

export default function FoodLogScreen() {
  const { t, i18n } = useTranslation();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const userId = useCurrentUserId();

  const today = localDate(new Date());
  const [date, setDate] = useState(today);
  const [entries, setEntries] = useState<FoodEntryRow[]>([]);
  const [targets, setTargets] = useState<ComputedTargets | null>(null);
  const [meals, setMeals] = useState<SavedMeal[]>([]);
  // Keeping a meal: which of the day's entries are in it, or null when nothing is being kept.
  const [picking, setPicking] = useState<ReadonlySet<string> | null>(null);
  const [mealName, setMealName] = useState('');
  const [busy, setBusy] = useState(false);
  // Two fields live low on this page: the name of a meal being kept, and an amount of water.
  const { scrollRef, onScroll } = useFieldAboveKeyboard();

  const load = useCallback(async () => {
    const db = await getExecutor();
    const [rows, profile, latest, kept] = await Promise.all([
      listFoodEntries(db, userId, date),
      getProfile(db, userId),
      getLatestWeight(db, userId),
      listSavedMeals(db, userId),
    ]);
    setEntries(rows);
    setMeals(kept);
    const computed = computeTargets(profile, latest?.weight_kg ?? null);
    setTargets(computed.ok ? computed.targets : null);
  }, [userId, date]);

  // On every return: coming back from adding something should show it added.
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const total = useMemo(() => sumDay(entries), [entries]);

  const step = (by: -1 | 1) => {
    const next = parseLocalDate(date);
    next.setDate(next.getDate() + by);
    const key = localDate(next);
    if (key > today) return;
    hapticLight();
    // A meal half-chosen from one day's entries means nothing on another day.
    setPicking(null);
    setDate(key);
  };

  const yesterday = useMemo(() => {
    const d = parseLocalDate(today);
    d.setDate(d.getDate() - 1);
    return localDate(d);
  }, [today]);
  const dayTitle =
    date === today
      ? t('food.today')
      : date === yesterday
        ? t('food.yesterday')
        : parseLocalDate(date).toLocaleDateString(i18n.language, {
            weekday: 'long',
            day: 'numeric',
            month: 'long',
          });

  // "Earlier" points where the past is, which is the other way in a right-to-left layout.
  const rtl = isRtlLanguage(i18n.language as Language);
  const Earlier = rtl ? CaretRight : CaretLeft;
  const Later = rtl ? CaretLeft : CaretRight;

  const remove = (entry: FoodEntryRow) => {
    void (async () => {
      await deleteFoodEntry(await getExecutor(), userId, entry.id);
      await load();
    })();
  };

  const left = targets ? targets.calorieTarget - total.calories : null;

  /** Log a kept meal onto the day that is open. */
  const logMeal = (meal: SavedMeal) => {
    if (busy) return;
    setBusy(true);
    void (async () => {
      try {
        await logSavedMeal(await getExecutor(), userId, newId, meal, date);
        hapticSuccess();
        await load();
      } finally {
        setBusy(false);
      }
    })();
  };

  const forgetMeal = (meal: SavedMeal) => {
    void (async () => {
      await deleteSavedMeal(await getExecutor(), userId, meal.id);
      await load();
    })();
  };

  const startKeeping = () => {
    hapticLight();
    // Everything on the day to begin with: the usual case is one meal logged, then kept.
    setPicking(new Set(entries.map((entry) => entry.id)));
    setMealName('');
  };

  const togglePicked = (id: string) => {
    hapticLight();
    setPicking((current) => {
      if (!current) return current;
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const picked = picking ? entries.filter((entry) => picking.has(entry.id)) : [];
  const canKeep = mealName.trim() !== '' && picked.length > 0 && !busy;

  const keepMeal = () => {
    if (!canKeep) return;
    setBusy(true);
    void (async () => {
      try {
        const id = await saveMeal(await getExecutor(), userId, newId, {
          name: mealName,
          items: picked.map((entry) => ({
            name: entry.name,
            foodKey: entry.food_key,
            grams: entry.grams,
            calories: entry.calories,
            proteinG: entry.protein_g,
            carbsG: entry.carbs_g,
            fatG: entry.fat_g,
          })),
        });
        if (id) {
          hapticSuccess();
          setPicking(null);
          await load();
        }
      } finally {
        setBusy(false);
      }
    })();
  };

  return (
    <KeyboardSafe>
      <ScrollView
        ref={scrollRef}
        onScroll={onScroll}
        scrollEventThrottle={16}
        style={styles.screen}
        contentContainerStyle={[
          styles.content,
          { paddingTop: spacing.lg, paddingBottom: insets.bottom + spacing.xxl },
        ]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <ScreenHeader title={t('food.title')} />

        <View style={styles.dayRow}>
          <Pressable
            onPress={() => step(-1)}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel={t('food.previousDay')}
            style={({ pressed }) => [styles.dayButton, pressed && styles.pressed]}
          >
            <Earlier size={18} color={colors.accent} weight="bold" />
          </Pressable>
          <Text style={styles.dayTitle}>{dayTitle}</Text>
          <Pressable
            onPress={() => step(1)}
            disabled={date === today}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel={t('food.nextDay')}
            style={({ pressed }) => [
              styles.dayButton,
              date === today && styles.dayButtonOff,
              pressed && styles.pressed,
            ]}
          >
            <Later size={18} color={colors.accent} weight="bold" />
          </Pressable>
        </View>

        <FadeSlideIn style={styles.summary}>
          <Text style={styles.calories}>
            {total.calories.toLocaleString()}
            {targets ? (
              <Text style={styles.caloriesOf}> / {targets.calorieTarget.toLocaleString()}</Text>
            ) : null}
            <Text style={styles.caloriesUnit}> {t('common.kcal')}</Text>
          </Text>
          {targets ? (
            <>
              <View style={styles.track}>
                <View
                  style={[
                    styles.fill,
                    left !== null && left < 0 && styles.fillOver,
                    { width: `${progressTowards(total.calories, targets.calorieTarget) * 100}%` },
                  ]}
                />
              </View>
              <Text style={[styles.left, left !== null && left < 0 && styles.leftOver]}>
                {left !== null && left >= 0
                  ? t('food.left', { count: left })
                  : t('food.over', { count: Math.abs(left ?? 0) })}
              </Text>
            </>
          ) : (
            <Text style={styles.left}>{t('food.noTargets')}</Text>
          )}

          <View style={styles.macros}>
            <Macro
              label={t('targets.protein')}
              eaten={total.proteinG}
              target={targets?.proteinG ?? null}
              color={colors.protein}
              floor={total.partial}
            />
            <Macro
              label={t('targets.carbs')}
              eaten={total.carbsG}
              target={targets?.carbsG ?? null}
              color={colors.carbs}
              floor={total.partial}
            />
            <Macro
              label={t('targets.fat')}
              eaten={total.fatG}
              target={targets?.fatG ?? null}
              color={colors.fat}
              floor={total.partial}
            />
          </View>
          {total.partial ? <Text style={styles.partial}>{t('food.partial')}</Text> : null}
        </FadeSlideIn>

        <View style={styles.actions}>
          <BrandButton
            label={t('food.add')}
            onPress={() => router.push({ pathname: '/food-add', params: { date } })}
          />
          {/* The quicker way in for a whole plate: a photograph, and an estimate to correct. */}
          <Button
            label={t('food.scan')}
            variant="secondary"
            onPress={() => router.push({ pathname: '/food-scan', params: { date } })}
          />
          {/* For anything in a packet: the label itself, read from the barcode. */}
          <Button
            label={t('food.barcode')}
            variant="secondary"
            onPress={() => router.push({ pathname: '/food-barcode', params: { date } })}
          />
        </View>

        {meals.length > 0 && !picking ? (
          <View style={styles.list}>
            <SectionTitle>{t('food.meals')}</SectionTitle>
            {meals.map((meal) => (
              <SwipeableRow key={meal.id} onDelete={() => forgetMeal(meal)}>
                <Pressable
                  onPress={() => logMeal(meal)}
                  disabled={busy}
                  accessibilityRole="button"
                  accessibilityLabel={t('food.mealLogLabel', { name: meal.name })}
                  style={({ pressed }) => [styles.entry, pressed && styles.pressed]}
                >
                  <BookmarkSimple size={20} color={colors.accent} weight="fill" />
                  <View style={styles.entryText}>
                    <Text style={styles.entryName} numberOfLines={1}>
                      {meal.name}
                    </Text>
                    <Text style={styles.entryMeta} numberOfLines={1}>
                      {meal.items.map((item) => item.name).join(' · ')}
                    </Text>
                  </View>
                  <Text style={styles.entryCalories}>
                    {mealCalories(meal.items).toLocaleString()}
                    <Text style={styles.entryUnit}> {t('common.kcal')}</Text>
                  </Text>
                </Pressable>
              </SwipeableRow>
            ))}
            <Hint>{t('food.mealsHint')}</Hint>
          </View>
        ) : null}

        {picking ? (
          <Card tone="accent">
            <SectionTitle>{t('food.keepTitle')}</SectionTitle>
            <View style={styles.keep}>
              <Field
                value={mealName}
                onChangeText={setMealName}
                placeholder={t('food.keepNamePlaceholder')}
                maxLength={MAX_MEAL_NAME}
                autoFocus
              />
              <Text style={styles.entryMeta}>{t('food.keepHint')}</Text>
              <BrandButton
                label={t('food.keepSave')}
                disabled={!canKeep}
                busy={busy}
                onPress={keepMeal}
              />
              <Button label={t('common.cancel')} variant="ghost" onPress={() => setPicking(null)} />
            </View>
          </Card>
        ) : null}

        {entries.length === 0 ? (
          <EmptyState icon={ForkKnife} title={t('food.empty')} hint={t('food.emptyHint')} />
        ) : picking ? (
          <View style={styles.list}>
            {entries.map((entry) => {
              const on = picking.has(entry.id);
              const Mark = on ? CheckCircle : CircleIcon;
              return (
                <Pressable
                  key={entry.id}
                  onPress={() => togglePicked(entry.id)}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: on }}
                  style={({ pressed }) => [styles.entry, pressed && styles.pressed]}
                >
                  <Mark
                    size={22}
                    color={on ? colors.accent : colors.textFaint}
                    weight={on ? 'fill' : 'regular'}
                  />
                  <View style={styles.entryText}>
                    <Text style={styles.entryName} numberOfLines={2}>
                      {entry.name}
                    </Text>
                  </View>
                  <Text style={styles.entryCalories}>
                    {Math.round(entry.calories).toLocaleString()}
                    <Text style={styles.entryUnit}> {t('common.kcal')}</Text>
                  </Text>
                </Pressable>
              );
            })}
          </View>
        ) : (
          <View style={styles.list}>
            {entries.map((entry) => (
              <SwipeableRow key={entry.id} onDelete={() => remove(entry)}>
                <View style={styles.entry}>
                  <View style={styles.entryText}>
                    <Text style={styles.entryName} numberOfLines={2}>
                      {entry.name}
                    </Text>
                    <Text style={styles.entryMeta}>
                      {[
                        entry.grams !== null
                          ? `${Math.round(entry.grams)} ${t('common.grams')}`
                          : null,
                        entry.protein_g !== null
                          ? `${entry.protein_g} ${t('common.grams')} ${t('targets.protein')}`
                          : null,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </Text>
                  </View>
                  <Text style={styles.entryCalories}>
                    {Math.round(entry.calories).toLocaleString()}
                    <Text style={styles.entryUnit}> {t('common.kcal')}</Text>
                  </Text>
                </View>
              </SwipeableRow>
            ))}
            {/* Under the entries it would keep, and out of the way while one is being kept. */}
            <Button label={t('food.keep')} variant="ghost" onPress={startKeeping} />
          </View>
        )}

        <WaterCard date={date} />

        <Hint>{t('food.approximate')}</Hint>
      </ScrollView>
    </KeyboardSafe>
  );
}

/** One macro: its name, grams eaten against the target, and a bar. */
function Macro({
  label,
  eaten,
  target,
  color,
  floor,
}: {
  label: string;
  eaten: number;
  target: number | null;
  color: string;
  /** The figure may be low: something that day was logged without it. */
  floor: boolean;
}) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  return (
    <View style={styles.macro}>
      <Text style={styles.macroLabel}>{label}</Text>
      <Text style={styles.macroValue}>
        {floor ? '≥ ' : ''}
        {Math.round(eaten)}
        {target !== null ? <Text style={styles.macroOf}> / {target}</Text> : null}
        <Text style={styles.macroOf}> {t('common.grams')}</Text>
      </Text>
      <View style={styles.macroTrack}>
        <View
          style={[
            styles.macroFill,
            { backgroundColor: color, width: `${progressTowards(eaten, target) * 100}%` },
          ]}
        />
      </View>
    </View>
  );
}

const createStyles = (colors: ColorPalette) =>
  StyleSheet.create<{
    screen: ViewStyle;
    content: ViewStyle;
    dayRow: ViewStyle;
    dayButton: ViewStyle;
    dayButtonOff: ViewStyle;
    dayTitle: TextStyle;
    pressed: ViewStyle;
    summary: ViewStyle;
    calories: TextStyle;
    caloriesOf: TextStyle;
    caloriesUnit: TextStyle;
    track: ViewStyle;
    fill: ViewStyle;
    fillOver: ViewStyle;
    left: TextStyle;
    leftOver: TextStyle;
    macros: ViewStyle;
    macro: ViewStyle;
    macroLabel: TextStyle;
    macroValue: TextStyle;
    macroOf: TextStyle;
    macroTrack: ViewStyle;
    macroFill: ViewStyle;
    partial: TextStyle;
    actions: ViewStyle;
    list: ViewStyle;
    entry: ViewStyle;
    entryText: ViewStyle;
    entryName: TextStyle;
    entryMeta: TextStyle;
    entryCalories: TextStyle;
    entryUnit: TextStyle;
    keep: ViewStyle;
  }>({
    screen: { flex: 1 },
    content: { paddingHorizontal: spacing.lg, gap: spacing.lg },

    dayRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    dayButton: {
      width: 40,
      height: 40,
      borderRadius: radius.pill,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.surfaceRaised,
    },
    dayButtonOff: { opacity: 0.3 },
    dayTitle: { color: colors.text, fontSize: fontSize.lg, fontWeight: fontWeight.bold },
    pressed: { opacity: 0.6 },

    summary: {
      backgroundColor: colors.surface,
      borderRadius: radius.xl,
      padding: spacing.lg,
      gap: spacing.sm,
      ...shadow(colors.shadow).card,
    },
    calories: {
      color: colors.text,
      fontSize: 38,
      fontWeight: fontWeight.bold,
      fontVariant: ['tabular-nums'],
      textAlign: 'auto',
    },
    caloriesOf: { color: colors.textMuted, fontSize: fontSize.xl, fontWeight: fontWeight.medium },
    caloriesUnit: { color: colors.textMuted, fontSize: fontSize.md, fontWeight: fontWeight.medium },
    track: {
      height: 10,
      borderRadius: radius.pill,
      backgroundColor: colors.surfaceHigh,
      overflow: 'hidden',
    },
    fill: { height: '100%', borderRadius: radius.pill, backgroundColor: colors.accent },
    fillOver: { backgroundColor: colors.warning },
    left: { color: colors.textMuted, fontSize: fontSize.sm, textAlign: 'auto' },
    leftOver: { color: colors.warning },

    macros: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.sm },
    macro: { flex: 1, gap: spacing.xxs },
    macroLabel: { color: colors.textMuted, fontSize: fontSize.xs, textAlign: 'auto' },
    macroValue: {
      color: colors.text,
      fontSize: fontSize.md,
      fontWeight: fontWeight.bold,
      fontVariant: ['tabular-nums'],
      textAlign: 'auto',
    },
    macroOf: { color: colors.textMuted, fontSize: fontSize.xs, fontWeight: fontWeight.medium },
    macroTrack: {
      height: 6,
      borderRadius: radius.pill,
      backgroundColor: colors.surfaceHigh,
      overflow: 'hidden',
    },
    macroFill: { height: '100%', borderRadius: radius.pill },
    partial: { color: colors.textFaint, fontSize: fontSize.xs, textAlign: 'auto' },

    actions: { gap: spacing.sm },
    list: { gap: spacing.sm },
    entry: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      padding: spacing.md,
      borderRadius: radius.lg,
      backgroundColor: colors.surface,
    },
    entryText: { flex: 1, gap: spacing.xxs },
    entryName: {
      color: colors.text,
      fontSize: fontSize.md,
      fontWeight: fontWeight.medium,
      textAlign: 'auto',
    },
    entryMeta: { color: colors.textMuted, fontSize: fontSize.xs, textAlign: 'auto' },
    entryCalories: {
      color: colors.text,
      fontSize: fontSize.md,
      fontWeight: fontWeight.bold,
      fontVariant: ['tabular-nums'],
    },
    entryUnit: { color: colors.textMuted, fontSize: fontSize.xs, fontWeight: fontWeight.medium },
    keep: { gap: spacing.md },
  });
