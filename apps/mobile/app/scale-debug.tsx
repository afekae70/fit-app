/**
 * Bluetooth diagnostics — what is actually advertising in the room.
 *
 * A tool, not a feature. It exists because "the app did not find my scale" has at least four
 * different causes that all look identical from the outside: a missing manifest flag, a denied
 * permission, a scale that only speaks after a GATT connection, or a protocol none of the
 * shipped adapters knows. Guessing between them wastes a rebuild each time; this screen turns
 * the question into a list of bytes.
 *
 * Reached from the smart-scale card on the metrics screen. It writes nothing to the database —
 * a diagnostic that changes state is a diagnostic you cannot trust the second time you run it.
 */

import { useCallback, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, Share, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BLE_REASON_MESSAGE } from '../src/ble/messages.js';
import {
  exploreDevice,
  formatDiagnostics,
  formatExploration,
  formatSweep,
  ScanError,
  scanDiagnostics,
  sweepForScale,
  type ExploreResult,
  type ExploreStatus,
  type SightedDevice,
  type SweepProgress,
  type SweepResult,
} from '../src/ble/scanner.js';
import { Banner, Card, Hint, ScreenHeader, SectionTitle } from '../src/components/ui.js';
import { hapticLight } from '../src/haptics.js';
import { useTheme } from '../src/ThemeProvider.js';
import { fontSize, radius, spacing, type ColorPalette } from '../src/theme.js';

/**
 * Long enough to start the scan, walk to the scale and let it settle.
 *
 * The first run of this screen used twenty seconds and caught nothing but televisions — a scale
 * sleeps until it is stepped on and stays awake only briefly, so the window has to cover the
 * walk over as well as the weighing. There is a Stop button for when it is done sooner.
 */
const SCAN_MS = 60_000;

/** How long to hold the connection open while the weight is meant to change. */
const LISTEN_MS = 30_000;

