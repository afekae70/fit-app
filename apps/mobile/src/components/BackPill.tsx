/**
 * The way back from a screen opened from a tab: an arrow and the word "Back", in a pill, at the
 * top of the screen on the start side — where the menu is on the tabs.
 *
 * Asked for by the owner (2026-11-13). The stack draws no header of its own (`headerShown: false`
 * in the root layout), so these screens had no way back on the screen at all, only Android's
 * swipe from the edge. A first version floated a round button at the bottom; the owner asked for
 * it at the top on the right, and in another design — this one, with the word beside the arrow
 * so it reads as "back" and not as "next".
 *
 * `BrandBar` shows it in place of the menu on those screens (see `backButtonRule.ts` for which):
 * one control in the corner, and the one that answers "how do I get out of here". The menu is
 * one tap away again on any tab.
 *
 * The same height as the menu button, so the bar does not shift between a tab and a screen.
 */

import { router } from 'expo-router';
import { ArrowLeft, ArrowRight } from 'phosphor-react-native';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, type TextStyle, type ViewStyle } from 'react-native';

import { hapticLight } from '../haptics.js';
import { isRtlLanguage, type Language } from '../i18n/index.js';
import { useTheme } from '../ThemeProvider.js';
import { fontSize, fontWeight, radius, spacing, type ColorPalette } from '../theme.js';
import { Pressable } from './Pressable.js';
import { Text } from './Text.js';

export function BackPill() {
  const { t, i18n } = useTranslation();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  // The arrow points the way back: to the right in a right-to-left language. It comes first in
  // the row, so it sits at the outer edge with the word beside it, in either direction.
  const Arrow = isRtlLanguage(i18n.language as Language) ? ArrowRight : ArrowLeft;

  return (
    <Pressable
      onPress={() => {
        hapticLight();
        // Nothing behind this screen (it was opened from a link): home, rather than a button
        // that does nothing.
        if (router.canGoBack()) router.back();
        else router.replace('/');
      }}
      accessibilityRole="button"
      accessibilityLabel={t('common.back')}
      hitSlop={8}
      style={({ pressed }) => [styles.pill, pressed && styles.pressed]}
    >
      <Arrow size={18} color={colors.accent} weight="bold" />
      <Text style={styles.label}>{t('common.back')}</Text>
    </Pressable>
  );
}

const createStyles = (colors: ColorPalette) =>
  StyleSheet.create<{ pill: ViewStyle; label: TextStyle; pressed: ViewStyle }>({
    pill: {
      height: 36,
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.xs,
      paddingStart: spacing.sm,
      paddingEnd: spacing.md,
      borderRadius: radius.pill,
      // The bar's own glass with the accent washed in, and an edge — light on the bar, not a
      // painted button competing with the page.
      backgroundColor: colors.accentSoft,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.glassEdge,
    },
    label: { color: colors.accent, fontSize: fontSize.sm, fontWeight: fontWeight.bold },
    pressed: { opacity: 0.6 },
  });
