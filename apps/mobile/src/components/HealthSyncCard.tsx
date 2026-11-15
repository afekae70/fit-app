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

import { useCallback, useEffect, useMemo, useReducer } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View, type TextStyle, type ViewStyle } from 'react-native';
import { Text } from './Text.js';
import { Heartbeat } from 'phosphor-react-native';

import { getExecutor } from '../db/provider.js';
import { healthExportCopy } from '../health/copy.js';
import { healthCardReducer, INITIAL_HEALTH_CARD_STATE } from '../health/syncCardState.js';
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
import { LinkRow, RowDivider, SettingsSection, ToggleRow } from './settings/kit.js';
import { Banner } from './ui.js';

export function HealthSyncCard({ userId, index }: { userId: string; index?: number }) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const s = useMemo(() => createStyles(colors), [colors]);

  // Checking, unavailable, off, asking, denied, on: one value, see syncCardState.ts.
  const [state, dispatch] = useReducer(healthCardReducer, INITIAL_HEALTH_CARD_STATE);

  useEffect(() => {
    void (async () => {
      const availability = await checkHealthWriteAvailability();
      const [on, granted] = await Promise.all([loadHealthSyncEnabled(), hasHealthWritePermission()]);
      // A permission revoked in Health Connect since is the authority, not what was saved here.
      dispatch({ type: 'CHECKED', availability, enabled: on && granted });
      if (on && !granted) await setHealthSyncEnabled(false);
    })();
  }, []);

  /** Send what is already in history, so the other app is not empty. */
  const backfill = useCallback(async () => {
    dispatch({ type: 'EXPORT_STARTED' });
    try {
      const db = await getExecutor();
      const outcome = await backfillHealthExport(db, userId, healthExportCopy(t));
      dispatch({ type: 'EXPORT_DONE', counts: { sent: outcome.sent, failed: outcome.failed } });
    } catch {
      dispatch({ type: 'EXPORT_DONE', counts: null });
    }
  }, [t, userId]);

  const toggle = (next: 'on' | 'off') => {
    void (async () => {
      if (next === 'off') {
        if (state.kind !== 'on' && state.kind !== 'denied') return;
        dispatch({ type: 'TURNED_OFF' });
        await setHealthSyncEnabled(false);
        return;
      }

      // Not twice: a second tap while Health Connect's screen is coming up would ask again.
      if (state.kind !== 'off' && state.kind !== 'denied') return;
      dispatch({ type: 'ASKED' });
      const granted = (await hasHealthWritePermission()) || (await requestHealthWritePermission());
      dispatch({ type: 'ANSWERED', granted });
      await setHealthSyncEnabled(granted);
      if (granted) await backfill();
    })();
  };

  if (state.kind === 'checking') return null;

  if (state.kind === 'unavailable') {
    // On anything but an Android with Health Connect there is nothing to offer, so the card says
    // why rather than showing a switch that cannot do anything.
    if (state.reason === 'not_android') return null;
    return (
      <SettingsSection icon={Heartbeat} title={t('health.title')} hint={t('health.hint')} index={index}>
        <Banner tone="info">
          {state.reason === 'not_installed' ? t('health.notInstalled') : t('health.unavailable')}
        </Banner>
      </SettingsSection>
    );
  }

  const enabled = state.kind === 'on';
  const exporting = state.kind === 'on' ? state.exporting : 'idle';
  const result =
    typeof exporting === 'string'
      ? null
      : exporting.failed > 0
        ? t('health.backfillFailed', { count: exporting.failed })
        : exporting.sent > 0
          ? t('health.backfillDone', { count: exporting.sent })
          : t('health.backfillNone');

  return (
    <SettingsSection icon={Heartbeat} title={t('health.title')} hint={t('health.hint')} index={index}>
      <ToggleRow
        label={enabled ? t('settings.reminderOn') : t('settings.reminderOff')}
        value={enabled}
        onChange={(next) => toggle(next ? 'on' : 'off')}
      />

      {enabled ? <Banner tone="success">{t('health.connected')}</Banner> : null}
      {state.kind === 'denied' ? <Banner tone="warning">{t('health.denied')}</Banner> : null}

      <View style={s.body}>
        <RowDivider />
        {enabled ? (
          <>
            <LinkRow
              label={
                exporting === 'running'
                  ? t('health.backfillRunning')
                  : t('health.backfill', { days: BACKFILL_DAYS })
              }
              onPress={() => void backfill()}
              disabled={exporting === 'running'}
              chevron={false}
            />
            {result ? <Text style={s.result}>{result}</Text> : null}
          </>
        ) : null}
        <LinkRow label={t('health.openSettings')} onPress={openHealthConnectSettings} />
      </View>
    </SettingsSection>
  );
}

const createStyles = (colors: ColorPalette) =>
  StyleSheet.create<{ body: ViewStyle; result: TextStyle }>({
    body: { gap: spacing.sm },
    result: { color: colors.textSecondary, fontSize: fontSize.xs, textAlign: 'auto' },
  });
