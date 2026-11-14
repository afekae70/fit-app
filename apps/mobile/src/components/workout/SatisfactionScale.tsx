/**
 * "How satisfied were you with this workout?" — ten buttons, 1 to 10.
 *
 * Asked in the summary that opens the moment a workout is finished (the owner, 2026-11-13: "the
 * moment I finish, I can rate it 1 to 10, and then the card says it by itself"). It saves to
 * `setSessionSatisfaction`, and the share card reads it from there. The share window itself does
 * not ask — asked for the same day: "when I press share, the rating should not appear at all".
 *
 * Never required. Nothing waits on an answer, and a second tap on the chosen number takes it back.
 *
 * `tone` is the surface it sits on: the summary's card, or the dark backdrop behind the share
 * card, where the type has to be light in both schemes.
 */

import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View, type TextStyle, type ViewStyle } from 'react-native';

import { hapticLight } from '../../haptics.js';
import { useTheme } from '../../ThemeProvider.js';
import { fontSize, fontWeight, spacing, type ColorPalette } from '../../theme.js';
import { Pressable } from '../Pressable.js';
import { Text } from '../Text.js';

const SCALE = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] as const;

export function SatisfactionScale({
  value,
  onChange,
  tone = 'surface',
}: {
  value: number | null;
  /** The number chosen, or null when the chosen one is tapped again. */
  onChange: (value: number | null) => void;
  tone?: 'surface' | 'dark';
}) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors, tone), [colors, tone]);

  return (
    <View style={styles.wrap}>
      <Text style={styles.title}>{t('history.satisfactionAsk')}</Text>
      <View style={styles.scale}>
        {SCALE.map((n) => {
          const selected = value === n;
          return (
            <Pressable
              key={n}
              onPress={() => {
                void hapticLight();
                onChange(selected ? null : n);
              }}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              accessibilityLabel={t('history.satisfactionLabel', { value: n })}
              style={({ pressed }) => [
                styles.button,
                selected && styles.buttonOn,
                pressed && styles.pressed,
              ]}
            >
              <Text style={[styles.number, selected && styles.numberOn]}>{n}</Text>
            </Pressable>
          );
        })}
      </View>
      <View style={styles.ends}>
        <Text style={styles.end}>{t('history.satisfactionLow')}</Text>
        <Text style={styles.end}>{t('history.satisfactionHigh')}</Text>
      </View>
    </View>
  );
}

const createStyles = (colors: ColorPalette, tone: 'surface' | 'dark') => {
  const dark = tone === 'dark';
  return StyleSheet.create<{
    wrap: ViewStyle;
    title: TextStyle;
    scale: ViewStyle;
    button: ViewStyle;
    buttonOn: ViewStyle;
    number: TextStyle;
    numberOn: TextStyle;
    ends: ViewStyle;
    end: TextStyle;
    pressed: ViewStyle;
  }>({
    wrap: { alignSelf: 'stretch', gap: spacing.sm },
    title: {
      color: dark ? '#FFFFFF' : colors.text,
      fontSize: fontSize.md,
      fontWeight: fontWeight.bold,
      textAlign: 'center',
    },
    // Ten 44-point targets wrap to two rows of five on a narrow phone, one row on a wide one.
    scale: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 6 },
    button: {
      width: 44,
      height: 44,
      borderRadius: 22,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 1,
      borderColor: dark ? 'rgba(255, 255, 255, 0.35)' : colors.border,
      backgroundColor: dark ? 'rgba(255, 255, 255, 0.08)' : colors.surfaceRaised,
    },
    buttonOn: { backgroundColor: colors.accent, borderColor: colors.accent },
    number: {
      color: dark ? '#FFFFFF' : colors.text,
      fontSize: fontSize.md,
      fontWeight: fontWeight.medium,
      fontVariant: ['tabular-nums'],
    },
    numberOn: { color: colors.bg, fontWeight: fontWeight.bold },
    ends: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 4 },
    end: { color: dark ? 'rgba(255, 255, 255, 0.7)' : colors.textMuted, fontSize: fontSize.xs },
    pressed: { opacity: 0.7 },
  });
};
