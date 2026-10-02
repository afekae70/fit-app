/**
 * The Health Connect switch: send finished workouts to the phone's health store, or do not.
 *
 * Turning it on is two steps that read as one — the permission screen belongs to Health Connect
 * and this app cannot grant anything itself, so the toggle asks, and then says what came back.
 * Coming back without the workout permission leaves the toggle off rather than on-and-silent,
 * which is the failure that makes someone think a sync works when nothing is being sent.
 *
 * Turning it on also sends the recent history, so the other app has something in it immediately.
 * Waiting until the next workout for the first entry looks exactly like a feature that is broken.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View, type TextStyle, type ViewStyle } from 'react-native';

import { getExecutor } from '../db/provider.js';
import { hapticLight } from '../haptics.js';
import type { HealthAvailability } from '../health/adapter.js';
import { healthExportCopy } from '../health/copy.js';
import {
  BACKFILL_DAYS,
  backfillHealthExport,
  loadHealthSyncEnabled,
  setHealthSyncEnabled,
} from '../health/sync.js';
import {
  checkHealthWriteAvailability,
  hasHealthWritePermission,
  openHealthConnectSettings,
  requestHealthWritePermission,
} from '../health/writer.js';
import { useTheme } from '../ThemeProvider.js';
import { fontSize, spacing, type ColorPalette } from '../theme.js';
import { Banner, Card, Hint, SectionTitle, Segmented } from './ui.js';

export function HealthSyncCard({ userId, index }: { userId: string; index?: number }) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const s = useMemo(() => createStyles(colors), [colors]);

  const [availability, setAvailability] = useState<HealthAvailability | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [denied, setDenied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      setAvailability(await checkHealthWriteAvailability());
      const [on, granted] = await Promise.all([loadHealthSyncEnabled(), hasHealthWritePermission()]);
      // A permission revoked in Health Connect since is the authority, not what was saved here.
      setEnabled(on && granted);
      if (on && !granted) await setHealthSyncEnabled(false);
    })();
  }, []);

  /** Send what is already in history, so the other app is not empty. */
  const backfill = useCallback(async () => {
    setBusy(true);
    setResult(null);
    try {
      const db = await getExecutor();
      const outcome = await backfillHealthExport(db, userId, healthExportCopy(t));
      setResult(
        outcome.failed > 0
          ? t('health.backfillFailed', { count: outcome.failed })
          : outcome.sent > 0
            ? t('health.backfillDone', { count: outcome.sent })
            : t('health.backfillNone'),
      );
    } finally {
      setBusy(false);
    }
  }, [t, userId]);

  const toggle = (next: 'on' | 'off') => {
    void hapticLight();
    void (async () => {
      if (next === 'off') {
        setEnabled(false);
        setDenied(false);
        setResult(null);
        await setHealthSyncEnabled(false);
        return;
      }

      setBusy(true);
      const granted = (await hasHealthWritePermission()) || (await requestHealthWritePermission());
      setBusy(false);
      setDenied(!granted);
      setEnabled(granted);
      await setHealthSyncEnabled(granted);
      if (granted) await backfill();
    })();
  };

  if (!availability) return null;

  if (!availability.available) {
    // On anything but an Android with Health Connect there is nothing to offer, so the card says
    // why rather than showing a switch that cannot do anything.
    if (availability.reason === 'not_android') return null;
    return (
      <Card index={index}>
        <SectionTitle>{t('health.title')}</SectionTitle>
        <Hint>{t('health.hint')}</Hint>
        <Banner tone="info">
          {availability.reason === 'not_installed' ? t('health.notInstalled') : t('health.unavailable')}
        </Banner>
      </Card>
    );
  }

  return (
    <Card index={index}>
      <SectionTitle>{t('health.title')}</SectionTitle>
      <Hint>{t('health.hint')}</Hint>

      <Segmented<'on' | 'off'>
        label={t('health.title')}
        selected={enabled ? 'on' : 'off'}
        onSelect={toggle}
        options={[
          { value: 'on', label: t('settings.reminderOn') },
          { value: 'off', label: t('settings.reminderOff') },
        ]}
      />

      {enabled ? <Banner tone="success">{t('health.connected')}</Banner> : null}
      {denied ? <Banner tone="warning">{t('health.denied')}</Banner> : null}

      {enabled ? (
        <View style={s.body}>
          <Pressable
            onPress={() => void backfill()}
            disabled={busy}
            accessibilityRole="button"
            style={({ pressed }) => [s.row, (pressed || busy) && s.pressed]}
          >
            <Text style={s.rowLabel}>
              {busy ? t('health.backfillRunning') : t('health.backfill', { days: BACKFILL_DAYS })}
            </Text>
          </Pressable>
          {result ? <Text style={s.result}>{result}</Text> : null}
        </View>
      ) : null}

      <Pressable
        onPress={() => {
          void hapticLight();
          openHealthConnectSettings();
        }}
        accessibilityRole="button"
        style={({ pressed }) => [s.row, pressed && s.pressed]}
      >
        <Text style={s.link}>{t('health.openSettings')}</Text>
      </Pressable>
    </Card>
  );
}

const createStyles = (colors: ColorPalette) =>
  StyleSheet.create<{
    body: ViewStyle;
    row: ViewStyle;
    rowLabel: TextStyle;
    result: TextStyle;
    link: TextStyle;
    pressed: ViewStyle;
  }>({
    body: { gap: spacing.xs, marginTop: spacing.sm },
    row: { paddingVertical: spacing.sm },
    rowLabel: { color: colors.text, fontSize: fontSize.md, textAlign: 'auto' },
    result: { color: colors.textSecondary, fontSize: fontSize.sm, textAlign: 'auto' },
    link: { color: colors.accent, fontSize: fontSize.md, textAlign: 'auto' },
    pressed: { opacity: 0.7 },
  });
