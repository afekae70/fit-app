/**
 * Take the metadata out of a JPEG before it is kept or sent.
 *
 * The image picker copies the original photo's EXIF block into the file it hands back — the
 * camera model, the time, and, if the camera recorded it, where the photo was taken. A progress
 * photo is a picture of someone's body that a coach may be allowed to open; where it was taken
 * is not part of it. So every block that is not the picture itself is dropped here, in plain
 * JavaScript, before the file is written to the app's folder.
 *
 * What is dropped: APP1 (EXIF and XMP), APP3 to APP15 (IPTC, Photoshop, maker data) and
 * comments. What is kept: APP0 (JFIF), APP2 (the colour profile, without which colours shift)
 * and everything the image is drawn from. Orientation goes with EXIF, which is safe because the
 * picker turns the pixels upright when it crops and leaves the orientation tag out (see
 * `copyExifData` in expo-image-picker).
 *
 * Anything that is not a well-formed JPEG is handed back untouched rather than half-edited.
 */

const SOI = 0xd8;
const SOS = 0xda;
const EOI = 0xd9;
const COM = 0xfe;
const APP2 = 0xe2;

/** Markers with no length after them. */
const standalone = (marker: number) => marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7);

const isDropped = (marker: number) =>
  marker === COM || (marker >= 0xe1 && marker <= 0xef && marker !== APP2);

export function stripJpegMetadata(bytes: Uint8Array): Uint8Array {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== SOI) return bytes;

  const kept: Uint8Array[] = [bytes.subarray(0, 2)];
  let at = 2;
  let dropped = false;
  while (at < bytes.length) {
    if (bytes[at] !== 0xff) return bytes;
    // Any number of 0xFF may pad before a marker.
    let markerAt = at + 1;
    while (markerAt < bytes.length && bytes[markerAt] === 0xff) markerAt++;
    if (markerAt >= bytes.length) return bytes;
    const marker = bytes[markerAt]!;

    if (marker === EOI) {
      kept.push(bytes.subarray(at));
      break;
    }
    if (standalone(marker)) {
      kept.push(bytes.subarray(at, markerAt + 1));
      at = markerAt + 1;
      continue;
    }
    if (markerAt + 2 >= bytes.length) return bytes;
    const length = (bytes[markerAt + 1]! << 8) | bytes[markerAt + 2]!;
    if (length < 2) return bytes;
    const end = markerAt + 1 + length;
    if (end > bytes.length) return bytes;

    if (marker === SOS) {
      // The compressed picture runs from here to the end, markers and all: kept as it is.
      kept.push(bytes.subarray(at));
      break;
    }
    if (isDropped(marker)) dropped = true;
    else kept.push(bytes.subarray(at, end));
    at = end;
  }
  if (!dropped) return bytes;

  const total = kept.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of kept) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}
