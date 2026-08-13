/**
 * A one-field text prompt, as a bottom sheet.
 *
 * `Alert.prompt` exists only on iOS, so naming a plan or a day would silently do nothing on
 * Android — the platform this app is actually being built for. One sheet used by both callers
 * costs less than two platform branches.
 */

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

import { colors, fontSize, fontWeight, radius, spacing } from '../theme.js';
import { Button } from './ui.js';

export interface PromptSheetProps {
  visible: boolean;
  title: string;
  placeholder?: string;
  initialValue?: string | null;
  onSubmit: (value: string) => void;
  onCancel: () => void;
}

export function PromptSheet({
  visible,
  title,
  placeholder,
  initialValue,
  onSubmit,
  onCancel,
}: PromptSheetProps) {
  const { t } = useTranslation();
  const [value, setValue] = useState(initialValue ?? '');

  // The sheet stays mounted between opens, so without this the second rename would still show
  // the first row's text.
  useEffect(() => {
    if (visible) setValue(initialValue ?? '');
  }, [visible, initialValue]);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onCancel}>
      <KeyboardAvoidingView
        style={styles.backdrop}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.sheet}>
          <View style={styles.grabber} />
          <Text style={styles.title}>{title}</Text>

          <TextInput
            value={value}
            onChangeText={setValue}
            placeholder={placeholder}
            placeholderTextColor={colors.textFaint}
            style={styles.input}
            autoFocus
            returnKeyType="done"
            onSubmitEditing={() => onSubmit(value.trim())}
          />

          <View style={styles.actions}>
            <Button label={t('common.save')} onPress={() => onSubmit(value.trim())} />
            <Button label={t('common.cancel')} variant="ghost" onPress={onCancel} />
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create<{
  backdrop: ViewStyle;
  sheet: ViewStyle;
  grabber: ViewStyle;
  title: TextStyle;
  input: TextStyle;
  actions: ViewStyle;
}>({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    borderTopWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    paddingBottom: spacing.xxl,
  },
  grabber: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.borderStrong,
    alignSelf: 'center',
    marginBottom: spacing.lg,
  },
  title: {
    color: colors.text,
    fontSize: fontSize.lg,
    fontWeight: fontWeight.bold,
    marginBottom: spacing.md,
    textAlign: 'auto',
  },
  input: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    color: colors.text,
    fontSize: fontSize.md,
    fontWeight: fontWeight.medium,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    textAlign: 'auto',
  },
  actions: { marginTop: spacing.lg, gap: spacing.sm },
});
