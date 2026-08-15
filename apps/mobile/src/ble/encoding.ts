/**
 * Pure helpers shared by the BLE transport.
 *
 * Kept out of scanner.ts so they can be tested in Node: scanner.ts imports
 * `react-native-ble-plx`, which has no JS-only build and cannot be loaded by the test runner.
 * Everything here is bytes and strings, so it is testable without a phone, a scale, or a
 * development build — which matters, because getting either of these subtly wrong produces a
 * plausible number rather than an error.
 */

/**
 * Decode base64 to bytes.
 *
 * react-native-ble-plx hands every payload over as base64, and React Native has no global
 * `Buffer` and no `Uint8Array.fromBase64`. `atob` exists in the Hermes runtime but not in Node
 * without a polyfill, so this decodes by hand and works identically in both.
 */
export function base64ToBytes(input: string): Uint8Array {
  const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

  const clean = input.replace(/[^A-Za-z0-9+/]/g, '');
  if (clean.length === 0) return new Uint8Array(0);

  // Every 4 base64 characters encode 3 bytes. Padding was stripped above, so the tail is
  // derived from the remainder rather than from '=' characters.
  const fullGroups = Math.floor(clean.length / 4);
  const remainder = clean.length % 4;
  const byteLength = fullGroups * 3 + (remainder === 0 ? 0 : remainder - 1);
  const out = new Uint8Array(byteLength);

  let outIndex = 0;
  let buffer = 0;
  let bitsCollected = 0;

  for (const char of clean) {
    const value = ALPHABET.indexOf(char);
    if (value === -1) continue;

    buffer = (buffer << 6) | value;
    bitsCollected += 6;

    if (bitsCollected >= 8) {
      bitsCollected -= 8;
      if (outIndex < byteLength) out[outIndex++] = (buffer >> bitsCollected) & 0xff;
    }
  }

  return out;
}

/**
 * Reduce a BLE UUID to its 16-bit short form, lower-case.
 *
 * The adapters key off short ids ('181d'), while react-native-ble-plx reports the full 128-bit
 * Bluetooth Base UUID ('0000181D-0000-1000-8000-00805F9B34FB'), casing varying by platform.
 * Comparing those directly silently never matches — the scan appears to work and simply finds
 * nothing, which is close to the worst possible failure mode to debug.
 */
export function shortUuid(uuid: string): string {
  const lower = uuid.toLowerCase().trim();

  // Full Bluetooth Base UUID: the 16-bit id lives in characters 4-8.
  if (lower.length === 36 && lower.endsWith('-0000-1000-8000-00805f9b34fb')) {
    return lower.slice(4, 8);
  }
  // Already short, with or without a 0x prefix.
  const bare = lower.startsWith('0x') ? lower.slice(2) : lower;
  if (/^[0-9a-f]{4}$/.test(bare)) return bare;
  if (/^[0-9a-f]{8}$/.test(bare) && bare.startsWith('0000')) return bare.slice(4);

  return lower;
}

/** Expand a 16-bit id to the full Bluetooth Base UUID, which is what ble-plx expects. */
export function fullUuid(short: string): string {
  const bare = shortUuid(short);
  if (bare.length !== 4) return short;
  return `0000${bare}-0000-1000-8000-00805f9b34fb`;
}

/**
 * Pick the payload to parse out of a scan result.
 *
 * Scales split across two conventions: the Mi Scale broadcasts in `serviceData` keyed by its
 * service UUID, while others put the same bytes in `manufacturerData`. Trying serviceData first
 * and falling back means one code path serves both without the caller having to know which
 * device it is talking to.
 */
export function selectAdvertisementPayload(input: {
  serviceData?: Record<string, string> | null;
  manufacturerData?: string | null;
  serviceUuids: readonly string[];
}): { bytes: Uint8Array; serviceUuid: string } | null {
  const wanted = new Set(input.serviceUuids.map(shortUuid));

  for (const [uuid, base64] of Object.entries(input.serviceData ?? {})) {
    const short = shortUuid(uuid);
    if (!wanted.has(short)) continue;
    const bytes = base64ToBytes(base64);
    if (bytes.length > 0) return { bytes, serviceUuid: short };
  }

  if (input.manufacturerData) {
    const bytes = base64ToBytes(input.manufacturerData);
    if (bytes.length > 0) return { bytes, serviceUuid: '' };
  }

  return null;
}

/**
 * Bluetooth SIG company identifiers, as they appear little-endian at the head of manufacturer
 * data — which is why the hex here reads back-to-front from the assigned numbers list.
 */
const KNOWN_COMPANIES: Record<string, string> = {
  '4c00': 'Apple',
  '7500': 'Samsung',
  '0600': 'Microsoft',
  '0e00': 'Google',
  d007: 'Tuya',
  '5d00': 'Gree',
};

/**
 * Names that give a device away without any usable manufacturer data.
 *
 * Anchored or word-bounded on purpose. An unanchored /tv/i matches any name containing those
 * two letters, and the entire value of this table is that a device it stays silent about is
 * worth connecting to — a false match hides the one row that mattered.
 */
const KNOWN_NAME_PATTERNS: [RegExp, string][] = [
  [/^govee/i, 'Govee'],
  [/^\[?tv\]?[\s_-]|samsung|qled/i, 'TV'],
  [/webos|^\[lg\]/i, 'LG'],
  [/^jbl[\s_-]/i, 'JBL'],
  [/^gr-ac/i, 'Gree'],
];

/**
 * Which brand, if any, this advertiser is recognisably from.
 *
 * Returns null for anything unrecognised, which is deliberately the interesting answer: a
 * body-composition scale from a factory that also ships four other brands has no entry in any
 * table, and "not a television" is the most this can honestly narrow it to.
 */
export function classifyVendor(device: {
  name: string | null;
  manufacturerDataHex: string | null;
}): string | null {
  const company = device.manufacturerDataHex?.slice(0, 4).toLowerCase();
  if (company && KNOWN_COMPANIES[company]) return KNOWN_COMPANIES[company];

  for (const [pattern, vendor] of KNOWN_NAME_PATTERNS) {
    if (device.name && pattern.test(device.name)) return vendor;
  }

  return null;
}
