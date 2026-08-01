/**
 * Today screen — a live BMR / TDEE / macro calculator.
 *
 * Everything here is computed by `@fit/shared`, the same module the API imports. That is the
 * point of this screen existing before the backend does: it proves the shared calculation
 * layer runs correctly on device, and gives real output with no Supabase project required.
 *
 * Once auth lands, these inputs come from the user's stored profile instead of local state.
 */

import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
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

import { useAuth } from '../../src/auth/AuthProvider.js';
import { useCurrentUserId } from '../../src/auth/CurrentUserProvider.js';
import { getDailyBrief } from '../../src/coach/dailyBrief.js';
import {
  Banner,
  Card,
  Hint,
  NumberField,
  Segmented,
  SectionTitle,
  Stat,
} from '../../src/components/ui.js';
import { API_BASE_URL } from '../../src/config.js';
import { getLatestWeight, getProfile, recordBodyMetric, saveProfile } from '../../src/db/metrics.js';
import { getExecutor, newId } from '../../src/db/provider.js';
import { getWorkoutStreak, type WorkoutStreak } from '../../src/db/workouts.js';
import { useTheme } from '../../src/ThemeProvider.js';
import { fontSize, spacing, type ColorPalette } from '../../src/theme.js';

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
  const isHebrew = i18n.language === 'he';
  const insets = useSafeAreaInsets();
  const userId = useCurrentUserId();
  const { session } = useAuth();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const [weightRaw, setWeightRaw] = useState('80');
  const [heightRaw, setHeightRaw] = useState('180');
  const [ageRaw, setAgeRaw] = useState('30');
  const [sex, setSex] = useState<SexChoice>('male');
  const [activityLevel, setActivityLevel] = useState<ActivityLevel>('moderate');
  const [goal, setGoal] = useState<Goal>('cut');
  const [hydrated, setHydrated] = useState(false);
  const [streak, setStreak] = useState<WorkoutStreak | null>(null);
  const [brief, setBrief] = useState<string | null>(null);

  // Once per mount, not on every focus: the brief is cached per calendar day (see
  // getDailyBrief), so refetching on every tab switch would only add repeat network calls on the
  // days it fails, never a fresher result on the days it succeeds.
  useEffect(() => {
    const accessToken = session?.access_token;
    if (!accessToken || !API_BASE_URL) return;
    let cancelled = false;
    void (async () => {
      const db = await getExecutor();
      const text = await getDailyBrief({
        db,
        userId,
        newId,
        locale: isHebrew ? 'he' : 'en',
        baseUrl: API_BASE_URL,
        accessToken,
      });
      if (!cancelled) setBrief(text);
    })();
    return () => {
      cancelled = true;
    };
  }, [userId, session?.access_token, isHebrew]);

  // useFocusEffect rather than useEffect: a workout gets finished on another tab, so coming back
  // to Today must show the fresh streak rather than whatever it was on first mount.
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      void (async () => {
        const db = await getExecutor();
        const result = await getWorkoutStreak(db, userId);
        if (!cancelled) setStreak(result);
      })();
      return () => {
        cancelled = true;
      };
    }, [userId]),
  );

  // Load the saved profile and latest weight once. Until this completes, the fields show
  // defaults; writing those defaults back would overwrite real saved values, hence `hydrated`.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const db = await getExecutor();
      const [profile, latest] = await Promise.all([
        getProfile(db, userId),
        getLatestWeight(db, userId),
      ]);
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
      await saveProfile(db, userId, {
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

  const renderMacroBar = (label: string, grams: number, share: number, color: string) => (
    <View key={label} style={styles.macroBarBlock}>
      <View style={styles.macroBarHeader}>
        <Text style={styles.macroBarLabel}>{label}</Text>
        <Text style={styles.macroBarValue}>
          {grams}
          {t('common.grams')}
        </Text>
      </View>
      <View style={styles.macroBarTrack}>
        <View
          style={[
            styles.macroBarFill,
            { width: `${Math.round(share * 100)}%`, backgroundColor: color },
          ]}
        />
      </View>
    </View>
  );

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
        <Pressable
          // eslint-disable-next-line @typescript-eslint/no-explicit-any -- settings.tsx is new;
          // expo-router's typed-routes union regenerates on the next `expo start`/build.
          onPress={() => router.push('/settings' as any)}
          style={styles.langButton}
          accessibilityRole="button"
          accessibilityLabel={t('settings.title')}
          hitSlop={8}
        >
          <Text style={styles.langButtonText}>⚙️</Text>
        </Pressable>
      </View>

      {streak && streak.currentDays > 0 ? (
        <Card style={styles.streakCard}>
          <View style={styles.streakRow}>
            <Text style={styles.streakEmoji}>🔥</Text>
            <View style={styles.streakTextCol}>
              <Text style={styles.streakDays}>
                {t('streak.days', { count: streak.currentDays })}
              </Text>
              <Text style={styles.streakSub}>
                {t(streak.trainedToday ? 'streak.trainedToday' : 'streak.trainToday')}
              </Text>
            </View>
          </View>
        </Card>
      ) : null}

      {brief ? (
        <Card tone="accent" style={styles.briefCard}>
          <View style={styles.briefRow}>
            <Text style={styles.briefEmoji}>🧠</Text>
            <View style={styles.streakTextCol}>
              <Text style={styles.briefTitle}>{t('coach.dailyBriefTitle')}</Text>
              <Text style={styles.briefText}>{brief}</Text>
            </View>
          </View>
        </Card>
      ) : null}

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
              const latest = await getLatestWeight(db, userId);
              if (latest?.weight_kg === value) return; // no change, no duplicate row
              await recordBodyMetric(db, userId, newId, { weightKg: value, source: 'manual' });
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
            {(() => {
              // Shown as each macro's share of the day's calories, not "progress toward a goal"
              // — there is no food log here, so these three numbers ARE the target, not an
              // intake to compare against it. The bars visualise the split, nothing more.
              const proteinKcal = results.macros.proteinG * 4;
              const carbsKcal = results.macros.carbsG * 4;
              const fatKcal = results.macros.fatG * 9;
              const totalKcal = proteinKcal + carbsKcal + fatKcal;
              const share = (kcal: number) => (totalKcal > 0 ? kcal / totalKcal : 0);

              return (
                <>
                  {renderMacroBar(t('targets.protein'), results.macros.proteinG, share(proteinKcal), colors.protein)}
                  {renderMacroBar(t('targets.carbs'), results.macros.carbsG, share(carbsKcal), colors.carbs)}
                  {renderMacroBar(t('targets.fat'), results.macros.fatG, share(fatKcal), colors.fat)}
                </>
              );
            })()}
          </Card>
        </>
      ) : null}

    </ScrollView>
  );
}

