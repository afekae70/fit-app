/**
 * The Bluetooth transport: finds a scale and turns its frames into readings.
 *
 * All decoding lives in adapter.ts and all byte/UUID handling in encoding.ts, both pure and
 * unit-tested. What is left here is the part that genuinely needs hardware — permissions,
 * scanning, and the GATT connection — kept as thin as possible because it is the one layer no
 * test can cover.
 *
 * Two acquisition paths, because scales disagree about how to report:
 *  - **Advertisement** (Mi Scale 2 and similar): the measurement is broadcast in the scan
 *    record. No pairing, no connection — step on the scale and the frame arrives.
 *  - **GATT notify** (Bluetooth SIG Weight Scale, 0x181D): connect, discover, and subscribe to
 *    the Weight Measurement characteristic 0x2A9D.
 *
 * `react-native-ble-plx` is imported lazily. It has no JS-only implementation, so a top-level
 * import would crash Expo Go on startup — before any code could explain why. Everything here
 * therefore reports unavailability instead of throwing.
 */

import { PermissionsAndroid, Platform } from 'react-native';

import {
  SCANNABLE_SERVICE_UUIDS,
  selectAdapter,
  type ScaleReading,
} from './adapter.js';
import { base64ToBytes, fullUuid, selectAdvertisementPayload, shortUuid } from './encoding.js';

/** Bluetooth SIG Weight Scale Service and its Weight Measurement characteristic. */
const WEIGHT_SERVICE = '181d';
const WEIGHT_MEASUREMENT_CHARACTERISTIC = '2a9d';

export type ScanUnavailableReason =
  | 'not_supported_platform'
  | 'no_native_module'
  | 'permission_denied'
  | 'bluetooth_off';

export type ScanAvailability = { available: true } | { available: false; reason: ScanUnavailableReason };

export interface ScanResult {
  reading: ScaleReading;
  deviceId: string;
  deviceName: string | null;
  adapterId: string;
  /** The raw frame, base64. Stored so a future parser fix can reprocess history. */
  rawPayload: string;
}

/* -------------------------------------------------------------------------- */
/* Native module access                                                        */
/* -------------------------------------------------------------------------- */

interface BlePlxModule {
  BleManager: new () => BleManagerLike;
  State: Record<string, string>;
}

interface BleManagerLike {
  state(): Promise<string>;
  startDeviceScan(
    uuids: string[] | null,
    options: { allowDuplicates?: boolean } | null,
    listener: (error: unknown, device: ScannedDevice | null) => void,
  ): void;
  stopDeviceScan(): void;
  destroy(): void;
  connectToDevice(id: string): Promise<ConnectedDeviceLike>;
  cancelDeviceConnection(id: string): Promise<unknown>;
}

interface ScannedDevice {
  id: string;
  name: string | null;
  localName?: string | null;
  serviceUUIDs?: string[] | null;
  serviceData?: Record<string, string> | null;
  manufacturerData?: string | null;
}

interface ConnectedDeviceLike {
  id: string;
  name: string | null;
  discoverAllServicesAndCharacteristics(): Promise<ConnectedDeviceLike>;
  monitorCharacteristicForService(
    serviceUUID: string,
    characteristicUUID: string,
    listener: (error: unknown, characteristic: { value?: string | null } | null) => void,
  ): { remove(): void };
}

/**
 * Load the native module, or report that it is absent.
 *
 * `require` rather than a static import so the failure is catchable: in Expo Go the module does
 * not exist, and a top-level import would take the whole app down at startup rather than
 * letting the metrics screen explain that a development build is needed.
 */
function loadBlePlx(): BlePlxModule | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-unsafe-return
    return require('react-native-ble-plx') as BlePlxModule;
  } catch {
    return null;
  }
}

/* -------------------------------------------------------------------------- */
/* Permissions                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Request what Android needs to scan, which changed shape in Android 12.
 *
 * From API 31 the Bluetooth permissions are their own thing and — because the manifest declares
 * `neverForLocation` — no location grant is required. Below 31 there is no BLUETOOTH_SCAN at
 * all and discovery is genuinely gated behind fine location, so both eras must be handled
 * rather than requesting the union and hoping.
 */
async function requestAndroidPermissions(): Promise<boolean> {
  if (Platform.OS !== 'android') return true;

  const apiLevel = typeof Platform.Version === 'number' ? Platform.Version : 0;

  const wanted =
    apiLevel >= 31
      ? [
          PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
          PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
        ]
      : [PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION];

  const granted = await PermissionsAndroid.requestMultiple(wanted);
  return Object.values(granted).every((state) => state === PermissionsAndroid.RESULTS.GRANTED);
}

/* -------------------------------------------------------------------------- */
/* Availability                                                                */
/* -------------------------------------------------------------------------- */

export async function checkScanAvailability(): Promise<ScanAvailability> {
  if (Platform.OS !== 'android' && Platform.OS !== 'ios') {
    return { available: false, reason: 'not_supported_platform' };
  }

  const ble = loadBlePlx();
  if (!ble) return { available: false, reason: 'no_native_module' };

  let manager: BleManagerLike | null = null;
  try {
    manager = new ble.BleManager();
    const state = await manager.state();
    if (state !== 'PoweredOn') return { available: false, reason: 'bluetooth_off' };
    return { available: true };
  } catch {
    return { available: false, reason: 'no_native_module' };
  } finally {
    manager?.destroy();
  }
}

