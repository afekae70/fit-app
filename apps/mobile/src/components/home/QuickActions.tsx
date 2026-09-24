/**
 * The round shortcuts under the hero: the five places worth reaching in one tap.
 *
 * They exist because the menu is a two-tap detour for things done daily — logging a meal,
 * weighing in — and because a home screen of nothing but cards gives the thumb nowhere obvious
 * to go. Icons rather than words carry the row; the word underneath is what makes an icon
 * unambiguous, and at this size both fit.
 *
 * Each one presses in slightly: a spring on scale, native-driven, which is the whole of the
 * feedback. Nothing here changes colour on press — a coloured flash on five circles in a row
 * reads as the screen flickering.
 */

import { useMemo, useRef } from 'react';
import { Animated, Pressable, StyleSheet, Text, View, type TextStyle, type ViewStyle } from 'react-native';
import type { Icon } from 'phosphor-react-native';

import { hapticLight } from '../../haptics.js';
import { useTheme } from '../../ThemeProvider.js';
import { radius, shadow, type ColorPalette } from '../../theme.js';

export interface QuickAction {
  key: string;
  label: string;
  Glyph: Icon;
  onPress: () => void;
  /** The one action that is the point of the screen — filled rather than outlined. */
  primary?: boolean;
}

export function QuickActions({ actions }: { actions: readonly QuickAction[] }) {
  const { colors } = useTheme();
  const s = useMemo(() => createStyles(colors), [colors]);

  return (
    <View style={s.row}>
      {actions.map((action) => (
        <ActionButton key={action.key} action={action} colors={colors} styles={s} />
      ))}
    </View>
  );
}

function ActionButton({
  action,
  colors,
  styles: s,
}: {
  action: QuickAction;
  colors: ColorPalette;
  styles: ReturnType<typeof createStyles>;
}) {
  const press = useRef(new Animated.Value(0)).current;

  const spring = (toValue: number) =>
    Animated.spring(press, { toValue, useNativeDriver: true, friction: 6, tension: 140 }).start();

  return (
    <Pressable
      onPressIn={() => spring(1)}
      onPressOut={() => spring(0)}
      onPress={() => {
        void hapticLight();
        action.onPress();
      }}
      accessibilityRole="button"
      accessibilityLabel={action.label}
      style={s.item}
    >
      <Animated.View
        style={[
          s.circle,
          action.primary && s.circlePrimary,
          { transform: [{ scale: press.interpolate({ inputRange: [0, 1], outputRange: [1, 0.92] }) }] },
        ]}
      >
        <action.Glyph
          size={22}
          color={action.primary ? colors.bg : colors.accent}
          weight={action.primary ? 'fill' : 'regular'}
        />
      </Animated.View>
      <Text style={s.label} numberOfLines={1}>
        {action.label}
      </Text>
    </Pressable>
  );
}

const createStyles = (colors: ColorPalette) =>
  StyleSheet.create<{
    row: ViewStyle;
    item: ViewStyle;
    circle: ViewStyle;
    circlePrimary: ViewStyle;
    label: TextStyle;
  }>({
    row: { flexDirection: 'row', justifyContent: 'space-between', gap: 8 },
    item: { flex: 1, alignItems: 'center', gap: 6 },
    circle: {
      width: 54,
      height: 54,
      borderRadius: radius.pill,
      backgroundColor: colors.surface,
      alignItems: 'center',
      justifyContent: 'center',
      ...shadow(colors.shadow).card,
    },
    circlePrimary: { backgroundColor: colors.accent },
    label: { color: colors.textMuted, fontSize: 11, textAlign: 'center' },
  });
