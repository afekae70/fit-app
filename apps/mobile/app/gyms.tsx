/**
 * The places you train.
 *
 * A gym here is a name and nothing else. It exists so the app can tell two sets of numbers
 * apart: the same leg press at two gyms is two different machines, and a comparison that reads
 * across them makes a lifter progressing steadily in both look like they are lurching up and
 * down — which is the shape the stall detector is watching for, so it starts reporting plateaus
 * that are only a change of address.
 *
 * Every edit writes through immediately, like the rest of the app. There is no Save button
 * because there is nothing held back to save.
 *
 * Gyms are local to this device for now. The remote `locations` table has no `updated_at` or
 * `deleted_at` for the sync engine to track; the migration adding them is written and waiting in
 * `apps/api/drizzle`. Until it is applied, this list does not leave the phone — which is worth
 * saying on the screen rather than letting someone discover it after a reinstall.
 */

import { useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useCurrentUserId } from '../src/auth/CurrentUserProvider.js';
import { useActionSheet } from '../src/components/ActionSheetProvider.js';
import { KeyboardSafe } from '../src/components/KeyboardSafe.js';
import { Banner, Card, EmptyState, Hint, ScreenHeader, SectionTitle } from '../src/components/ui.js';
import { getExecutor, newId } from '../src/db/provider.js';
import {
  addLocation,
  listLocations,
  removeLocation,
  renameLocation,
  type LocationRow,
} from '../src/db/locations.js';
import { hapticLight } from '../src/haptics.js';
import { useTheme } from '../src/ThemeProvider.js';
import { fontSize, radius, spacing, type ColorPalette } from '../src/theme.js';

export default function GymsScreen() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const userId = useCurrentUserId();
  const { confirm } = useActionSheet();

  const [gyms, setGyms] = useState<LocationRow[]>([]);
  const [draft, setDraft] = useState('');

  const reload = useCallback(async () => {
    const db = await getExecutor();
    setGyms(await listLocations(db, userId));
  }, [userId]);

  useFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload]),
  );

  const add = useCallback(() => {
    const name = draft.trim();
    if (name.length === 0) return;
    void hapticLight();
    void (async () => {
      const db = await getExecutor();
      await addLocation(db, newId, userId, name);
      // Cleared only after the write, so a failed insert leaves the typing recoverable.
      setDraft('');
      await reload();
    })();
  }, [draft, userId, reload]);

  const rename = useCallback(
    (gym: LocationRow, name: string) => {
      if (name.trim() === gym.name) return;
      void (async () => {
        const db = await getExecutor();
        await renameLocation(db, gym.id, name);
        await reload();
      })();
    },
    [reload],
  );

  const remove = useCallback(
    (gym: LocationRow) => {
      void (async () => {
        const ok = await confirm({
          message: t('gyms.confirmDelete', { name: gym.name }),
          confirmLabel: t('gyms.delete'),
        });
        if (!ok) return;
        const db = await getExecutor();
        await removeLocation(db, gym.id);
        await reload();
      })();
    },
    [confirm, t, reload],
  );

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
        <ScreenHeader title={t('gyms.title')} back settings={false} />

        <Card>
          <SectionTitle>{t('gyms.addTitle')}</SectionTitle>
          <Hint>{t('gyms.addHint')}</Hint>
          <View style={styles.addRow}>
            <TextInput
              value={draft}
              onChangeText={setDraft}
              onSubmitEditing={add}
              placeholder={t('gyms.namePlaceholder')}
              placeholderTextColor={colors.textMuted}
              style={styles.input}
              returnKeyType="done"
            />
            <Pressable
              onPress={add}
              disabled={draft.trim().length === 0}
              accessibilityRole="button"
              style={({ pressed }) => [
                styles.addButton,
                draft.trim().length === 0 && styles.addButtonDisabled,
                pressed && styles.pressed,
              ]}
            >
              <Text style={styles.addButtonText}>{t('common.add')}</Text>
            </Pressable>
          </View>
        </Card>

        <Card>
          <SectionTitle>{t('gyms.listTitle')}</SectionTitle>
          {gyms.length === 0 ? (
            <EmptyState emoji="🏋️" title={t('gyms.empty')} hint={t('gyms.emptyHint')} />
          ) : (
            gyms.map((gym) => (
              <View key={gym.id} style={styles.row}>
                {/* Uncontrolled and re-keyed on the committed name, the same as the weight and
                    rep fields: a controlled input that writes on every keystroke fights the
                    typing on a slow reload. */}
                <TextInput
                  key={`${gym.id}-${gym.name}`}
                  defaultValue={gym.name}
                  onEndEditing={(e) => rename(gym, e.nativeEvent.text)}
                  style={[styles.input, styles.rowInput]}
                  returnKeyType="done"
                />
                <Pressable
                  onPress={() => remove(gym)}
                  accessibilityRole="button"
                  accessibilityLabel={t('gyms.delete')}
                  hitSlop={6}
                  style={({ pressed }) => [styles.removeButton, pressed && styles.pressed]}
                >
                  <Text style={styles.removeGlyph}>×</Text>
                </Pressable>
              </View>
            ))
          )}
        </Card>

        {/* Stated on the screen rather than in a release note. Someone who reinstalls and finds
            their gyms gone would reasonably call that a bug. */}
        <Banner tone="info">{t('gyms.localOnly')}</Banner>
      </ScrollView>
    </KeyboardSafe>
  );
}

const createStyles = (colors: ColorPalette) =>
  StyleSheet.create<{
    screen: ViewStyle;
    content: ViewStyle;
    addRow: ViewStyle;
    input: TextStyle;
    rowInput: TextStyle;
    addButton: ViewStyle;
    addButtonDisabled: ViewStyle;
    addButtonText: TextStyle;
    row: ViewStyle;
    removeButton: ViewStyle;
    removeGlyph: TextStyle;
    pressed: ViewStyle;
  }>({
    screen: { flex: 1 },
    content: { paddingHorizontal: spacing.lg, gap: spacing.md },
    addRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.sm },
    input: {
      height: 44,
      flex: 1,
      backgroundColor: colors.surfaceRaised,
      borderRadius: radius.sm,
      borderWidth: 1,
      borderColor: colors.border,
      color: colors.text,
      fontSize: fontSize.sm,
      paddingHorizontal: spacing.md,
      textAlign: 'auto',
    },
    rowInput: { backgroundColor: colors.bg },
    addButton: {
      height: 44,
      paddingHorizontal: spacing.lg,
      borderRadius: radius.sm,
      backgroundColor: colors.accentSoft,
      borderWidth: 1,
      borderColor: colors.accentBorder,
      alignItems: 'center',
      justifyContent: 'center',
    },
    addButtonDisabled: { opacity: 0.4 },
    addButtonText: { color: colors.accent, fontSize: fontSize.sm, fontWeight: '700' },
    row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.sm },
    removeButton: {
      width: 36,
      height: 36,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: radius.sm,
    },
    removeGlyph: { color: colors.textMuted, fontSize: 22, lineHeight: 24 },
    pressed: { opacity: 0.7 },
  });
