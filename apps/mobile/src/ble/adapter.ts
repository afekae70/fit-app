/**
 * Smart-scale adapter layer.
 *
 * Deliberately split from any Bluetooth transport. The parsers here are pure
 * bytes-in / reading-out functions, which means the decoding — the part that is genuinely
 * easy to get wrong and impossible to eyeball — is unit-tested against recorded frames with
 * no scale, no phone and no development build required.
 *
 * Scanning itself needs `react-native-ble-plx` in a development build; Bluetooth does not
 * work in Expo Go at all. See scanner.ts.
 *
 * Three adapters ship:
 *  - `standardWeightScaleAdapter` — the Bluetooth SIG Weight Scale Service (0x181D). Any
 *    spec-compliant scale works with no extra code.
 *  - `miScale2Adapter` — Xiaomi Mi Body Composition Scale 2, which broadcasts weight and
 *    impedance in a plain advertisement on service 0x181B. Reverse-engineered but stable and
 *    widely documented, and the cheapest reliable target.
 *  - `namelessBroadcastScaleAdapter` — the unbranded body-composition scale sold with the OKOK
 *    app, which advertises no name, no service UUID and no valid company id, and refuses GATT
 *    connections. Reverse-engineered from captures off one unit and confirmed against its own
 *    display; it is the only adapter matched by payload shape rather than identity, and the
 *    only one where a second identical unit nearby is indistinguishable. See
 *    `ScanOptions.preferDeviceId`.
 *
 * Deliberately NOT attempted: Withings, Renpho and Eufy encrypt their payloads or require
 * cloud pairing, so no local BLE parser can work for them — those need their cloud APIs.
 */

/** A decoded measurement. Only `weightKg` is guaranteed; the rest depend on the device. */
export interface ScaleReading {
  weightKg: number;
  /** True when the scale signals the reading has settled. Unstable frames must be ignored. */
  isStabilised: boolean;
  bodyFatPct?: number;
  waterPct?: number;
  muscleMassKg?: number;
  boneMassKg?: number;
  visceralFat?: number;
  /** Raw bio-impedance in ohms, when broadcast. Body composition is derived from this. */
  impedanceOhms?: number;
  measuredAt?: string;
}

/**
 * What an advertisement tells us about who is broadcasting, before anything is decoded.
 *
 * All the UUID fields it carries, not just the first one: a scale that advertises a battery
 * service alongside its own used to be judged on whichever entry happened to come first in the
 * array, which is device- and platform-dependent and therefore a coin toss.
 */
export interface AdvertisementIdentity {
  /** Short (16-bit) service UUIDs listed in the advertisement. */
  serviceUuids?: readonly string[];
  /** Short UUIDs that actually carried service data — often the more reliable signal. */
  serviceDataUuids?: readonly string[];
  name?: string | null;
}

export interface ScaleAdapter {
  readonly id: string;
  readonly displayName: string;
  /** Service UUIDs (16-bit, lower-case hex) this adapter listens for. */
  readonly serviceUuids: readonly string[];
  /** Whether this adapter recognises the advertised data. */
  matches(input: AdvertisementIdentity): boolean;
  /**
   * Whether this adapter recognises a payload it has no name or UUID to go on.
   *
   * The cheapest scales advertise no name and no service list at all — nothing to match against
   * but the bytes themselves. Only consulted after every identity match has failed, because
   * shape-matching a raw payload is inherently weaker evidence than a service UUID.
   */
  matchesPayload?(bytes: Uint8Array): boolean;
  /** Decode a frame. Returns null when the frame is not a usable measurement. */
  parse(bytes: Uint8Array): ScaleReading | null;
}

/** Does any advertised UUID — listed or data-carrying — match one this adapter wants? */
function advertisesAny(input: AdvertisementIdentity, wanted: readonly string[]): boolean {
  const seen = [...(input.serviceUuids ?? []), ...(input.serviceDataUuids ?? [])].map((uuid) =>
    uuid.toLowerCase(),
  );
  return seen.some((uuid) => wanted.some((want) => uuid.includes(want.toLowerCase())));
}

const u16le = (b: Uint8Array, offset: number): number =>
  (b[offset] ?? 0) | ((b[offset + 1] ?? 0) << 8);

/* -------------------------------------------------------------------------- */
/* Bluetooth SIG Weight Scale Service (0x181D)                                 */
/* -------------------------------------------------------------------------- */

/**
 * Weight Measurement characteristic (0x2A9D).
 *
 * Byte 0 is a flags field:
 *   bit 0 — units: 0 = SI (kg), 1 = Imperial (lb)
 *   bit 1 — timestamp present
 *   bit 2 — user id present
 *   bit 3 — BMI and height present
 *
 * Weight occupies bytes 1-2 as a uint16. Resolution is fixed by the spec and differs per
 * unit: 5 g per count in kg, 10 lb-hundredths per count in pounds. Applying the kg factor to
 * an Imperial frame yields a plausible-but-wrong number, which is why the unit bit is
 * honoured rather than assumed.
 */
