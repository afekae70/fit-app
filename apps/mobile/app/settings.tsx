/**
 * Settings.
 *
 * Read from the top: who is signed in, then how the app looks, then what it reminds and what it
 * talks to, and the account last — the two rows on this screen that cannot be taken back are
 * the furthest from a thumb that has just arrived.
 *
 * Everything is one of a handful of shapes from `components/settings/kit` — a section with a
 * badge and a name, a row with its control at the end, a lit choice among two or three — so the
 * screen can be scanned rather than read. The sections that are features in their own right
 * (workout-day reminders, Health Connect, cloud sync) keep their logic in their own components
 * and wear the same shapes.
 */

import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Image,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type ImageStyle,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { BellRinging, Palette, SignOut, Trash, UserCircle } from 'phosphor-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { UnitPreference } from '@fit/shared';

import { useAuth } from '../src/auth/AuthProvider.js';
import { useCurrentUserId } from '../src/auth/CurrentUserProvider.js';
import { useSignOut } from '../src/auth/useSignOut.js';
import { useActionSheet } from '../src/components/ActionSheetProvider.js';
import { HealthSyncCard } from '../src/components/HealthSyncCard.js';
import { FadeSlideIn } from '../src/components/motion.js';
import {
  Choice,
  LinkRow,
  RowDivider,
  SettingRow,
  SettingsSection,
  ToggleRow,
} from '../src/components/settings/kit.js';
import { SyncCard } from '../src/components/SyncCard.js';
import { Banner, ScreenHeader } from '../src/components/ui.js';
import { WorkoutReminderCard } from '../src/components/WorkoutReminderCard.js';
import { setAppLanguage, type Language } from '../src/i18n/index.js';
import {
  cancelWeeklyReminder,
  isWeeklyReminderScheduled,
  scheduleWeeklyReminder,
} from '../src/notifications.js';
import { loadAvatar } from '../src/profile/avatar.js';
import { useTheme, type ThemePreference } from '../src/ThemeProvider.js';
import { fontSize, fontWeight, radius, shadow, spacing, type ColorPalette } from '../src/theme.js';
import { useUnits } from '../src/UnitsProvider.js';

