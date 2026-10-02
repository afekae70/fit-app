/**
 * The masthead: the app's name in the middle, the menu at the start of the row.
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
 * The name is centred on the page, not merely placed after the menu — the menu is taken out of
 * the flow and pinned to the start, so the centre is the centre of the screen and does not
 * shift when the button's size or the language's direction changes. `start` is logical: the
 * right-hand side in Hebrew, the left in English, from one rule.
 *
 * The app icon used to sit beside the name. It is drawn to be read at launcher size against a
 * home screen, and shrunk into a row above the app's own content it read as a sticker rather
 * than a mark. The name alone carries the same thing without competing with the screen — in the
 * brand's own violet, over a wash of it that fades out before the page begins, which is as much
 * of the logo as belongs above someone's training.
 */

import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, View, type TextStyle, type ViewStyle } from 'react-native';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useTheme } from '../ThemeProvider.js';
import { fontSize, fontWeight, spacing, type ColorPalette } from '../theme.js';
import { MenuButton } from './AppMenu.js';

export function BrandBar() {
  const { t } = useTranslation();
  const { colors, scheme } = useTheme();
  const insets = useSafeAreaInsets();
  const s = useMemo(() => createStyles(colors), [colors]);

  return (
    <View style={[s.bar, { paddingTop: insets.top + spacing.sm }]}>
      {/* The wash, not a fill: the bar keeps the page's own ground underneath it and only
          carries a breath of the accent at the very top of the screen. */}
      {/* Frosted, like the bar at the other end of the screen, with the accent washed across
          it — the brand's colour as light on glass rather than as a painted band. */}
      <BlurView
        intensity={scheme === 'dark' ? 54 : 44}
        tint={scheme === 'dark' ? 'dark' : 'light'}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />
      <LinearGradient
        colors={[colors.accentSoft, 'transparent']}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />

      <Text style={s.name}>{t('common.appName')}</Text>

      {/* Last, so it is drawn on top. The name above stretches the full width of the row, and
          a view rendered later covers one rendered earlier — with the menu first, every tap
          on it landed on the name instead, and the button never opened. Touch goes to the
          topmost view and bubbles to its parents, never sideways to a sibling underneath. */}
      <View style={s.menu}>
        <MenuButton />
      </View>
    </View>
  );
}

const createStyles = (colors: ColorPalette) =>
  StyleSheet.create<{ bar: ViewStyle; menu: ViewStyle; name: TextStyle }>({
    bar: {
      paddingHorizontal: spacing.lg,
      paddingBottom: spacing.sm,
      justifyContent: 'center',
      // A hairline, because the page now scrolls underneath rather than carrying this along with
      // it: without a line, text arriving from below reaches the name and the two read as one.
      backgroundColor: colors.glass,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.glassEdge,
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
    name: {
      color: colors.accent,
      fontSize: fontSize.xl,
      fontWeight: fontWeight.bold,
      textAlign: 'center',
    },
  });
