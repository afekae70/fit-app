/**
 * Settings hub — appearance and account, previously scattered as inline buttons in the Today
 * and Coach tab headers. Consolidated here once there were enough of them (theme, language,
 * sign-out) that leaving them spread across two screens started to look like clutter rather
 * than convenience.
 */

import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, StyleSheet, Text, View, type TextStyle, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAuth } from '../src/auth/AuthProvider.js';
import { Banner, Button, Card, ScreenTitle, Segmented, SectionTitle } from '../src/components/ui.js';
import { setAppLanguage, type Language } from '../src/i18n/index.js';
import { useTheme, type ColorScheme } from '../src/ThemeProvider.js';
import { fontSize, spacing, type ColorPalette } from '../src/theme.js';

export default function SettingsScreen() {
  const { t, i18n } = useTranslation();
  const insets = useSafeAreaInsets();
  const isHebrew = i18n.language === 'he';
  const { session, signOut } = useAuth();
  const { scheme, toggleScheme, colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const [reloadNeeded, setReloadNeeded] = useState(false);

  // setAppLanguage never restarts the app itself (see its file header for why) — the banner
  // below is how a direction change actually reaches the user's eyes.
  const changeLanguage = async (next: Language) => {
    if (next === i18n.language) return;
    const result = await setAppLanguage(next);
    setReloadNeeded(result.directionChanged);
  };

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[
        styles.content,
        { paddingTop: insets.top + spacing.lg, paddingBottom: insets.bottom + spacing.xxl },
      ]}
    >
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} accessibilityRole="button" hitSlop={8}>
          <Text style={styles.back}>{isHebrew ? '›' : '‹'}</Text>
        </Pressable>
        <ScreenTitle>{t('settings.title')}</ScreenTitle>
      </View>

      {reloadNeeded ? <Banner tone="warning">{t('settings.reloadForRtl')}</Banner> : null}

      <Card>
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
      </Card>

      {session ? (
        <Card>
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
    header: ViewStyle;
    back: TextStyle;
    email: TextStyle;
    signOutSpacer: ViewStyle;
  }>({
    screen: { flex: 1 },
    content: { paddingHorizontal: spacing.lg },
    header: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginBottom: spacing.lg },
    back: { color: colors.accent, fontSize: fontSize.xl, fontWeight: '700' },
    email: { color: colors.textSecondary, fontSize: fontSize.sm, textAlign: 'auto' },
    signOutSpacer: { height: spacing.md },
  });
