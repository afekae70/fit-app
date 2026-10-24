/**
 * "Report" under something the AI coach wrote: a reason chosen from a sheet, then one row sent
 * to the server (coach/aiReport.ts). Small and quiet on purpose — it is there for the rare
 * answer that deserves it, not to make every answer look doubtful — and always reachable
 * without leaving the screen, which is what Google Play's policy asks.
 */

import { Flag } from 'phosphor-react-native';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, type TextStyle, type ViewStyle } from 'react-native';

import { AI_REPORT_REASONS, buildAiReport, type AiReportKind } from '../coach/aiReport.js';
import { sendAiReport } from '../coach/aiReportClient.js';
import { hapticLight } from '../haptics.js';
import { useTheme } from '../ThemeProvider.js';
import { fontSize, spacing, type ColorPalette } from '../theme.js';
import { useActionSheet } from './ActionSheetProvider.js';
import { Pressable } from './Pressable.js';
import { Text } from './Text.js';

export function ReportAiButton({ kind, text }: { kind: AiReportKind; text: string }) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { ask, notify } = useActionSheet();
  const [sending, setSending] = useState(false);

  const report = async () => {
    hapticLight();
    const choice = await ask({
      title: t('aiReport.title'),
      message: t('aiReport.message'),
      actions: AI_REPORT_REASONS.map((reason) => ({ label: t(`aiReport.reason_${reason}`) })),
    });
    if (choice === null) return;
    const reason = AI_REPORT_REASONS[choice];
    const row = reason ? buildAiReport(kind, reason, text) : null;
    if (!row) return;
    setSending(true);
    const outcome = await sendAiReport(row);
    setSending(false);
    const message = t(`aiReport.outcome_${outcome}`);
    await notify(outcome === 'sent' ? { title: t('aiReport.thanksTitle'), message } : { message });
  };

  return (
    <Pressable
      onPress={() => void report()}
      disabled={sending}
      hitSlop={12}
      accessibilityRole="button"
      accessibilityLabel={t('aiReport.button')}
      style={({ pressed }) => [styles.button, (pressed || sending) && styles.pressed]}
    >
      <Flag size={13} color={colors.textMuted} weight="bold" />
      <Text style={styles.label}>{t('aiReport.short')}</Text>
    </Pressable>
  );
}

const createStyles = (colors: ColorPalette) =>
  StyleSheet.create<{ button: ViewStyle; label: TextStyle; pressed: ViewStyle }>({
    button: {
      flexDirection: 'row',
      alignItems: 'center',
      alignSelf: 'flex-start',
      gap: spacing.xxs,
      minHeight: 24,
      marginTop: spacing.xs,
    },
    label: { color: colors.textMuted, fontSize: fontSize.xxs },
    pressed: { opacity: 0.5 },
  });
