/**
 * A line that appears when sync has failed, and at no other time.
 *
 * See `trouble.ts` for when that is. It draws nothing at all otherwise — no "synced" tick, no
 * timestamp, no card — because the app was deliberately rid of a sync card: something that
 * works does not need a place on the screen. This is the opposite case, and it goes where the
 * user already is (the home screen, and settings) rather than waiting to be looked for.
 *
 * It says what matters to the person reading it: their data is on the phone and safe, it has
 * not all reached the cloud, and here is a button that tries again. The server's own message
 * stays in the log.
 */

import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View, type TextStyle, type ViewStyle } from 'react-native';
import { CloudWarning } from 'phosphor-react-native';

import { hapticLight } from '../haptics.js';
import { useTheme } from '../ThemeProvider.js';
import { fontSize, fontWeight, radius, spacing, type ColorPalette } from '../theme.js';
import { useSync } from './SyncProvider.js';
import { syncTroubleOf } from './trouble.js';

export function SyncTrouble() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { status, syncNow } = useSync();
  // Its own flag, because the status goes to "syncing" during a retry and the warning would
  // otherwise vanish and reappear a second later, looking like a different event.
  const [retrying, setRetrying] = useState(false);

  const trouble = syncTroubleOf(status);
  if (!trouble && !retrying) return null;

  return (
    <View style={styles.box} accessibilityRole="alert">
      <CloudWarning size={22} color={colors.warning} />
      <View style={styles.text}>
        <Text style={styles.message}>
          {trouble?.kind === 'refused'
            ? t('syncTrouble.refused', { count: trouble.count })
            : t('syncTrouble.failed')}
        </Text>
        <Pressable
          onPress={() => {
            if (retrying) return;
            hapticLight();
            setRetrying(true);
            void syncNow().finally(() => setRetrying(false));
          }}
          disabled={retrying}
          accessibilityRole="button"
          hitSlop={8}
          style={({ pressed }) => pressed && styles.pressed}
        >
          <Text style={styles.retry}>
            {retrying ? t('syncTrouble.retrying') : t('syncTrouble.retry')}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

const createStyles = (colors: ColorPalette) =>
  StyleSheet.create<{
    box: ViewStyle;
    text: ViewStyle;
    message: TextStyle;
    retry: TextStyle;
    pressed: ViewStyle;
  }>({
    box: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: spacing.md,
      padding: spacing.md,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: colors.warning,
      backgroundColor: colors.warningSoft,
    },
    text: { flex: 1, gap: spacing.xs },
    message: { color: colors.text, fontSize: fontSize.sm, lineHeight: 20, textAlign: 'auto' },
    retry: {
      color: colors.warning,
      fontSize: fontSize.sm,
      fontWeight: fontWeight.bold,
      textAlign: 'auto',
    },
    pressed: { opacity: 0.6 },
  });
