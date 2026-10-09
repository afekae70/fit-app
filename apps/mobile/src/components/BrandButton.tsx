/**
 * The one button on a screen that is the thing to press.
 *
 * Filled with the logo's own gradient — the violet it starts as and the pink it fades into —
 * which the rest of the app holds back precisely so that it means something here. Used where
 * someone arrives and where they are carried forward: signing in, each step of setting up.
 *
 * It gives a little under the thumb. That is the only animation, and it is the scale of the
 * whole button, native-driven, on a node that carries nothing else animated: the disabled look
 * is a different set of plain styles, not a colour tweened on the same view.
 */

import { useMemo, useRef } from 'react';
import {
  ActivityIndicator,
  Animated,
  Pressable,
  StyleSheet,
  Text,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

import { hapticLight } from '../haptics.js';
import { useTheme } from '../ThemeProvider.js';
import { fontSize, fontWeight, radius, shadow, spacing, type ColorPalette } from '../theme.js';

export function BrandButton({
  label,
  onPress,
  disabled = false,
  busy = false,
  style,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  /** Shows a spinner in place of the label and ignores presses, without looking switched off. */
  busy?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const pressed = useRef(new Animated.Value(0)).current;

  const settle = (toValue: number) =>
    Animated.spring(pressed, {
      toValue,
      friction: 7,
      tension: 180,
      useNativeDriver: true,
    }).start();

  const inert = disabled || busy;

  return (
    <Animated.View
      style={[
        style,
        { transform: [{ scale: pressed.interpolate({ inputRange: [0, 1], outputRange: [1, 0.97] }) }] },
      ]}
    >
      <Pressable
        onPress={() => {
          hapticLight();
          onPress();
        }}
        onPressIn={() => settle(1)}
        onPressOut={() => settle(0)}
        disabled={inert}
        accessibilityRole="button"
        accessibilityState={{ disabled: inert, busy }}
        style={[styles.button, disabled ? styles.buttonDisabled : styles.buttonLive]}
      >
        {disabled ? null : (
          <LinearGradient
            colors={[colors.accent, colors.info]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={StyleSheet.absoluteFill}
            pointerEvents="none"
          />
        )}
        {busy ? (
          <ActivityIndicator color={colors.bg} />
        ) : (
          <Text style={[styles.label, disabled && styles.labelDisabled]}>{label}</Text>
        )}
      </Pressable>
    </Animated.View>
  );
}

const createStyles = (colors: ColorPalette) =>
  StyleSheet.create<{
    button: ViewStyle;
    buttonLive: ViewStyle;
    buttonDisabled: ViewStyle;
    label: TextStyle;
    labelDisabled: TextStyle;
  }>({
    button: {
      minHeight: 54,
      borderRadius: radius.lg,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: spacing.xl,
      // The gradient is a child and would otherwise square off the corners.
      overflow: 'hidden',
    },
    // A colour under the gradient, so the shadow has something opaque to be cast by.
    buttonLive: { backgroundColor: colors.accent, ...shadow(colors.accent).card },
    buttonDisabled: { backgroundColor: colors.surfaceHigh },
    label: { color: colors.bg, fontSize: fontSize.md, fontWeight: fontWeight.bold },
    labelDisabled: { color: colors.textFaint },
  });
