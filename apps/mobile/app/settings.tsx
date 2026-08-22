/**
 * Settings hub — appearance and account, previously scattered as inline buttons in the Today
 * and Coach tab headers. Consolidated here once there were enough of them (theme, language,
 * sign-out) that leaving them spread across two screens started to look like clutter rather
 * than convenience.
 */

import { useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { UnitPreference } from '@fit/shared';

import { useAuth } from '../src/auth/AuthProvider.js';
import { SyncCard } from '../src/components/SyncCard.js';
import {
  Banner,
  Button,
  Card,
  Hint,
  ScreenHeader,
  Segmented,
  SectionTitle,
} from '../src/components/ui.js';
import { isRtlLanguage, setAppLanguage, type Language } from '../src/i18n/index.js';
import {
  cancelWeeklyReminder,
  isWeeklyReminderScheduled,
  scheduleWeeklyReminder,
} from '../src/notifications.js';
import { useTheme, type ColorScheme } from '../src/ThemeProvider.js';
import { useUnits } from '../src/UnitsProvider.js';
import { fontSize, spacing, type ColorPalette } from '../src/theme.js';

export default function SettingsScreen() {
  const router = useRouter();
  const { t, i18n } = useTranslation();
  const insets = useSafeAreaInsets();
  const { session, signOut } = useAuth();
  const { scheme, toggleScheme, colors } = useTheme();
  const { unit, setUnit } = useUnits();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const [reminderOn, setReminderOn] = useState(false);
  const [reminderDenied, setReminderDenied] = useState(false);

  // Read from the OS rather than stored: the user can revoke notification permission outside
  // the app, and a toggle that says "on" while nothing is scheduled is worse than no toggle.
  useEffect(() => {
    let cancelled = false;
    void isWeeklyReminderScheduled().then((on) => {
      if (!cancelled) setReminderOn(on);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const toggleReminder = async (next: 'on' | 'off') => {
    if (next === 'off') {
      await cancelWeeklyReminder();
      setReminderOn(false);
      setReminderDenied(false);
      return;
    }
    const scheduled = await scheduleWeeklyReminder({
      title: t('settings.reminderWeekly'),
      body: t('week.unplanned'),
    });
    setReminderOn(scheduled);
    // Only a refusal is worth reporting. A build without the native module also returns false,
    // but there is nothing the user could do about that and no message that would help.
    setReminderDenied(!scheduled);
  };

  // No "reopen the app" prompt any more: the root View's `direction` follows i18next, so the
  // layout mirrors as the language changes (see app/_layout.tsx).
  const changeLanguage = async (next: Language) => {
    if (next === i18n.language) return;
    await setAppLanguage(next);
  };

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[
        styles.content,
        { paddingTop: insets.top + spacing.lg, paddingBottom: insets.bottom + spacing.xxl },
      ]}
    >
      {/* No gear here — it would link to the screen you are already on. */}
      <ScreenHeader title={t('settings.title')} back settings={false} />

      <Card index={0}>
        <SectionTitle>{t('settings.appearance')}</SectionTitle>

        <Segmented<ColorScheme>
          label={t('settings.theme')}
          selected={scheme}
          onSelect={(next) => {
            if (next !== scheme) toggleScheme();
          }}
          options={[
            { value: 'dark', label: t('settings.themeDark') },
            { value: 'light', label: t('settings.themeLight') },
          ]}
        />

        <Segmented<Language>
          label={t('settings.language')}
          selected={i18n.language as Language}
          onSelect={(next) => void changeLanguage(next)}
          options={[
            { value: 'he', label: 'עברית' },
            { value: 'en', label: 'English' },
          ]}
        />

        <Segmented<UnitPreference>
          label={t('settings.units')}
          selected={unit}
          onSelect={setUnit}
          options={[
            { value: 'metric', label: t('settings.unitsMetric') },
            { value: 'imperial', label: t('settings.unitsImperial') },
          ]}
        />
        <Text style={styles.unitsHint}>{t('settings.unitsHint')}</Text>
      </Card>

      <Card index={1}>
        <SectionTitle>{t('settings.remindersTitle')}</SectionTitle>
        <Hint>{t('settings.reminderWeeklyHint')}</Hint>

        <Segmented<'on' | 'off'>
          label={t('settings.reminderWeekly')}
          selected={reminderOn ? 'on' : 'off'}
          onSelect={(next) => void toggleReminder(next)}
          options={[
            { value: 'on', label: t('settings.reminderOn') },
            { value: 'off', label: t('settings.reminderOff') },
          ]}
        />
        {reminderDenied ? <Banner tone="warning">{t('settings.reminderDenied')}</Banner> : null}
      </Card>

      <Card index={2}>
        <SectionTitle>{t('gyms.title')}</SectionTitle>
        <Hint>{t('gyms.addHint')}</Hint>
        <Pressable
          onPress={() => router.push('/gyms')}
          accessibilityRole="button"
          style={({ pressed }) => [styles.linkRow, pressed && { opacity: 0.7 }]}
        >
          <Text style={styles.linkText}>{t('gyms.manage')}</Text>
          <Text style={styles.linkChevron}>{isRtlLanguage(i18n.language as Language) ? '‹' : '›'}</Text>
        </Pressable>
      </Card>

      {session ? <SyncCard /> : null}

      {session ? (
        <Card index={2}>
          <SectionTitle>{t('settings.account')}</SectionTitle>
          <Text style={styles.email}>{session.user.email}</Text>
          <View style={styles.signOutSpacer} />
          <Button label={t('auth.signOut')} variant="danger" onPress={() => void signOut()} />
        </Card>
      ) : null}
    </ScrollView>
  );
}

const createStyles = (colors: ColorPalette) =>
  StyleSheet.create<{
    screen: ViewStyle;
    content: ViewStyle;
    unitsHint: TextStyle;
    linkRow: ViewStyle;
    linkText: TextStyle;
    linkChevron: TextStyle;
    email: TextStyle;
    signOutSpacer: ViewStyle;
  }>({
    screen: { flex: 1 },
    content: { paddingHorizontal: spacing.lg },
    unitsHint: {
      color: colors.textFaint,
      fontSize: fontSize.xs,
      marginTop: spacing.sm,
      textAlign: 'auto',
    },
    linkRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginTop: spacing.sm,
      paddingVertical: spacing.sm,
    },
    linkText: { color: colors.text, fontSize: fontSize.sm, textAlign: 'auto' },
    linkChevron: { color: colors.textMuted, fontSize: fontSize.lg },
    email: { color: colors.textSecondary, fontSize: fontSize.sm, textAlign: 'auto' },
    signOutSpacer: { height: spacing.md },
  });
