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
 *
 * ## The manifest trap, which cost a working scan
 *
 * On Android 12+ `BLUETOOTH_SCAN` must be declared with
 * `android:usesPermissionFlags="neverForLocation"`, or the system requires a runtime location
 * grant on top of it and otherwise returns **zero devices with no error** — the scan appears to
 * run perfectly and simply finds nothing.
 *
 * The `react-native-ble-plx` config plugin adds that flag, but only if `BLUETOOTH_SCAN` is not
 * already in the manifest. `app.json` used to list it under `android.permissions`, Expo wrote it
 * first without flags, and the plugin then skipped it. Do not put `BLUETOOTH_SCAN` or
 * `ACCESS_FINE_LOCATION` back in `android.permissions` — the plugin owns both.
 *
 * Verify after any prebuild:
 *
 *     grep BLUETOOTH_SCAN android/app/src/main/AndroidManifest.xml
 *
 * and check `neverForLocation` is on the line.
 */

import { PermissionsAndroid, Platform } from 'react-native';

import { selectAdapter, type ScaleReading } from './adapter.js';
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
    // eslint-disable-next-line @typescript-eslint/no-require-imports
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
      // No service filter. Filtering here only ever matched a UUID present in the advertisement
      // itself, and most cheap scales advertise a name and their measurement bytes with no
      // service list at all — they were invisible before the adapters got a chance to look.
      // Matching moved into `selectAdapter`, which can also key off the device name.
      null,
      // allowDuplicates is required: an advertising scale re-broadcasts as the weight settles,
      // and without duplicates only the first (unsettled) frame would ever arrive.
      { allowDuplicates: true },
      (error, device) => {
        if (error || !device || settled) return;

        const adapter = selectAdapter({
          serviceUuids: device.serviceUUIDs?.map(shortUuid) ?? [],
          serviceDataUuids: Object.keys(device.serviceData ?? {}).map(shortUuid),
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

/* -------------------------------------------------------------------------- */
/* Diagnostics                                                                 */
/* -------------------------------------------------------------------------- */

export interface SightedDevice {
  id: string;
  name: string | null;
  /** Short service UUIDs listed in the advertisement. */
  serviceUuids: string[];
  /** Short UUID -> payload hex, for every service that carried data. */
  serviceData: Record<string, string>;
  /** Manufacturer data as hex. The first two bytes are the little-endian company id. */
  manufacturerDataHex: string | null;
  /** How many advertisements arrived — a scale under load re-broadcasts constantly. */
  frames: number;
  /** Distinct payloads seen, newest last. A changing payload is a live measurement. */
  payloadsHex: string[];
  /** Whether one of the shipped adapters claims it. */
  adapterId: string | null;
}

/**
 * List everything advertising nearby, decoded no further than hex.
 *
 * This exists because "the app found no scale" is not a diagnosis. Cheap body-composition
 * scales are a genus, not a species: some speak the SIG Weight Scale service, some broadcast in
 * manufacturer data, some only talk after a GATT connection, and the ones sold with the OKOK
 * app use none of the UUIDs this app currently knows. Writing a parser for one by guessing gives
 * a plausible wrong number rather than an error — the exact failure adapter.ts is built to
 * avoid — so the frames get captured first and the parser is written against them.
 *
 * Payloads are kept per device and de-duplicated: a scale someone is standing on emits a
 * different payload every few hundred milliseconds, and that changing run of bytes is what
 * identifies the weight field. A key fob emits the same bytes forever.
 */
export async function scanDiagnostics(
  options: { timeoutMs?: number } = {},
): Promise<SightedDevice[]> {
  const { timeoutMs = 15_000 } = options;

  const availability = await checkScanAvailability();
  if (!availability.available) throw new ScanError(availability.reason);
  if (!(await requestAndroidPermissions())) throw new ScanError('permission_denied');

  const ble = loadBlePlx();
  if (!ble) throw new ScanError('no_native_module');

  const manager = new ble.BleManager();
  const seen = new Map<string, SightedDevice>();

  return new Promise<SightedDevice[]>((resolve) => {
    const finish = () => {
      clearTimeout(timer);
      try {
        manager.stopDeviceScan();
      } catch {
        /* already torn down */
      }
      manager.destroy();
      // Busiest first: the scale being stood on is the loudest thing in the room, and a list
      // sorted by arrival order buries it under whatever a neighbour left switched on.
      resolve([...seen.values()].sort((a, b) => b.frames - a.frames));
    };

    const timer = setTimeout(finish, timeoutMs);

    manager.startDeviceScan(null, { allowDuplicates: true }, (error, device) => {
      if (error || !device) return;

      const name = device.name ?? device.localName ?? null;
      const serviceData: Record<string, string> = {};
      for (const [uuid, base64] of Object.entries(device.serviceData ?? {})) {
        serviceData[shortUuid(uuid)] = bytesToHex(base64ToBytes(base64));
      }
      const manufacturerDataHex = device.manufacturerData
        ? bytesToHex(base64ToBytes(device.manufacturerData))
        : null;

      const existing = seen.get(device.id);
      const entry: SightedDevice = existing ?? {
        id: device.id,
        name,
        serviceUuids: [],
        serviceData: {},
        manufacturerDataHex,
        frames: 0,
        payloadsHex: [],
        adapterId: null,
      };

      entry.frames += 1;
      // A name often only arrives in the scan response, several frames after the first sighting.
      if (!entry.name && name) entry.name = name;
      for (const uuid of device.serviceUUIDs ?? []) {
        const short = shortUuid(uuid);
        if (!entry.serviceUuids.includes(short)) entry.serviceUuids.push(short);
      }
      Object.assign(entry.serviceData, serviceData);
      if (manufacturerDataHex) entry.manufacturerDataHex = manufacturerDataHex;

      // Capped: a scale advertising for fifteen seconds would otherwise produce hundreds of
      // lines, and the first few distinct payloads carry the same information.
      for (const payload of [...Object.values(serviceData), manufacturerDataHex ?? '']) {
        if (payload && !entry.payloadsHex.includes(payload) && entry.payloadsHex.length < 12) {
          entry.payloadsHex.push(payload);
        }
      }

      entry.adapterId =
        selectAdapter({
          serviceUuids: entry.serviceUuids,
          serviceDataUuids: Object.keys(entry.serviceData),
          name: entry.name,
        })?.id ?? null;

      seen.set(device.id, entry);
    });
  });
}

/** Lower-case hex, no separators — the form every BLE protocol note is written in. */
export function bytesToHex(bytes: Uint8Array): string {
  let out = '';
  for (const byte of bytes) out += byte.toString(16).padStart(2, '0');
  return out;
}

/** A diagnostics dump as plain text, for pasting into a bug report. */
export function formatDiagnostics(devices: readonly SightedDevice[]): string {
  if (devices.length === 0) return 'No BLE devices seen.';

  return devices
    .map((device) => {
      const lines = [
        `${device.name ?? '(no name)'}  [${device.id}]`,
        `  frames: ${device.frames}${device.adapterId ? `  adapter: ${device.adapterId}` : ''}`,
      ];
      if (device.serviceUuids.length > 0) lines.push(`  services: ${device.serviceUuids.join(', ')}`);
      for (const [uuid, hex] of Object.entries(device.serviceData)) {
        lines.push(`  serviceData[${uuid}]: ${hex}`);
      }
      if (device.manufacturerDataHex) lines.push(`  manufacturerData: ${device.manufacturerDataHex}`);
      if (device.payloadsHex.length > 1) {
        lines.push('  payloads:');
        for (const hex of device.payloadsHex) lines.push(`    ${hex}`);
      }
      return lines.join('\n');
    })
    .join('\n\n');
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