export default function SettingsScreen() {
  const { t, i18n } = useTranslation();
  const insets = useSafeAreaInsets();
  const { session, deleteAccount } = useAuth();
  const { preference, setPreference, colors } = useTheme();
  const { unit, setUnit } = useUnits();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const { notify, confirm } = useActionSheet();
  const signOut = useSignOut();
  const [deleting, setDeleting] = useState(false);
  const userId = useCurrentUserId();

  const [avatarUri, setAvatarUri] = useState<string | null>(null);
  useEffect(() => {
    void loadAvatar(userId).then(setAvatarUri);
  }, [userId]);

  /**
   * Delete the account, after asking twice.
   *
   * Twice because the first question is about the decision and the second is about the finger:
   * a sheet that appears under a thumb already on its way down gets confirmed by accident, and
   * this cannot be taken back. The second one names the account, so it is read.
   *
   * On success there is nothing to do here — the session is gone and the gate above this screen
   * shows the sign-in page. On failure nothing was deleted anywhere, and the message says which
   * kind of failure it was, because the three have different remedies.
   */
  const removeAccount = async () => {
    const decided = await confirm({
      title: t('settings.deleteAccountTitle'),
      message: t('settings.deleteAccountBody'),
      confirmLabel: t('settings.deleteAccountContinue'),
    });
    if (!decided) return;

    const sure = await confirm({
      title: t('settings.deleteAccountFinalTitle'),
      message: t('settings.deleteAccountFinalBody', { email: session?.user.email ?? '' }),
      confirmLabel: t('settings.deleteAccountFinalConfirm'),
    });
    if (!sure) return;

    setDeleting(true);
    const outcome = await deleteAccount();
    setDeleting(false);
    if (outcome.status === 'deleted') return;

    const reasons = {
      not_signed_in: t('settings.deleteAccountNotSignedIn'),
      not_available: t('settings.deleteAccountNotAvailable'),
      offline: t('settings.deleteAccountOffline'),
      failed: t('settings.deleteAccountFailed'),
    };
    await notify({
      title: t('settings.deleteAccountFailedTitle'),
      message: reasons[outcome.status],
    });
  };

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

  const toggleReminder = async (next: boolean) => {
    if (!next) {
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

  // No "reopen the app" prompt: the root View's `direction` follows i18next, so the layout
  // mirrors as the language changes (see app/_layout.tsx).
  const changeLanguage = async (next: Language) => {
    if (next === i18n.language) return;
    await setAppLanguage(next);
  };

  const email = session?.user.email ?? '';

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[
        styles.content,
        { paddingTop: spacing.lg, paddingBottom: insets.bottom + spacing.xxl },
      ]}
      showsVerticalScrollIndicator={false}
    >
      <ScreenHeader title={t('settings.title')} />

      {session ? (
        <FadeSlideIn style={styles.heroShadow}>
          <LinearGradient
            colors={[colors.accent, colors.info]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.hero}
          >
            <View style={styles.avatar}>
              {avatarUri ? (
                <Image source={{ uri: avatarUri }} style={styles.avatarImage} />
              ) : (
                <Text style={styles.avatarText}>{initialsFor(email)}</Text>
              )}
            </View>
            <View style={styles.heroText}>
              <Text style={styles.heroCaption}>{t('settings.signedInAs')}</Text>
              <Text style={styles.heroEmail} numberOfLines={1}>
                {email}
              </Text>
            </View>
          </LinearGradient>
        </FadeSlideIn>
      ) : null}

      <SettingsSection icon={Palette} title={t('settings.appearance')} index={1}>
        {/* Following the phone leads, because a phone that goes dark at sunset should take
            this app with it — the other two are for when someone wants it fixed. */}
        <SettingRow label={t('settings.theme')} stacked>
          <Choice<ThemePreference>
            selected={preference}
            onSelect={setPreference}
            options={[
              { value: 'system', label: t('settings.themeSystem') },
              { value: 'light', label: t('settings.themeLight') },
              { value: 'dark', label: t('settings.themeDark') },
            ]}
          />
        </SettingRow>
        <RowDivider />
        <SettingRow label={t('settings.language')} stacked>
          <Choice<Language>
            selected={i18n.language as Language}
            onSelect={(next) => void changeLanguage(next)}
            options={[
              { value: 'he', label: 'עברית' },
              { value: 'en', label: 'English' },
            ]}
          />
        </SettingRow>
        <RowDivider />
        <SettingRow label={t('settings.units')} hint={t('settings.unitsHint')} stacked>
          <Choice<UnitPreference>
            selected={unit}
            onSelect={setUnit}
            options={[
              { value: 'metric', label: t('settings.unitsMetric') },
              { value: 'imperial', label: t('settings.unitsImperial') },
            ]}
          />
        </SettingRow>
      </SettingsSection>

      <SettingsSection icon={BellRinging} title={t('settings.remindersTitle')} index={2}>
        <ToggleRow
          label={t('settings.reminderWeekly')}
          hint={t('settings.reminderWeeklyHint')}
          value={reminderOn}
          onChange={(next) => void toggleReminder(next)}
        />
        {reminderDenied ? <Banner tone="warning">{t('settings.reminderDenied')}</Banner> : null}
      </SettingsSection>

      <WorkoutReminderCard userId={userId} index={3} />

      <HealthSyncCard userId={userId} index={4} />

      {session ? <SyncCard index={5} /> : null}

      {session ? (
        <SettingsSection icon={UserCircle} title={t('settings.account')} index={6}>
          <LinkRow icon={SignOut} label={t('auth.signOut')} onPress={signOut} chevron={false} />
          <RowDivider />
          {/* Last on the screen and in the colour of a warning. Leaving for good is something
              a person has to be able to do without writing to anyone — and it is asked about
              twice, because nothing brings it back. */}
          <LinkRow
            icon={Trash}
            tone="danger"
            label={deleting ? t('settings.deleteAccountWorking') : t('settings.deleteAccount')}
            onPress={() => void removeAccount()}
            disabled={deleting}
            chevron={false}
          />
        </SettingsSection>
      ) : null}
    </ScrollView>
  );
}

function initialsFor(email: string): string {
  const letters = (email.split('@')[0] ?? '').replace(/[^\p{L}]/gu, '');
  return letters.slice(0, 2).toUpperCase() || '·';
}

const createStyles = (colors: ColorPalette) =>
  StyleSheet.create<{
    screen: ViewStyle;
    content: ViewStyle;
    heroShadow: ViewStyle;
    hero: ViewStyle;
    avatar: ViewStyle;
    avatarImage: ImageStyle;
    avatarText: TextStyle;
    heroText: ViewStyle;
    heroCaption: TextStyle;
    heroEmail: TextStyle;
  }>({
    screen: { flex: 1 },
    content: { paddingHorizontal: spacing.lg, gap: spacing.lg },

    // On a plain view around the gradient: a gradient clipped to rounded corners cannot also
    // cast the shadow of them.
    heroShadow: {
      borderRadius: radius.xl,
      backgroundColor: colors.accent,
      ...shadow(colors.accent).hero,
    },
    hero: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.lg,
      padding: spacing.lg,
      borderRadius: radius.xl,
      overflow: 'hidden',
    },
    avatar: {
      width: 56,
      height: 56,
      borderRadius: radius.pill,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: 'rgba(255, 255, 255, 0.22)',
      borderWidth: 1.5,
      borderColor: 'rgba(255, 255, 255, 0.55)',
      overflow: 'hidden',
    },
    avatarImage: { width: '100%', height: '100%' },
    avatarText: { color: colors.bg, fontSize: fontSize.lg, fontWeight: fontWeight.bold },
    heroText: { flex: 1, gap: spacing.xxs },
    heroCaption: { color: colors.bg, opacity: 0.8, fontSize: fontSize.xs, textAlign: 'auto' },
    heroEmail: {
      color: colors.bg,
      fontSize: fontSize.md,
      fontWeight: fontWeight.bold,
      textAlign: 'auto',
    },
  });
