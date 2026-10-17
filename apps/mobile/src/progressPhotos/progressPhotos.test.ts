/**
 * The pure parts of progress photos: taking the metadata out of a picture, and the arithmetic
 * of setting two side by side.
 */

import { describe, expect, it } from 'vitest';

import { daysBetween, exifDay, inOrder, weightNear } from './compare.js';
import { stripJpegMetadata } from './jpeg.js';
import { dividerAfterDrag, dividerStep, shownPercent } from './slider.js';

/** A marker segment: FF, the marker, a two-byte length that counts itself, then the payload. */
const segment = (marker: number, payload: number[]) => [
  0xff,
  marker,
  (payload.length + 2) >> 8,
  (payload.length + 2) & 0xff,
  ...payload,
];

const ascii = (text: string) => [...text].map((c) => c.charCodeAt(0));

const JFIF = segment(0xe0, [...ascii('JFIF'), 0, 1, 1, 0, 0, 1, 0, 1, 0, 0]);
const EXIF_WITH_GPS = segment(0xe1, [...ascii('Exif'), 0, 0, ...ascii('GPS 32.08N 34.78E')]);
const XMP = segment(0xe1, ascii('http://ns.adobe.com/xap/1.0/ <x:xmpmeta/>'));
const ICC = segment(0xe2, [...ascii('ICC_PROFILE'), 0, 1, 1, 9, 9, 9]);
const IPTC = segment(0xed, ascii('Photoshop 3.0 caption'));
const COMMENT = segment(0xfe, ascii('taken at the gym'));
const QUANT = segment(0xdb, [0, ...Array.from({ length: 64 }, (_, i) => i + 1)]);
const FRAME = segment(0xc0, [8, 0, 16, 0, 16, 1, 1, 0x11, 0]);
const SCAN = [...segment(0xda, [1, 1, 0, 0, 63, 0]), 0x12, 0xff, 0x00, 0x34, 0xff, 0xd9];

const jpeg = (...parts: number[][]) => new Uint8Array([0xff, 0xd8, ...parts.flat()]);
const contains = (bytes: Uint8Array, text: string) =>
  new TextDecoder('latin1').decode(bytes).includes(text);

describe('taking the metadata out of a picture', () => {
  it('drops the location along with the rest of EXIF', () => {
    const before = jpeg(JFIF, EXIF_WITH_GPS, QUANT, FRAME, SCAN);
    const after = stripJpegMetadata(before);
    expect(contains(before, 'GPS')).toBe(true);
    expect(contains(after, 'GPS')).toBe(false);
    expect(contains(after, 'Exif')).toBe(false);
  });

  it('drops XMP, IPTC and comments too', () => {
    const after = stripJpegMetadata(jpeg(JFIF, XMP, IPTC, COMMENT, QUANT, FRAME, SCAN));
    expect(contains(after, 'xmpmeta')).toBe(false);
    expect(contains(after, 'Photoshop')).toBe(false);
    expect(contains(after, 'gym')).toBe(false);
  });

  it('leaves exactly the picture: the same bytes as a file that never had any', () => {
    const clean = jpeg(JFIF, ICC, QUANT, FRAME, SCAN);
    const dirty = jpeg(JFIF, EXIF_WITH_GPS, ICC, XMP, QUANT, COMMENT, FRAME, SCAN);
    expect([...stripJpegMetadata(dirty)]).toEqual([...clean]);
  });

  it('keeps the colour profile', () => {
    expect(contains(stripJpegMetadata(jpeg(EXIF_WITH_GPS, ICC, FRAME, SCAN)), 'ICC_PROFILE')).toBe(
      true,
    );
  });

  it('does not look for markers inside the compressed picture', () => {
    // FF E1 after the scan starts is picture data, not a block to drop.
    const scanWithLookalike = [
      ...segment(0xda, [1, 1, 0, 0, 63, 0]),
      0xff,
      0xe1,
      0x00,
      0x04,
      0xff,
      0xd9,
    ];
    const before = jpeg(EXIF_WITH_GPS, FRAME, scanWithLookalike);
    const after = stripJpegMetadata(before);
    expect([...after.slice(after.length - scanWithLookalike.length)]).toEqual(scanWithLookalike);
  });

  it('hands back a file with nothing to drop as it was', () => {
    const clean = jpeg(JFIF, QUANT, FRAME, SCAN);
    expect(stripJpegMetadata(clean)).toBe(clean);
  });

  it('leaves alone what is not a well-formed JPEG', () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(stripJpegMetadata(png)).toBe(png);
    // A block claiming to run past the end of the file.
    const truncated = new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 0x40, 0x00, 1, 2, 3]);
    expect(stripJpegMetadata(truncated)).toBe(truncated);
    // Something that is not a marker where a marker should be.
    const garbled = new Uint8Array([0xff, 0xd8, ...EXIF_WITH_GPS, 0x00, 0x11]);
    expect(stripJpegMetadata(garbled)).toBe(garbled);
    expect(stripJpegMetadata(new Uint8Array())).toEqual(new Uint8Array());
  });
});

