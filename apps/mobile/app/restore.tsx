/**
 * Loading a backup back in.
 *
 * On its own screen rather than behind a button in settings, because restoring replaces
 * everything and a destructive action deserves somewhere to stop and read before it happens.
 *
 * The backup arrives as pasted text. Reading a file would need a document picker, which is a
 * native module this build does not carry — and adding one means the JS loads and then fails at
 * the call site on the phone already installed. Paste needs nothing but the keyboard.
 *
 * Nothing is touched until the text has been inspected and the user has confirmed what it
 * contains: how old it is, and how much is in it. A restore that begins before the user knows
 * what they are about to overwrite is a trap.
 */

import { useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { readBackupFile } from '../src/backup/store.js';
import { useCurrentUserId } from '../src/auth/CurrentUserProvider.js';
import { useActionSheet } from '../src/components/ActionSheetProvider.js';
import { KeyboardSafe } from '../src/components/KeyboardSafe.js';
import { Banner, Card, Hint, ScreenHeader, SectionTitle } from '../src/components/ui.js';
import { inspectBackup, restoreBackup, type BackupCheck } from '../src/db/backup.js';
import { getExecutor } from '../src/db/provider.js';
import { SCHEMA_VERSION } from '../src/db/schema.js';
import { hapticLight } from '../src/haptics.js';
import { useTheme } from '../src/ThemeProvider.js';
import { fontSize, radius, spacing, type ColorPalette } from '../src/theme.js';

export default function RestoreScreen() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const userId = useCurrentUserId();
  const { confirm, notify } = useActionSheet();
  const router = useRouter();

  const [text, setText] = useState('');
  const [check, setCheck] = useState<BackupCheck | null>(null);
  const [busy, setBusy] = useState(false);

  /**
   * Read a backup straight off the phone, which is where the automatic ones are.
   *
   * The file is loaded and inspected in one step — there is no reason to make somebody press
   * "check" after choosing a file, when choosing it is already the decision.
   */
  const pickFile = useCallback(() => {
    void hapticLight();
    void (async () => {
      const contents = await readBackupFile();
      if (contents === null) return;
      setText(contents);
      setCheck(inspectBackup(contents, userId, SCHEMA_VERSION));
    })();
  }, [userId]);

  const inspect = useCallback(() => {
    void hapticLight();
    setCheck(inspectBackup(text, userId, SCHEMA_VERSION));
  }, [text, userId]);

  const run = useCallback(() => {
    if (!check?.ok || !check.file) return;
    // Captured here: the narrowing above does not survive into the async closure below.
    const file = check.file;
    const summary = check.summary;
    void (async () => {
      const ok = await confirm({
        title: t('restore.confirmTitle'),
        message: t('restore.confirmBody', {
          sessions: summary?.sessions ?? 0,
          sets: summary?.sets ?? 0,
        }),
        confirmLabel: t('restore.confirmAction'),
      });
      if (!ok) return;

      setBusy(true);
      try {
        const db = await getExecutor();
        await restoreBackup(db, file);
        await notify({ message: t('restore.done') });
        // Back to the start: every screen behind this one is showing data that no longer exists.
        router.replace('/(tabs)');
      } catch {
        await notify({ message: t('restore.failed') });
      } finally {
        setBusy(false);
      }
    })();
  }, [check, confirm, notify, t, router]);

  return (
    <KeyboardSafe>
      <ScrollView
        style={styles.screen}
        contentContainerStyle={[
          styles.content,
          { paddingTop: insets.top + 8, paddingBottom: insets.bottom + 28 },
        ]}
        keyboardShouldPersistTaps="handled"
      >
        <ScreenHeader title={t('restore.title')} back settings={false} />

        <Banner tone="warning">{t('restore.warning')}</Banner>

        <Card>
          <SectionTitle>{t('restore.fileTitle')}</SectionTitle>
          <Hint>{t('restore.fileHint')}</Hint>
          <Pressable
            onPress={pickFile}
            accessibilityRole="button"
            style={({ pressed }) => [styles.button, pressed && styles.pressed]}
          >
            <Text style={styles.buttonText}>{t('restore.pickFile')}</Text>
          </Pressable>
        </Card>

        {/* Kept as the way in for a backup that arrived as text — in a note, or a message to
            yourself — rather than as a file on this phone. */}
        <Card>
          <SectionTitle>{t('restore.pasteTitle')}</SectionTitle>
          <Hint>{t('restore.pasteHint')}</Hint>
          <TextInput
            value={text}
            onChangeText={(next) => {
              setText(next);
              // Any edit invalidates the previous verdict; leaving it on screen would let the
              // user confirm a check that no longer describes what is in the box.
              setCheck(null);
            }}
            placeholder={t('restore.pastePlaceholder')}
            placeholderTextColor={colors.textMuted}
            style={styles.input}
            multiline
            textAlignVertical="top"
          />
          <Pressable
            onPress={inspect}
            disabled={text.trim().length === 0}
            accessibilityRole="button"
            style={({ pressed }) => [
              styles.button,
              text.trim().length === 0 && styles.buttonDisabled,
              pressed && styles.pressed,
            ]}
          >
            <Text style={styles.buttonText}>{t('restore.check')}</Text>
          </Pressable>
        </Card>

        {check && !check.ok ? (
          // Named, not "something went wrong": each of these has a different fix.
          <Banner tone="warning">{t(`restore.problem.${check.problem}`)}</Banner>
        ) : null}

        {check?.ok ? (
          <Card>
            <SectionTitle>{t('restore.foundTitle')}</SectionTitle>
            <Text style={styles.summary}>
              {t('restore.foundBody', {
                date: (check.summary?.exportedAt ?? '').slice(0, 10),
                sessions: check.summary?.sessions ?? 0,
                sets: check.summary?.sets ?? 0,
                weighIns: check.summary?.weighIns ?? 0,
              })}
            </Text>
            <Pressable
              onPress={run}
              disabled={busy}
              accessibilityRole="button"
              style={({ pressed }) => [
                styles.button,
                styles.buttonDanger,
                busy && styles.buttonDisabled,
                pressed && styles.pressed,
              ]}
            >
              <Text style={[styles.buttonText, styles.buttonTextDanger]}>
                {busy ? t('restore.running') : t('restore.action')}
              </Text>
            </Pressable>
          </Card>
        ) : null}
      </ScrollView>
    </KeyboardSafe>
  );
}

