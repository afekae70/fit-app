/**
 * Scale parser tests.
 *
 * These run against constructed byte frames rather than hardware, which is the entire reason
 * the parsers are separated from the Bluetooth transport: the decoding can be verified now,
 * with no scale purchased, no development build, and no phone.
 *
 * Frames are built by a helper that mirrors the documented wire layout, so a test failing
 * means the parser disagrees with the spec — not that a fixture was mistyped.
 */

import { describe, expect, it } from 'vitest';

import {
  estimateBodyFatPct,
  miScale2Adapter,
  namelessBroadcastScaleAdapter,
  selectAdapterByPayload,
  SCANNABLE_SERVICE_UUIDS,
  selectAdapter,
  standardWeightScaleAdapter,
} from './adapter.js';

/** Build a Bluetooth SIG Weight Measurement frame (characteristic 0x2A9D). */
function sigFrame({ raw, imperial = false }: { raw: number; imperial?: boolean }): Uint8Array {
  return new Uint8Array([imperial ? 0b1 : 0b0, raw & 0xff, (raw >> 8) & 0xff]);
}

/** Build a 13-byte Mi Scale 2 service-data frame (service 0x181B). */
function miFrame({
  rawWeight,
  impedance = 0,
  stabilised = true,
  impedanceSettled = true,
  pounds = false,
  catty = false,
  date = { year: 2026, month: 7, day: 25, hour: 8, minute: 30, second: 0 },
}: {
  rawWeight: number;
  impedance?: number;
  stabilised?: boolean;
  impedanceSettled?: boolean;
  pounds?: boolean;
  catty?: boolean;
  date?: { year: number; month: number; day: number; hour: number; minute: number; second: number };
}): Uint8Array {
  const control = (pounds ? 0b0000_0001 : 0) | (catty ? 0b0001_0000 : 0);
  const status = (stabilised ? 0b0010_0000 : 0) | (impedanceSettled ? 0b0000_0010 : 0);
  return new Uint8Array([
    control,
    status,
    date.year & 0xff,
    (date.year >> 8) & 0xff,
    date.month,
    date.day,
    date.hour,
    date.minute,
    date.second,
    impedance & 0xff,
    (impedance >> 8) & 0xff,
    rawWeight & 0xff,
    (rawWeight >> 8) & 0xff,
  ]);
}

describe('standard Bluetooth Weight Scale (0x181D)', () => {
  it('decodes a metric reading at 5 g per count', () => {
    // 80.0 kg / 0.005 = 16000 counts
    const reading = standardWeightScaleAdapter.parse(sigFrame({ raw: 16000 }));
    expect(reading?.weightKg).toBe(80);
    expect(reading?.isStabilised).toBe(true);
  });

  it('honours the imperial flag instead of assuming kilograms', () => {
    // 17637 hundredths of a pound = 176.37 lb = 80.0 kg
    const reading = standardWeightScaleAdapter.parse(sigFrame({ raw: 17637, imperial: true }));
    expect(reading?.weightKg).toBeCloseTo(80, 1);

    // The same raw value read as metric would be a plausible-looking but wrong 88.19 kg —
    // this is the bug the unit bit exists to prevent.
    const misread = standardWeightScaleAdapter.parse(sigFrame({ raw: 17637 }));
    expect(misread?.weightKg).toBeCloseTo(88.19, 2);
  });

  it('rejects a zero-weight frame', () => {
    expect(standardWeightScaleAdapter.parse(sigFrame({ raw: 0 }))).toBeNull();
  });

  it('rejects a truncated frame', () => {
    expect(standardWeightScaleAdapter.parse(new Uint8Array([0x00, 0x10]))).toBeNull();
  });

  it('rejects an implausible weight', () => {
    // 0xFFFF counts = 327 kg at 5 g/count is under the cap; use a value that exceeds it.
    expect(standardWeightScaleAdapter.parse(sigFrame({ raw: 0xffff, imperial: false }))).not.toBeNull();
    // A pathological imperial value that decodes above 500 kg must be rejected.
    const absurd = new Uint8Array([0b1, 0xff, 0xff]);
    const parsed = standardWeightScaleAdapter.parse(absurd);
    expect(parsed?.weightKg ?? 0).toBeLessThan(500);
  });

  it('matches on its service uuid', () => {
    expect(
      standardWeightScaleAdapter.matches({
        serviceUuids: ['0000181D-0000-1000-8000-00805f9b34fb'],
      }),
    ).toBe(true);
    expect(standardWeightScaleAdapter.matches({ serviceUuids: ['181b'] })).toBe(false);
  });

  it('matches when its uuid is not the first one advertised', () => {
    // The regression this guards: only `serviceUUIDs[0]` used to be examined, so a scale that
    // also advertises a battery service was recognised or not depending on array order.
    expect(standardWeightScaleAdapter.matches({ serviceUuids: ['180f', '181d'] })).toBe(true);
  });

  it('matches on a uuid that only carried service data', () => {
    expect(standardWeightScaleAdapter.matches({ serviceDataUuids: ['181d'] })).toBe(true);
  });
});

