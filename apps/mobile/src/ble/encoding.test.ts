/**
 * Tests for the BLE transport's pure helpers.
 *
 * These exist because both functions fail *silently* when wrong: a bad base64 decode yields a
 * plausible weight rather than an error, and a UUID that never matches makes the scan look like
 * it is working and simply finding no scales.
 */

import { describe, expect, it } from 'vitest';

import {
  base64ToBytes,
  fullUuid,
  selectAdvertisementPayload,
  shortUuid,
} from './encoding.js';

/** Node's Buffer is the reference implementation to check ours against. */
const encode = (bytes: number[]) => Buffer.from(bytes).toString('base64');

describe('base64ToBytes', () => {
  it('decodes an empty string to an empty array', () => {
    expect(base64ToBytes('')).toEqual(new Uint8Array(0));
  });

  it('matches Buffer across every padding case', () => {
    // Lengths 1, 2 and 3 exercise the two-, one- and zero-padding tails respectively.
    for (const bytes of [[0x01], [0x01, 0x02], [0x01, 0x02, 0x03], [0xff, 0x00, 0xa5, 0x5a]]) {
      expect(Array.from(base64ToBytes(encode(bytes)))).toEqual(bytes);
    }
  });

  it('round-trips a realistic 13-byte Mi Scale frame', () => {
    const frame = [0x02, 0x26, 0xa0, 0x1f, 0xe6, 0x07, 0x07, 0x1a, 0x0c, 0x1e, 0x00, 0x40, 0x1f];
    expect(Array.from(base64ToBytes(encode(frame)))).toEqual(frame);
  });

  it('preserves high bytes rather than truncating them', () => {
    const bytes = [0xff, 0xfe, 0xfd];
    expect(Array.from(base64ToBytes(encode(bytes)))).toEqual(bytes);
  });

  it('ignores whitespace and padding characters', () => {
    const withPadding = encode([0x01, 0x02]);
    expect(Array.from(base64ToBytes(` ${withPadding} `))).toEqual([0x01, 0x02]);
  });
});

describe('shortUuid', () => {
  it('extracts the 16-bit id from the full Bluetooth Base UUID', () => {
    expect(shortUuid('0000181D-0000-1000-8000-00805F9B34FB')).toBe('181d');
    expect(shortUuid('0000181b-0000-1000-8000-00805f9b34fb')).toBe('181b');
  });

  it('lower-cases, since iOS and Android disagree on casing', () => {
    expect(shortUuid('181D')).toBe('181d');
  });

  it('accepts an already-short id, with or without 0x', () => {
    expect(shortUuid('181d')).toBe('181d');
    expect(shortUuid('0x181D')).toBe('181d');
  });

  it('leaves a genuinely custom 128-bit UUID alone', () => {
    const custom = '6e400001-b5a3-f393-e0a9-e50e24dcca9e';
    expect(shortUuid(custom)).toBe(custom);
  });

  it('round-trips through fullUuid', () => {
    expect(shortUuid(fullUuid('181d'))).toBe('181d');
    expect(fullUuid('181D')).toBe('0000181d-0000-1000-8000-00805f9b34fb');
  });
});

describe('selectAdvertisementPayload', () => {
  it('prefers serviceData matching a wanted service', () => {
    const result = selectAdvertisementPayload({
      serviceData: { '0000181b-0000-1000-8000-00805f9b34fb': encode([0x02, 0x26]) },
      manufacturerData: encode([0xff, 0xff]),
      serviceUuids: ['181b'],
    });
    expect(result?.serviceUuid).toBe('181b');
    expect(Array.from(result!.bytes)).toEqual([0x02, 0x26]);
  });

  it('ignores serviceData for a service nobody asked about', () => {
    const result = selectAdvertisementPayload({
      serviceData: { '0000180f-0000-1000-8000-00805f9b34fb': encode([0x64]) },
      serviceUuids: ['181b'],
    });
    // 0x180F is battery level; parsing it as a weight would invent a reading.
    expect(result).toBeNull();
  });

  it('falls back to manufacturerData when no serviceData matches', () => {
    const result = selectAdvertisementPayload({
      serviceData: {},
      manufacturerData: encode([0x1b, 0x18, 0x02]),
      serviceUuids: ['181b'],
    });
    expect(result?.serviceUuid).toBe('');
    expect(Array.from(result!.bytes)).toEqual([0x1b, 0x18, 0x02]);
  });

  it('returns null when there is nothing to parse', () => {
    expect(
      selectAdvertisementPayload({ serviceData: null, manufacturerData: null, serviceUuids: ['181b'] }),
    ).toBeNull();
  });

  it('treats an empty payload as nothing rather than as a frame', () => {
    expect(
      selectAdvertisementPayload({
        serviceData: { '0000181b-0000-1000-8000-00805f9b34fb': '' },
        manufacturerData: '',
        serviceUuids: ['181b'],
      }),
    ).toBeNull();
  });
});
