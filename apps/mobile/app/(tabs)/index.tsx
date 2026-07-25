/**
 * Today screen — a live BMR / TDEE / macro calculator.
 *
 * Everything here is computed by `@fit/shared`, the same module the API imports. That is the
 * point of this screen existing before the backend does: it proves the shared calculation
 * layer runs correctly on device, and gives real output with no Supabase project required.
 *
 * Once auth lands, these inputs come from the user's stored profile instead of local state.
 */

import { useMemo, useState } from 'react';
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

import {
  ACTIVITY_LEVELS,
  bmi as computeBmi,
  bmiCategory,
  bmr as computeBmr,
  calorieTarget,
  GOALS,
  macroSplit,
  resolveBmrSex,
  tdee as computeTdee,
  type ActivityLevel,
  type Goal,
} from '@fit/shared/calculations';

import { Banner, Card, Hint, NumberField, Segmented, SectionTitle, Stat } from '../../src/components/ui.js';
import { setAppLanguage, type Language } from '../../src/i18n/index.js';
import { colors, fontSize, spacing } from '../../src/theme.js';

type SexChoice = 'male' | 'female';

/** Parse a user-typed number, tolerating an empty field and a comma decimal separator. */
function parseNumber(raw: string): number | null {
  const normalised = raw.replace(',', '.').trim();
  if (normalised === '') return null;
  const value = Number(normalised);
  return Number.isFinite(value) && value > 0 ? value : null;
}

