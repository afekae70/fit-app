/**
 * Today's food so far, in one line, and the way into the log.
 *
 * It sits on the nutrition screen, directly above the targets it is measured against: the
 * screen has always said what to eat, and this is where what was eaten shows up beside it.
 *
 * Loads for itself whenever the screen it is on comes into view, so the screen that hosts it
 * needs to know nothing about the food log — and so that coming back from logging lunch shows
 * lunch.
 */

import { router, useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View, type TextStyle, type ViewStyle } from 'react-native';
import { CaretLeft, CaretRight, ForkKnife } from 'phosphor-react-native';

import { listFoodEntries } from '../db/food.js';
import { computeTargets, getLatestWeight, getProfile } from '../db/metrics.js';
import { getExecutor } from '../db/provider.js';
import { localDate } from '../db/schedule.js';
import { progressTowards, sumDay } from '../food/foodMath.js';
import { isRtlLanguage, type Language } from '../i18n/index.js';
import { useTheme } from '../ThemeProvider.js';
import { fontSize, fontWeight, radius, shadow, spacing, type ColorPalette } from '../theme.js';

export function FoodTodayCard({ userId }: { userId: string }) {
  const { t, i18n } = useTranslation();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [eaten, setEaten] = useState(0);
  const [target, setTarget] = useState<number | null>(null);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      void (async () => {
        const db = await getExecutor();
        const [entries, profile, latest] = await Promise.all([
          listFoodEntries(db, userId, localDate(new Date())),
          getProfile(db, userId),
          getLatestWeight(db, userId),
        ]);
        if (cancelled) return;
        setEaten(sumDay(entries).calories);
        const computed = computeTargets(profile, latest?.weight_kg ?? null);
        setTarget(computed.ok ? computed.targets.calorieTarget : null);
      })();
      return () => {
        cancelled = true;
      };
    }, [userId]),
  );

  // Points where the row leads, which is the other way in a right-to-left layout.
  const Onward = isRtlLanguage(i18n.language as Language) ? CaretLeft : CaretRight;

  return (
    <Pressable
      onPress={() => router.push('/food')}
      accessibilityRole="button"
      accessibilityLabel={t('food.openLog')}
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}
    >
      <View style={styles.icon}>
        <ForkKnife size={22} color={colors.accent} />
      </View>
      <View style={styles.text}>
        <Text style={styles.caption}>{t('food.todaySoFar')}</Text>
        <Text style={styles.value}>
          {eaten.toLocaleString()}
          {target !== null ? <Text style={styles.of}> / {target.toLocaleString()}</Text> : null}
          <Text style={styles.of}> {t('common.kcal')}</Text>
        </Text>
        {target !== null ? (
          <View style={styles.track}>
            <View style={[styles.fill, { width: `${progressTowards(eaten, target) * 100}%` }]} />
          </View>
        ) : null}
      </View>
      <Onward size={18} color={colors.textFaint} />
    </Pressable>
  );
}

const createStyles = (colors: ColorPalette) =>
  StyleSheet.create<{
    card: ViewStyle;
    pressed: ViewStyle;
    icon: ViewStyle;
    text: ViewStyle;
    caption: TextStyle;
    value: TextStyle;
    of: TextStyle;
    track: ViewStyle;
    fill: ViewStyle;
  }>({
    card: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      padding: spacing.lg,
      borderRadius: radius.xl,
      backgroundColor: colors.surface,
      ...shadow(colors.shadow).card,
    },
    pressed: { opacity: 0.7 },
    icon: {
      width: 44,
      height: 44,
      borderRadius: radius.md,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.accentSoft,
    },
    text: { flex: 1, gap: spacing.xxs },
    caption: { color: colors.textMuted, fontSize: fontSize.xs, textAlign: 'auto' },
    value: {
      color: colors.text,
      fontSize: fontSize.lg,
      fontWeight: fontWeight.bold,
      fontVariant: ['tabular-nums'],
      textAlign: 'auto',
    },
    of: { color: colors.textMuted, fontSize: fontSize.sm, fontWeight: fontWeight.medium },
    track: {
      height: 6,
      borderRadius: radius.pill,
      backgroundColor: colors.surfaceHigh,
      overflow: 'hidden',
      marginTop: spacing.xxs,
    },
    fill: { height: '100%', borderRadius: radius.pill, backgroundColor: colors.accent },
  });
