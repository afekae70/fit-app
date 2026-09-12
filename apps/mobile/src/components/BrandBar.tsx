/**
 * The masthead: the menu on one side, the app's mark and name on the other, on every screen.
 *
 * One row, in the same place, everywhere — so the way out of a screen is never something to look
 * for. The menu sits at the start of the row, which in Hebrew is the right-hand side; it is a
 * logical property, so it moves to the left in English without a second rule.
 *
 * Deliberately quiet. A masthead that repeats on every page is furniture, not content: the name
 * is small and muted, the mark is 26px, and the row is short enough that it costs a screen a
 * line rather than a header. The screen's own title, which is the thing actually worth reading,
 * sits underneath it at full size.
 *
 * No safe-area inset of its own. Every screen already pads its top for the notch, and this
 * renders as the first thing inside that padding — taking the inset here as well would push
 * every page down by the height of a status bar twice over.
 */

import { useTranslation } from 'react-i18next';
import { Image, StyleSheet, Text, View, type ImageStyle, type TextStyle, type ViewStyle } from 'react-native';
import { useMemo } from 'react';

import LOGO from '../../assets/icon.png';
import { useTheme } from '../ThemeProvider.js';
import { fontSize, fontWeight, radius, spacing, type ColorPalette } from '../theme.js';
import { MenuButton } from './AppMenu.js';

export function BrandBar() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const s = useMemo(() => createStyles(colors), [colors]);

  return (
    <View style={s.bar}>
      <MenuButton />
      {/* Sent to the far end rather than centred: a centre-aligned mark would shift whenever the
          menu button's hit area changed, and the eye reads a corner as a fixed point. */}
      <View style={s.brand}>
        <Image source={LOGO} style={s.logo} accessibilityIgnoresInvertColors />
        <Text style={s.name}>{t('common.appName')}</Text>
      </View>
    </View>
  );
}

const createStyles = (colors: ColorPalette) =>
  StyleSheet.create<{ bar: ViewStyle; brand: ViewStyle; logo: ImageStyle; name: TextStyle }>({
    bar: { flexDirection: 'row', alignItems: 'center', minHeight: 36 },
    brand: { marginStart: 'auto', flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
    logo: {
      width: 26,
      height: 26,
      borderRadius: radius.sm,
      borderWidth: 1,
      borderColor: colors.borderSubtle,
    },
    name: { color: colors.textMuted, fontSize: fontSize.sm, fontWeight: fontWeight.bold },
  });
