/**
 * Weight tracking and derived targets.
 *
 * Manual entry always works. Bluetooth needs a development build — Expo Go cannot do BLE at all
 * — so the scale section checks at runtime and either offers a scan button or explains exactly
 * what is missing, rather than showing a button that silently fails.
 *
 * All physiology comes from `@fit/shared` — the same functions the API and the AI coach use,
 * so the number shown here is the number the coach will reason about.
 */

import {
  calorieAdjustmentFromDrift,
  expectedKgPerWeek,
  movingAverage,
} from '@fit/shared/calculations';
import { router } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Pressable,
  RefreshControl,
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
import { useUnit } from '../src/UnitsProvider.js';
import {
  displayWeightToKg,
  formatWeight,
  kgToDisplay,
  weightUnitKey,
} from '../src/units.js';
import { BLE_REASON_MESSAGE } from '../src/ble/messages.js';
import {
  checkScanAvailability,
  scanForReading,
  ScanError,
  type ScanUnavailableReason,
} from '../src/ble/scanner.js';
import {
  Banner,
  Card,
  Hint,
  ScreenHeader,
  SectionTitle,
  SkeletonScreen,
  Stat,
} from '../src/components/ui.js';
import { SwipeableRow } from '../src/components/SwipeableRow.js';
import { UndoToast } from '../src/components/UndoToast.js';
import { WeightSparkline } from '../src/components/WeightSparkline.js';
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
} from '../src/db/metrics.js';
import { getExecutor, newId } from '../src/db/provider.js';
import { useTheme } from '../src/ThemeProvider.js';
import { fontSize, radius, spacing, type ColorPalette } from '../src/theme.js';

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
  const userId = useCurrentUserId();
  const unit = useUnit();
  const weightUnit = t(`common.${weightUnitKey(unit)}`);
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const [metrics, setMetrics] = useState<BodyMetricRow[]>([]);
  const [profile, setProfile] = useState<ProfileRow | null>(null);
  const [entry, setEntry] = useState('');
  const [loading, setLoading] = useState(true);

  const [bleState, setBleState] = useState<'checking' | 'ready' | 'scanning' | 'unavailable'>(
    'checking',
  );
  const [bleReason, setBleReason] = useState<ScanUnavailableReason | null>(null);
  const [bleError, setBleError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const db = await getExecutor();
    setMetrics(await listBodyMetrics(db, userId));
    setProfile(await getProfile(db, userId));
  }, [userId]);

  const [refreshing, setRefreshing] = useState(false);
  const handleRefresh = useCallback(() => {
    setRefreshing(true);
    void reload().finally(() => setRefreshing(false));
  }, [reload]);

  useEffect(() => {
    void (async () => {
      await reload();
      setLoading(false);
    })();
  }, [reload]);

  // Availability is re-checked on mount rather than cached: Bluetooth can be switched off
  // between visits, and a stale "ready" would give a button that fails when pressed.
  const refreshBleAvailability = useCallback(async () => {
    const availability = await checkScanAvailability();
    if (availability.available) {
      setBleState('ready');
      setBleReason(null);
    } else {
      setBleState('unavailable');
      setBleReason(availability.reason);
    }
  }, []);

  useEffect(() => {
    void refreshBleAvailability();
  }, [refreshBleAvailability]);

  /**
   * Scan, and record whatever the scale reports.
   *
   * `raw_payload` is stored alongside the decoded values because consumer scale protocols are
   * reverse-engineered: keeping the frame means a later parser fix can reprocess this reading
   * instead of it being lost.
   */
  const scanForScale = () => {
    setBleError(null);
    setBleState('scanning');

    void (async () => {
      try {
        const result = await scanForReading({ timeoutMs: 25_000 });

        if (!result) {
          setBleError(t('metrics.bleNoScale'));
          setBleState('ready');
          return;
        }

        const db = await getExecutor();
        await recordBodyMetric(db, userId, newId, {
          weightKg: result.reading.weightKg,
          bodyFatPct: result.reading.bodyFatPct ?? null,
          muscleMassKg: result.reading.muscleMassKg ?? null,
          waterPct: result.reading.waterPct ?? null,
          boneMassKg: result.reading.boneMassKg ?? null,
          visceralFat: result.reading.visceralFat ?? null,
          source: 'ble_scale',
          deviceId: result.deviceId,
          rawPayload: result.rawPayload,
        });

        await reload();
        setBleState('ready');
      } catch (error) {
        const reason = error instanceof ScanError ? error.reason : 'no_native_module';
        setBleReason(reason);
        setBleState(reason === 'bluetooth_off' || reason === 'permission_denied' ? 'ready' : 'unavailable');
        setBleError(t(BLE_REASON_MESSAGE[reason]));
      }
    })();
  };

  const save = async () => {
    const typed = Number(entry.replace(',', '.').trim());
    if (!Number.isFinite(typed) || typed <= 0) return;
    // Bounded in kilograms, after conversion. Capping the typed number instead would put the
    // ceiling at 500 lb for imperial users — a different limit depending on a display setting.
    const value = displayWeightToKg(typed, unit);
    if (value > 500) return;

    const db = await getExecutor();
    await recordBodyMetric(db, userId, newId, { weightKg: value, source: 'manual' });
    setEntry('');
    await reload();
  };

  // A swipe hides the row immediately; the entry only leaves SQLite once the undo window
  // (below) runs out or a second swipe forces this one to commit early.
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const pendingRef = useRef<{ id: string; timer: ReturnType<typeof setTimeout> } | null>(null);

  const commitDelete = useCallback(
    (id: string) => {
      void (async () => {
        const db = await getExecutor();
        await deleteBodyMetric(db, userId, id);
        await reload();
      })();
    },
    [userId, reload],
  );

  const finalizePending = useCallback(() => {
    if (!pendingRef.current) return;
    clearTimeout(pendingRef.current.timer);
    const id = pendingRef.current.id;
    pendingRef.current = null;
    setPendingDeleteId(null);
    commitDelete(id);
  }, [commitDelete]);

  const swipeDelete = useCallback(
    (id: string) => {
      // Only one undo window open at a time — swiping a second row commits the first right away
      // rather than silently discarding it.
      finalizePending();
      setPendingDeleteId(id);
      const timer = setTimeout(() => {
        pendingRef.current = null;
        setPendingDeleteId(null);
        commitDelete(id);
      }, 4000);
      pendingRef.current = { id, timer };
    },
    [finalizePending, commitDelete],
  );

  const undoDelete = useCallback(() => {
    if (!pendingRef.current) return;
    clearTimeout(pendingRef.current.timer);
    pendingRef.current = null;
    setPendingDeleteId(null);
  }, []);

  // Leaving the screen with an undo window still open must not silently drop the delete.
  useEffect(() => {
    return () => {
      if (pendingRef.current) {
        clearTimeout(pendingRef.current.timer);
        commitDelete(pendingRef.current.id);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (loading) {
    return <SkeletonScreen paddingTop={insets.top + spacing.lg} />;
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
    <View style={styles.screen}>
    <ScrollView
      contentContainerStyle={[
        styles.content,
        { paddingTop: insets.top + spacing.lg, paddingBottom: insets.bottom + spacing.xxl },
      ]}
      keyboardShouldPersistTaps="handled"
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={colors.accent} />
      }
    >
      <ScreenHeader title={t('metrics.title')} back />

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
            value={formatWeight(latest.weight_kg, unit) ?? '—'}
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
                // The value converts; the ±0.05 thresholds above stay in kilograms. Those are
                // judgements about the body, not about how the number is displayed.
                value={`${rate.kgPerWeek > 0 ? '+' : ''}${kgToDisplay(rate.kgPerWeek, unit).toFixed(2)}`}
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
                value={`${expected > 0 ? '+' : ''}${kgToDisplay(expected, unit).toFixed(2)}`}
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

        {bleState === 'unavailable' ? (
          <>
            <Banner tone="warning">{t(BLE_REASON_MESSAGE[bleReason ?? 'no_native_module'])}</Banner>
            <Hint>{t('metrics.bleExplain')}</Hint>
          </>
        ) : bleState === 'checking' ? (
          <Hint>{t('common.loading')}</Hint>
        ) : (
          <>
            <Pressable
              onPress={scanForScale}
              disabled={bleState === 'scanning'}
              style={styles.scanButton}
              accessibilityRole="button"
            >
              <Text style={styles.scanButtonText}>
                {bleState === 'scanning' ? `⏳ ${t('metrics.bleScanning')}` : `⚖ ${t('metrics.bleScan')}`}
              </Text>
            </Pressable>
            <Hint>{bleState === 'scanning' ? t('metrics.bleStepOn') : t('metrics.bleScanHint')}</Hint>
            {bleError ? <Banner tone="warning">{bleError}</Banner> : null}
          </>
        )}

        <Text style={styles.bleSupported}>{t('metrics.bleSupported')}</Text>

        {/* Offered unconditionally, including while the scan reports "no scale found" — that is
            exactly the moment the answer is a list of what IS advertising, and the scale sold
            with the OKOK app uses none of the UUIDs above. */}
        <Pressable
          onPress={() => router.push('/scale-debug')}
          accessibilityRole="button"
          style={styles.diagnosticsLink}
        >
          <Text style={styles.diagnosticsLinkText}>{t('metrics.bleDiagnostics')} ›</Text>
        </Pressable>
      </Card>

      {metrics.length > 0 ? (
        <Card>
          <SectionTitle>{t('metrics.history')}</SectionTitle>
          {metrics
            .filter((metric) => metric.id !== pendingDeleteId)
            .slice(0, 30)
            .map((metric) => (
              <SwipeableRow key={metric.id} onDelete={() => swipeDelete(metric.id)}>
                <View style={styles.historyRow}>
                  <View style={styles.historyMain}>
                    <Text style={styles.historyWeight}>
                      {formatWeight(metric.weight_kg, unit)} {weightUnit}
                    </Text>
                    <Text style={styles.historyMeta}>
                      {new Date(metric.measured_at).toLocaleDateString()} ·{' '}
                      {t(SOURCE_LABEL[metric.source] ?? 'metrics.sourceManual')}
                    </Text>
                  </View>
                  {metric.body_fat_pct !== null ? (
                    <Text style={styles.historyFat}>{metric.body_fat_pct}%</Text>
                  ) : null}
                </View>
              </SwipeableRow>
            ))}
        </Card>
      ) : null}
    </ScrollView>
    <UndoToast message={pendingDeleteId ? t('metrics.deletedToast') : null} onUndo={undoDelete} />
    </View>
  );
}

const createStyles = (colors: ColorPalette) =>
  StyleSheet.create<{
    screen: ViewStyle;
    content: ViewStyle;
    centered: ViewStyle;
    muted: TextStyle;
    entryRow: ViewStyle;
    entryInput: TextStyle;
    saveButton: ViewStyle;
    saveButtonText: TextStyle;
    divider: ViewStyle;
    macroRow: ViewStyle;
    scanButton: ViewStyle;
    scanButtonText: TextStyle;
    bleSupported: TextStyle;
    diagnosticsLink: ViewStyle;
    diagnosticsLinkText: TextStyle;
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
  scanButton: {
    paddingVertical: spacing.md,
    borderRadius: radius.sm,
    backgroundColor: colors.accentSoft,
    borderWidth: 1,
    borderColor: colors.accent,
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  scanButtonText: { color: colors.accent, fontSize: fontSize.md, fontWeight: '700' },
  bleSupported: {
    color: colors.textMuted,
    fontSize: fontSize.xs,
    marginTop: spacing.sm,
    textAlign: 'auto',
  },
  diagnosticsLink: { minHeight: 44, justifyContent: 'center' },
  diagnosticsLinkText: { color: colors.accent, fontSize: fontSize.sm, textAlign: 'auto' },
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