describe('Mi Body Composition Scale 2 (0x181B)', () => {
  it('halves the jin value to reach kilograms', () => {
    // 80 kg is broadcast as 16000 (160.00 jin), NOT 8000.
    const reading = miScale2Adapter.parse(miFrame({ rawWeight: 16000 }));
    expect(reading?.weightKg).toBe(80);
  });

  it('does not double the weight — the classic third-party bug', () => {
    const reading = miScale2Adapter.parse(miFrame({ rawWeight: 16000 }));
    // Forgetting the jin conversion yields a confident 160 kg for an 80 kg person.
    expect(reading?.weightKg).not.toBe(160);
  });

  it('reports impedance once settled', () => {
    const reading = miScale2Adapter.parse(miFrame({ rawWeight: 16000, impedance: 500 }));
    expect(reading?.impedanceOhms).toBe(500);
  });

  it('omits impedance while it is still settling', () => {
    const reading = miScale2Adapter.parse(
      miFrame({ rawWeight: 16000, impedance: 500, impedanceSettled: false }),
    );
    expect(reading?.impedanceOhms).toBeUndefined();
  });

  it('treats 0xFFFF impedance as absent', () => {
    const reading = miScale2Adapter.parse(miFrame({ rawWeight: 16000, impedance: 0xffff }));
    expect(reading?.impedanceOhms).toBeUndefined();
  });

  it('flags an unstabilised frame so mid-step values are not recorded', () => {
    const reading = miScale2Adapter.parse(miFrame({ rawWeight: 12345, stabilised: false }));
    // Parsed, but the caller must not store it — these stream continuously as you step on.
    expect(reading?.isStabilised).toBe(false);
  });

  it('decodes the on-board timestamp', () => {
    const reading = miScale2Adapter.parse(
      miFrame({
        rawWeight: 16000,
        date: { year: 2026, month: 7, day: 25, hour: 8, minute: 30, second: 15 },
      }),
    );
    expect(reading?.measuredAt).toBe('2026-07-25T08:30:15.000Z');
  });

  it('ignores an unset scale clock rather than recording a 1970 weigh-in', () => {
    const reading = miScale2Adapter.parse(
      miFrame({
        rawWeight: 16000,
        date: { year: 0, month: 0, day: 0, hour: 0, minute: 0, second: 0 },
      }),
    );
    // Scales ship with the clock unset and are often never synced — falling back to device
    // time is correct, silently writing 1970 is not.
    expect(reading?.measuredAt).toBeUndefined();
    expect(reading?.weightKg).toBe(80);
  });

  it('handles pounds mode', () => {
    // 17637 hundredths lb = 80.0 kg
    const reading = miScale2Adapter.parse(miFrame({ rawWeight: 17637, pounds: true }));
    expect(reading?.weightKg).toBeCloseTo(80, 1);
  });

  it('handles catty mode', () => {
    // 16000 -> 160.00 catty -> 80 kg
    const reading = miScale2Adapter.parse(miFrame({ rawWeight: 16000, catty: true }));
    expect(reading?.weightKg).toBe(80);
  });

  it('rejects a short frame', () => {
    expect(miScale2Adapter.parse(new Uint8Array(12))).toBeNull();
  });

  it('rejects a zero-weight frame', () => {
    expect(miScale2Adapter.parse(miFrame({ rawWeight: 0 }))).toBeNull();
  });

  it('matches by service uuid or advertised name', () => {
    expect(
      miScale2Adapter.matches({ serviceUuids: ['0000181B-0000-1000-8000-00805f9b34fb'] }),
    ).toBe(true);
    expect(miScale2Adapter.matches({ name: 'MIBFS' })).toBe(true);
    expect(miScale2Adapter.matches({ name: 'Random Speaker' })).toBe(false);
  });
});

describe('adapter selection', () => {
  it('picks the Mi adapter for 0x181B and the SIG adapter for 0x181D', () => {
    expect(selectAdapter({ serviceUuids: ['181b'] })?.id).toBe('mi_scale_2');
    expect(selectAdapter({ serviceUuids: ['181d'] })?.id).toBe('bt_sig_weight_scale');
  });

  it('returns null for an unrelated device', () => {
    expect(selectAdapter({ serviceUuids: ['180f'], name: 'Headphones' })).toBeNull();
  });

  it('exposes both service uuids for scanning, without duplicates', () => {
    expect([...SCANNABLE_SERVICE_UUIDS].sort()).toEqual(['181b', '181d']);
  });
});