export const standardWeightScaleAdapter: ScaleAdapter = {
  id: 'bt_sig_weight_scale',
  displayName: 'Bluetooth Weight Scale (0x181D)',
  serviceUuids: ['181d'],

  matches: (input) => advertisesAny(input, ['181d']),

  parse(bytes) {
    if (bytes.length < 3) return null;

    const flags = bytes[0] ?? 0;
    const isImperial = (flags & 0b1) === 1;
    const raw = u16le(bytes, 1);
    if (raw === 0) return null;

    const weightKg = isImperial
      ? raw * 0.01 * 0.45359237 // hundredths of a pound -> kg
      : raw * 0.005; // 5 g per count

    if (!Number.isFinite(weightKg) || weightKg <= 0 || weightKg > 500) return null;

    // The SIG characteristic is only sent once a measurement is complete, so any frame that
    // parses is by definition final.
    return { weightKg: Number(weightKg.toFixed(2)), isStabilised: true };
  },
};

/* -------------------------------------------------------------------------- */
/* Xiaomi Mi Body Composition Scale 2                                          */
/* -------------------------------------------------------------------------- */

/**
 * Mi Scale 2 service data on 0x181B, 13 bytes.
 *
 *   byte 0    control/unit byte — bit 0 set means pounds, bit 4 means catty
 *   byte 1    status flags — bit 5 = impedance settled, bit 6 = weight stabilised
 *   bytes 2-8 timestamp (year u16, month, day, hour, minute, second)
 *   bytes 9-10  impedance (uint16, ohms)
 *   bytes 11-12 weight (uint16)
 *
 * Weight is transmitted at 200 counts per kg (0.005 kg resolution) but in *jin* when the
 * scale is in metric mode, so the raw value is halved. That factor-of-two is the single most
 * common mistake in third-party implementations — it yields a confident 160 kg for an 80 kg
 * person.
 *
 * Unstabilised frames stream continuously as the user steps on. Recording them would fill the
 * history with garbage mid-step values, so they are parsed but flagged, and the caller stores
 * only stabilised readings.
 */
export const miScale2Adapter: ScaleAdapter = {
  id: 'mi_scale_2',
  displayName: 'Xiaomi Mi Body Composition Scale 2',
  serviceUuids: ['181b'],

  matches: (input) => {
    if (advertisesAny(input, ['181b'])) return true;
    const lower = input.name?.toLowerCase() ?? '';
    return lower.includes('mibfs') || lower.includes('mi scale') || lower.includes('mi body');
  },

  parse(bytes) {
    if (bytes.length < 13) return null;

    const control = bytes[0] ?? 0;
    const status = bytes[1] ?? 0;

    const isStabilised = (status & 0b0010_0000) !== 0;
    const impedanceSettled = (status & 0b0000_0010) !== 0;

    const rawWeight = u16le(bytes, 11);
    if (rawWeight === 0) return null;

    const isPounds = (control & 0b0000_0001) !== 0;
    const isCatty = (control & 0b0001_0000) !== 0;

    let weightKg: number;
    if (isPounds) {
      weightKg = rawWeight * 0.01 * 0.45359237;
    } else if (isCatty) {
      weightKg = rawWeight * 0.01 * 0.5;
    } else {
      // Metric: value is in jin at 0.01 resolution, and 1 jin = 0.5 kg.
      weightKg = (rawWeight * 0.01) / 2;
    }

    if (!Number.isFinite(weightKg) || weightKg <= 0 || weightKg > 500) return null;

    const impedanceOhms = u16le(bytes, 9);

    const reading: ScaleReading = {
      weightKg: Number(weightKg.toFixed(2)),
      isStabilised,
    };

    // Impedance is only meaningful once settled; 0 and 0xFFFF are both "no reading".
    if (impedanceSettled && impedanceOhms > 0 && impedanceOhms < 0xffff) {
      reading.impedanceOhms = impedanceOhms;
    }

    const timestamp = parseMiTimestamp(bytes);
    if (timestamp) reading.measuredAt = timestamp;

    return reading;
  },
};

/** Decode the scale's on-board clock. Returns null when it is unset or nonsensical. */
function parseMiTimestamp(bytes: Uint8Array): string | null {
  const year = u16le(bytes, 2);
  const month = bytes[4] ?? 0;
  const day = bytes[5] ?? 0;
  const hour = bytes[6] ?? 0;
  const minute = bytes[7] ?? 0;
  const second = bytes[8] ?? 0;

  // Scales ship with an unset clock and are frequently never synced, so a bad timestamp is
  // expected rather than exceptional. The caller falls back to device time.
  if (year < 2000 || year > 2100) return null;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  if (hour > 23 || minute > 59 || second > 59) return null;

  return new Date(Date.UTC(year, month - 1, day, hour, minute, second)).toISOString();
}

/* -------------------------------------------------------------------------- */
/* Nameless 15-byte broadcast scale                                            */
/* -------------------------------------------------------------------------- */

/** Big-endian uint16 — this device is big-endian where the Mi Scale is little. */
const u16be = (b: Uint8Array, offset: number): number =>
  ((b[offset] ?? 0) << 8) | (b[offset + 1] ?? 0);

