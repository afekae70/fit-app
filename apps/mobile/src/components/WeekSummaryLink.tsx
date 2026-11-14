/**
 * The way into the weekly summary from the Progress tab: one row, at the top, before the month.
 *
 * The Saturday reminder opens the summary too; this is for any other day. A row rather than a
 * card of numbers, so the Progress screen does not grow a second copy of what the summary shows.
 */

import { router } from 'expo-router';
import { CaretLeft, CaretRight, ChartBar } from 'phosphor-react-native';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View, type TextStyle, type ViewStyle } from 'react-native';

import { hapticLight } from '../haptics.js';
import { isRtlLanguage, type Language } from '../i18n/index.js';
import { useTheme } from '../ThemeProvider.js';
import { fontSize, fontWeight, radius, spacing, type ColorPalette } from '../theme.js';
import { Pressable } from './Pressable.js';
import { Text } from './Text.js';

export function WeekSummaryLink() {
  const { t, i18n } = useTranslation();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  // Onward, in the reading direction.
  const Onward = isRtlLanguage(i18n.language as Language) ? CaretLeft : CaretRight;

  return (
    <Pressable
      onPress={() => {
        hapticLight();
        router.push('/week-summary');
      }}
      accessibilityRole="button"
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
    >
      <View style={styles.icon}>
        <ChartBar size={20} color={colors.accent} weight="bold" />
      </View>
      <View style={styles.text}>
        <Text style={styles.title}>{t('weekSummary.open')}</Text>
        <Text style={styles.hint} numberOfLines={1}>
          {t('weekSummary.openHint')}
        </Text>
      </View>
      <Onward size={18} color={colors.textMuted} weight="bold" />
    </Pressable>
  );
}

const createStyles = (colors: ColorPalette) =>
  StyleSheet.create<{
    row: ViewStyle;
    pressed: ViewStyle;
    icon: ViewStyle;
    text: ViewStyle;
    title: TextStyle;
    hint: TextStyle;
  }>({
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      minHeight: 64,
      paddingHorizontal: spacing.md,
      borderRadius: radius.lg,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
    },
    pressed: { opacity: 0.7 },
    icon: {
      width: 40,
      height: 40,
      borderRadius: radius.pill,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.accentSoft,
    },
    text: { flex: 1, gap: 2 },
    title: { color: colors.text, fontSize: fontSize.md, fontWeight: fontWeight.bold, textAlign: 'auto' },
    hint: { color: colors.textMuted, fontSize: fontSize.xs, textAlign: 'auto' },
  });