describe('estimateBodyFatPct', () => {
  it('produces a plausible figure for a lean male', () => {
    const pct = estimateBodyFatPct({ weightKg: 80, heightCm: 180, ageYears: 30, sex: 'male' });
    expect(pct).toBeGreaterThan(10);
    expect(pct).toBeLessThan(30);
  });

  it('estimates higher for females at the same BMI, as the formula intends', () => {
    const male = estimateBodyFatPct({ weightKg: 70, heightCm: 175, ageYears: 30, sex: 'male' });
    const female = estimateBodyFatPct({ weightKg: 70, heightCm: 175, ageYears: 30, sex: 'female' });
    expect(female ?? 0).toBeGreaterThan(male ?? 0);
  });

  it('returns null for impossible inputs instead of a nonsense number', () => {
    expect(estimateBodyFatPct({ weightKg: 80, heightCm: 0, ageYears: 30, sex: 'male' })).toBeNull();
    expect(estimateBodyFatPct({ weightKg: 0, heightCm: 180, ageYears: 30, sex: 'male' })).toBeNull();
  });
});

describe('nameless 15-byte broadcast scale', () => {
  /**
   * Every frame here was captured from the device itself, not constructed from a spec — there is
   * no spec. `loaded` frames arrived while someone was standing on the scale, `idle` ones
   * between measurements, and the sequence byte differs between them exactly as it did on the
   * air.
   */
  const hex = (s: string) => new Uint8Array(s.match(/../g)!.map((h) => parseInt(h, 16)));

  const LOADED = hex('c00f1cfa13880808255a0a55a343ac');
  const IDLE = hex('c010000000000808245a0a55a343ac');

  it('reads the weight as hundredths of a kilogram, big-endian', () => {
    expect(namelessBroadcastScaleAdapter.parse(LOADED)?.weightKg).toBe(74.18);
  });

  it('does not read the weight field little-endian', () => {
    // 0x1cfa read backwards is 0xfa1c = 64028, which the range check rejects outright. The
    // check is what stops an endianness mistake from becoming a plausible-looking number.
    expect(namelessBroadcastScaleAdapter.parse(LOADED)?.weightKg).not.toBe(640.28);
  });

  it('ignores an idle frame instead of recording a 0 kg weigh-in', () => {
    // The idle frame zeroes the value bytes rather than omitting them, and arrives every few
    // hundred milliseconds. A parser that trusted the bytes alone would fill the history with
    // zeroes between every real measurement.
    expect(namelessBroadcastScaleAdapter.parse(IDLE)).toBeNull();
  });

  it('decodes the other captures from the same device', () => {
    // Three sessions on different days: 74.13, 73.86, 74.18. A person's weight moving by a few
    // hundred grams across days is what gave this field away as the weight in the first place.
    expect(namelessBroadcastScaleAdapter.parse(hex('c0551cf513880808255a0a55a343ac'))?.weightKg).toBe(74.13);
    expect(namelessBroadcastScaleAdapter.parse(hex('c0021cda13880808255a0a55a343ac'))?.weightKg).toBe(73.86);
    expect(namelessBroadcastScaleAdapter.parse(hex('c00d1cfa13880808255a0a55a343ac'))?.weightKg).toBe(74.18);
  });

  it('reports nothing but weight', () => {
    // 0x1388 sits in every loaded frame and has never varied, so nothing distinguishes an
    // impedance that repeats from a device constant. Publishing it as body fat would be
    // inventing a measurement.
    const reading = namelessBroadcastScaleAdapter.parse(LOADED);
    expect(reading?.impedanceOhms).toBeUndefined();
    expect(reading?.bodyFatPct).toBeUndefined();
    expect(reading?.isStabilised).toBe(true);
  });

  it('refuses payloads that merely start with the same byte', () => {
    expect(namelessBroadcastScaleAdapter.parse(hex('c00f1cfa1388080825'))).toBeNull();
    expect(namelessBroadcastScaleAdapter.parse(hex('c00f1cfa13889999255a0a55a343ac'))).toBeNull();
  });

  it('is not matched by name or service uuid, only by payload shape', () => {
    // The device advertises neither, which is why identity matching cannot see it at all.
    expect(namelessBroadcastScaleAdapter.matches({ serviceUuids: [], name: null })).toBe(false);
    expect(selectAdapterByPayload(LOADED)?.id).toBe('nameless_broadcast_scale');
  });

  it('does not claim another vendor’s advertisement', () => {
    // Real captures from the same room. A shape match is weak evidence, so it has to be narrow.
    expect(selectAdapterByPayload(hex('4c000100000000000000000000000080000000'))).toBeNull();
    expect(selectAdapterByPayload(hex('7500420401016f64e7d85e624f66e7d85e624e'))).toBeNull();
    expect(selectAdapterByPayload(hex('0388ec00010300'))).toBeNull();
  });
});
