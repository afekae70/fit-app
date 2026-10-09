/**
 * A text input with a picture of what goes in it, and room for a control at the far end.
 *
 * Started on the sign-in screen and moved here once the coaching screens wanted the same thing:
 * a field that looks like it belongs to the card it sits on, shows which one has the cursor,
 * and reads the same in both directions. The row is laid out with logical properties, so the
 * icon leads and the trailing control follows whichever way the language runs.
 *
 * The focus ring is a plain style that changes on a render — a border colour — never an
 * animated one. Nothing on this view is animated at all, which is the simplest way to be sure
 * no two drivers ever meet on it.
 */

import { useMemo, useState, type ReactNode } from 'react';
import {
  StyleSheet,
  TextInput,
  View,
  type TextInputProps,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import type { Icon } from 'phosphor-react-native';

import { useTheme } from '../ThemeProvider.js';
import { fontSize, radius, spacing, type ColorPalette } from '../theme.js';

export function Field({
  icon: IconComponent,
  trailing,
  inputStyle,
  ...input
}: TextInputProps & {
  icon?: Icon;
  trailing?: ReactNode;
  /** For a field whose text is not ordinary prose — a code set wide and centred, say. */
  inputStyle?: TextStyle;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [focused, setFocused] = useState(false);

  return (
    <View style={[styles.field, focused && styles.fieldFocused]}>
      {IconComponent ? (
        <IconComponent size={20} color={focused ? colors.accent : colors.textMuted} />
      ) : null}
      <TextInput
        {...input}
        onFocus={(event) => {
          setFocused(true);
          input.onFocus?.(event);
        }}
        onBlur={(event) => {
          setFocused(false);
          input.onBlur?.(event);
        }}
        placeholderTextColor={colors.textFaint}
        style={[styles.input, inputStyle]}
      />
      {trailing}
    </View>
  );
}

const createStyles = (colors: ColorPalette) =>
  StyleSheet.create<{ field: ViewStyle; fieldFocused: ViewStyle; input: TextStyle }>({
    field: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      minHeight: 52,
      paddingHorizontal: spacing.md,
      borderRadius: radius.md,
      borderWidth: 1.5,
      borderColor: colors.border,
      backgroundColor: colors.surfaceRaised,
    },
    fieldFocused: { borderColor: colors.accent, backgroundColor: colors.surface },
    input: {
      flex: 1,
      color: colors.text,
      fontSize: fontSize.md,
      paddingVertical: spacing.sm,
      textAlign: 'auto',
    },
  });