/**
 * A body-composition scale that advertises no name, no service UUID, and no valid company id.
 *
 * Identified from captures rather than documentation, because there is no documentation: the
 * unit ships under the OKOK app (`com.chipsea.btcontrol.en`) and its advertisement is the only
 * thing it will say to anyone. It refuses GATT connections outright, which is why four rounds of
 * connect attempts got nowhere — it is a broadcaster, and the measurement was in the scan record
 * the whole time.
 *
 * 15 bytes of manufacturer data:
 *
 *     0      0xC0, constant across every capture
 *     1      sequence counter, seen running 0x0D, 0x0F, 0x10 on consecutive frames
 *     2-3    weight, big-endian, hundredths of a kilogram
 *     4-5    a second field, 0x1388 in every loaded frame and zero in every idle one
 *     6-7    0x0808, constant
 *     8      flags; bit 0 marks a live measurement (0x25 loaded, 0x24 idle)
 *     9-14   the device's own MAC address
 *
 * The idle frame zeroes bytes 2-5 rather than omitting them, so a parser that ignored the flag
 * byte would record a 0 kg weigh-in every few hundred milliseconds between measurements.
 *
 * Two fields are deliberately NOT decoded. `0x1388` is constant across every capture taken so
 * far, which means nothing has yet distinguished "impedance that happens to repeat" from "a
 * device constant" — publishing it as body fat would invent a measurement. Likewise the MAC tail
 * is used to sanity-check the frame, not to identify a user.
 */
export const namelessBroadcastScaleAdapter: ScaleAdapter = {
  id: 'nameless_broadcast_scale',
  displayName: 'Broadcast body-composition scale (OKOK/Chipsea)',
  serviceUuids: [],

  // Nothing to match on: no name, no service UUID. Identity matching cannot see this device at
  // all, which is what `matchesPayload` exists for.
  matches: () => false,

  matchesPayload(bytes) {
    return (
      bytes.length === 15 &&
      bytes[0] === 0xc0 &&
      bytes[6] === 0x08 &&
      bytes[7] === 0x08 &&
      // The flag byte only ever differs in its low bit between loaded and idle.
      ((bytes[8] ?? 0) & 0xfe) === 0x24
    );
  },

  parse(bytes) {
    if (!namelessBroadcastScaleAdapter.matchesPayload?.(bytes)) return null;

    const hasMeasurement = ((bytes[8] ?? 0) & 0x01) !== 0;
    const raw = u16be(bytes, 2);
    if (!hasMeasurement || raw === 0) return null;

    const weightKg = raw / 100;
    if (!Number.isFinite(weightKg) || weightKg < 2 || weightKg > 300) return null;

    // Every frame carrying the flag is a settled reading — unlike the Mi Scale, this device
    // simply stops broadcasting a value rather than streaming the climb.
    return { weightKg: Number(weightKg.toFixed(2)), isStabilised: true };
  },
};

/* -------------------------------------------------------------------------- */
/* Registry                                                                    */
/* -------------------------------------------------------------------------- */

export const SCALE_ADAPTERS: readonly ScaleAdapter[] = [
  miScale2Adapter,
  standardWeightScaleAdapter,
  namelessBroadcastScaleAdapter,
];

/** Pick the adapter that recognises a discovered device, if any. */
export function selectAdapter(input: AdvertisementIdentity): ScaleAdapter | null {
  return SCALE_ADAPTERS.find((adapter) => adapter.matches(input)) ?? null;
}

/**
 * Pick an adapter by the shape of a payload, for devices that identify themselves not at all.
 *
 * Tried only after `selectAdapter` has failed. A service UUID is a claim the device makes about
 * itself; a byte pattern is a guess we make about the device, and the weaker evidence should
 * never pre-empt the stronger.
 */
export function selectAdapterByPayload(bytes: Uint8Array): ScaleAdapter | null {
  return SCALE_ADAPTERS.find((adapter) => adapter.matchesPayload?.(bytes) ?? false) ?? null;
}

/** All service UUIDs worth scanning for. */
export const SCANNABLE_SERVICE_UUIDS: readonly string[] = [
  ...new Set(SCALE_ADAPTERS.flatMap((a) => a.serviceUuids)),
];

/* -------------------------------------------------------------------------- */
/* Body composition                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Estimate body-fat percentage without an impedance reading.
 *
 * Re-exported rather than implemented here so there is exactly one copy: CLAUDE.md puts
 * physiology in `packages/shared` precisely so the number on screen and the number the coach
 * reasons about cannot drift apart, and a scale adapter is no place for a second version of it.
 *
 * Impedance-based body fat, where a scale offers it at all, is an estimate with meaningful error
 * that swings with hydration and recent food far more than actual body composition does. It is
 * worth tracking as a trend and worth ignoring as an absolute figure — which is why the weight
 * trend, not this, drives the calorie targets.
 */
export { estimateBodyFatPctFromBmi as estimateBodyFatPct } from '@fit/shared/calculations';
