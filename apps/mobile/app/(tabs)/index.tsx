/**
 * Today screen — a live BMR / TDEE / macro calculator.
 *
 * Everything here is computed by `@fit/shared`, the same module the API imports. That is the
 * point of this screen existing before the backend does: it proves the shared calculation
 * layer runs correctly on device, and gives real output with no Supabase project required.
 *
 * Once auth lands, these inputs come from the user's stored profile instead of local state.
 */

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

import {
  Banner,
  Card,
  Hint,
  NumberField,
  Segmented,
  SectionTitle,
  Stat,
} from '../../src/components/ui.js';
import { getLatestWeight, getProfile, recordBodyMetric, saveProfile } from '../../src/db/metrics.js';
import { getExecutor, newId } from '../../src/db/provider.js';
import { setAppLanguage, type Language } from '../../src/i18n/index.js';
import { colors, fontSize, spacing } from '../../src/theme.js';

/**
 * Convert an entered age to a date of birth.
 *
 * The profile stores a birth date rather than an age so the value cannot go stale — a stored
 * age silently becomes wrong on the user's birthday and skews every BMR calculation from then
 * on. Anchoring to today's month and day keeps the derived age correct for a full year.
 */
function birthDateFromAge(ageYears: number, today = new Date()): string {
  const birth = new Date(
    Date.UTC(today.getUTCFullYear() - ageYears, today.getUTCMonth(), today.getUTCDate()),
  );
  return birth.toISOString().slice(0, 10);
}

function ageFromBirthDate(birthDate: string, today = new Date()): number {
  const birth = new Date(birthDate);
  let age = today.getUTCFullYear() - birth.getUTCFullYear();
  const monthDelta = today.getUTCMonth() - birth.getUTCMonth();
  if (monthDelta < 0 || (monthDelta === 0 && today.getUTCDate() < birth.getUTCDate())) age -= 1;
  return age;
}

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
  const [hydrated, setHydrated] = useState(false);

  // Load the saved profile and latest weight once. Until this completes, the fields show
  // defaults; writing those defaults back would overwrite real saved values, hence `hydrated`.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const db = await getExecutor();
      const [profile, latest] = await Promise.all([getProfile(db), getLatestWeight(db)]);
      if (cancelled) return;

      if (profile?.height_cm) setHeightRaw(String(profile.height_cm));
      if (profile?.birth_date) setAgeRaw(String(ageFromBirthDate(profile.birth_date)));
      if (profile?.sex === 'male' || profile?.sex === 'female') setSex(profile.sex);
      if (profile?.activity_level) setActivityLevel(profile.activity_level as ActivityLevel);
      if (profile?.goal) setGoal(profile.goal as Goal);
      if (latest?.weight_kg) setWeightRaw(String(latest.weight_kg));

      setHydrated(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Persist profile edits so the metrics tab (and later the AI coach) can read them.
  useEffect(() => {
    if (!hydrated) return;
    const ageYears = parseNumber(ageRaw);
    const heightCm = parseNumber(heightRaw);
    void (async () => {
      const db = await getExecutor();
      await saveProfile(db, {
        heightCm,
        birthDate: ageYears === null ? null : birthDateFromAge(ageYears),
        sex,
        activityLevel,
        goal,
      });
    })();
  }, [hydrated, ageRaw, heightRaw, sex, activityLevel, goal]);

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

  // On a direction change this never returns — setAppLanguage reloads the bundle, and the app
  // comes back mirrored. The banner below is only reached if that reload was refused.
  const toggleLanguage = async () => {
    const next: Language = i18n.language === 'he' ? 'en' : 'he';
    const result = await setAppLanguage(next);
    setReloadNeeded(result.reloadFailed === true);
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

      {/* Only shown when the automatic reload failed; normally the app has already restarted
          mirrored by this point and this branch is never rendered. */}
      {reloadNeeded ? <Banner tone="warning">{t('dev.reloadForRtl')}</Banner> : null}

      <Card>
        <SectionTitle>{t('profile.title')}</SectionTitle>
        <Hint>{t('profile.subtitle')}</Hint>

        <NumberField
          label={t('profile.weight')}
          value={weightRaw}
          suffix={t('common.kg')}
          onChangeText={setWeightRaw}
          // Committed on blur rather than per keystroke: typing "80" passes through "8",
          // and recording that would put a phantom 8 kg weigh-in in the history.
          onEndEditing={() => {
            const value = parseNumber(weightRaw);
            if (value === null || !hydrated) return;
            void (async () => {
              const db = await getExecutor();
              const latest = await getLatestWeight(db);
              if (latest?.weight_kg === value) return; // no change, no duplicate row
              await recordBodyMetric(db, newId, { weightKg: value, source: 'manual' });
            })();
          }}
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