export default function ScaleDebugScreen() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const [scanning, setScanning] = useState(false);
  const [devices, setDevices] = useState<SightedDevice[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [exploring, setExploring] = useState<string | null>(null);
  const [exploreStatus, setExploreStatus] = useState<ExploreStatus | null>(null);
  const [exploration, setExploration] = useState<ExploreResult | null>(null);
  const [sweep, setSweep] = useState<SweepResult | null>(null);
  const [sweepProgress, setSweepProgress] = useState<SweepProgress | null>(null);
  // A ref, not state: the scan loop polls this every 250 ms and must see the current value
  // without the closure it was created with going stale.
  const stopRequested = useRef(false);

  const scan = useCallback(() => {
    void hapticLight();
    stopRequested.current = false;
    setScanning(true);
    setError(null);
    setDevices([]);

    void (async () => {
      try {
        setDevices(
          await scanDiagnostics({
            timeoutMs: SCAN_MS,
            onUpdate: setDevices,
            shouldStop: () => stopRequested.current,
          }),
        );
      } catch (caught) {
        setError(
          caught instanceof ScanError ? t(BLE_REASON_MESSAGE[caught.reason]) : String(caught),
        );
      } finally {
        setScanning(false);
      }
    })();
  }, [t]);

  const stop = useCallback(() => {
    void hapticLight();
    stopRequested.current = true;
  }, []);

  /**
   * The whole hunt behind one button.
   *
   * Scan, shortlist, then connect to each candidate in turn. The manual sequence asked the user
   * to stop a scan, pick a row and reach the scale before it slept — four attempts, no capture.
   * Here the only thing left to a human is standing on the scale, which is the one part code
   * cannot do.
   */
  const runSweep = useCallback(() => {
    void hapticLight();
    setSweep(null);
    setExploration(null);
    setError(null);
    setSweepProgress({ phase: 'scanning', index: 0, total: 0, deviceName: null });

    void (async () => {
      try {
        setSweep(
          await sweepForScale({ onProgress: setSweepProgress, onResult: setSweep }),
        );
      } catch (caught) {
        setError(
          caught instanceof ScanError ? t(BLE_REASON_MESSAGE[caught.reason]) : String(caught),
        );
      } finally {
        setSweepProgress(null);
      }
    })();
  }, [t]);

  const shareSweep = useCallback(() => {
    if (!sweep) return;
    void hapticLight();
    void Share.share({ message: formatSweep(sweep) }).catch(() => undefined);
  }, [sweep]);

  /**
   * Connect to one device and record everything it exposes and pushes.
   *
   * The passive scan cannot see a scale that only talks once connected, which two scans now
   * suggest is what this one does. Thirty seconds is long enough to step on and let the number
   * settle while every notifiable characteristic is subscribed at once.
   */
  const explore = useCallback(
    (deviceId: string) => {
      void hapticLight();
      setExploring(deviceId);
      setExploreStatus('connecting');
      setExploration(null);
      setError(null);

      void (async () => {
        try {
          setExploration(
            await exploreDevice(deviceId, {
              listenMs: LISTEN_MS,
              onUpdate: setExploration,
              onStatus: setExploreStatus,
            }),
          );
        } catch (caught) {
          setError(
            caught instanceof ScanError ? t(BLE_REASON_MESSAGE[caught.reason]) : String(caught),
          );
        } finally {
          setExploring(null);
          setExploreStatus(null);
        }
      })();
    },
    [t],
  );

  const shareExploration = useCallback(() => {
    if (!exploration) return;
    void hapticLight();
    void Share.share({ message: formatExploration(exploration) }).catch(() => undefined);
  }, [exploration]);

  /**
   * Hand the dump to the system share sheet.
   *
   * `Share` is React Native core, so this adds no native dependency and no rebuild — the same
   * reason SwipeableRow uses PanResponder. It also lands the text where it needs to go anyway:
   * in a message to whoever is writing the parser.
   */
  const share = useCallback(() => {
    if (!devices) return;
    void hapticLight();
    void Share.share({ message: formatDiagnostics(devices) }).catch(() => undefined);
  }, [devices]);

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[
        styles.content,
        { paddingTop: insets.top + 8, paddingBottom: insets.bottom + 28 },
      ]}
    >
      <ScreenHeader title={t('scaleDebug.title')} back settings={false} />

      <Card>
        <SectionTitle>{t('scaleDebug.autoTitle')}</SectionTitle>
        <Hint>{t('scaleDebug.autoIntro')}</Hint>
        <Pressable
          onPress={runSweep}
          disabled={sweepProgress !== null || scanning || exploring !== null}
          accessibilityRole="button"
          style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
        >
          <Text style={styles.buttonText}>
            {sweepProgress
              ? `⏳ ${t(`scaleDebug.sweep.${sweepProgress.phase}`, {
                  index: sweepProgress.index,
                  total: sweepProgress.total,
                  name: sweepProgress.deviceName ?? t('scaleDebug.unnamed'),
                })}`
              : `⚖ ${t('scaleDebug.autoRun')}`}
          </Text>
        </Pressable>
        {sweepProgress ? <Hint>{t('scaleDebug.autoStandOn')}</Hint> : null}
        {error ? <Banner tone="warning">{error}</Banner> : null}

        {sweep && sweepProgress === null ? (
          <Pressable
            onPress={shareSweep}
            accessibilityRole="button"
            style={({ pressed }) => [styles.copyButton, pressed && styles.buttonPressed]}
          >
            <Text style={styles.copyText}>⤴ {t('scaleDebug.share')}</Text>
          </Pressable>
        ) : null}

        {sweep?.explorations.map((explored) => (
          <View
            key={explored.deviceId}
            style={[
              styles.device,
              explored.characteristics.some((c) => c.notifications.length > 0) &&
                styles.deviceChanging,
            ]}
          >
            <Text style={styles.deviceName}>{explored.deviceName ?? explored.deviceId}</Text>
            {explored.error ? (
              <Text style={styles.deviceId}>{explored.error}</Text>
            ) : (
              <Text style={styles.deviceId}>
                {t('scaleDebug.charCount', { count: explored.characteristics.length })}
              </Text>
            )}
            {explored.characteristics
              .filter((c) => c.notifications.length > 0)
              .map((c) => (
                <View key={`${c.serviceUuid}/${c.uuid}`}>
                  <Text style={styles.mono}>
                    {c.serviceUuid}/{c.uuid} [{c.properties}]
                  </Text>
                  {c.notifications.map((hex, index) => (
                    <Text key={`${hex}-${index}`} style={styles.mono}>
                      → {hex}
                    </Text>
                  ))}
                </View>
              ))}
          </View>
        ))}
      </Card>

      <Card>
        <Hint>{t('scaleDebug.intro')}</Hint>
        <Pressable
          onPress={scanning ? stop : scan}
          accessibilityRole="button"
          style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
        >
          <Text style={styles.buttonText}>
            {scanning ? `■ ${t('scaleDebug.stop')}` : `📡 ${t('scaleDebug.scan')}`}
          </Text>
        </Pressable>
        {/* Said before the scan rather than after: the whole point is to capture a scale while
            it is transmitting a changing weight, and a scale nobody is standing on goes to
            sleep and broadcasts nothing at all. */}
        <Hint>{t('scaleDebug.standOn')}</Hint>
        {error ? <Banner tone="warning">{error}</Banner> : null}
      </Card>

      {devices ? (
        <Card>
          <SectionTitle>
            {scanning
              ? t('scaleDebug.live', { count: devices.length })
              : t('scaleDebug.found', { count: devices.length })}
          </SectionTitle>

          {devices.length === 0 ? (
            <Hint>{scanning ? t('scaleDebug.scanning') : t('scaleDebug.none')}</Hint>
          ) : (
            <>
              {scanning ? null : (
                <Pressable
                  onPress={share}
                  accessibilityRole="button"
                  style={({ pressed }) => [styles.copyButton, pressed && styles.buttonPressed]}
                >
                  <Text style={styles.copyText}>⤴ {t('scaleDebug.share')}</Text>
                </Pressable>
              )}

              {devices.map((device) => (
                <Pressable
                  key={device.id}
                  onPress={() => explore(device.id)}
                  disabled={scanning || exploring !== null}
                  accessibilityRole="button"
                  style={({ pressed }) => [
                    styles.device,
                    device.changing && styles.deviceChanging,
                    pressed && styles.devicePressed,
                  ]}
                >
                  <View style={styles.deviceHeader}>
                    <Text
                      style={[styles.deviceName, device.vendor !== null && styles.deviceKnown]}
                      numberOfLines={1}
                    >
                      {device.name ?? t('scaleDebug.unnamed')}
                    </Text>
                    {/* A recognised brand is a reason NOT to tap this row, so it is stated
                        plainly rather than left for the user to infer from the name. */}
                    <Text style={styles.frames}>
                      {device.vendor ?? `${device.frames}×`}
                    </Text>
                  </View>
                  <Text style={styles.deviceId}>{device.id}</Text>

                  {/* The number, as large as anything on this screen. It exists to be read off
                      the phone and compared against the scale's own display in the same second —
                      the only check that can confirm a parser built from captures. */}
                  {device.decodedKg !== null ? (
                    <Text style={styles.decoded}>{device.decodedKg.toFixed(2)} kg</Text>
                  ) : null}

                  {device.adapterId ? (
                    <Text style={styles.recognised}>
                      {t('scaleDebug.recognised', { adapter: device.adapterId })}
                    </Text>
                  ) : null}

                  {device.serviceUuids.length > 0 ? (
                    <Text style={styles.mono}>services: {device.serviceUuids.join(', ')}</Text>
                  ) : null}

                  {Object.entries(device.serviceData).map(([uuid, hex]) => (
                    <Text key={uuid} style={styles.mono}>
                      data[{uuid}]: {hex}
                    </Text>
                  ))}

                  {device.manufacturerDataHex ? (
                    <Text style={styles.mono}>mfg: {device.manufacturerDataHex}</Text>
                  ) : null}

                  {/* More than one distinct payload means the bytes changed while we watched,
                      which is what a scale being stood on looks like and what a doorbell
                      does not. This is the line that identifies the device. */}
                  {device.payloadsHex.length > 1 ? (
                    <View style={styles.payloads}>
                      <Text style={styles.payloadsLabel}>{t('scaleDebug.changing')}</Text>
                      {device.payloadsHex.map((hex) => (
                        <Text key={hex} style={styles.mono}>
                          {hex}
                        </Text>
                      ))}
                    </View>
                  ) : null}

                  {/* The offer that matters once broadcasting has been ruled out. */}
                  <Text style={styles.connectHint}>
                    {exploring === device.id
                      ? t(`scaleDebug.status.${exploreStatus ?? 'connecting'}`)
                      : device.vendor === null
                        ? t('scaleDebug.tapToConnect')
                        : t('scaleDebug.knownVendor')}
                  </Text>
                </Pressable>
              ))}
            </>
          )}
        </Card>
      ) : null}

      {exploration ? (
        <Card>
          <SectionTitle>
            {exploration.deviceName ?? t('scaleDebug.unnamed')} · {exploration.characteristics.length}
          </SectionTitle>

          {exploration.error ? <Banner tone="warning">{exploration.error}</Banner> : null}

          {exploring ? (
            <Hint>
              {exploreStatus === 'waiting_for_device'
                ? t('scaleDebug.wakeItUp')
                : t('scaleDebug.standOnNow')}
            </Hint>
          ) : (
            <Pressable
              onPress={shareExploration}
              accessibilityRole="button"
              style={({ pressed }) => [styles.copyButton, pressed && styles.buttonPressed]}
            >
              <Text style={styles.copyText}>⤴ {t('scaleDebug.share')}</Text>
            </Pressable>
          )}

          {exploration.characteristics.map((characteristic) => (
            <View
              key={`${characteristic.serviceUuid}/${characteristic.uuid}`}
              style={[styles.device, characteristic.notifications.length > 0 && styles.deviceChanging]}
            >
              <Text style={styles.mono}>
                {characteristic.serviceUuid}/{characteristic.uuid} [{characteristic.properties}]
              </Text>
              {characteristic.readHex ? (
                <Text style={styles.mono}>= {characteristic.readHex}</Text>
              ) : null}
              {/* A characteristic that pushed anything is the whole point of connecting. */}
              {characteristic.notifications.map((hex, index) => (
                <Text key={`${hex}-${index}`} style={styles.mono}>
                  → {hex}
                </Text>
              ))}
            </View>
          ))}
        </Card>
      ) : null}
    </ScrollView>
  );
}

