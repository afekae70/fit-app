/**
 * Weight tracking and derived targets.
 *
 * Manual entry works today; Bluetooth needs a development build (Expo Go cannot do BLE at
 * all), so the scale section explains that rather than offering a button that silently fails.
 *
 * All physiology comes from `@fit/shared` — the same functions the API and the AI coach use,
 * so the number shown here is the number the coach will reason about.
 */

import {
  calorieAdjustmentFromDrift,
  expectedKgPerWeek,
  movingAverage,
} from '@fit/shared/calculations';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Alert,
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

import { Banner, Card, Hint, SectionTitle, Stat } from '../../src/components/ui.js';
import { WeightSparkline } from '../../src/components/WeightSparkline.js';
import {
  computeTargets,
  deleteBodyMetric,
  getProfile,
  listBodyMetrics,
  recordBodyMetric,
  summariseTrend,
  type BodyMetricRow,
  type ComputedTargets,
  type ProfileRow,
  type TargetsGap,
} from '../../src/db/metrics.js';
import { getExecutor, newId } from '../../src/db/provider.js';
import { useUnitSystem } from '../../src/settings.js';
import { colors, fontSize, radius, spacing } from '../../src/theme.js';
import { displayWeightToKg, formatWeight, kgToDisplay, weightUnitKey } from '../../src/units.js';

const GAP_MESSAGE: Record<TargetsGap, string> = {
  no_weight: 'metrics.noDataHint',
  no_height: 'metrics.missingHeight',
  no_birth_date: 'metrics.missingBirthDate',
  no_activity_level: 'metrics.missingActivity',
  no_goal: 'metrics.missingGoal',
  needs_bmr_formula_sex: 'metrics.missingFormulaSex',
};

const SOURCE_LABEL: Record<string, string> = {
  manual: 'metrics.sourceManual',
  ble_scale: 'metrics.sourceScale',
  ai_assistant: 'metrics.sourceAi',
  health_platform: 'metrics.sourceManual',
};

