/**
 * Ready-made programmes, reached from the plan screen.
 *
 * The same picker a new account is shown at the end of signing up (`StarterProgramPicker`),
 * for anyone who would rather add a plan than build one: someone who skipped it then, or who
 * wants to try a different split next to the one they have.
 */

import { router } from 'expo-router';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, StyleSheet, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useCurrentUserId } from '../src/auth/CurrentUserProvider.js';
import { Hint, ScreenHeader } from '../src/components/ui.js';
import { StarterProgramPicker } from '../src/plans/StarterProgramPicker.js';
import { spacing } from '../src/theme.js';

export default function StarterProgramsScreen() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const userId = useCurrentUserId();
  const styles = useMemo(() => createStyles(), []);

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[
        styles.content,
        { paddingTop: spacing.lg, paddingBottom: insets.bottom + spacing.xxl },
      ]}
      showsVerticalScrollIndicator={false}
    >
      <ScreenHeader title={t('starter.libraryTitle')} />
      <Hint>{t('starter.libraryHint')}</Hint>
      {/* Back to the plan screen, which reloads when it comes into view and so shows the new
          plan without being told about it. */}
      <StarterProgramPicker userId={userId} onAdded={() => router.back()} />
    </ScrollView>
  );
}

const createStyles = () =>
  StyleSheet.create<{ screen: ViewStyle; content: ViewStyle }>({
    screen: { flex: 1 },
    content: { paddingHorizontal: spacing.lg, gap: spacing.lg },
  });
