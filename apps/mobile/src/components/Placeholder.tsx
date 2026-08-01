/**
 * Placeholder for tabs whose screens are built in later phases. Explicitly names which phase
 * owns the screen, so an unfinished tab reads as planned work rather than a broken app.
 */

import { useMemo } from 'react';
import { StyleSheet, Text, View, type TextStyle, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useTheme } from '../ThemeProvider.js';
import { fontSize, spacing, type ColorPalette } from '../theme.js';

export function Placeholder({
  emoji,
  title,
  phase,
  description,
}: {
  emoji: string;
  title: string;
  phase: string;
  description: string;
}) {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  return (
    <View style={[styles.container, { paddingTop: insets.top + spacing.xxl }]}>
      <Text style={styles.emoji}>{emoji}</Text>
      <Text style={styles.title}>{title}</Text>
      <View style={styles.phaseBadge}>
        <Text style={styles.phaseText}>{phase}</Text>
      </View>
      <Text style={styles.description}>{description}</Text>
    </View>
  );
}

const createStyles = (colors: ColorPalette) =>
  StyleSheet.create<{
    container: ViewStyle;
    emoji: TextStyle;
    title: TextStyle;
    phaseBadge: ViewStyle;
    phaseText: TextStyle;
    description: TextStyle;
  }>({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
    alignItems: 'center',
    paddingHorizontal: spacing.xl,
  },
  emoji: {
    fontSize: 56,
    marginBottom: spacing.lg,
  },
  title: {
    color: colors.text,
    fontSize: fontSize.lg,
    fontWeight: '700',
    textAlign: 'center',
  },
  phaseBadge: {
    marginTop: spacing.md,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
    borderRadius: 999,
    backgroundColor: colors.surfaceRaised,
    borderWidth: 1,
    borderColor: colors.border,
  },
  phaseText: {
    color: colors.textMuted,
    fontSize: fontSize.xs,
    fontWeight: '600',
  },
  description: {
    color: colors.textMuted,
    fontSize: fontSize.sm,
    lineHeight: 22,
    textAlign: 'center',
    marginTop: spacing.lg,
  },
});
