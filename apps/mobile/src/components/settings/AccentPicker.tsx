/**
 * Choose the accent: four swatches, the chosen one ringed and ticked.
 *
 * Swatches rather than a `Choice` of four words, because the thing being chosen is a colour
 * and the fastest description of a colour is the colour. Each is drawn in the tone it would
 * actually take in the scheme now showing — the daylight blue is not the after-dark blue — so
 * what is tapped is what appears.
 *
 * The change is immediate and needs no confirmation: the whole screen repaints in the new
 * accent the moment it is tapped, which is both the preview and the result.
 */

import { Check } from 'phosphor-react-native';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View, type ViewStyle } from 'react-native';

import { hapticLight } from '../../haptics.js';
import { useTheme } from '../../ThemeProvider.js';
import { ACCENT_NAMES, paletteFor, radius, spacing, type ColorPalette } from '../../theme.js';

export function AccentPicker() {
  const { t } = useTranslation();
  const { accent, setAccent, scheme, colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  return (
    <View style={styles.row} accessibilityRole="radiogroup">
      {ACCENT_NAMES.map((name) => {
        const swatch = paletteFor(scheme, name).accent;
        const selected = name === accent;
        return (
          <Pressable
            key={name}
            onPress={() => {
              if (selected) return;
              void hapticLight();
              setAccent(name);
            }}
            accessibilityRole="radio"
            accessibilityState={{ selected }}
            accessibilityLabel={t(`settings.accent_${name}`)}
            style={({ pressed }) => [
              styles.ring,
              selected && { borderColor: swatch },
              pressed && styles.pressed,
            ]}
          >
            <View style={[styles.swatch, { backgroundColor: swatch }]}>
              {/* The tick is the type that sits on the accent everywhere else, so it is also
                  a preview of how a label will read on it. */}
              {selected ? <Check size={16} color={colors.bg} weight="bold" /> : null}
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

const createStyles = (colors: ColorPalette) =>
  StyleSheet.create<{
    row: ViewStyle;
    ring: ViewStyle;
    swatch: ViewStyle;
    pressed: ViewStyle;
  }>({
    row: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.sm },
    // 44pt across, so the target is a thumb's width though the colour itself is smaller.
    ring: {
      width: 44,
      height: 44,
      borderRadius: radius.pill,
      borderWidth: 2,
      borderColor: 'transparent',
      alignItems: 'center',
      justifyContent: 'center',
    },
    swatch: {
      width: 32,
      height: 32,
      borderRadius: radius.pill,
      alignItems: 'center',
      justifyContent: 'center',
      // A hairline, so a swatch close to the card's own colour still has an edge.
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
    },
    pressed: { opacity: 0.7 },
  });