const createStyles = (colors: ColorPalette) =>
  StyleSheet.create<{
    screen: ViewStyle;
    content: ViewStyle;
    input: TextStyle;
    button: ViewStyle;
    buttonDanger: ViewStyle;
    buttonDisabled: ViewStyle;
    buttonText: TextStyle;
    buttonTextDanger: TextStyle;
    summary: TextStyle;
    pressed: ViewStyle;
  }>({
    screen: { flex: 1 },
    content: { paddingHorizontal: spacing.lg, gap: spacing.md },
    input: {
      minHeight: 120,
      marginTop: spacing.sm,
      backgroundColor: colors.bg,
      borderRadius: radius.sm,
      borderWidth: 1,
      borderColor: colors.border,
      color: colors.text,
      fontSize: fontSize.xs,
      padding: spacing.md,
      textAlign: 'left',
    },
    button: {
      marginTop: spacing.md,
      paddingVertical: spacing.md,
      borderRadius: radius.sm,
      backgroundColor: colors.accentSoft,
      borderWidth: 1,
      borderColor: colors.accentBorder,
      alignItems: 'center',
    },
    buttonDanger: { backgroundColor: colors.dangerSoft, borderColor: colors.danger },
    buttonDisabled: { opacity: 0.4 },
    buttonText: { color: colors.accent, fontSize: fontSize.sm, fontWeight: '700' },
    buttonTextDanger: { color: colors.danger },
    summary: { color: colors.textSecondary, fontSize: fontSize.sm, textAlign: 'auto', marginTop: 6 },
    pressed: { opacity: 0.7 },
  });