describe('the day a picked photo was taken', () => {
  const TODAY = '2026-10-17';

  it('reads the camera’s own date', () => {
    expect(exifDay({ DateTimeOriginal: '2026:07:14 08:31:02' }, TODAY)).toBe('2026-07-14');
    expect(exifDay({ DateTime: '2026:03:01 21:00:00' }, TODAY)).toBe('2026-03-01');
  });

  it('prefers when it was taken over when it was last edited', () => {
    expect(
      exifDay({ DateTimeOriginal: '2026:01:02 10:00:00', DateTime: '2026:09:09 10:00:00' }, TODAY),
    ).toBe('2026-01-02');
  });

  it('distrusts a clock that was never set, or is ahead of today', () => {
    expect(exifDay({ DateTimeOriginal: '2000:01:01 00:00:00' }, TODAY)).toBeNull();
    expect(exifDay({ DateTimeOriginal: '2027:01:01 00:00:00' }, TODAY)).toBeNull();
    expect(exifDay({ DateTimeOriginal: '2026:02:30 00:00:00' }, TODAY)).toBeNull();
  });

  it('is nothing when there is no date to read', () => {
    expect(exifDay(null, TODAY)).toBeNull();
    expect(exifDay({}, TODAY)).toBeNull();
    expect(exifDay({ DateTimeOriginal: 20260714 }, TODAY)).toBeNull();
    expect(exifDay({ DateTimeOriginal: 'yesterday' }, TODAY)).toBeNull();
  });
});

describe('two photos side by side', () => {
  it('counts the days between them', () => {
    expect(daysBetween('2026-07-01', '2026-10-17')).toBe(108);
    expect(daysBetween('2026-10-17', '2026-10-17')).toBe(0);
    expect(daysBetween('2026-10-17', '2026-10-10')).toBe(-7);
    // Across the clocks going back, which a local-time subtraction would get wrong.
    expect(daysBetween('2026-10-24', '2026-10-26')).toBe(2);
  });

  it('puts the earlier first', () => {
    const a = { takenOn: '2026-10-01' };
    const b = { takenOn: '2026-06-01' };
    expect(inOrder(a, b)).toEqual([b, a]);
    expect(inOrder(b, a)).toEqual([b, a]);
  });

  describe('the weight beside each', () => {
    const day = (iso: string) => iso.slice(0, 10);
    const readings = [
      { measuredAt: '2026-10-16T07:00:00Z', weightKg: 72.4 },
      { measuredAt: '2026-10-10T07:00:00Z', weightKg: 73.1 },
      { measuredAt: '2026-07-01T07:00:00Z', weightKg: 78 },
      { measuredAt: '2026-07-02T07:00:00Z', weightKg: null },
    ];

    it('is the weigh-in nearest the day', () => {
      expect(weightNear(readings, '2026-10-17', day)).toBe(72.4);
      expect(weightNear(readings, '2026-10-11', day)).toBe(73.1);
      expect(weightNear(readings, '2026-07-02', day)).toBe(78);
    });

    it('is nothing when the nearest is more than a week away', () => {
      expect(weightNear(readings, '2026-08-20', day)).toBeNull();
      expect(weightNear([], '2026-10-17', day)).toBeNull();
    });
  });
});

describe('the before-and-after slider', () => {
  it('moves with the finger in English, and against the physical drag in Hebrew', () => {
    // A drag to the right: away from the start in English, towards it in Hebrew.
    expect(dividerAfterDrag(150, 40, 300, false)).toBe(190);
    expect(dividerAfterDrag(150, 40, 300, true)).toBe(110);
  });

  it('stays inside the frame however far the finger goes', () => {
    expect(dividerAfterDrag(150, 900, 300, false)).toBe(300);
    expect(dividerAfterDrag(150, -900, 300, false)).toBe(0);
    expect(dividerAfterDrag(150, 900, 300, true)).toBe(0);
  });

  it('steps a tenth at a time for a screen reader, and says how much shows', () => {
    expect(dividerStep(150, 300, false)).toBe(180);
    expect(dividerStep(150, 300, true)).toBe(120);
    expect(dividerStep(295, 300, false)).toBe(300);
    expect(shownPercent(150, 300)).toBe(50);
    expect(shownPercent(0, 0)).toBe(0);
  });
});
