/**
 * The masthead: the app's mark and name in the middle, the menu at the start of the row.
 *
 * Mounted once in the root layout, above the router — so it is genuinely fixed. Rendering it
 * inside each screen put it inside that screen's ScrollView, which meant it scrolled away the
 * moment the page moved; the only way for it to stay put is to sit outside every scrolling
 * surface there is. One instance also means it cannot drift between screens, and a screen added
 * later gets it without being asked to.
 *
 * Because it sits above the router it owns the top safe-area inset for the whole app: the
 * screens underneath it no longer reach the notch, so they no longer pad for it.
 *
 * The mark and name are centred on the page, not merely placed after the menu — the menu is
 * taken out of the flow and pinned to the start, so the centre is the centre of the screen and
 * does not shift when the button's size or the language's direction changes. `start` is logical:
 * the right-hand side in Hebrew, the left in English, from one rule.
 */

import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Image,
  StyleSheet,
  Text,
  View,
  type ImageStyle,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import LOGO from '../../assets/icon.png';
import { useTheme } from '../ThemeProvider.js';
import { fontSize, fontWeight, radius, spacing, type ColorPalette } from '../theme.js';
import { MenuButton } from './AppMenu.js';

export function BrandBar() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const s = useMemo(() => createStyles(colors), [colors]);

  return (
    <View style={[s.bar, { paddingTop: insets.top + spacing.sm }]}>
      <View style={s.menu}>
        <MenuButton />
      </View>

      <View style={s.brand}>
        <Image source={LOGO} style={s.logo} accessibilityIgnoresInvertColors />
        <Text style={s.name}>{t('common.appName')}</Text>
      </View>
    </View>
  );
}

const createStyles = (colors: ColorPalette) =>
  StyleSheet.create<{
    bar: ViewStyle;
    menu: ViewStyle;
    brand: ViewStyle;
    logo: ImageStyle;
    name: TextStyle;
  }>({
    bar: {
      paddingHorizontal: spacing.lg,
      paddingBottom: spacing.sm,
      justifyContent: 'center',
      // A hairline, because the page now scrolls underneath rather than carrying this along with
      // it: without a line, text arriving from below reaches the name and the two read as one.
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.borderSubtle,
    },
    /* Out of the flow, so the brand below is centred on the screen and not on what is left of
       it. Pinned vertically to the row's own bottom half, which is where the content sits once
       the safe-area inset has been added on top. */
    menu: {
      position: 'absolute',
      start: spacing.lg,
      bottom: spacing.sm,
      justifyContent: 'center',
    },
    brand: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm },
    logo: {
      width: 44,
      height: 44,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.borderSubtle,
    },
    name: { color: colors.text, fontSize: fontSize.xl, fontWeight: fontWeight.bold },
  });