/* -------------------------------------------------------------------------- */
/* Scanning                                                                    */
/* -------------------------------------------------------------------------- */

export interface ScanOptions {
  /** Give up after this long. A user standing on a scale will not wait longer. */
  timeoutMs?: number;
  /**
   * Ignore readings the scale has not marked as settled.
   *
   * On by default: a scale streams a rising sequence of numbers as you step on, and taking the
   * first of them records a weight substantially below the real one.
   */
  requireStabilised?: boolean;
  onStatus?: (status: 'scanning' | 'found_device' | 'connecting' | 'reading') => void;
}

/**
 * Scan for a scale and resolve the first usable reading.
 *
 * Resolves null on timeout rather than rejecting: not finding a scale is an ordinary outcome
 * (the scale is asleep, or out of range), not an error worth a stack trace.
 */
export async function scanForReading(options: ScanOptions = {}): Promise<ScanResult | null> {
  const { timeoutMs = 20_000, requireStabilised = true, onStatus } = options;

  const availability = await checkScanAvailability();
  if (!availability.available) {
    throw new ScanError(availability.reason);
  }

  if (!(await requestAndroidPermissions())) {
    throw new ScanError('permission_denied');
  }

  const ble = loadBlePlx();
  if (!ble) throw new ScanError('no_native_module');

  const manager = new ble.BleManager();

  return new Promise<ScanResult | null>((resolve) => {
    let settled = false;
    let subscription: { remove(): void } | null = null;
    let connectedId: string | null = null;

    const finish = (result: ScanResult | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      subscription?.remove();
      try {
        manager.stopDeviceScan();
      } catch {
        /* the manager may already be torn down; nothing useful to do */
      }
      if (connectedId) void manager.cancelDeviceConnection(connectedId).catch(() => undefined);
      manager.destroy();
      resolve(result);
    };

    const timer = setTimeout(() => finish(null), timeoutMs);

    onStatus?.('scanning');

    manager.startDeviceScan(
      SCANNABLE_SERVICE_UUIDS.map(fullUuid),
      // allowDuplicates is required: an advertising scale re-broadcasts as the weight settles,
      // and without duplicates only the first (unsettled) frame would ever arrive.
      { allowDuplicates: true },
      (error, device) => {
        if (error || !device || settled) return;

        const adapter = selectAdapter({
          serviceUuid: device.serviceUUIDs?.map(shortUuid)[0],
          name: device.name ?? device.localName ?? null,
        });
        if (!adapter) return;

        // Path 1 — the measurement is in the advertisement.
        const payload = selectAdvertisementPayload({
          serviceData: device.serviceData,
          manufacturerData: device.manufacturerData,
          serviceUuids: adapter.serviceUuids,
        });

        if (payload) {
          const reading = adapter.parse(payload.bytes);
          if (reading && (!requireStabilised || reading.isStabilised)) {
            finish({
              reading,
              deviceId: device.id,
              deviceName: device.name ?? device.localName ?? null,
              adapterId: adapter.id,
              rawPayload: bytesToBase64(payload.bytes),
            });
          }
          return;
        }

        // Path 2 — a SIG scale that reports over GATT. Connect and subscribe.
        if (!adapter.serviceUuids.includes(WEIGHT_SERVICE) || connectedId) return;
        connectedId = device.id;
        onStatus?.('connecting');

        void (async () => {
          try {
            const connected = await manager.connectToDevice(device.id);
            await connected.discoverAllServicesAndCharacteristics();
            if (settled) return;

            onStatus?.('reading');
            subscription = connected.monitorCharacteristicForService(
              fullUuid(WEIGHT_SERVICE),
              fullUuid(WEIGHT_MEASUREMENT_CHARACTERISTIC),
              (notifyError, characteristic) => {
                if (notifyError || !characteristic?.value || settled) return;
                const bytes = base64ToBytes(characteristic.value);
                const reading = adapter.parse(bytes);
                if (reading && (!requireStabilised || reading.isStabilised)) {
                  finish({
                    reading,
                    deviceId: device.id,
                    deviceName: connected.name ?? device.name ?? null,
                    adapterId: adapter.id,
                    rawPayload: characteristic.value,
                  });
                }
              },
            );
          } catch {
            // Connection failed — keep scanning; another device (or another advertisement from
            // this one) may still produce a reading before the timeout.
            connectedId = null;
          }
        })();
      },
    );
  });
}

/** Encode bytes back to base64 for storage in `body_metrics.raw_payload`. */
function bytesToBase64(bytes: Uint8Array): string {
  const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let out = '';

  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i] ?? 0;
    const b = bytes[i + 1];
    const c = bytes[i + 2];
    const triple = (a << 16) | ((b ?? 0) << 8) | (c ?? 0);

    out += ALPHABET[(triple >> 18) & 0x3f];
    out += ALPHABET[(triple >> 12) & 0x3f];
    out += b === undefined ? '=' : ALPHABET[(triple >> 6) & 0x3f];
    out += c === undefined ? '=' : ALPHABET[triple & 0x3f];
  }

  return out;
}

export class ScanError extends Error {
  constructor(public readonly reason: ScanUnavailableReason) {
    super(`BLE scan unavailable: ${reason}`);
    this.name = 'ScanError';
  }
}
