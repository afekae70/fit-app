/**
 * Bottom-anchored "deleted — undo" snackbar.
 *
 * The row it refers to is already gone from the list by the time this shows (see SwipeableRow) —
 * this is the one remaining chance to reverse that before the caller commits the delete to
 * SQLite. Purely presentational: the caller owns the undo window's timer so it can finalise an
 * earlier pending delete immediately if a second swipe comes in before the first one expires.
 *
 * Single driver mode throughout (native) — see ui.tsx's SegmentButton for why mixing native- and
 * JS-driven animations on one node is a hard crash, not a warning.
 */

import { useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Animated,
  Easing,
  Pressable,
  StyleSheet,
  Text,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

import { useTheme } from '../ThemeProvider.js';
import { fontSize, fontWeight, radius, spacing, type ColorPalette } from '../theme.js';

export function UndoToast({
  message,
  onUndo,
}: {
  message: string | null;
  onUndo: () => void;
}) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const anim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(anim, {
      toValue: message ? 1 : 0,
      duration: message ? 220 : 160,
      easing: message ? Easing.out(Easing.cubic) : Easing.in(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [message, anim]);

  if (!message) return null;

  return (
    <Animated.View
      pointerEvents="box-none"
      style={[
        styles.toast,
        {
          opacity: anim,
          transform: [{ translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [40, 0] }) }],
        },
      ]}
    >
      <Text style={styles.message} numberOfLines={1}>
        {message}
      </Text>
      <Pressable onPress={onUndo} hitSlop={10}>
        <Text style={styles.undo}>{t('common.undo')}</Text>
      </Pressable>
    </Animated.View>
  );
}

const createStyles = (colors: ColorPalette) =>
  StyleSheet.create<{
    toast: ViewStyle;
    message: TextStyle;
    undo: TextStyle;
  }>({
    toast: {
      position: 'absolute',
      left: spacing.lg,
      right: spacing.lg,
      bottom: spacing.lg,
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      backgroundColor: colors.surfaceRaised,
      borderWidth: 1,
      borderColor: colors.borderStrong,
      borderRadius: radius.md,
      paddingVertical: spacing.md,
      paddingHorizontal: spacing.lg,
      zIndex: 10,
    },
    message: { flex: 1, color: colors.text, fontSize: fontSize.sm, textAlign: 'auto' },
    undo: { color: colors.accent, fontSize: fontSize.sm, fontWeight: fontWeight.bold },
  });