const createStyles = (colors: ColorPalette) =>
  StyleSheet.create({
    screen: { flex: 1 },
    content: { paddingHorizontal: spacing.lg, gap: spacing.md },

    button: {
      minHeight: 52,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: colors.accent,
      backgroundColor: colors.accentSoft,
      alignItems: 'center',
      justifyContent: 'center',
    },
    buttonPressed: { transform: [{ scale: 0.99 }] },
    buttonText: { color: colors.accent, fontSize: fontSize.md, fontWeight: '500' },

    copyButton: {
      minHeight: 44,
      borderRadius: radius.sm,
      borderWidth: 1,
      borderColor: colors.borderStrong,
      alignItems: 'center',
      justifyContent: 'center',
    },
    copyText: { color: colors.text, fontSize: fontSize.sm },

    device: {
      borderTopWidth: 1,
      borderTopColor: colors.borderSubtle,
      paddingTop: spacing.sm,
      gap: 2,
    },
    devicePressed: { opacity: 0.6 },
    connectHint: { color: colors.accent, fontSize: fontSize.xs, textAlign: 'auto', marginTop: 2 },
    // The one thing worth spotting at a glance in a list of twenty-odd televisions.
    deviceChanging: {
      borderStartWidth: 2,
      borderStartColor: colors.accent,
      paddingStart: spacing.sm,
    },
    deviceHeader: {
      flexDirection: 'row',
      alignItems: 'baseline',
      justifyContent: 'space-between',
      gap: spacing.sm,
    },
    deviceName: { color: colors.text, fontSize: fontSize.sm, fontWeight: '500', flex: 1, textAlign: 'auto' },
    deviceKnown: { color: colors.textFaint, fontWeight: '400' },
    frames: { color: colors.textFaint, fontSize: fontSize.xs, fontVariant: ['tabular-nums'] },
    deviceId: { color: colors.textFaint, fontSize: fontSize.xs },
    recognised: { color: colors.accent, fontSize: fontSize.xs, textAlign: 'auto' },
    decoded: {
      color: colors.accent,
      fontSize: 28,
      fontWeight: '600',
      textAlign: 'auto',
      fontVariant: ['tabular-nums'],
    },

    // Hex is data, not prose: it stays left-to-right and monospaced even in a mirrored layout,
    // because a reversed byte string is worse than useless.
    mono: {
      color: colors.textMuted,
      fontSize: 11,
      fontFamily: 'monospace',
      writingDirection: 'ltr',
      textAlign: 'left',
    },
    payloads: { marginTop: 4, gap: 1 },
    payloadsLabel: { color: colors.textFaint, fontSize: fontSize.xs, textAlign: 'auto' },
  });
