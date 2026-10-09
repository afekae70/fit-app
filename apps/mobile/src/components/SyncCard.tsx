/**
 * The one place the user can see whether their training is actually in the cloud.
 *
 * Sync is otherwise silent by design — it runs on sign-in and on foreground and says nothing —
 * which is right until something goes wrong, at which point silence is indistinguishable from
 * working. This card is the answer to "is my data safe?", and it is deliberately plain about it:
 * a state, a time, and a button.
 */

import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View, type TextStyle, type ViewStyle } from 'react-native';

import { useSync, type SyncStatus } from '../sync/SyncProvider.js';
import { useTheme } from '../ThemeProvider.js';
import { fontSize, fontWeight, radius, spacing, type ColorPalette } from '../theme.js';
import { Card, SectionTitle } from './ui.js';

export function SyncCard() {
  const { t, i18n } = useTranslation();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { status, syncNow } = useSync();

  // Nothing to say and nothing to offer on a build with no Supabase project: the app is working
  // exactly as intended, entirely on the device. A card explaining an absent feature is noise.
  if (status.kind === 'unconfigured') return null;

  const busy = status.kind === 'syncing';

  return (
    <Card>
      <SectionTitle>{t('sync.title')}</SectionTitle>

      <View style={styles.row}>
        <View style={[styles.dot, { backgroundColor: dotColor(status, colors) }]} />
        <Text style={styles.state}>{t(`sync.state.${status.kind}`)}</Text>
      </View>

      <Text style={styles.detail}>{detailFor(status, t, i18n.language)}</Text>

      <Pressable
        onPress={() => void syncNow()}
        disabled={busy}
        accessibilityRole="button"
        accessibilityState={{ disabled: busy }}
        style={({ pressed }) => [styles.button, (pressed || busy) && styles.buttonPressed]}
      >
        <Text style={styles.buttonLabel}>{busy ? t('sync.syncing') : t('sync.syncNow')}</Text>
      </Pressable>
    </Card>
  );
}

function dotColor(status: SyncStatus, colors: ColorPalette): string {
  switch (status.kind) {
    case 'idle':
      // The accent, not a green. There is no success token in this palette and adding one for a
      // single dot would put a hue on screen that appears nowhere else in the app.
      return colors.accent;
    // Coloured as a fault, because it is one: part of the training log is not in the cloud.
    case 'partial':
    case 'error':
      return colors.danger;
    // Offline is not a fault and is not coloured like one — the phone is in a lift. Everything is
    // still saved locally and will go up by itself.
    case 'offline':
    case 'syncing':
    default:
      return colors.textMuted;
  }
}

function detailFor(
  status: SyncStatus,
  t: (key: string, options?: Record<string, unknown>) => string,
  language: string,
): string {
  if (status.kind === 'syncing') return t('sync.detailSyncing');
  if (status.kind === 'error') return status.message;
  if (status.kind === 'partial') return t('sync.detailPartial', { count: status.refused });

  const last = 'lastSyncedAt' in status ? status.lastSyncedAt : null;
  if (!last) return t('sync.detailNever');
  return t('sync.detailLast', { time: formatTime(last, language) });
}

function formatTime(iso: string, language: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const today = new Date();
  const sameDay = date.toDateString() === today.toDateString();
  return sameDay
    ? date.toLocaleTimeString(language, { hour: '2-digit', minute: '2-digit' })
    : date.toLocaleDateString(language, { day: 'numeric', month: 'short' });
}

const createStyles = (colors: ColorPalette) =>
  StyleSheet.create<{
    row: ViewStyle;
    dot: ViewStyle;
    state: TextStyle;
    detail: TextStyle;
    button: ViewStyle;
    buttonPressed: ViewStyle;
    buttonLabel: TextStyle;
  }>({
    row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
    dot: { width: 8, height: 8, borderRadius: 4 },
    state: { color: colors.text, fontSize: fontSize.md, fontWeight: fontWeight.medium },
    detail: {
      color: colors.textMuted,
      fontSize: fontSize.sm,
      marginTop: spacing.xs,
      textAlign: 'auto',
    },
    button: {
      marginTop: spacing.md,
      alignSelf: 'flex-start',
      paddingVertical: spacing.sm,
      paddingHorizontal: spacing.lg,
      borderRadius: radius.pill,
      backgroundColor: colors.accentSoft,
      borderWidth: 1,
      borderColor: colors.accentBorder,
    },
    buttonPressed: { opacity: 0.6 },
    buttonLabel: { color: colors.accent, fontSize: fontSize.sm, fontWeight: fontWeight.medium },
  });
