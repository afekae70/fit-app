/**
 * The friendly screen ErrorBoundary shows in place of a crash. Kept in its own file (rather
 * than inlined in the class) purely so it can use hooks — see ErrorBoundary.tsx for why.
 */

import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View, type TextStyle, type ViewStyle } from 'react-native';
import { Text } from './Text.js';

import { useTheme } from '../ThemeProvider.js';
import { fontSize, fontWeight, spacing, type ColorPalette } from '../theme.js';
import { Button } from './ui.js';
import { Warning } from 'phosphor-react-native';
import { Glyph } from './Glyph.js';

export function ErrorFallback({ onReset }: { onReset: () => void }) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  return (
    <View style={styles.screen}>
      <Glyph icon={Warning} style={styles.emoji} weight="duotone" />
      <Text style={styles.title}>{t('errorBoundary.title')}</Text>
      <Text style={styles.hint}>{t('errorBoundary.hint')}</Text>
      <View style={styles.buttonWrap}>
        <Button label={t('errorBoundary.retry')} onPress={onReset} />
      </View>
    </View>
  );
}

const createStyles = (colors: ColorPalette) =>
  StyleSheet.create<{
    screen: ViewStyle;
    emoji: TextStyle;
    title: TextStyle;
    hint: TextStyle;
    buttonWrap: ViewStyle;
  }>({
    screen: {
      flex: 1,
      backgroundColor: colors.bg,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: spacing.xl,
    },
    emoji: { fontSize: 56, marginBottom: spacing.lg, color: colors.warning },
    title: {
      color: colors.text,
      fontSize: fontSize.lg,
      fontWeight: fontWeight.bold,
      textAlign: 'center',
    },
    hint: {
      color: colors.textMuted,
      fontSize: fontSize.sm,
      textAlign: 'center',
      marginTop: spacing.sm,
      marginBottom: spacing.xl,
    },
    buttonWrap: { minWidth: 160 },
  });
