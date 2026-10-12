/**
 * Take a photo of a meal, and ask the server what is on the plate.
 *
 * Two halves, and both live here because both are the phone talking to something that is not
 * this app: the camera, and the `scan-food` function.
 *
 * ## The photo
 *
 * From the camera or from the gallery, through `expo-image-picker`, which is already in the
 * app for the profile picture. It comes back compressed and as base64 in one step — there is
 * no image-resizing library here and none is added for this: a phone photograph at this
 * quality is around a megabyte, which is a fine thing to send once per meal, and the model
 * reads it at lower resolution than that anyway.
 *
 * The camera needs the CAMERA permission. It is asked for when the button is pressed, not
 * before, and a refusal is reported as itself — the gallery still works without it.
 *
 * ## The request
 *
 * To the Supabase function, with the signed-in session's token, exactly as sync talks to
 * Supabase. Not to the app's own API server: this feature is meant to cost nothing to run,
 * and that server is not free (see `apps/api/src/edge/scan-food.ts` for the whole of that
 * reasoning). The key the function uses never comes near the phone.
 *
 * Nothing here writes to the food log. It returns an estimate; `app/food-scan.tsx` shows it,
 * and only the person's own tap saves anything.
 */

import * as ImagePicker from 'expo-image-picker';

import { getSupabaseClient } from '../auth/client.js';
import { AI_FUNCTION_URL, SUPABASE_ANON_KEY } from '../config.js';
import { readScanResponse, type ScanFailure, type ScanOutcome } from './scanEstimate.js';

export interface MealPhoto {
  /** Where the picture is on the phone, for showing it back while the answer is awaited. */
  uri: string;
  base64: string;
  mimeType: 'image/jpeg' | 'image/png' | 'image/webp';
}

export type PhotoOutcome =
  | { ok: true; photo: MealPhoto }
  /** Backed out of the camera or the gallery. Not an error, and nothing to say about it. */
  | { ok: false; error: 'cancelled' | 'camera_denied' | 'image_too_large' | 'not_readable' };

/**
 * JPEG quality the photo is saved at. Low, deliberately: the question is "what food is this
 * and roughly how much", which survives compression that would ruin a portrait.
 */
const PHOTO_QUALITY = 0.35;

/** The server's own bound on a photo (`MAX_IMAGE_BASE64` in the function). Checked here first. */
const MAX_BASE64 = 6_000_000;

/** How long the whole round trip may take. The function gives each model forty seconds. */
const SCAN_TIMEOUT_MS = 75_000;

const PICKER_OPTIONS: ImagePicker.ImagePickerOptions = {
  mediaTypes: ['images'],
  quality: PHOTO_QUALITY,
  base64: true,
  // Where a meal was photographed is nobody's business but the eater's, and the model has no
  // use for it. Not read, so not sent.
  exif: false,
};

function photoFrom(result: ImagePicker.ImagePickerResult): PhotoOutcome {
  const asset = result.canceled ? undefined : result.assets[0];
  if (!asset) return { ok: false, error: 'cancelled' };
  if (!asset.base64) return { ok: false, error: 'not_readable' };
  if (asset.base64.length > MAX_BASE64) return { ok: false, error: 'image_too_large' };

  const type =
    asset.mimeType === 'image/png' || asset.mimeType === 'image/webp'
      ? asset.mimeType
      : 'image/jpeg';
  return { ok: true, photo: { uri: asset.uri, base64: asset.base64, mimeType: type } };
}

/** Open the camera for one photo. Asks for the permission the first time. */
export async function takeMealPhoto(): Promise<PhotoOutcome> {
  try {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) return { ok: false, error: 'camera_denied' };
    return photoFrom(await ImagePicker.launchCameraAsync(PICKER_OPTIONS));
  } catch {
    // The library refuses outright when the build does not declare the camera at all — an
    // app installed from before this feature. To the person that is the same thing: no camera.
    return { ok: false, error: 'camera_denied' };
  }
}

/** Choose a photo already taken. Android's own picker; no permission involved. */
export async function pickMealPhoto(): Promise<PhotoOutcome> {
  try {
    return photoFrom(await ImagePicker.launchImageLibraryAsync(PICKER_OPTIONS));
  } catch {
    return { ok: false, error: 'not_readable' };
  }
}

const failed = (error: ScanFailure): ScanOutcome => ({ ok: false, error });

/** Ask the server what is in the photo. Never throws: every way it can go wrong is a reason. */
export async function scanMeal(photo: MealPhoto, language: string): Promise<ScanOutcome> {
  const supabase = getSupabaseClient();
  if (!supabase || !AI_FUNCTION_URL || !SUPABASE_ANON_KEY) return failed('not_configured');

  const { data } = await supabase.auth.getSession().catch(() => ({ data: { session: null } }));
  const token = data.session?.access_token;
  if (!token) return failed('sign_in_required');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SCAN_TIMEOUT_MS);
  try {
    const response = await fetch(AI_FUNCTION_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        apikey: SUPABASE_ANON_KEY,
        'Content-Type': 'application/json',
      },
      signal: controller.signal,
      body: JSON.stringify({
        image: photo.base64,
        mimeType: photo.mimeType,
        language: language === 'en' ? 'en' : 'he',
      }),
    });
    // Read as text and parsed by hand: an error page from in front of the function is not
    // JSON, and `response.json()` throwing would turn "the function is missing" into "offline".
    const text = await response.text();
    let body: unknown = null;
    try {
      body = JSON.parse(text);
    } catch {
      body = null;
    }
    return readScanResponse(response.status, body);
  } catch {
    // No network, or no answer in time. Either way there is nothing to do but try again.
    return failed('offline');
  } finally {
    clearTimeout(timer);
  }
}