export default function MetricsScreen() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const unitSystem = useUnitSystem();
  const weightUnit = t(`common.${weightUnitKey(unitSystem)}`);

  const [metrics, setMetrics] = useState<BodyMetricRow[]>([]);
  const [profile, setProfile] = useState<ProfileRow | null>(null);
  const [entry, setEntry] = useState('');
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    const db = await getExecutor();
    setMetrics(await listBodyMetrics(db));
    setProfile(await getProfile(db));
  }, []);

  useEffect(() => {
    void (async () => {
      await reload();
      setLoading(false);
    })();
  }, [reload]);

  const save = async () => {
    const typed = Number(entry.replace(',', '.').trim());
    if (!Number.isFinite(typed) || typed <= 0) return;

    // Sanity-check in kilograms, after conversion. Bounding the typed number instead would put
    // the ceiling at 500 lb for imperial users — a different limit depending on the setting.
    const weightKg = displayWeightToKg(typed, unitSystem);
    if (weightKg > 500) return;

    const db = await getExecutor();
    await recordBodyMetric(db, newId, { weightKg, source: 'manual' });
    setEntry('');
    await reload();
  };

  const remove = (id: string) => {
    Alert.alert('', t('metrics.delete'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('metrics.delete'),
        style: 'destructive',
        onPress: () => {
          void (async () => {
            const db = await getExecutor();
            await deleteBodyMetric(db, id);
            await reload();
          })();
        },
      },
    ]);
  };

  if (loading) {
    return (
      <View style={[styles.centered, { paddingTop: insets.top }]}>
        <Text style={styles.muted}>{t('common.loading')}</Text>
      </View>
    );
  }

  // listBodyMetrics returns newest-first; the trend maths expects oldest-first.
  const chronological = [...metrics].reverse();
  const { points, rate } = summariseTrend(chronological);
  const smoothed = movingAverage(points, 7);
  const latest = metrics[0] ?? null;

  const targetsResult = computeTargets(profile, latest?.weight_kg ?? null);
  const targets: ComputedTargets | null = targetsResult.ok ? targetsResult.targets : null;

  // Compare what the plan predicts against what the scale actually did.
  const expected =
    targets !== null ? expectedKgPerWeek(targets.calorieTarget - targets.tdeeKcal) : null;
  const drift =
    rate !== null && rate.isReliable && expected !== null
      ? calorieAdjustmentFromDrift(rate.kgPerWeek, expected)
      : null;

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[
        styles.content,
        { paddingTop: insets.top + spacing.lg, paddingBottom: insets.bottom + spacing.xxl },
      ]}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={styles.pageTitle}>{t('metrics.title')}</Text>

      <Card>
        <SectionTitle>{t('metrics.addWeight')}</SectionTitle>
        <View style={styles.entryRow}>
          <TextInput
            value={entry}
            onChangeText={setEntry}
            placeholder={`${t('metrics.weightPlaceholder')} (${weightUnit})`}
            placeholderTextColor={colors.textMuted}
            keyboardType="numeric"
            inputMode="decimal"
            style={styles.entryInput}
            onSubmitEditing={() => void save()}
            returnKeyType="done"
          />
          <Pressable
            onPress={() => void save()}
            style={styles.saveButton}
            accessibilityRole="button"
          >
            <Text style={styles.saveButtonText}>{t('metrics.save')}</Text>
          </Pressable>
        </View>

        {latest ? (
          <Stat
            label={t('metrics.currentWeight')}
            value={formatWeight(latest.weight_kg, unitSystem) ?? '—'}
            unit={weightUnit}
            emphasis
          />
        ) : (
          <Hint>{t('metrics.noDataHint')}</Hint>
        )}
      </Card>

      {smoothed.length >= 2 ? (
        <Card>
          <SectionTitle>{t('metrics.trendTitle')}</SectionTitle>
          <WeightSparkline points={smoothed} />

          {rate ? (
            <>
              <Stat
                label={
                  rate.kgPerWeek < -0.05
                    ? t('metrics.trendLosing')
                    : rate.kgPerWeek > 0.05
                      ? t('metrics.trendGaining')
                      : t('metrics.trendStable')
                }
                // A rate is a weight per week, so it converts like a weight. The threshold
                // comparisons above stay in kg — they are judgements about the body, not
                // about the display.
                value={`${rate.kgPerWeek > 0 ? '+' : ''}${kgToDisplay(rate.kgPerWeek, unitSystem).toFixed(2)}`}
                unit={`${weightUnit} / ${t('metrics.perWeek')}`}
              />
              {!rate.isReliable ? <Banner tone="info">{t('metrics.unreliable')}</Banner> : null}
            </>
          ) : null}

          {drift !== null && expected !== null ? (
            <>
              <View style={styles.divider} />
              <Stat
                label={t('metrics.expectedRate')}
                value={`${expected > 0 ? '+' : ''}${kgToDisplay(expected, unitSystem).toFixed(2)}`}
                unit={`${weightUnit} / ${t('metrics.perWeek')}`}
              />
              {drift === 0 ? (
                <Banner tone="info">{t('metrics.onTrack')}</Banner>
              ) : (
                <Banner tone="warning">
                  {t('metrics.offTrack')} ·{' '}
                  {t('metrics.adjustSuggestion', { kcal: drift > 0 ? `+${drift}` : drift })}
                </Banner>
              )}
            </>
          ) : null}
        </Card>
      ) : null}

      <Card>
        <SectionTitle>{t('metrics.targetsTitle')}</SectionTitle>
        {/* Branch on the discriminant, not on the extracted `targets`, so TypeScript can
            narrow the result union and reach `.missing` in the else arm. */}
        {targetsResult.ok ? (
          <>
            <Hint>{t('metrics.recomputed')}</Hint>
            <Stat
              label={t('targets.calorieTarget')}
              value={String(targetsResult.targets.calorieTarget)}
              unit={t('common.kcal')}
              emphasis
            />
            {targetsResult.targets.clampedToBmr ? (
              <Banner tone="warning">{t('targets.clampedWarning')}</Banner>
            ) : null}
            <View style={styles.divider} />
            <View style={styles.macroRow}>
              <Stat
                label={t('targets.protein')}
                value={String(targetsResult.targets.proteinG)}
                unit={t('common.grams')}
                color={colors.protein}
              />
              <Stat
                label={t('targets.carbs')}
                value={String(targetsResult.targets.carbsG)}
                unit={t('common.grams')}
                color={colors.carbs}
              />
              <Stat
                label={t('targets.fat')}
                value={String(targetsResult.targets.fatG)}
                unit={t('common.grams')}
                color={colors.fat}
              />
            </View>
            <Stat
              label={t('targets.tdee')}
              value={String(targetsResult.targets.tdeeKcal)}
              unit={t('common.kcal')}
            />
          </>
        ) : (
          <Banner tone="info">
            {t('metrics.missingProfile')} · {t(GAP_MESSAGE[targetsResult.missing])}
          </Banner>
        )}
      </Card>

      <Card>
        <SectionTitle>{t('metrics.bleTitle')}</SectionTitle>
        <Banner tone="warning">{t('metrics.bleUnavailable')}</Banner>
        <Hint>{t('metrics.bleExplain')}</Hint>
        <Text style={styles.bleSupported}>{t('metrics.bleSupported')}</Text>
      </Card>

      {metrics.length > 0 ? (
        <Card>
          <SectionTitle>{t('metrics.history')}</SectionTitle>
          {metrics.slice(0, 30).map((metric) => (
            <Pressable
              key={metric.id}
              onLongPress={() => remove(metric.id)}
              style={styles.historyRow}
              accessibilityRole="button"
            >
              <View style={styles.historyMain}>
                <Text style={styles.historyWeight}>
                  {formatWeight(metric.weight_kg, unitSystem) ?? '—'} {weightUnit}
                </Text>
                <Text style={styles.historyMeta}>
                  {new Date(metric.measured_at).toLocaleDateString()} ·{' '}
                  {t(SOURCE_LABEL[metric.source] ?? 'metrics.sourceManual')}
                </Text>
              </View>
              {metric.body_fat_pct !== null ? (
                <Text style={styles.historyFat}>{metric.body_fat_pct}%</Text>
              ) : null}
            </Pressable>
          ))}
        </Card>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create<{
  screen: ViewStyle;
  content: ViewStyle;
  centered: ViewStyle;
  muted: TextStyle;
  pageTitle: TextStyle;
  entryRow: ViewStyle;
  entryInput: TextStyle;
  saveButton: ViewStyle;
  saveButtonText: TextStyle;
  divider: ViewStyle;
  macroRow: ViewStyle;
  bleSupported: TextStyle;
  historyRow: ViewStyle;
  historyMain: ViewStyle;
  historyWeight: TextStyle;
  historyMeta: TextStyle;
  historyFat: TextStyle;
}>({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { paddingHorizontal: spacing.lg },
  centered: { flex: 1, backgroundColor: colors.bg, alignItems: 'center' },
  muted: { color: colors.textMuted, fontSize: fontSize.sm },
  pageTitle: {
    color: colors.text,
    fontSize: fontSize.xl,
    fontWeight: '800',
    marginBottom: spacing.lg,
    textAlign: 'auto',
  },
  entryRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.md },
  entryInput: {
    flex: 1,
    height: 44,
    backgroundColor: colors.surfaceRaised,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    color: colors.text,
    fontSize: fontSize.md,
    paddingHorizontal: spacing.md,
    textAlign: 'auto',
  },
  saveButton: {
    height: 44,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.sm,
    backgroundColor: colors.accentSoft,
    borderWidth: 1,
    borderColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveButtonText: { color: colors.accent, fontSize: fontSize.md, fontWeight: '700' },
  divider: { height: 1, backgroundColor: colors.border, marginVertical: spacing.md },
  macroRow: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.md },
  bleSupported: {
    color: colors.textMuted,
    fontSize: fontSize.xs,
    marginTop: spacing.sm,
    textAlign: 'auto',
  },
  historyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  historyMain: { flex: 1 },
  historyWeight: { color: colors.text, fontSize: fontSize.md, textAlign: 'auto' },
  historyMeta: { color: colors.textMuted, fontSize: fontSize.xs, marginTop: 2, textAlign: 'auto' },
  historyFat: { color: colors.textMuted, fontSize: fontSize.sm },
});
