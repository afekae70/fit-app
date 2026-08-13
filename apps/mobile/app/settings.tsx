/**
 * Settings — units, the rest-timer default, and language.
 *
 * A separate screen rather than another card on the Today tab: these are set once and then
 * left alone for months, and putting them inline would push the numbers people actually open
 * that tab for further down the scroll every time a preference is added.
 *
 * Language moved here from the Today header in the same change. A settings screen that omits
 * the one preference the app already had would be the odd thing.
 */

import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, StyleSheet, Text, View, type TextStyle, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Banner, Button, Card, Hint, NumberField, SectionTitle, Segmented } from '../src/components/ui.js';
import { setAppLanguage, type Language } from '../src/i18n/index.js';
import { useSettings } from '../src/settings.js';
import { colors, fontSize, fontWeight, radius, spacing } from '../src/theme.js';
import { UNIT_SYSTEMS, type UnitSystem } from '../src/units.js';

/** Empty clears the timer; anything unparseable leaves the stored value alone. */
function parseRest(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === '') return null;
  const value = Number(trimmed);
  return Number.isFinite(value) && value > 0 ? Math.round(value) : null;
}

export default function SettingsScreen() {
  const { t, i18n } = useTranslation();
  const insets = useSafeAreaInsets();
  const { settings, update } = useSettings();

  const [restRaw, setRestRaw] = useState(
    settings.defaultRestSeconds === null ? '' : String(settings.defaultRestSeconds),
  );
  const [reloadNeeded, setReloadNeeded] = useState(false);

  // The provider finishes loading the profile after the first render, so the field has to pick
  // up the stored value when it arrives rather than keeping the initial state forever.
  useEffect(() => {
    setRestRaw(settings.defaultRestSeconds === null ? '' : String(settings.defaultRestSeconds));
  }, [settings.defaultRestSeconds]);

  const toggleLanguage = async () => {
    const next: Language = i18n.language === 'he' ? 'en' : 'he';
    const result = await setAppLanguage(next);
    setReloadNeeded(result.needsReloadForRtl);
  };

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[
        styles.content,
        { paddingTop: insets.top + spacing.lg, paddingBottom: insets.bottom + spacing.xxl },
      ]}
      keyboardShouldPersistTaps="handled"
    >
      <View style={styles.header}>
        <Text style={styles.title}>{t('settings.title')}</Text>
        <Pressable onPress={() => router.back()} style={styles.closeButton} accessibilityRole="button">
          <Text style={styles.closeText}>✕</Text>
        </Pressable>
      </View>

      <Card>
        <SectionTitle>{t('settings.unitsTitle')}</SectionTitle>
        <Hint>{t('settings.unitsHint')}</Hint>

        <Segmented<UnitSystem>
          label={t('settings.unitSystem')}
          selected={settings.unitSystem}
          onSelect={(unitSystem) => void update({ unitSystem })}
          options={UNIT_SYSTEMS.map((system) => ({
            value: system,
            label: t(`settings.${system}`),
          }))}
        />
        <Text style={styles.example}>
          {settings.unitSystem === 'imperial'
            ? t('settings.imperialExample')
            : t('settings.metricExample')}
        </Text>
      </Card>

      <Card>
        <SectionTitle>{t('settings.timerTitle')}</SectionTitle>
        <Hint>{t('settings.timerHint')}</Hint>

        <NumberField
          label={t('settings.defaultRest')}
          value={restRaw}
          suffix={t('plan.restSeconds')}
          onChangeText={setRestRaw}
          // Committed on blur rather than per keystroke: typing "120" passes through "1" and
          // "12", and writing those would leave the timer at one second between characters.
          onEndEditing={() => void update({ defaultRestSeconds: parseRest(restRaw) })}
        />
        {restRaw.trim() === '' ? <Hint>{t('settings.timerOffHint')}</Hint> : null}
      </Card>

      <Card>
        <SectionTitle>{t('settings.languageTitle')}</SectionTitle>
        <Hint>{t('settings.languageHint')}</Hint>
        <Button label={t('dev.languageToggle')} variant="secondary" onPress={() => void toggleLanguage()} />
        {reloadNeeded ? (
          <Banner tone="warning">
            {/* forceRTL only applies on the next bundle load — see src/i18n/index.ts */}
            {i18n.language === 'he'
              ? 'השפה הוחלפה. סגור ופתח את האפליקציה כדי להחליף גם את כיוון הפריסה.'
              : 'Language changed. Reopen the app to switch layout direction too.'}
          </Banner>
        ) : null}
      </Card>
    </ScrollView>
  );
}

const styles = StyleSheet.create<{
  screen: ViewStyle;
  content: ViewStyle;
  header: ViewStyle;
  title: TextStyle;
  closeButton: ViewStyle;
  closeText: TextStyle;
  example: TextStyle;
}>({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { paddingHorizontal: spacing.lg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.lg,
  },
  title: { color: colors.text, fontSize: fontSize.xxl, fontWeight: fontWeight.bold, letterSpacing: -0.5 },
  closeButton: {
    width: 36,
    height: 36,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceRaised,
  },
  closeText: { color: colors.textMuted, fontSize: fontSize.md },
  example: {
    color: colors.textFaint,
    fontSize: fontSize.xs,
    marginTop: spacing.sm,
    textAlign: 'auto',
  },
});
