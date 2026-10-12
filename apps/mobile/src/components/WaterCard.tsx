/**
 * Water for one day: how much against an aim, and two buttons to add to it.
 *
 * Deliberately the smallest thing that works. Drinking is logged many times a day, usually
 * with the other hand holding the glass, so adding is one tap on a large target — a glass or
 * a bottle — and there is no sheet, no number to type and nothing to confirm. The price of
 * one-tap adding is adding by mistake, so the last one can be taken back from the same card.
 *
 * It loads and saves for itself, given a day. The food screen shows it for whichever day is
 * open; the home screen shows it for today. Neither has to know what water is.
 *
 * The aim is a rule of thumb from body weight (`food/water.ts`) and is labelled as one.
 */

import { useFocusEffect } from 'expo-router';
import { ArrowCounterClockwise, Drop } from 'phosphor-react-native';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Animated, Easing, StyleSheet, View } from 'react-native';

import { useCurrentUserId } from '../auth/CurrentUserProvider.js';
import { getLatestWeight } from '../db/metrics.js';
import { getExecutor, newId } from '../db/provider.js';
import { addWater, getWaterTotal, undoLastWater } from '../db/water.js';
import { BOTTLE_ML, GLASS_ML, litres, waterGoalMl } from '../food/water.js';
import { hapticLight, hapticSuccess } from '../haptics.js';
import { useTheme } from '../ThemeProvider.js';
import { fontSize, fontWeight, radius, shadow, spacing, type ColorPalette } from '../theme.js';
import { useReduceMotion } from './motion.js';
import { Pressable } from './Pressable.js';
import { Text } from './Text.js';

export function WaterCard({ date }: { date: string }) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const userId = useCurrentUserId();
  const reduceMotion = useReduceMotion();

  const [total, setTotal] = useState(0);
  const [goal, setGoal] = useState(() => waterGoalMl(null));

  const load = useCallback(async () => {
    const db = await getExecutor();
    const [drunk, latest] = await Promise.all([
      getWaterTotal(db, userId, date),
      getLatestWeight(db, userId),
    ]);
    setTotal(drunk);
    setGoal(waterGoalMl(latest?.weight_kg ?? null));
  }, [userId, date]);

  // On every return to the screen, and whenever the day shown changes.
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const share = Math.max(0, Math.min(1, total / goal));
  const reached = total >= goal;

  // The bar's width is a layout property, so it is JS-driven, and it is the only animated
  // value on its node — nothing native-driven shares it (see CLAUDE.md on mixing drivers).
  const fill = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (reduceMotion) {
      fill.setValue(share);
      return;
    }
    Animated.timing(fill, {
      toValue: share,
      duration: 320,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start();
  }, [fill, share, reduceMotion]);

  const add = (ml: number) => {
    const before = total;
    // Shown at once: the tap should feel like it did something before the database answers.
    setTotal(before + ml);
    if (before < goal && before + ml >= goal) hapticSuccess();
    else hapticLight();
    void (async () => {
      const id = await addWater(await getExecutor(), userId, newId, { drunkOn: date, ml });
      // Whatever was shown, the database is what is true.
      if (!id) setTotal(before);
      else await load();
    })();
  };

  const undo = () => {
    hapticLight();
    void (async () => {
      await undoLastWater(await getExecutor(), userId, date);
      await load();
    })();
  };

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <View style={styles.titleRow}>
          <Drop size={18} color={colors.info} weight="fill" />
          <Text style={styles.title}>{t('water.title')}</Text>
        </View>
        {total > 0 ? (
          <Pressable
            onPress={undo}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel={t('water.undo')}
            style={({ pressed }) => [styles.undo, pressed && styles.pressed]}
          >
            <ArrowCounterClockwise size={16} color={colors.textMuted} weight="bold" />
          </Pressable>
        ) : null}
      </View>

      <Text
        style={styles.amount}
        accessibilityLabel={t('water.amountLabel', { drunk: litres(total), goal: litres(goal) })}
      >
        {litres(total)}
        <Text style={styles.amountOf}> / {litres(goal)}</Text>
        <Text style={styles.amountUnit}> {t('water.litres')}</Text>
      </Text>

      <View style={styles.track}>
        <Animated.View
          style={[
            styles.fill,
            reached && styles.fillReached,
            { width: fill.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }) },
          ]}
        />
      </View>
      <Text style={styles.note}>{reached ? t('water.reached') : t('water.goalNote')}</Text>

      <View style={styles.buttons}>
        <Pressable
          onPress={() => add(GLASS_ML)}
          accessibilityRole="button"
          accessibilityLabel={t('water.addGlassLabel', { ml: GLASS_ML })}
          style={({ pressed }) => [styles.button, pressed && styles.pressed]}
        >
          <Text style={styles.buttonText}>+ {t('water.glass')}</Text>
          <Text style={styles.buttonMeta}>
            {GLASS_ML} {t('water.ml')}
          </Text>
        </Pressable>
        <Pressable
          onPress={() => add(BOTTLE_ML)}
          accessibilityRole="button"
          accessibilityLabel={t('water.addBottleLabel', { ml: BOTTLE_ML })}
          style={({ pressed }) => [styles.button, pressed && styles.pressed]}
        >
          <Text style={styles.buttonText}>+ {t('water.bottle')}</Text>
          <Text style={styles.buttonMeta}>
            {BOTTLE_ML} {t('water.ml')}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

const createStyles = (colors: ColorPalette) =>
  StyleSheet.create({
    card: {
      backgroundColor: colors.surface,
      borderRadius: radius.xl,
      padding: spacing.lg,
      gap: spacing.sm,
      ...shadow(colors.shadow).card,
    },
    header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    titleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
    title: { color: colors.textSecondary, fontSize: fontSize.sm, fontWeight: fontWeight.bold },
    undo: {
      width: 32,
      height: 32,
      borderRadius: radius.pill,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.surfaceRaised,
    },
    pressed: { opacity: 0.6 },

    amount: {
      color: colors.text,
      fontSize: fontSize.xxl,
      fontWeight: fontWeight.bold,
      fontVariant: ['tabular-nums'],
      textAlign: 'auto',
    },
    amountOf: { color: colors.textMuted, fontSize: fontSize.lg, fontWeight: fontWeight.medium },
    amountUnit: { color: colors.textMuted, fontSize: fontSize.sm, fontWeight: fontWeight.medium },

    track: {
      height: 10,
      borderRadius: radius.pill,
      backgroundColor: colors.surfaceHigh,
      overflow: 'hidden',
    },
    fill: { height: '100%', borderRadius: radius.pill, backgroundColor: colors.info },
    fillReached: { backgroundColor: colors.accent },
    note: { color: colors.textMuted, fontSize: fontSize.xs, textAlign: 'auto' },

    buttons: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xs },
    button: {
      flex: 1,
      minHeight: 52,
      borderRadius: radius.md,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.infoSoft,
      paddingVertical: spacing.sm,
    },
    buttonText: { color: colors.text, fontSize: fontSize.md, fontWeight: fontWeight.bold },
    buttonMeta: { color: colors.textMuted, fontSize: fontSize.xs },
  });