// Per-key types — see the note in src/components/ui.tsx for why this is explicit.
const createStyles = (colors: ColorPalette) =>
  StyleSheet.create<{
    screen: ViewStyle;
    content: ViewStyle;
    header: ViewStyle;
    appName: TextStyle;
    langButton: ViewStyle;
    langButtonText: TextStyle;
    streakCard: ViewStyle;
    streakRow: ViewStyle;
    streakEmoji: TextStyle;
    streakTextCol: ViewStyle;
    streakDays: TextStyle;
    streakSub: TextStyle;
    briefCard: ViewStyle;
    briefRow: ViewStyle;
    briefEmoji: TextStyle;
    briefTitle: TextStyle;
    briefText: TextStyle;
    divider: ViewStyle;
    macroBarBlock: ViewStyle;
    macroBarHeader: ViewStyle;
    macroBarLabel: TextStyle;
    macroBarValue: TextStyle;
    macroBarTrack: ViewStyle;
    macroBarFill: ViewStyle;
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
  streakCard: {
    paddingVertical: spacing.md,
  },
  streakRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  streakEmoji: {
    fontSize: 32,
  },
  streakTextCol: {
    flex: 1,
  },
  streakDays: {
    color: colors.text,
    fontSize: fontSize.md,
    fontWeight: '700',
    textAlign: 'auto',
  },
  streakSub: {
    color: colors.textMuted,
    fontSize: fontSize.xs,
    marginTop: spacing.xxs,
    textAlign: 'auto',
  },
  briefCard: {
    paddingVertical: spacing.md,
  },
  briefRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
  },
  briefEmoji: {
    fontSize: 24,
  },
  briefTitle: {
    color: colors.accent,
    fontSize: fontSize.xs,
    fontWeight: '700',
    textTransform: 'uppercase',
    marginBottom: spacing.xxs,
    textAlign: 'auto',
  },
  briefText: {
    color: colors.text,
    fontSize: fontSize.sm,
    lineHeight: 20,
    textAlign: 'auto',
  },
  divider: {
    height: 1,
    backgroundColor: colors.border,
    marginVertical: spacing.md,
  },
  macroBarBlock: {
    marginTop: spacing.md,
  },
  macroBarHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: spacing.xs,
  },
  macroBarLabel: { color: colors.text, fontSize: fontSize.sm, fontWeight: '600', textAlign: 'auto' },
  macroBarValue: { color: colors.textMuted, fontSize: fontSize.sm, textAlign: 'auto' },
  macroBarTrack: {
    height: 10,
    borderRadius: 999,
    backgroundColor: colors.surfaceRaised,
    overflow: 'hidden',
  },
  macroBarFill: {
    height: '100%',
    borderRadius: 999,
  },
});