export default function TodayScreen() {
  const { t, i18n } = useTranslation();
  const insets = useSafeAreaInsets();

  const [weightRaw, setWeightRaw] = useState('80');
  const [heightRaw, setHeightRaw] = useState('180');
  const [ageRaw, setAgeRaw] = useState('30');
  const [sex, setSex] = useState<SexChoice>('male');
  const [activityLevel, setActivityLevel] = useState<ActivityLevel>('moderate');
  const [goal, setGoal] = useState<Goal>('cut');
  const [reloadNeeded, setReloadNeeded] = useState(false);

  const results = useMemo(() => {
    const weightKg = parseNumber(weightRaw);
    const heightCm = parseNumber(heightRaw);
    const ageYears = parseNumber(ageRaw);
    if (weightKg === null || heightCm === null || ageYears === null) return null;

    // Guard against values the formulas reject outright (they throw RangeError), so a
    // half-typed field renders as "no result" rather than crashing the screen.
    if (heightCm <= 50 || heightCm >= 260 || weightKg >= 500) return null;

    const bmrSex = resolveBmrSex(sex);
    if (bmrSex === null) return null;

    const bmrKcal = computeBmr({ weightKg, heightCm, ageYears, sex: bmrSex });
    const tdeeKcal = computeTdee(bmrKcal, activityLevel);
    const target = calorieTarget(tdeeKcal, goal, { bmrKcal });
    const macros = macroSplit(target.calories, weightKg, goal);
    const bmiValue = computeBmi(weightKg, heightCm);

    return {
      bmrKcal: Math.round(bmrKcal),
      tdeeKcal: Math.round(tdeeKcal),
      target,
      macros,
      bmiValue,
      bmiLabel: bmiCategory(bmiValue),
    };
  }, [weightRaw, heightRaw, ageRaw, sex, activityLevel, goal]);

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
        { paddingTop: insets.top + spacing.lg, paddingBottom: spacing.xxl },
      ]}
      keyboardShouldPersistTaps="handled"
    >
      <View style={styles.header}>
        <Text style={styles.appName}>{t('common.appName')}</Text>
        <Pressable onPress={toggleLanguage} style={styles.langButton} accessibilityRole="button">
          <Text style={styles.langButtonText}>{t('dev.languageToggle')}</Text>
        </Pressable>
      </View>

      {reloadNeeded ? (
        <Banner tone="warning">
          {/* forceRTL only applies on the next bundle load — see src/i18n/index.ts */}
          {i18n.language === 'he'
            ? 'השפה הוחלפה. סגור ופתח את האפליקציה כדי להחליף גם את כיוון הפריסה.'
            : 'Language changed. Reopen the app to switch layout direction too.'}
        </Banner>
      ) : null}

      <Card>
        <SectionTitle>{t('profile.title')}</SectionTitle>
        <Hint>{t('profile.subtitle')}</Hint>

        <NumberField
          label={t('profile.weight')}
          value={weightRaw}
          suffix={t('common.kg')}
          onChangeText={setWeightRaw}
        />
        <NumberField
          label={t('profile.height')}
          value={heightRaw}
          suffix={t('common.cm')}
          onChangeText={setHeightRaw}
        />
        <NumberField
          label={t('profile.age')}
          value={ageRaw}
          suffix={t('profile.years')}
          onChangeText={setAgeRaw}
        />

        <Segmented<SexChoice>
          label={t('profile.sex')}
          selected={sex}
          onSelect={setSex}
          options={[
            { value: 'male', label: t('profile.male') },
            { value: 'female', label: t('profile.female') },
          ]}
        />

        <Segmented<ActivityLevel>
          label={t('profile.activityLevel')}
          selected={activityLevel}
          onSelect={setActivityLevel}
          options={ACTIVITY_LEVELS.map((level) => ({
            value: level,
            label: t(`activity.${level}`),
          }))}
        />

        <Segmented<Goal>
          label={t('profile.goal')}
          selected={goal}
          onSelect={setGoal}
          options={GOALS.map((g) => ({ value: g, label: t(`goal.${g}`) }))}
        />
      </Card>

      {results ? (
        <>
          <Card>
            <SectionTitle>{t('targets.title')}</SectionTitle>
            <Stat
              label={t('targets.calorieTarget')}
              value={String(results.target.calories)}
              unit={t('common.kcal')}
              emphasis
            />
            {results.target.clampedToBmr ? (
              <Banner tone="warning">{t('targets.clampedWarning')}</Banner>
            ) : null}

            <View style={styles.divider} />

            <Stat
              label={t('targets.bmr')}
              value={String(results.bmrKcal)}
              unit={t('common.kcal')}
              hint={t('targets.bmrHint')}
            />
            <Stat
              label={t('targets.tdee')}
              value={String(results.tdeeKcal)}
              unit={t('common.kcal')}
              hint={t('targets.tdeeHint')}
            />
            <Stat
              label={t('targets.bmi')}
              value={results.bmiValue.toFixed(1)}
              hint={t('targets.bmiMuscleCaveat')}
            />
          </Card>

          <Card>
            <SectionTitle>{t('targets.protein')} · {t('targets.carbs')} · {t('targets.fat')}</SectionTitle>
            <View style={styles.macroRow}>
              <Stat
                label={t('targets.protein')}
                value={String(results.macros.proteinG)}
                unit={t('common.grams')}
                color={colors.protein}
              />
              <Stat
                label={t('targets.carbs')}
                value={String(results.macros.carbsG)}
                unit={t('common.grams')}
                color={colors.carbs}
              />
              <Stat
                label={t('targets.fat')}
                value={String(results.macros.fatG)}
                unit={t('common.grams')}
                color={colors.fat}
              />
            </View>
          </Card>
        </>
      ) : null}

      <Card>
        <SectionTitle>{t('dev.statusTitle')}</SectionTitle>
        <View style={styles.statusRow}>
          <Text style={styles.statusOk}>✅ {t('dev.calculationsLive')}</Text>
          <Hint>{t('dev.calculationsHint')}</Hint>
        </View>
        <View style={styles.statusRow}>
          <Text style={styles.statusPending}>⏳ {t('dev.noBackend')}</Text>
          <Hint>{t('dev.noBackendHint')}</Hint>
        </View>
      </Card>
    </ScrollView>
  );
}

// Per-key types — see the note in src/components/ui.tsx for why this is explicit.
const styles = StyleSheet.create<{
  screen: ViewStyle;
  content: ViewStyle;
  header: ViewStyle;
  appName: TextStyle;
  langButton: ViewStyle;
  langButtonText: TextStyle;
  divider: ViewStyle;
  macroRow: ViewStyle;
  statusRow: ViewStyle;
  statusOk: TextStyle;
  statusPending: TextStyle;
}>({
  screen: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  content: {
    paddingHorizontal: spacing.lg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.lg,
  },
  appName: {
    color: colors.text,
    fontSize: fontSize.xl,
    fontWeight: '800',
  },
  langButton: {
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
  },
  langButtonText: {
    color: colors.textMuted,
    fontSize: fontSize.sm,
  },
  divider: {
    height: 1,
    backgroundColor: colors.border,
    marginVertical: spacing.md,
  },
  macroRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  statusRow: {
    marginBottom: spacing.sm,
  },
  statusOk: {
    color: colors.accent,
    fontSize: fontSize.md,
    fontWeight: '600',
    textAlign: 'auto',
  },
  statusPending: {
    color: colors.warning,
    fontSize: fontSize.md,
    fontWeight: '600',
    textAlign: 'auto',
  },
});
